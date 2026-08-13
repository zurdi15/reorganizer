"""Subida multipart en streaming hacia input_dir.

El cliente XHR manda 1 archivo por request (progreso por archivo), pero la
API acepta batch (≤50) para curl/scripts. Nota README: detrás de un reverse
proxy hacen falta `client_max_body_size` y `proxy_request_buffering off`.
"""

import asyncio
import logging
from dataclasses import asdict

from fastapi import APIRouter, File, HTTPException, Request, UploadFile

from ..config import get_settings
from ..schemas.uploads import UploadResult
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
