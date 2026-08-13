"""Miniaturas para la grid del input: fotos vía Pillow, vídeos vía frame de
ffmpeg. Cache en data_dir/thumbs/<sha1(path+mtime)>.jpg — la clave incluye el
mtime, así que reemplazar un archivo invalida su miniatura sola.
"""

import hashlib
import os
import subprocess
from pathlib import Path
from uuid import uuid4

from PIL import Image, ImageOps

from ..config import get_settings

try:
    # HEIC/HEIF de iPhone; si la wheel no está disponible las fotos HEIC
    # simplemente fallarán a thumb_unavailable (graceful)
    from pillow_heif import register_heif_opener

    register_heif_opener()
except ImportError:  # pragma: no cover
    pass

THUMB_SIZE = 512

# clasificación BARATA por extensión (la real, por contenido, es del planning)
PHOTO_EXTS = {
    ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tif", ".tiff",
    ".heic", ".heif", ".avif", ".dng",
}
VIDEO_EXTS = {
    ".mp4", ".mov", ".m4v", ".avi", ".mkv", ".webm", ".3gp", ".mts", ".m2ts",
    ".wmv", ".mpg", ".mpeg",
}


class ThumbUnavailableError(Exception):
    """No se pudo generar la miniatura (formato raro, archivo corrupto o
    ffmpeg ausente) → el router lo mapea a 404 thumb_unavailable."""


def kind_for(path: Path | str) -> str:
    """photo|video|unknown por extensión."""
    ext = Path(path).suffix.lower()
    if ext in PHOTO_EXTS:
        return "photo"
    if ext in VIDEO_EXTS:
        return "video"
    return "unknown"


def get_or_create_thumb(src: Path) -> Path:
    """Devuelve la ruta de la miniatura JPEG 512px de `src`, generándola si no
    está en cache."""
    settings = get_settings()
    stat = src.stat()
    key = hashlib.sha1(f"{src}:{stat.st_mtime_ns}".encode()).hexdigest()
    dest = settings.thumbs_dir / f"{key}.jpg"
    if dest.is_file():
        return dest
    settings.thumbs_dir.mkdir(parents=True, exist_ok=True)
    # se escribe a un .part ÚNICO por intento y se renombra: una miniatura a
    # medias nunca queda cacheada como buena, y dos requests concurrentes de la
    # misma imagen no compiten por el mismo temporal (os.replace del perdedor
    # daba FileNotFoundError → 500)
    tmp = dest.with_name(f"{dest.name}.{uuid4().hex}.part")
    kind = kind_for(src)
    try:
        if kind == "photo":
            _photo_thumb(src, tmp)
        elif kind == "video":
            _video_thumb(src, tmp)
        else:
            raise ThumbUnavailableError(f"unsupported kind for {src.name}")
        os.replace(tmp, dest)
    finally:
        tmp.unlink(missing_ok=True)
    return dest


def _photo_thumb(src: Path, out: Path) -> None:
    try:
        with Image.open(src) as img:
            # respeta el tag EXIF Orientation (móviles guardan el sensor crudo)
            img = ImageOps.exif_transpose(img)
            img.thumbnail((THUMB_SIZE, THUMB_SIZE))
            img.convert("RGB").save(out, "JPEG", quality=85)
    except ThumbUnavailableError:
        raise
    except Exception as exc:  # formato no soportado, archivo corrupto…
        raise ThumbUnavailableError(str(exc)) from exc


def _video_thumb(src: Path, out: Path) -> None:
    timeout = get_settings().ffprobe_timeout_s
    # primer intento en el segundo 1 (evita fundidos de entrada negros);
    # vídeos más cortos que 1 s no tienen ese frame → reintento en el 0
    for seek in ("1", "0"):
        cmd = [
            "ffmpeg", "-y", "-loglevel", "error",
            "-ss", seek, "-i", str(src),
            "-frames:v", "1",
            "-vf", f"scale='min({THUMB_SIZE},iw)':-2",
            # el tmp acaba en .part: hay que fijar el formato explícitamente
            "-f", "image2",
            str(out),
        ]
        try:
            proc = subprocess.run(cmd, capture_output=True, timeout=timeout)
        except FileNotFoundError as exc:
            # sin ffmpeg instalado (dev sin paquete): graceful, nunca un 500
            raise ThumbUnavailableError("ffmpeg not installed") from exc
        except subprocess.TimeoutExpired as exc:
            raise ThumbUnavailableError("ffmpeg timeout") from exc
        if proc.returncode == 0 and out.is_file() and out.stat().st_size > 0:
            return
    raise ThumbUnavailableError(f"ffmpeg could not extract a frame from {src.name}")
