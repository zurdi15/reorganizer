"""Metadata real por contenido: `probe(path) -> MediaInfo`.

Fotos vía Pillow (EXIF: fecha, cámara, tag Orientation) con el trabajo síncrono
en `asyncio.to_thread`; vídeos vía ffprobe JSON por subprocess asíncrono con
timeout. Es la clasificación "cara" que usan el planning y /input/probe — la
barata por extensión vive en thumbs.kind_for.
"""

import asyncio
import json
import logging
import shutil
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Literal

from PIL import ExifTags, Image

from ..config import get_settings
from .thumbs import PHOTO_EXTS, VIDEO_EXTS

try:
    # HEIC/HEIF de iPhone; sin la wheel, Pillow falla en .heic y el probe cae
    # al fallback ffprobe (graceful) — misma pauta que thumbs.py
    from pillow_heif import register_heif_opener

    register_heif_opener()
except ImportError:  # pragma: no cover
    pass

logger = logging.getLogger(__name__)

# aviso único por proceso: dev sin ffmpeg instalado debe seguir funcionando
_ffprobe_missing_warned = False

# formato EXIF estándar de DateTimeOriginal/DateTime
_EXIF_DT_FORMAT = "%Y:%m:%d %H:%M:%S"

# tags EXIF por id numérico (los nombres simbólicos varían entre versiones)
_TAG_MAKE = 271
_TAG_MODEL = 272
_TAG_DATETIME = 306
_TAG_ORIENTATION = 274
_TAG_DATETIME_ORIGINAL = 36867

# claves de cámara en tags de contenedor (QuickTime/iPhone y Android)
_MAKE_TAG_KEYS = ("com.apple.quicktime.make", "com.android.manufacturer")
_MODEL_TAG_KEYS = ("com.apple.quicktime.model", "com.android.model")


@dataclass(frozen=True)
class MediaInfo:
    media_type: Literal["photo", "video", "unknown"]
    width: int | None = None
    height: int | None = None
    # post-rotación (tag EXIF Orientation / display matrix): horizontal si w>=h
    orientation: Literal["horizontal", "vertical"] | None = None
    taken_at: datetime | None = None
    camera_make: str | None = None
    camera_model: str | None = None


_UNKNOWN = MediaInfo(media_type="unknown")


async def probe(path: Path) -> MediaInfo:
    """Punto de entrada único: clasifica y extrae metadata de UN archivo.

    Orden de despacho: extensión de foto → Pillow primero con fallback ffprobe
    (cubre HEIC sin wheel); extensión de vídeo → ffprobe primero; extensión
    desconocida → el contenido manda (Pillow, luego ffprobe). Si todo falla →
    `unknown`, jamás una excepción.
    """
    ext = path.suffix.lower()
    if ext in PHOTO_EXTS:
        info = await _probe_photo(path)
        # Pillow no pudo (p. ej. .heic sin pillow-heif): ffprobe también lee
        # dimensiones/EXIF de imágenes, pero sigue siendo una foto
        return info or await _probe_video(path, media_type="photo") or _UNKNOWN
    if ext in VIDEO_EXTS:
        info = await _probe_video(path)
        return info or await _probe_photo(path) or _UNKNOWN
    # extensión desconocida: probar como foto y después como vídeo
    info = await _probe_photo(path)
    return info or await _probe_video(path) or _UNKNOWN


# ── fotos (Pillow) ─────────────────────────────────────────────────────────


async def _probe_photo(path: Path) -> MediaInfo | None:
    # Pillow es síncrono: fuera del event loop
    return await asyncio.to_thread(_photo_info_sync, path)


def _photo_info_sync(path: Path) -> MediaInfo | None:
    try:
        with Image.open(path) as img:
            width, height = img.size
            exif = img.getexif()
    except Exception:
        # no es una imagen legible por Pillow (o está corrupta)
        return None

    taken_at = _parse_exif_datetime(
        exif.get_ifd(ExifTags.IFD.Exif).get(_TAG_DATETIME_ORIGINAL)
        or exif.get(_TAG_DATETIME)
    )
    make = _clean_exif_str(exif.get(_TAG_MAKE))
    model = _clean_exif_str(exif.get(_TAG_MODEL))

    # Orientation 5-8 = rotaciones de 90°: permutar dims ANTES de decidir
    # horizontal/vertical (los móviles guardan el sensor crudo + el tag)
    orientation_tag = exif.get(_TAG_ORIENTATION)
    if orientation_tag in (5, 6, 7, 8):
        width, height = height, width

    return MediaInfo(
        media_type="photo",
        width=width,
        height=height,
        orientation="horizontal" if width >= height else "vertical",
        taken_at=taken_at,
        camera_make=make,
        camera_model=model,
    )


def _parse_exif_datetime(value: object) -> datetime | None:
    """`2024:08:15 10:00:00` → datetime; basura o vacío → None (hay cámaras
    que escriben cualquier cosa, incluidos NULs de relleno)."""
    if value is None:
        return None
    if isinstance(value, bytes):
        value = value.decode("ascii", errors="ignore")
    text = str(value).replace("\x00", "").strip()
    try:
        return datetime.strptime(text, _EXIF_DT_FORMAT)
    except ValueError:
        return None


def _clean_exif_str(value: object) -> str | None:
    """Make/Model llegan con NULs de relleno y espacios: limpiar o None."""
    if value is None:
        return None
    if isinstance(value, bytes):
        value = value.decode("utf-8", errors="ignore")
    text = str(value).replace("\x00", "").strip()
    return text or None


# ── vídeos (ffprobe) ───────────────────────────────────────────────────────


async def _probe_video(
    path: Path, media_type: Literal["photo", "video"] = "video"
) -> MediaInfo | None:
    data = await _run_ffprobe(path)
    if data is None:
        return None
    return parse_ffprobe_output(data, media_type=media_type)


def _ffprobe_available() -> bool:
    global _ffprobe_missing_warned
    if shutil.which("ffprobe") is not None:
        return True
    if not _ffprobe_missing_warned:
        _ffprobe_missing_warned = True
        logger.warning(
            "ffprobe not found: video files will be classified as 'unknown'"
        )
    return False


async def _run_ffprobe(path: Path) -> dict | None:
    if not _ffprobe_available():
        return None
    proc = await asyncio.create_subprocess_exec(
        "ffprobe",
        "-v", "error",
        "-print_format", "json",
        "-show_format",
        "-show_streams",
        str(path),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
    )
    try:
        stdout, _ = await asyncio.wait_for(
            proc.communicate(), timeout=get_settings().ffprobe_timeout_s
        )
    except TimeoutError:
        # archivo patológico o FS colgado: matar y clasificar como ilegible
        proc.kill()
        await proc.wait()
        return None
    if proc.returncode != 0:
        return None
    try:
        data = json.loads(stdout)
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


def parse_ffprobe_output(
    data: dict, media_type: Literal["photo", "video"] = "video"
) -> MediaInfo | None:
    """JSON de ffprobe → MediaInfo. Pura y separada para poder testear
    rotaciones/tags exóticos sin fabricar contenedores reales."""
    streams = data.get("streams") or []
    video_stream = next(
        (s for s in streams if isinstance(s, dict) and s.get("codec_type") == "video"),
        None,
    )
    if video_stream is None:
        # sin stream de vídeo (audio puro, contenedor vacío…) → no es media
        return None

    width = video_stream.get("width")
    height = video_stream.get("height")
    if not isinstance(width, int) or not isinstance(height, int):
        width = height = None

    # rotación: side_data moderna (display matrix) o tag legacy `rotate`;
    # ±90/±270 permutan dims ANTES de decidir horizontal/vertical
    rotation = _extract_rotation(video_stream)
    if width is not None and height is not None and rotation % 180 == 90:
        width, height = height, width

    fmt = data.get("format") or {}
    fmt_tags = fmt.get("tags") or {}
    stream_tags = video_stream.get("tags") or {}

    taken_at = _parse_iso_datetime(
        fmt_tags.get("creation_time") or stream_tags.get("creation_time")
    )
    make = _first_tag(fmt_tags, stream_tags, _MAKE_TAG_KEYS)
    model = _first_tag(fmt_tags, stream_tags, _MODEL_TAG_KEYS)

    orientation = None
    if width is not None and height is not None:
        orientation = "horizontal" if width >= height else "vertical"

    return MediaInfo(
        media_type=media_type,
        width=width,
        height=height,
        orientation=orientation,
        taken_at=taken_at,
        camera_make=make,
        camera_model=model,
    )


def _extract_rotation(stream: dict) -> int:
    """Grados de rotación normalizados a [0, 360)."""
    raw = None
    for side_data in stream.get("side_data_list") or []:
        if isinstance(side_data, dict) and "rotation" in side_data:
            raw = side_data["rotation"]
            break
    if raw is None:
        raw = (stream.get("tags") or {}).get("rotate")
    if raw is None:
        return 0
    try:
        return int(round(float(raw))) % 360
    except (TypeError, ValueError):
        return 0


def _parse_iso_datetime(value: object) -> datetime | None:
    """creation_time ISO 8601 (tolera sufijo Z y microsegundos) → datetime."""
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).strip())
    except ValueError:
        return None


def _first_tag(
    fmt_tags: dict, stream_tags: dict, keys: tuple[str, ...]
) -> str | None:
    """Primer valor no vacío entre tags de formato y de stream (los .MOV de
    iPhone lo llevan a nivel formato; algunos Android a nivel stream)."""
    for tags in (fmt_tags, stream_tags):
        for key in keys:
            value = tags.get(key)
            if value and str(value).strip():
                return str(value).strip()
    return None
