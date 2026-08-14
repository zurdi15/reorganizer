"""Subidas multipart en streaming hacia input_dir (patrón
turtletrips/services/files.py: aiofiles por chunks + os.replace atómico).

Los `.part` viven en upload_tmp_dir (= input_dir/.rg-tmp, mismo filesystem
que el destino final — deliberado, ver config.upload_tmp_dir) para que la
finalización sea un os.replace atómico y nunca se vea un archivo a medias.
"""

import asyncio
import json
import logging
import os
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from pathlib import Path

import aiofiles
from fastapi import UploadFile

from ..config import Settings
from .paths import sanitize_filename
from .thumbs import kind_for

logger = logging.getLogger(__name__)

# streaming por chunks de 1 MiB (mismo tamaño que turtletrips/files.py)
CHUNK_SIZE = 1024 * 1024

# serializa resolver-colisión + os.replace: dos subidas simultáneas con el
# mismo nombre jamás deben elegir el mismo destino (os.replace pisa en silencio)
_finalize_lock = asyncio.Lock()


class UploadTooLargeError(Exception):
    """El archivo supera max_upload_mb (el router lo mapea a 413 file_too_large)."""


class UploadNotFoundError(Exception):
    """La sesión de subida por trozos no existe (404 upload_not_found)."""


class ChunkOutOfOrderError(Exception):
    """El offset del trozo deja un hueco respecto a lo ya recibido (409).

    Lleva `received` para que el cliente resincronice desde ahí."""

    def __init__(self, received: int) -> None:
        self.received = received
        super().__init__(f"received={received}")


class UploadIncompleteError(Exception):
    """Se pidió finalizar con menos bytes de los declarados (409).

    Lleva `received` para reanudar."""

    def __init__(self, received: int) -> None:
        self.received = received
        super().__init__(f"received={received}")


@dataclass(frozen=True)
class StoredUpload:
    """Resultado de una subida ya finalizada en input_dir."""

    # nombre tal cual lo mandó el cliente (informativo; el frontend lo
    # renderiza siempre como nodo de texto, nunca HTML)
    original_name: str
    # nombre final en input_dir (saneado y des-colisionado)
    stored_name: str
    size_bytes: int
    # photo|video|unknown por extensión (thumbs.kind_for)
    media_type: str


def clean_stale_parts(settings: Settings) -> None:
    """Al arrancar, borra los `.part`/`.meta` huérfanos de upload_tmp_dir
    (subidas cortadas por un reinicio; idempotente, tolera que el dir no exista).

    El servidor acaba de arrancar, así que NO puede haber ninguna subida en
    vuelo: todo `.part`/`.meta` presente es basura por definición (las sesiones
    por trozos no sobreviven a un reinicio; el cliente re-crea sesión). Nunca
    lanza — un tmp dir raro no debe impedir el arranque (solo se loguea).
    """
    tmp_dir = settings.upload_tmp_dir
    try:
        tmp_dir.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        logger.warning("no se pudo crear el dir de subidas %s: %s", tmp_dir, exc)
        return
    for stale in (*tmp_dir.glob("*.part"), *tmp_dir.glob("*.meta")):
        try:
            stale.unlink()
            logger.info("borrado huérfano de un arranque anterior: %s", stale.name)
        except OSError as exc:
            logger.warning("no se pudo borrar el huérfano %s: %s", stale, exc)


# ── subida por trozos, reanudable ────────────────────────────────────────────
# Sesión = <upload_id>.part (datos, se rellena por append) + <upload_id>.meta
# (JSON {original_name, total_size}). `received` = tamaño del .part en disco, así
# que reanudar tras un corte de red es un GET del estado. Un PUT con offset ≤
# recibido trunca a ese offset y reescribe (retry idempotente); offset > recibido
# es un hueco → 409. Trozos pequeños ⇒ ni el ingress ni la memoria son problema.


def _session_paths(settings: Settings, upload_id: str) -> tuple[Path, Path]:
    safe = uuid.UUID(hex=upload_id).hex  # valida el id (evita path tricks)
    tmp = settings.upload_tmp_dir
    return tmp / f"{safe}.part", tmp / f"{safe}.meta"


def _load_meta(settings: Settings, upload_id: str) -> tuple[Path, dict]:
    try:
        part, meta = _session_paths(settings, upload_id)
    except ValueError as exc:  # id no-uuid
        raise UploadNotFoundError(upload_id) from exc
    if not meta.exists() or not part.exists():
        raise UploadNotFoundError(upload_id)
    return part, json.loads(meta.read_text())


def create_session(filename: str, total_size: int, settings: Settings) -> dict:
    """Abre una sesión de subida por trozos y devuelve {upload_id, received,
    total_size}. 413 si total_size supera el límite."""
    max_bytes = settings.max_upload_mb * 1024 * 1024
    if total_size < 0 or total_size > max_bytes:
        raise UploadTooLargeError(filename)
    settings.upload_tmp_dir.mkdir(parents=True, exist_ok=True)
    upload_id = uuid.uuid4().hex
    part, meta = _session_paths(settings, upload_id)
    part.touch()
    meta.write_text(json.dumps({"original_name": filename, "total_size": total_size}))
    return {"upload_id": upload_id, "received": 0, "total_size": total_size}


def session_status(upload_id: str, settings: Settings) -> dict:
    """{received, total_size} para reanudar; 404 si la sesión no existe."""
    part, data = _load_meta(settings, upload_id)
    return {"received": part.stat().st_size, "total_size": data["total_size"]}


async def append_chunk(
    upload_id: str, offset: int, stream: AsyncIterator[bytes], settings: Settings
) -> int:
    """Escribe el trozo en `offset` y devuelve el nuevo `received`.

    offset == recibido → append normal. offset < recibido → retry: se trunca a
    offset y se reescribe (idempotente). offset > recibido → hueco (409). El
    límite total se re-verifica a mitad de stream.
    """
    part, data = _load_meta(settings, upload_id)
    total_size = data["total_size"]
    received = part.stat().st_size
    if offset > received:
        raise ChunkOutOfOrderError(received)
    if offset < 0 or offset > total_size:
        raise ChunkOutOfOrderError(received)

    # trunca a offset (idempotencia de retries) y reescribe desde ahí
    written = offset
    async with aiofiles.open(part, "r+b") as out:
        await out.truncate(offset)
        await out.seek(offset)
        async for chunk in stream:
            written += len(chunk)
            if written > total_size:
                # cliente hostil o corrupto: aborta la sesión entera
                abort_session(upload_id, settings)
                raise UploadTooLargeError(data["original_name"])
            await out.write(chunk)
    return written


async def complete_session(upload_id: str, settings: Settings) -> StoredUpload:
    """Finaliza: valida received == total, sanea el nombre, resuelve colisión
    bajo lock y os.replace atómico a input_dir. Borra el .meta."""
    part, data = _load_meta(settings, upload_id)
    received = part.stat().st_size
    total_size = data["total_size"]
    if received != total_size:
        raise UploadIncompleteError(received)
    clean = sanitize_filename(data["original_name"] or "")
    async with _finalize_lock:
        final = _next_free_path(settings.input_dir, clean)
        os.replace(part, final)  # atómico: mismo filesystem
    _, meta = _session_paths(settings, upload_id)
    meta.unlink(missing_ok=True)
    return StoredUpload(
        original_name=data["original_name"] or final.name,
        stored_name=final.name,
        size_bytes=received,
        media_type=kind_for(final),
    )


def abort_session(upload_id: str, settings: Settings) -> None:
    """Borra .part y .meta (idempotente; el DELETE del router y el overflow lo
    usan). Un id inválido o inexistente es un no-op silencioso."""
    try:
        part, meta = _session_paths(settings, upload_id)
    except ValueError:
        return
    part.unlink(missing_ok=True)
    meta.unlink(missing_ok=True)


async def store_upload(upload: UploadFile, settings: Settings) -> StoredUpload:
    """Streamea `upload` a `<uuid>.part` y lo finaliza en input_dir.

    Límite max_upload_mb enforzado A MITAD de stream (un cliente hostil no
    llena el disco antes del 413); cualquier fallo — límite, desconexión del
    cliente, short read — deja cero `.part` huérfanos (finally). El nombre
    final sale de sanitize_filename + resolución de colisiones `stem (n).ext`
    bajo lock, y aterriza con os.replace atómico (mismo filesystem).
    """
    tmp_dir = settings.upload_tmp_dir
    # parents=True crea también input_dir si faltara (el tmp cuelga de él)
    tmp_dir.mkdir(parents=True, exist_ok=True)
    part = tmp_dir / f"{uuid.uuid4().hex}.part"
    max_bytes = settings.max_upload_mb * 1024 * 1024

    size = 0
    try:
        async with aiofiles.open(part, "wb") as out:
            while chunk := await upload.read(CHUNK_SIZE):
                size += len(chunk)
                if size > max_bytes:
                    raise UploadTooLargeError(upload.filename or part.name)
                await out.write(chunk)
        clean = sanitize_filename(upload.filename or "")
        async with _finalize_lock:
            final = _next_free_path(settings.input_dir, clean)
            # atómico: .part y destino comparten filesystem (config.upload_tmp_dir)
            os.replace(part, final)
    finally:
        # tras un os.replace exitoso el .part ya no existe y esto es un no-op;
        # en cualquier fallo (límite, desconexión…) borra el parcial
        part.unlink(missing_ok=True)

    return StoredUpload(
        original_name=upload.filename or final.name,
        stored_name=final.name,
        size_bytes=size,
        media_type=kind_for(final),
    )


def _next_free_path(directory: Path, name: str) -> Path:
    """Primer destino libre: `foto.jpg`, `foto (1).jpg`, `foto (2).jpg`…

    Debe llamarse con _finalize_lock cogido: el par comprobar-existe +
    os.replace tiene que ser atómico dentro del proceso.
    """
    candidate = directory / name
    if not candidate.exists():
        return candidate
    stem, ext = Path(name).stem, Path(name).suffix
    counter = 1
    while True:
        candidate = directory / f"{stem} ({counter}){ext}"
        if not candidate.exists():
            return candidate
        counter += 1
