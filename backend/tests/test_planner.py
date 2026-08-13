"""Planificación de jobs (dry-run asíncrono): rutas por regla, fallback
`_unknown`, progreso WS, colisiones previstas, defaults y fallos.

Los tasks del runner corren en el event loop del TestClient (vive en un hilo
del portal mientras el `with` está abierto): los tests esperan con un poll
acotado sobre GET /jobs/{id}.
"""

import asyncio
import shutil
import threading
import time
from pathlib import Path

import pytest
from PIL import Image

from app.config import get_settings
from app.services import metadata

FIXTURES = Path(__file__).parent / "fixtures"
HAS_FFPROBE = shutil.which("ffprobe") is not None
needs_ffprobe = pytest.mark.skipif(not HAS_FFPROBE, reason="ffprobe no instalado")

BASE = "/api/v1/jobs"


def make_photo(path: Path, size=(64, 32)) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", size, "red").save(path)


def wait_for_job(client, job_id: int, statuses, timeout: float = 15.0) -> dict:
    """Poll acotado hasta que el task de fondo deje el job en un estado dado."""
    deadline = time.monotonic() + timeout
    data: dict = {}
    while time.monotonic() < deadline:
        data = client.get(f"{BASE}/{job_id}").json()
        if data["status"] in statuses:
            return data
        time.sleep(0.02)
    raise AssertionError(f"job {job_id} no llegó a {statuses}: quedó en {data.get('status')}")


def items_by_source(client, job_id: int) -> dict[str, dict]:
    items = client.get(f"{BASE}/{job_id}/items").json()
    return {item["source_path"]: item for item in items}


# ── planning básico ────────────────────────────────────────────────────────


def test_create_job_plans_photo_and_unknown(client):
    root = get_settings().input_dir
    make_photo(root / "foto.jpg")
    (root / "notas.txt").write_text("hola")

    resp = client.post(BASE, json={"dest_path": "2024/08/prueba"})
    assert resp.status_code == 202
    created = resp.json()
    assert created["status"] == "planning"

    job = wait_for_job(client, created["id"], {"planned"})
    assert job["total"] == 2
    assert job["error"] is None

    items = items_by_source(client, created["id"])
    foto = items["foto.jpg"]
    assert foto["planned_dest"] == "2024/08/prueba/photo/foto.jpg"
    assert isinstance(foto["matched_rule_id"], int)
    assert foto["media_type"] == "photo"
    assert foto["orientation"] == "horizontal"
    assert foto["size_bytes"] > 0
    assert foto["status"] == "planned"
    # sin regla que matchee (unknown) → fallback built-in _unknown/
    txt = items["notas.txt"]
    assert txt["planned_dest"] == "2024/08/prueba/_unknown/notas.txt"
    assert txt["matched_rule_id"] is None
    assert txt["media_type"] == "unknown"


@needs_ffprobe
def test_plan_routes_dji_and_phone_video(client):
    root = get_settings().input_dir
    # DJI en mayúsculas: la regla seed matchea por regex case-insensitive
    shutil.copyfile(FIXTURES / "tiny-h.mp4", root / "DJI_0001.MP4")
    shutil.copyfile(FIXTURES / "tiny-v.mp4", root / "clip.mp4")

    created = client.post(BASE, json={"dest_path": "d"}).json()
    wait_for_job(client, created["id"], {"planned"})

    items = items_by_source(client, created["id"])
    assert items["DJI_0001.MP4"]["planned_dest"] == "d/video/horizontal/dron/mini3/DJI_0001.MP4"
    assert items["clip.mp4"]["planned_dest"] == "d/video/vertical/phone/clip.mp4"
    assert items["clip.mp4"]["orientation"] == "vertical"


def test_plan_empty_input(client):
    created = client.post(BASE, json={"dest_path": "d"}).json()
    job = wait_for_job(client, created["id"], {"planned"})
    assert job["total"] == 0
    assert client.get(f"{BASE}/{created['id']}/items").json() == []


def test_plan_scans_recursively_and_skips_hidden(client):
    root = get_settings().input_dir
    make_photo(root / "sub" / "anidada.jpg")
    (root / ".oculto.jpg").write_bytes(b"x")
    (root / ".rg-tmp").mkdir(exist_ok=True)  # clean_stale_parts ya lo crea al arrancar
    (root / ".rg-tmp" / "a.part").write_bytes(b"x")

    created = client.post(BASE, json={"dest_path": "d"}).json()
    job = wait_for_job(client, created["id"], {"planned"})
    assert job["total"] == 1
    items = items_by_source(client, created["id"])
    assert items["sub/anidada.jpg"]["planned_dest"] == "d/photo/anidada.jpg"


# ── progreso WS ────────────────────────────────────────────────────────────


def _plan_progress_events(app):
    return [e["data"] for e in app.state.broadcaster.events if e["type"] == "plan-progress"]


def test_plan_progress_every_item_for_small_batches(app, client):
    root = get_settings().input_dir
    for i in range(3):
        make_photo(root / f"p{i}.jpg")
    created = client.post(BASE, json={"dest_path": "d"}).json()
    wait_for_job(client, created["id"], {"planned"})

    events = _plan_progress_events(app)
    assert [e["scanned"] for e in events] == [1, 2, 3]
    assert all(e["total"] == 3 for e in events)
    assert all(e["job_id"] == created["id"] for e in events)


def test_plan_progress_throttled_for_big_batches(app, client):
    root = get_settings().input_dir
    make_photo(root / "p000.jpg")
    for i in range(1, 52):
        shutil.copyfile(root / "p000.jpg", root / f"p{i:03d}.jpg")
    created = client.post(BASE, json={"dest_path": "d"}).json()
    wait_for_job(client, created["id"], {"planned"})

    # >50 archivos: cada 5 y siempre el último
    scanned = [e["scanned"] for e in _plan_progress_events(app)]
    assert scanned == [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 52]


# ── validación y defaults ──────────────────────────────────────────────────


def test_create_job_validates_dest_path(client):
    for dest in ("../fuera", "/absoluta", "", "a/../b"):
        resp = client.post(BASE, json={"dest_path": dest})
        assert resp.status_code == 400, dest
        assert resp.json()["detail"] == "invalid_path"


def test_create_job_validates_modes(client):
    resp = client.post(BASE, json={"dest_path": "d", "transfer_mode": "teleport"})
    assert resp.status_code == 422
    assert resp.json()["detail"] == "invalid_transfer_mode"
    resp = client.post(BASE, json={"dest_path": "d", "duplicate_strategy": "explotar"})
    assert resp.status_code == 422
    assert resp.json()["detail"] == "invalid_duplicate_strategy"


def test_create_job_defaults_from_settings(client):
    resp = client.put(
        "/api/v1/settings",
        json={"default_transfer_mode": "copy", "default_duplicate_strategy": "skip"},
    )
    assert resp.status_code == 200
    created = client.post(BASE, json={"dest_path": "d"}).json()
    assert created["transfer_mode"] == "copy"
    assert created["duplicate_strategy"] == "skip"
    wait_for_job(client, created["id"], {"planned"})


# ── colisiones previstas (flag de solo-lectura) ────────────────────────────


def test_collision_flags_on_planned_items(client):
    root = get_settings().input_dir
    make_photo(root / "x.jpg")
    make_photo(root / "y.jpg")
    # dos sources distintos con el mismo nombre → mismo planned_dest
    make_photo(root / "sub1" / "z.jpg")
    make_photo(root / "sub2" / "z.jpg")
    # x.jpg ya existe en el destino en disco
    out = get_settings().output_dir / "d" / "photo"
    out.mkdir(parents=True)
    (out / "x.jpg").write_bytes(b"ya estaba")

    created = client.post(BASE, json={"dest_path": "d"}).json()
    wait_for_job(client, created["id"], {"planned"})

    items = items_by_source(client, created["id"])
    assert items["x.jpg"]["collision"] is True
    assert items["y.jpg"]["collision"] is False
    assert items["sub1/z.jpg"]["collision"] is True
    assert items["sub2/z.jpg"]["collision"] is True
    # el flag no cambia el estado del plan
    assert all(item["status"] == "planned" for item in items.values())


def test_collision_flag_null_outside_planned(client):
    root = get_settings().input_dir
    make_photo(root / "a.jpg")
    created = client.post(BASE, json={"dest_path": "d"}).json()
    wait_for_job(client, created["id"], {"planned"})
    client.post(f"{BASE}/{created['id']}/execute")
    wait_for_job(client, created["id"], {"completed"})
    items = client.get(f"{BASE}/{created['id']}/items").json()
    assert items[0]["collision"] is None


# ── fallo y cancelación durante el planning ────────────────────────────────


def test_plan_failure_marks_job_failed(app, client, monkeypatch):
    async def boom(_path):
        raise RuntimeError("probe roto")

    monkeypatch.setattr(metadata, "probe", boom)
    make_photo(get_settings().input_dir / "a.jpg")

    created = client.post(BASE, json={"dest_path": "d"}).json()
    job = wait_for_job(client, created["id"], {"failed"})
    assert job["error"] == "plan_failed"
    events = list(app.state.broadcaster.events)
    assert {"type": "job-error", "data": {"job_id": created["id"], "slug": "plan_failed"}} in events
    assert {"type": "job-status", "data": {"job_id": created["id"], "status": "failed"}} in events


def test_cancel_during_planning(client):
    root = get_settings().input_dir
    for i in range(3):
        make_photo(root / f"p{i}.jpg")

    started = threading.Event()
    release = threading.Event()
    real_probe = metadata.probe

    async def gated(path):
        started.set()
        while not release.is_set():
            await asyncio.sleep(0.01)
        return await real_probe(path)

    metadata.probe = gated
    try:
        created = client.post(BASE, json={"dest_path": "d"}).json()
        assert started.wait(5)
        resp = client.post(f"{BASE}/{created['id']}/cancel")
        assert resp.status_code == 202
        release.set()
        job = wait_for_job(client, created["id"], {"cancelled"})
        assert job["finished_at"] is not None
        # ningún item queda `planned` tras cancelar
        items = client.get(f"{BASE}/{created['id']}/items").json()
        assert all(item["status"] == "cancelled" for item in items)
    finally:
        metadata.probe = real_probe
