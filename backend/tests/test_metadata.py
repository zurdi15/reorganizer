"""Servicio de metadata (probe por contenido) + endpoint /input/probe.

Fotos: JPEGs con EXIF generados aquí mismo con Pillow (no se commitean).
Vídeos: fixtures diminutos commiteados en tests/fixtures/ (ver su README.md);
los tests que necesitan ffprobe llevan skipif para devs sin ffmpeg.
"""

import shutil
from datetime import datetime, timezone
from pathlib import Path

import pytest
from PIL import ExifTags, Image

from app.config import get_settings
from app.services import metadata

try:
    import pillow_heif
except ImportError:  # pragma: no cover
    pillow_heif = None

FIXTURES = Path(__file__).parent / "fixtures"

HAS_FFPROBE = shutil.which("ffprobe") is not None
needs_ffprobe = pytest.mark.skipif(not HAS_FFPROBE, reason="ffprobe no instalado")


def make_jpeg(
    path: Path,
    size=(64, 32),
    dt_original: str | None = None,
    exif_dt: str | None = None,
    make: str | None = None,
    model: str | None = None,
    orientation: int | None = None,
):
    path.parent.mkdir(parents=True, exist_ok=True)
    img = Image.new("RGB", size, "red")
    exif = Image.Exif()
    if dt_original:
        exif.get_ifd(ExifTags.IFD.Exif)[ExifTags.Base.DateTimeOriginal] = dt_original
    if exif_dt:
        exif[ExifTags.Base.DateTime] = exif_dt
    if make:
        exif[ExifTags.Base.Make] = make
    if model:
        exif[ExifTags.Base.Model] = model
    if orientation:
        exif[ExifTags.Base.Orientation] = orientation
    img.save(path, exif=exif)


# ── fotos (Pillow/EXIF) ────────────────────────────────────────────────────


async def test_photo_full_exif(tmp_path):
    make_jpeg(
        tmp_path / "foto.jpg",
        size=(64, 32),
        dt_original="2024:08:15 10:30:00",
        # NULs de relleno y espacios: deben limpiarse
        make="DJI\x00",
        model=" FC3582 \x00",
    )
    info = await metadata.probe(tmp_path / "foto.jpg")
    assert info.media_type == "photo"
    assert (info.width, info.height) == (64, 32)
    assert info.orientation == "horizontal"
    assert info.taken_at == datetime(2024, 8, 15, 10, 30, 0)
    assert info.camera_make == "DJI"
    assert info.camera_model == "FC3582"


async def test_photo_datetime_fallback(tmp_path):
    # sin DateTimeOriginal: cae al DateTime (306) del IFD0
    make_jpeg(tmp_path / "foto.jpg", exif_dt="2023:12:31 23:59:59")
    info = await metadata.probe(tmp_path / "foto.jpg")
    assert info.taken_at == datetime(2023, 12, 31, 23, 59, 59)


async def test_photo_orientation_tag_swaps_dims(tmp_path):
    # 64x32 con Orientation=6 (90° CW): dims post-rotación → vertical
    make_jpeg(tmp_path / "girada.jpg", size=(64, 32), orientation=6)
    info = await metadata.probe(tmp_path / "girada.jpg")
    assert (info.width, info.height) == (32, 64)
    assert info.orientation == "vertical"


async def test_photo_orientation_normal_tag_keeps_dims(tmp_path):
    # Orientation=1 (normal): sin permuta
    make_jpeg(tmp_path / "normal.jpg", size=(64, 32), orientation=1)
    info = await metadata.probe(tmp_path / "normal.jpg")
    assert (info.width, info.height) == (64, 32)
    assert info.orientation == "horizontal"


async def test_photo_vertical(tmp_path):
    make_jpeg(tmp_path / "vert.jpg", size=(32, 64))
    info = await metadata.probe(tmp_path / "vert.jpg")
    assert info.orientation == "vertical"


async def test_photo_garbage_exif_date_tolerated(tmp_path):
    make_jpeg(tmp_path / "rara.jpg", dt_original="no es una fecha")
    info = await metadata.probe(tmp_path / "rara.jpg")
    assert info.media_type == "photo"
    assert info.taken_at is None


async def test_photo_without_exif(tmp_path):
    make_jpeg(tmp_path / "pelada.jpg")
    info = await metadata.probe(tmp_path / "pelada.jpg")
    assert info.media_type == "photo"
    assert info.taken_at is None
    assert info.camera_make is None
    assert info.camera_model is None


@pytest.mark.skipif(pillow_heif is None, reason="pillow-heif no instalado")
async def test_heic_photo(tmp_path):
    # el opener registrado en metadata.py también habilita guardar HEIF
    Image.new("RGB", (64, 32), "blue").save(tmp_path / "foto.heic")
    info = await metadata.probe(tmp_path / "foto.heic")
    assert info.media_type == "photo"
    assert (info.width, info.height) == (64, 32)
    assert info.orientation == "horizontal"


# ── vídeos (ffprobe + fixtures commiteados) ────────────────────────────────


@needs_ffprobe
async def test_video_horizontal():
    info = await metadata.probe(FIXTURES / "tiny-h.mp4")
    assert info.media_type == "video"
    assert (info.width, info.height) == (64, 32)
    assert info.orientation == "horizontal"


@needs_ffprobe
async def test_video_vertical():
    info = await metadata.probe(FIXTURES / "tiny-v.mp4")
    assert info.media_type == "video"
    assert (info.width, info.height) == (32, 64)
    assert info.orientation == "vertical"
    # tiny-v no lleva creation_time
    assert info.taken_at is None


@needs_ffprobe
async def test_video_rot90_swaps_orientation():
    # 64x32 + display matrix rotation=90 → dims post-rotación → vertical
    info = await metadata.probe(FIXTURES / "tiny-rot90.mp4")
    assert (info.width, info.height) == (32, 64)
    assert info.orientation == "vertical"


@needs_ffprobe
async def test_video_creation_time():
    info = await metadata.probe(FIXTURES / "tiny-h.mp4")
    assert info.taken_at == datetime(2024, 8, 15, 10, 0, 0, tzinfo=timezone.utc)


# ── parser de ffprobe (puro, sin fabricar contenedores exóticos) ───────────


def _ffprobe_payload(**stream_extra):
    stream = {"codec_type": "video", "width": 64, "height": 32, **stream_extra}
    return {"streams": [stream], "format": {"tags": {}}}


def test_parser_legacy_rotate_tag():
    # contenedores viejos: tags.rotate en vez de display matrix
    data = _ffprobe_payload(tags={"rotate": "90"})
    info = metadata.parse_ffprobe_output(data)
    assert (info.width, info.height) == (32, 64)
    assert info.orientation == "vertical"


def test_parser_negative_rotation():
    data = _ffprobe_payload(side_data_list=[{"rotation": -90}])
    info = metadata.parse_ffprobe_output(data)
    assert (info.width, info.height) == (32, 64)


def test_parser_rotation_180_keeps_dims():
    data = _ffprobe_payload(side_data_list=[{"rotation": 180}])
    info = metadata.parse_ffprobe_output(data)
    assert (info.width, info.height) == (64, 32)
    assert info.orientation == "horizontal"


def test_parser_quicktime_make_model_format_level():
    data = _ffprobe_payload()
    data["format"]["tags"] = {
        "com.apple.quicktime.make": "Apple",
        "com.apple.quicktime.model": "iPhone 15 Pro",
    }
    info = metadata.parse_ffprobe_output(data)
    assert info.camera_make == "Apple"
    assert info.camera_model == "iPhone 15 Pro"


def test_parser_android_make_model_stream_level():
    data = _ffprobe_payload(
        tags={"com.android.manufacturer": "Google", "com.android.model": "Pixel 8"}
    )
    info = metadata.parse_ffprobe_output(data)
    assert info.camera_make == "Google"
    assert info.camera_model == "Pixel 8"


def test_parser_stream_creation_time_fallback():
    data = _ffprobe_payload(tags={"creation_time": "2024-08-15T10:00:00.000000Z"})
    info = metadata.parse_ffprobe_output(data)
    assert info.taken_at == datetime(2024, 8, 15, 10, 0, 0, tzinfo=timezone.utc)


def test_parser_garbage_creation_time():
    data = _ffprobe_payload(tags={"creation_time": "hace mucho tiempo"})
    info = metadata.parse_ffprobe_output(data)
    assert info.taken_at is None


def test_parser_no_video_stream():
    # audio puro: no clasifica como vídeo
    data = {"streams": [{"codec_type": "audio"}], "format": {}}
    assert metadata.parse_ffprobe_output(data) is None


# ── despacho por extensión y degradación ───────────────────────────────────


async def test_unknown_ext_with_photo_content(tmp_path):
    # el contenido manda: un JPEG renombrado a .bin es una foto
    make_jpeg(tmp_path / "foto.jpg", size=(64, 32))
    (tmp_path / "foto.jpg").rename(tmp_path / "misterio.bin")
    info = await metadata.probe(tmp_path / "misterio.bin")
    assert info.media_type == "photo"
    assert (info.width, info.height) == (64, 32)


async def test_txt_is_unknown(tmp_path):
    (tmp_path / "notas.txt").write_text("hola")
    info = await metadata.probe(tmp_path / "notas.txt")
    assert info == metadata.MediaInfo(media_type="unknown")


async def test_corrupt_photo_ext_without_ffprobe(tmp_path, monkeypatch):
    # foto ilegible y sin ffprobe de fallback → unknown, sin excepción
    monkeypatch.setattr(shutil, "which", lambda _cmd: None)
    (tmp_path / "rota.jpg").write_bytes(b"esto no es un jpeg")
    info = await metadata.probe(tmp_path / "rota.jpg")
    assert info.media_type == "unknown"


async def test_missing_ffprobe_classifies_video_unknown(tmp_path, monkeypatch):
    # dev sin ffmpeg: los vídeos degradan a unknown sin romper nada
    monkeypatch.setattr(shutil, "which", lambda _cmd: None)
    video = tmp_path / "video.mp4"
    shutil.copyfile(FIXTURES / "tiny-h.mp4", video)
    info = await metadata.probe(video)
    assert info.media_type == "unknown"


# ── GET /api/v1/input/probe ────────────────────────────────────────────────


def test_probe_endpoint_guards(client):
    assert client.get("/api/v1/input/probe", params={"path": "../../etc/passwd"}).status_code == 400
    assert client.get("/api/v1/input/probe", params={"path": "../../etc/passwd"}).json()["detail"] == "invalid_path"
    assert client.get("/api/v1/input/probe", params={"path": "/etc/passwd"}).status_code == 400
    assert client.get("/api/v1/input/probe", params={"path": ""}).status_code == 400
    assert client.get("/api/v1/input/probe", params={"path": "no-existe.jpg"}).status_code == 404
    assert client.get("/api/v1/input/probe", params={"path": "no-existe.jpg"}).json()["detail"] == "file_not_found"


def test_probe_endpoint_txt_unknown(client):
    root = get_settings().input_dir
    (root / "notas.txt").write_text("hola")
    resp = client.get("/api/v1/input/probe", params={"path": "notas.txt"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["media_type"] == "unknown"
    assert data["width"] is None
    assert data["orientation"] is None
    assert data["taken_at"] is None
    assert data["matched_rule"] is None


def test_probe_endpoint_photo_payload(client):
    root = get_settings().input_dir
    make_jpeg(
        root / "sub" / "foto.jpg",
        size=(64, 32),
        dt_original="2024:08:15 10:30:00",
        make="DJI",
        model="FC3582",
    )
    resp = client.get("/api/v1/input/probe", params={"path": "sub/foto.jpg"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["path"] == "sub/foto.jpg"
    assert data["name"] == "foto.jpg"
    assert data["size_bytes"] > 0
    assert data["media_type"] == "photo"
    assert data["width"] == 64
    assert data["height"] == 32
    assert data["orientation"] == "horizontal"
    assert data["taken_at"] == "2024-08-15T10:30:00"
    assert data["camera_make"] == "DJI"
    assert data["camera_model"] == "FC3582"
    # regla seed "Fotos" (media_type=photo → dest photo)
    assert data["matched_rule"]["name"] == "Fotos"
    assert data["matched_rule"]["dest"] == "photo"
    assert isinstance(data["matched_rule"]["id"], int)


@needs_ffprobe
def test_probe_endpoint_video_payload(client):
    root = get_settings().input_dir
    shutil.copyfile(FIXTURES / "tiny-rot90.mp4", root / "clip.mp4")
    resp = client.get("/api/v1/input/probe", params={"path": "clip.mp4"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["media_type"] == "video"
    assert data["width"] == 32
    assert data["height"] == 64
    assert data["orientation"] == "vertical"
