"""Subida multipart en streaming hacia input_dir.

El cliente XHR manda 1 archivo por request (progreso por archivo), pero la
API acepta batch (≤50) para curl/scripts. Nota README: detrás de un reverse
proxy hacen falta `client_max_body_size` y `proxy_request_buffering off`.
"""

import asyncio
import logging
from dataclasses import asdict

from fastapi import APIRouter, File, Header, HTTPException, Request, UploadFile

from ..config import get_settings
from ..schemas.uploads import (
    ChunkAck,
    UploadResult,
    UploadSession,
    UploadSessionCreate,
)
from ..services import uploads as uploads_service
from .input import summary as input_summary

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/uploads", tags=["uploads"])

# tope por request multipart: defiende la API abierta de batches absurdos
MAX_FILES_PER_REQUEST = 50


@router.post("", status_code=201, response_model=list[UploadResult])
async def upload_files(
    request: Request,
    # File(None) en vez de File(...): una request sin archivos debe fallar
    # con nuestro slug 422 no_files, no con el error de validación genérico
    files: list[UploadFile] | None = File(None),
) -> list[UploadResult]:
    if not files:
        raise HTTPException(status_code=422, detail="no_files")
    if len(files) > MAX_FILES_PER_REQUEST:
        raise HTTPException(status_code=422, detail="too_many_files")
    settings = get_settings()
    results: list[UploadResult] = []
    try:
        for upload in files:
            stored = await uploads_service.store_upload(upload, settings)
            results.append(UploadResult(**asdict(stored)))
    except uploads_service.UploadTooLargeError:
        # los archivos ya finalizados del batch se quedan (el input cambió de
        # verdad): se emite el evento igualmente antes de fallar la request
        if results:
            await _broadcast_input_changed(request)
        raise HTTPException(status_code=413, detail="file_too_large") from None
    await _broadcast_input_changed(request)
    return results


# ── subida por trozos, reanudable (para archivos grandes, varios GB) ──────────


@router.post("/session", status_code=201, response_model=UploadSession)
def create_session(body: UploadSessionCreate) -> UploadSession:
    settings = get_settings()
    try:
        session = uploads_service.create_session(body.filename, body.total_size, settings)
    except uploads_service.UploadTooLargeError:
        raise HTTPException(status_code=413, detail="file_too_large") from None
    return UploadSession(**session)


@router.get("/session/{upload_id}", response_model=UploadSession)
def get_session(upload_id: str) -> UploadSession:
    settings = get_settings()
    try:
        status = uploads_service.session_status(upload_id, settings)
    except uploads_service.UploadNotFoundError:
        raise HTTPException(status_code=404, detail="upload_not_found") from None
    return UploadSession(upload_id=upload_id, **status)


@router.put("/session/{upload_id}", response_model=ChunkAck)
async def put_chunk(
    upload_id: str,
    request: Request,
    x_chunk_offset: int = Header(...),
) -> ChunkAck:
    settings = get_settings()
    try:
        received = await uploads_service.append_chunk(
            upload_id, x_chunk_offset, request.stream(), settings
        )
    except uploads_service.UploadNotFoundError:
        raise HTTPException(status_code=404, detail="upload_not_found") from None
    except uploads_service.ChunkOutOfOrderError as exc:
        # 409 + received para que el cliente resincronice el offset
        raise HTTPException(
            status_code=409, detail={"slug": "chunk_out_of_order", "received": exc.received}
        ) from None
    except uploads_service.UploadTooLargeError:
        raise HTTPException(status_code=413, detail="file_too_large") from None
    return ChunkAck(received=received)


@router.post("/session/{upload_id}/complete", status_code=201, response_model=UploadResult)
async def complete_session(upload_id: str, request: Request) -> UploadResult:
    settings = get_settings()
    try:
        stored = await uploads_service.complete_session(upload_id, settings)
    except uploads_service.UploadNotFoundError:
        raise HTTPException(status_code=404, detail="upload_not_found") from None
    except uploads_service.UploadIncompleteError as exc:
        raise HTTPException(
            status_code=409, detail={"slug": "upload_incomplete", "received": exc.received}
        ) from None
    await _broadcast_input_changed(request)
    return UploadResult(**asdict(stored))


@router.delete("/session/{upload_id}", status_code=204)
def delete_session(upload_id: str) -> None:
    uploads_service.abort_session(upload_id, get_settings())


async def _broadcast_input_changed(request: Request) -> None:
    """Emite `input-changed` con contadores frescos del input; best-effort —
    un fallo del hub jamás convierte una subida buena en un 500. Sin clientes
    conectados (tests, arranque) el broadcast solo apunta al ring de replay."""
    broadcaster = getattr(request.app.state, "broadcaster", None)
    if broadcaster is None:  # apps de test que montan el router a pelo
        return
    try:
        # os.walk síncrono fuera del event loop (input grande no bloquea)
        counts = (await asyncio.to_thread(input_summary)).model_dump()
        await broadcaster.broadcast({"type": "input-changed", "data": {"counts": counts}})
    except Exception:
        logger.warning("no se pudo emitir input-changed tras la subida", exc_info=True)
