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


# ── subida por trozos, reanudable ────────────────────────────────────────────

CHUNK = "/api/v1/uploads/session"


def _put_chunk(client, upload_id, offset, data):
    return client.put(
        f"{CHUNK}/{upload_id}",
        content=data,
        headers={"X-Chunk-Offset": str(offset)},
    )


def test_chunked_upload_full_flow(client):
    body = b"A" * 5000
    sess = client.post(CHUNK, json={"filename": "grande.bin", "total_size": len(body)})
    assert sess.status_code == 201
    uid = sess.json()["upload_id"]
    assert sess.json() == {"upload_id": uid, "received": 0, "total_size": 5000}
    # tres trozos de 2000/2000/1000
    for off, size in [(0, 2000), (2000, 2000), (4000, 1000)]:
        r = _put_chunk(client, uid, off, body[off : off + size])
        assert r.status_code == 200
        assert r.json()["received"] == off + size
    # estado reanudable
    assert client.get(f"{CHUNK}/{uid}").json() == {
        "upload_id": uid,
        "received": 5000,
        "total_size": 5000,
    }
    done = client.post(f"{CHUNK}/{uid}/complete")
    assert done.status_code == 201
    assert done.json()["stored_name"] == "grande.bin"
    assert done.json()["size_bytes"] == 5000
    landed = get_settings().input_dir / "grande.bin"
    assert landed.read_bytes() == body


def test_chunk_retry_is_idempotent(client):
    body = b"0123456789" * 100  # 1000 bytes
    uid = client.post(CHUNK, json={"filename": "a.bin", "total_size": 1000}).json()["upload_id"]
    _put_chunk(client, uid, 0, body[:600])
    # retry del MISMO offset (el ack se perdió): trunca a 400 y reescribe
    r = _put_chunk(client, uid, 400, body[400:1000])
    assert r.status_code == 200
    assert r.json()["received"] == 1000
    client.post(f"{CHUNK}/{uid}/complete")
    assert (get_settings().input_dir / "a.bin").read_bytes() == body


def test_chunk_out_of_order_returns_received(client):
    uid = client.post(CHUNK, json={"filename": "a.bin", "total_size": 1000}).json()["upload_id"]
    _put_chunk(client, uid, 0, b"x" * 500)
    # hueco: offset 800 con solo 500 recibidos
    r = _put_chunk(client, uid, 800, b"y" * 100)
    assert r.status_code == 409
    assert r.json()["detail"] == {"slug": "chunk_out_of_order", "received": 500}


def test_chunk_session_not_found(client):
    import uuid

    missing = uuid.uuid4().hex
    assert client.get(f"{CHUNK}/{missing}").status_code == 404
    assert _put_chunk(client, missing, 0, b"x").status_code == 404
    assert client.post(f"{CHUNK}/{missing}/complete").status_code == 404
    # id no-uuid tampoco revienta: 404
    assert client.get(f"{CHUNK}/../etc").status_code in (404, 400)


def test_chunk_session_too_large(client):
    max_mb = get_settings().max_upload_mb
    resp = client.post(CHUNK, json={"filename": "x.bin", "total_size": (max_mb * 1024 * 1024) + 1})
    assert resp.status_code == 413
    assert resp.json()["detail"] == "file_too_large"


def test_chunk_overflow_aborts_session(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "max_upload_mb", 1)
    uid = client.post(CHUNK, json={"filename": "a.bin", "total_size": 500}).json()["upload_id"]
    # se declara 500 pero se manda más → 413 y la sesión se aborta
    r = _put_chunk(client, uid, 0, b"z" * 900)
    assert r.status_code == 413
    assert client.get(f"{CHUNK}/{uid}").status_code == 404


def test_complete_incomplete_returns_received(client):
    uid = client.post(CHUNK, json={"filename": "a.bin", "total_size": 1000}).json()["upload_id"]
    _put_chunk(client, uid, 0, b"x" * 400)
    r = client.post(f"{CHUNK}/{uid}/complete")
    assert r.status_code == 409
    assert r.json()["detail"] == {"slug": "upload_incomplete", "received": 400}


def test_chunk_collision_and_delete(client):
    (get_settings().input_dir / "a.bin").write_bytes(b"previo")
    uid = client.post(CHUNK, json={"filename": "a.bin", "total_size": 3}).json()["upload_id"]
    _put_chunk(client, uid, 0, b"new")
    done = client.post(f"{CHUNK}/{uid}/complete")
    assert done.json()["stored_name"] == "a (1).bin"
    # DELETE de una sesión (aborto) es idempotente
    uid2 = client.post(CHUNK, json={"filename": "b.bin", "total_size": 3}).json()["upload_id"]
    assert client.delete(f"{CHUNK}/{uid2}").status_code == 204
    assert client.get(f"{CHUNK}/{uid2}").status_code == 404
