"""WebSocket /api/v1/ws: state-sync al conectar y bajo demanda, replay del
ring, secuencia item-done durante la ejecución y robustez ante basura."""

import threading
import time
from pathlib import Path

from PIL import Image

from app.config import get_settings
from app.services import jobs

BASE = "/api/v1/jobs"
WS = "/api/v1/ws"

ITEM_DONE_KEYS = {
    "job_id",
    "item_id",
    "source_path",
    "media_type",
    "orientation",
    "status",
    "dest",
    "error",
    "counters",
}
COUNTER_KEYS = {"done", "errors", "skipped", "total"}


def make_photo(path: Path, size=(64, 32)) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", size, "red").save(path)


def wait_for_job(client, job_id: int, statuses, timeout: float = 15.0) -> dict:
    deadline = time.monotonic() + timeout
    data: dict = {}
    while time.monotonic() < deadline:
        data = client.get(f"{BASE}/{job_id}").json()
        if data["status"] in statuses:
            return data
        time.sleep(0.02)
    raise AssertionError(f"job {job_id} no llegó a {statuses}: quedó en {data.get('status')}")


def plan(client, dest: str = "d") -> dict:
    created = client.post(BASE, json={"dest_path": dest}).json()
    return wait_for_job(client, created["id"], {"planned"})


# ── protocolo básico ───────────────────────────────────────────────────────


def test_state_sync_on_connect(client):
    with client.websocket_connect(WS) as ws:
        msg = ws.receive_json()
    assert msg == {"type": "state-sync", "data": {"job": None, "events": []}}


def test_sync_action_resends_state(client):
    with client.websocket_connect(WS) as ws:
        ws.receive_json()
        ws.send_json({"action": "sync"})
        msg = ws.receive_json()
        assert msg["type"] == "state-sync"


def test_garbage_messages_are_ignored(client):
    with client.websocket_connect(WS) as ws:
        ws.receive_json()
        ws.send_text("esto no es json")
        ws.send_json({"action": "fiesta"})
        ws.send_json([1, 2, 3])
        # el loop sigue vivo: un sync posterior responde
        ws.send_json({"action": "sync"})
        assert ws.receive_json()["type"] == "state-sync"


def test_state_sync_includes_active_job_and_replay(client):
    make_photo(get_settings().input_dir / "a.jpg")
    job = plan(client)
    with client.websocket_connect(WS) as ws:
        msg = ws.receive_json()
    synced = msg["data"]["job"]
    assert synced["id"] == job["id"]
    assert synced["status"] == "planned"
    # JobRead serializado entero (contadores + immich + timestamps)
    for key in ("total", "done", "errors", "skipped", "immich_status", "created_at"):
        assert key in synced
    # replay: el ring ya contiene el progreso del planning
    types = [e["type"] for e in msg["data"]["events"]]
    assert "plan-progress" in types
    assert {"type": "job-status", "data": {"job_id": job["id"], "status": "planned"}} in msg[
        "data"
    ]["events"]


# ── secuencia de ejecución ─────────────────────────────────────────────────


def test_item_done_sequence_on_execute(client):
    root = get_settings().input_dir
    make_photo(root / "a.jpg")
    make_photo(root / "b.jpg")
    job = plan(client, dest="2024/08")

    with client.websocket_connect(WS) as ws:
        assert ws.receive_json()["type"] == "state-sync"
        assert client.post(f"{BASE}/{job['id']}/execute").status_code == 202

        assert ws.receive_json() == {
            "type": "job-status",
            "data": {"job_id": job["id"], "status": "running"},
        }

        first = ws.receive_json()
        second = ws.receive_json()
        for msg in (first, second):
            assert msg["type"] == "item-done"
            data = msg["data"]
            # payload EXACTO del contrato (el frontend se construye contra esto)
            assert set(data) == ITEM_DONE_KEYS
            assert set(data["counters"]) == COUNTER_KEYS
            assert data["job_id"] == job["id"]
            assert data["status"] == "done"
            assert data["error"] is None
            assert data["media_type"] == "photo"
            assert data["orientation"] == "horizontal"
        assert first["data"]["source_path"] == "a.jpg"
        assert first["data"]["dest"] == "2024/08/photo/a.jpg"
        assert first["data"]["counters"] == {"done": 1, "errors": 0, "skipped": 0, "total": 2}
        assert second["data"]["counters"] == {"done": 2, "errors": 0, "skipped": 0, "total": 2}

        assert ws.receive_json() == {
            "type": "job-status",
            "data": {"job_id": job["id"], "status": "completed"},
        }
        assert ws.receive_json() == {
            "type": "immich",
            "data": {"job_id": job["id"], "status": "skipped"},
        }
        changed = ws.receive_json()
        assert changed["type"] == "input-changed"
        assert changed["data"]["counts"]["total"] == 0


def test_state_sync_replay_mid_run(client):
    root = get_settings().input_dir
    make_photo(root / "a.jpg")
    make_photo(root / "b.jpg")
    job = plan(client)

    real_transfer = jobs.JobRunner._transfer_sync
    in_second = threading.Event()
    release = threading.Event()
    calls: list[str] = []

    def gated_transfer(mode, source, dest):
        calls.append(str(source))
        if len(calls) == 2:
            in_second.set()
            release.wait(10)
        return real_transfer(mode, source, dest)

    jobs.JobRunner._transfer_sync = staticmethod(gated_transfer)
    try:
        client.post(f"{BASE}/{job['id']}/execute")
        assert in_second.wait(5)  # primer item hecho, segundo en vuelo
        # un cliente que (re)conecta a mitad recibe el estado completo:
        # job running + replay con lo ya ocurrido
        with client.websocket_connect(WS) as ws:
            msg = ws.receive_json()
            assert msg["data"]["job"]["status"] == "running"
            events = msg["data"]["events"]
            assert {
                "type": "job-status",
                "data": {"job_id": job["id"], "status": "running"},
            } in events
            done_items = [e for e in events if e["type"] == "item-done"]
            assert len(done_items) == 1
            assert done_items[0]["data"]["source_path"] == "a.jpg"
            release.set()
            # el mismo socket sigue recibiendo el resto del job en directo
            assert ws.receive_json()["type"] == "item-done"
            assert ws.receive_json() == {
                "type": "job-status",
                "data": {"job_id": job["id"], "status": "completed"},
            }
    finally:
        jobs.JobRunner._transfer_sync = staticmethod(real_transfer)
    wait_for_job(client, job["id"], {"completed"})
