"""Subidas multipart en streaming hacia input_dir (patrón
turtletrips/services/files.py: aiofiles por chunks + os.replace atómico).

Los `.part` viven en upload_tmp_dir (= input_dir/.rg-tmp, mismo filesystem
que el destino final — deliberado, ver config.upload_tmp_dir) para que la
finalización sea un os.replace atómico y nunca se vea un archivo a medias.
"""

import asyncio
import logging
import os
import uuid
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
    """Al arrancar, borra los `.part` huérfanos de upload_tmp_dir (subidas
    cortadas por un reinicio; idempotente, tolera que el dir no exista).

    El servidor acaba de arrancar, así que NO puede haber ninguna subida en
    vuelo: todo `.part` presente es basura por definición. Nunca lanza — un
    tmp dir raro no debe impedir el arranque (solo se loguea el aviso).
    """
    tmp_dir = settings.upload_tmp_dir
    try:
        tmp_dir.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        logger.warning("no se pudo crear el dir de subidas %s: %s", tmp_dir, exc)
        return
    for part in tmp_dir.glob("*.part"):
        try:
            part.unlink()
            logger.info("borrado .part huérfano de un arranque anterior: %s", part.name)
        except OSError as exc:
            logger.warning("no se pudo borrar el .part huérfano %s: %s", part, exc)


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
