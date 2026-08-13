import io
import shutil
import subprocess

import pytest
from PIL import Image

from app.config import get_settings
from app.services import thumbs


def make_photo(path, size=(1200, 800)):
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", size, "orange").save(path, "JPEG")


HAS_FFMPEG = shutil.which("ffmpeg") is not None


def make_video(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            "ffmpeg", "-y", "-loglevel", "error",
            "-f", "lavfi", "-i", "testsrc=duration=2:size=64x48:rate=10",
            str(path),
        ],
        check=True,
    )


def test_kind_for_extensions():
    assert thumbs.kind_for("a.JPG") == "photo"
    assert thumbs.kind_for("a.heic") == "photo"
    assert thumbs.kind_for("DJI_0042.MP4") == "video"
    assert thumbs.kind_for("a.txt") == "unknown"
    assert thumbs.kind_for("sin_extension") == "unknown"


def test_photo_thumb_generated_and_cached(client):
    settings = get_settings()
    make_photo(settings.input_dir / "foto.jpg")

    resp = client.get("/api/v1/input/preview", params={"path": "foto.jpg", "thumb": 1})
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "image/jpeg"
    with Image.open(io.BytesIO(resp.content)) as thumb:
        assert max(thumb.size) == 512  # reescalada al lado largo exacto

    cached = list(settings.thumbs_dir.glob("*.jpg"))
    assert len(cached) == 1
    first_mtime = cached[0].stat().st_mtime_ns

    # segunda petición: sirve la cache, no regenera
    resp2 = client.get("/api/v1/input/preview", params={"path": "foto.jpg", "thumb": 1})
    assert resp2.status_code == 200
    cached2 = list(settings.thumbs_dir.glob("*.jpg"))
    assert len(cached2) == 1
    assert cached2[0].stat().st_mtime_ns == first_mtime


def test_small_photo_not_upscaled(client):
    settings = get_settings()
    make_photo(settings.input_dir / "mini.jpg", size=(100, 60))
    resp = client.get("/api/v1/input/preview", params={"path": "mini.jpg", "thumb": 1})
    with Image.open(io.BytesIO(resp.content)) as thumb:
        assert thumb.size == (100, 60)


def test_corrupt_photo_maps_to_404(client):
    settings = get_settings()
    bad = settings.input_dir / "rota.jpg"
    bad.write_bytes(b"esto no es un jpeg")
    resp = client.get("/api/v1/input/preview", params={"path": "rota.jpg", "thumb": 1})
    assert resp.status_code == 404
    assert resp.json()["detail"] == "thumb_unavailable"
    # una miniatura fallida no deja basura en la cache
    assert not any(settings.thumbs_dir.glob("*"))


def test_unknown_kind_maps_to_404(client):
    settings = get_settings()
    (settings.input_dir / "doc.txt").write_text("hola")
    resp = client.get("/api/v1/input/preview", params={"path": "doc.txt", "thumb": 1})
    assert resp.status_code == 404
    assert resp.json()["detail"] == "thumb_unavailable"


@pytest.mark.skipif(not HAS_FFMPEG, reason="ffmpeg no instalado")
def test_video_thumb_generated(client):
    settings = get_settings()
    make_video(settings.input_dir / "clip.mp4")
    resp = client.get("/api/v1/input/preview", params={"path": "clip.mp4", "thumb": 1})
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "image/jpeg"
    with Image.open(io.BytesIO(resp.content)) as thumb:
        assert thumb.size[0] <= 512
    assert len(list(settings.thumbs_dir.glob("*.jpg"))) == 1


def test_thumb_cache_key_includes_mtime(media_dirs):
    # reemplazar el archivo (mtime nuevo) debe invalidar la miniatura vieja
    settings = get_settings()
    src = settings.input_dir / "foto.jpg"
    make_photo(src)
    first = thumbs.get_or_create_thumb(src)
    make_photo(src, size=(600, 400))
    second = thumbs.get_or_create_thumb(src)
    assert first != second
