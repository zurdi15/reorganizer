import asyncio
import shutil
from io import BytesIO

from fastapi import UploadFile

from app.config import get_settings
from app.services.uploads import clean_stale_parts, store_upload


def post_files(client, *specs):
    """POST /uploads con specs (filename, content, content_type)."""
    files = [("files", (name, BytesIO(content), ctype)) for name, content, ctype in specs]
    return client.post("/api/v1/uploads", files=files)


class FakeWS:
    """Cliente WS mínimo (el router ws real llega en la oleada 3)."""

    def __init__(self):
        self.sent: list[dict] = []

    async def send_json(self, data: dict) -> None:
        self.sent.append(data)


# ── POST /uploads: casos base ──────────────────────────────────────────────


def test_single_upload_lands_in_input_sanitized(client):
    # espacios repetidos y bordes: sanitize_filename los colapsa/recorta
    resp = post_files(client, ("  Foto   Playa.jpg ", b"contenido", "image/jpeg"))
    assert resp.status_code == 201
    assert resp.json() == [
        {
            "original_name": "  Foto   Playa.jpg ",
            "stored_name": "Foto Playa.jpg",
            "size_bytes": 9,
            "media_type": "photo",
        }
    ]
    settings = get_settings()
    assert (settings.input_dir / "Foto Playa.jpg").read_bytes() == b"contenido"
    # cero .part huérfanos tras finalizar
    assert list(settings.upload_tmp_dir.glob("*.part")) == []


def test_hostile_filenames_no_traversal(client):
    resp = post_files(
        client,
        ("../../evil.jpg", b"x", "image/jpeg"),
        ("/etc/passwd", b"y", "application/octet-stream"),
    )
    assert resp.status_code == 201
    assert [r["stored_name"] for r in resp.json()] == ["evil.jpg", "passwd"]
    root = get_settings().input_dir
    assert (root / "evil.jpg").is_file()
    assert (root / "passwd").is_file()
    # nada escapó del input dir
    assert not (root.parent / "evil.jpg").exists()
    assert (root.parent / "etc") not in root.parent.iterdir()


def test_batch_of_three_and_media_type_classification(client):
    resp = post_files(
        client,
        ("a.jpg", b"1", "image/jpeg"),
        ("b.mp4", b"2", "video/mp4"),
        ("c.txt", b"3", "text/plain"),
    )
    assert resp.status_code == 201
    body = resp.json()
    assert len(body) == 3
    assert [r["media_type"] for r in body] == ["photo", "video", "unknown"]
    assert [r["stored_name"] for r in body] == ["a.jpg", "b.mp4", "c.txt"]


# ── colisiones ─────────────────────────────────────────────────────────────


def test_collision_appends_counter(client):
    for expected in ("photo.jpg", "photo (1).jpg", "photo (2).jpg"):
        resp = post_files(client, ("photo.jpg", b"data", "image/jpeg"))
        assert resp.status_code == 201
        assert resp.json()[0]["stored_name"] == expected
    stored = sorted(p.name for p in get_settings().input_dir.iterdir() if p.is_file())
    assert stored == ["photo (1).jpg", "photo (2).jpg", "photo.jpg"]


async def test_parallel_same_name_uploads_do_not_clobber(media_dirs):
    settings = get_settings()

    def mk(i: int) -> UploadFile:
        return UploadFile(BytesIO(f"contenido-{i}".encode()), filename="photo.jpg")

    results = await asyncio.gather(*(store_upload(mk(i), settings) for i in range(5)))
    names = [r.stored_name for r in results]
    # todos distintos: nadie pisó a nadie
    assert len(set(names)) == 5
    assert sorted(names) == [
        "photo (1).jpg",
        "photo (2).jpg",
        "photo (3).jpg",
        "photo (4).jpg",
        "photo.jpg",
    ]
    # y cada archivo conserva su contenido íntegro
    contents = sorted((settings.input_dir / n).read_bytes() for n in names)
    assert contents == sorted(f"contenido-{i}".encode() for i in range(5))
    assert list(settings.upload_tmp_dir.glob("*.part")) == []


# ── límite de tamaño ───────────────────────────────────────────────────────


def test_oversize_upload_413_no_leftovers(client, monkeypatch):
    settings = get_settings()
    # get_settings está lru_cacheado y el env se fijó antes de importar la app:
    # se parchea el atributo del objeto vivo (monkeypatch lo restaura al salir)
    monkeypatch.setattr(settings, "max_upload_mb", 1)
    # 2 MiB con límite de 1 MiB: el corte ocurre A MITAD de stream (chunk 2)
    resp = post_files(client, ("grande.mp4", b"\0" * (2 * 1024 * 1024), "video/mp4"))
    assert resp.status_code == 413
    assert resp.json()["detail"] == "file_too_large"
    # ni .part huérfano ni archivo final
    assert list(settings.upload_tmp_dir.glob("*.part")) == []
    assert not (settings.input_dir / "grande.mp4").exists()


# ── validaciones de la request ─────────────────────────────────────────────


def test_no_files_rejected(client):
    resp = client.post("/api/v1/uploads")
    assert resp.status_code == 422
    assert resp.json()["detail"] == "no_files"


def test_more_than_50_files_rejected(client):
    specs = [(f"f{i}.jpg", b"x", "image/jpeg") for i in range(51)]
    resp = post_files(client, *specs)
    assert resp.status_code == 422
    assert resp.json()["detail"] == "too_many_files"
    # nada llegó a escribirse
    assert list(get_settings().input_dir.glob("*.jpg")) == []


# ── clean_stale_parts ──────────────────────────────────────────────────────


def test_clean_stale_parts_removes_leftovers(media_dirs):
    settings = get_settings()
    tmp = settings.upload_tmp_dir
    tmp.mkdir(parents=True, exist_ok=True)
    (tmp / "abandonada.part").write_bytes(b"x")
    (tmp / "otra.part").write_bytes(b"y")
    # solo se barren los *.part: cualquier otra cosa se respeta
    (tmp / "ajeno.txt").write_bytes(b"z")
    clean_stale_parts(settings)
    assert list(tmp.glob("*.part")) == []
    assert (tmp / "ajeno.txt").is_file()


def test_clean_stale_parts_survives_missing_dir(media_dirs):
    settings = get_settings()
    # ni siquiera existe input_dir: no debe lanzar y deja el tmp creado
    shutil.rmtree(settings.input_dir, ignore_errors=True)
    clean_stale_parts(settings)
    assert settings.upload_tmp_dir.is_dir()


# ── broadcast input-changed ────────────────────────────────────────────────


def test_upload_broadcasts_input_changed(app, client):
    fake = FakeWS()
    app.state.broadcaster.add(fake)
    resp = post_files(
        client,
        ("a.jpg", b"x", "image/jpeg"),
        ("b.txt", b"y", "text/plain"),
    )
    assert resp.status_code == 201
    # un único evento por batch, con los contadores frescos del input
    events = [e for e in fake.sent if e["type"] == "input-changed"]
    assert events == [
        {
            "type": "input-changed",
            "data": {"counts": {"total": 2, "photo": 1, "video": 0, "unknown": 1}},
        }
    ]
    assert len(fake.sent) == 1
    # y queda apuntado en el ring de replay para el state-sync
    assert events[0] in app.state.broadcaster.events
