from pathlib import Path

from PIL import ExifTags, Image

from app.config import get_settings


def make_jpeg(path: Path, size=(32, 24), exif_dt: str | None = None, dt_original: str | None = None):
    path.parent.mkdir(parents=True, exist_ok=True)
    img = Image.new("RGB", size, "red")
    if exif_dt or dt_original:
        exif = Image.Exif()
        if exif_dt:
            exif[ExifTags.Base.DateTime] = exif_dt
        if dt_original:
            exif.get_ifd(ExifTags.IFD.Exif)[ExifTags.Base.DateTimeOriginal] = dt_original
        img.save(path, exif=exif)
    else:
        img.save(path)


def touch(path: Path, content: bytes = b"x"):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)


# ── GET /input/files ───────────────────────────────────────────────────────


def test_list_files_recursive_skips_dotfiles(client):
    root = get_settings().input_dir
    make_jpeg(root / "a.jpg")
    touch(root / "sub" / "b.mp4")
    touch(root / "notas.txt")
    # basura que NUNCA debe listarse: dotfiles, dot-dirs y .rg-tmp (subidas a medias)
    touch(root / ".oculto.jpg")
    touch(root / ".rg-tmp" / "subida.part")
    touch(root / "sub" / ".DS_Store")

    resp = client.get("/api/v1/input/files")
    assert resp.status_code == 200
    files = resp.json()
    assert [f["path"] for f in files] == ["a.jpg", "notas.txt", "sub/b.mp4"]
    by_path = {f["path"]: f for f in files}
    assert by_path["a.jpg"]["kind"] == "photo"
    assert by_path["sub/b.mp4"]["kind"] == "video"
    assert by_path["notas.txt"]["kind"] == "unknown"
    assert by_path["sub/b.mp4"]["name"] == "b.mp4"
    assert by_path["a.jpg"]["size_bytes"] > 0
    assert by_path["a.jpg"]["mtime"] > 0


def test_list_files_empty_input(client):
    assert client.get("/api/v1/input/files").json() == []


# ── GET /input/summary ─────────────────────────────────────────────────────


def test_summary_counts_by_kind(client):
    root = get_settings().input_dir
    make_jpeg(root / "a.jpg")
    make_jpeg(root / "b.jpeg")
    touch(root / "c.mp4")
    touch(root / "d.txt")
    touch(root / ".ignorado.jpg")

    resp = client.get("/api/v1/input/summary")
    assert resp.status_code == 200
    assert resp.json() == {"total": 4, "photo": 2, "video": 1, "unknown": 1}


# ── GET /input/dates ───────────────────────────────────────────────────────


def test_dates_samples_exif(client):
    root = get_settings().input_dir
    make_jpeg(root / "a.jpg", dt_original="2024:08:07 10:00:00")
    make_jpeg(root / "b.jpg", dt_original="2024:09:01 09:00:00")
    # sin DateTimeOriginal pero con DateTime del IFD0: vale como fallback
    make_jpeg(root / "c.jpg", exif_dt="2023:12:31 23:59:59")
    # sin EXIF ninguno: se ignora sin romper
    make_jpeg(root / "d.jpg")
    # no-foto: jamás se abre con Pillow
    touch(root / "e.mp4")

    resp = client.get("/api/v1/input/dates")
    assert resp.status_code == 200
    data = resp.json()
    assert data["years"] == ["2024", "2023"]
    assert data["months_by_year"] == {"2024": ["08", "09"], "2023": ["12"]}


def test_dates_empty_input(client):
    assert client.get("/api/v1/input/dates").json() == {"years": [], "months_by_year": {}}


# ── GET /input/preview ─────────────────────────────────────────────────────


def test_preview_serves_original(client):
    root = get_settings().input_dir
    make_jpeg(root / "sub" / "foto.jpg")
    resp = client.get("/api/v1/input/preview", params={"path": "sub/foto.jpg"})
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "image/jpeg"


def test_preview_supports_range(client):
    # el scrub de vídeo del frontend depende de esto (Starlette moderno lo trae)
    root = get_settings().input_dir
    touch(root / "video.mp4", b"0123456789")
    resp = client.get(
        "/api/v1/input/preview", params={"path": "video.mp4"}, headers={"Range": "bytes=0-3"}
    )
    assert resp.status_code == 206
    assert resp.content == b"0123"


def test_preview_guards(client):
    assert client.get("/api/v1/input/preview", params={"path": "../../etc/passwd"}).status_code == 400
    assert client.get("/api/v1/input/preview", params={"path": "../../etc/passwd"}).json()["detail"] == "invalid_path"
    assert client.get("/api/v1/input/preview", params={"path": "/etc/passwd"}).status_code == 400
    assert client.get("/api/v1/input/preview", params={"path": ""}).status_code == 400
    assert client.get("/api/v1/input/preview", params={"path": "no-existe.jpg"}).status_code == 404
    assert client.get("/api/v1/input/preview", params={"path": "no-existe.jpg"}).json()["detail"] == "file_not_found"


def test_preview_symlink_escape_rejected(client):
    root = get_settings().input_dir
    secret = root.parent / "secreto.txt"
    secret.write_text("privado")
    (root / "alias.txt").symlink_to(secret)
    resp = client.get("/api/v1/input/preview", params={"path": "alias.txt"})
    assert resp.status_code == 400
    assert resp.json()["detail"] == "invalid_path"


# ── DELETE /input/files ────────────────────────────────────────────────────


def test_delete_file(client):
    root = get_settings().input_dir
    touch(root / "borrar.txt")
    resp = client.delete("/api/v1/input/files", params={"path": "borrar.txt"})
    assert resp.status_code == 204
    assert not (root / "borrar.txt").exists()


def test_delete_guards(client):
    assert client.delete("/api/v1/input/files", params={"path": "../fuera.txt"}).status_code == 400
    assert client.delete("/api/v1/input/files", params={"path": "/etc/passwd"}).status_code == 400
    assert client.delete("/api/v1/input/files", params={"path": "no-existe.txt"}).status_code == 404


# ── GET /input/probe ───────────────────────────────────────────────────────
# Implementado en la oleada 2 (fase 3): la cobertura completa del endpoint y
# del servicio de metadata vive en tests/test_metadata.py.


# ── health ─────────────────────────────────────────────────────────────────


def test_health(client):
    resp = client.get("/api/v1/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}
