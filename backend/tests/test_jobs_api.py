"""Contrato REST de /jobs: invariante de job único activo, descarte de planes
obsoletos, transiciones ilegales (409 con slug), 404 y paginación."""

import asyncio
import threading
import time
from pathlib import Path

from PIL import Image

from app.config import get_settings
from app.services import jobs, metadata

BASE = "/api/v1/jobs"


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


class GatedProbe:
    """Sustituye metadata.probe por una versión que se queda esperando hasta
    `release()`: congela el planning en un punto determinista."""

    def __init__(self):
        self.started = threading.Event()
        self._release = threading.Event()
        self._real = metadata.probe

    def install(self):
        real = self._real
        started, release = self.started, self._release

        async def gated(path):
            started.set()
            while not release.is_set():
                await asyncio.sleep(0.01)
            return await real(path)

        metadata.probe = gated

    def release(self):
        self._release.set()

    def restore(self):
        metadata.probe = self._real


def _planned_job(client, dest: str = "d") -> dict:
    created = client.post(BASE, json={"dest_path": dest}).json()
    return wait_for_job(client, created["id"], {"planned"})


# ── invariante de job único ────────────────────────────────────────────────


def test_409_create_while_planning(client):
    make_photo(get_settings().input_dir / "a.jpg")
    gate = GatedProbe()
    gate.install()
    try:
        created = client.post(BASE, json={"dest_path": "d"})
        assert created.status_code == 202
        assert gate.started.wait(5)
        second = client.post(BASE, json={"dest_path": "otro"})
        assert second.status_code == 409
        assert second.json()["detail"] == "job_already_active"
        gate.release()
        wait_for_job(client, created.json()["id"], {"planned"})
    finally:
        gate.restore()


def test_409_create_while_running(client):
    make_photo(get_settings().input_dir / "a.jpg")
    job = _planned_job(client)

    release = threading.Event()
    in_move = threading.Event()
    real_transfer = jobs.JobRunner._transfer_sync

    def slow_transfer(mode, source, dest):
        in_move.set()
        release.wait(10)
        return real_transfer(mode, source, dest)

    jobs.JobRunner._transfer_sync = staticmethod(slow_transfer)
    try:
        assert client.post(f"{BASE}/{job['id']}/execute").status_code == 202
        assert in_move.wait(5)
        resp = client.post(BASE, json={"dest_path": "otro"})
        assert resp.status_code == 409
        assert resp.json()["detail"] == "job_already_active"
        # ejecutar el job en marcha otra vez tampoco vale (ya no está planned)
        again = client.post(f"{BASE}/{job['id']}/execute")
        assert again.status_code == 409
        assert again.json()["detail"] == "job_not_planned"
        release.set()
        wait_for_job(client, job["id"], {"completed"})
    finally:
        jobs.JobRunner._transfer_sync = staticmethod(real_transfer)


def test_stale_planned_job_is_discarded(client):
    make_photo(get_settings().input_dir / "a.jpg")
    old = _planned_job(client, dest="viejo")
    fresh = client.post(BASE, json={"dest_path": "nuevo"})
    assert fresh.status_code == 202
    # el plan viejo ya está descartado (síncrono en la creación del nuevo)
    old_read = client.get(f"{BASE}/{old['id']}").json()
    assert old_read["status"] == "discarded"
    assert old_read["finished_at"] is not None
    wait_for_job(client, fresh.json()["id"], {"planned"})
    # y los items del plan descartado no se quedan `planned` para siempre
    old_items = client.get(f"{BASE}/{old['id']}/items").json()
    assert all(i["status"] == "cancelled" for i in old_items)


def test_no_spurious_409_right_after_completion(client):
    # tras completar, la fila de DB es terminal al instante: crear un nuevo
    # job NO debe dar 409 aunque la cola del task anterior (Immich) siga viva
    make_photo(get_settings().input_dir / "a.jpg")
    job = _planned_job(client)
    client.post(f"{BASE}/{job['id']}/execute")
    wait_for_job(client, job["id"], {"completed"})
    again = client.post(BASE, json={"dest_path": "siguiente"})
    assert again.status_code == 202


def test_job_datetimes_are_timezone_aware(client):
    # las fechas del job salen con offset explícito (+00:00): sin él, el
    # cliente las interpreta en su zona y el historial muestra fechas futuras
    job = _planned_job(client)
    created = client.get(f"{BASE}/{job['id']}").json()["created_at"]
    assert created.endswith("+00:00") or created.endswith("Z")


# ── transiciones ilegales ──────────────────────────────────────────────────


def test_execute_requires_planned(client):
    job = _planned_job(client)  # input vacío → completa al instante
    client.post(f"{BASE}/{job['id']}/execute")
    wait_for_job(client, job["id"], {"completed"})
    resp = client.post(f"{BASE}/{job['id']}/execute")
    assert resp.status_code == 409
    assert resp.json()["detail"] == "job_not_planned"


def test_execute_409_while_other_job_planning(client):
    make_photo(get_settings().input_dir / "a.jpg")
    planned = _planned_job(client)
    # se crea otro job: el planned pasa a discarded y el nuevo se congela
    gate = GatedProbe()
    gate.install()
    try:
        fresh = client.post(BASE, json={"dest_path": "otro"}).json()
        assert gate.started.wait(5)
        # ejecutar el descartado → 409 (ya no está planned)
        resp = client.post(f"{BASE}/{planned['id']}/execute")
        assert resp.status_code == 409
        assert resp.json()["detail"] == "job_not_planned"
        gate.release()
        wait_for_job(client, fresh["id"], {"planned"})
    finally:
        gate.restore()


def test_cancel_only_valid_while_active(client):
    job = _planned_job(client)
    resp = client.post(f"{BASE}/{job['id']}/cancel")
    assert resp.status_code == 409
    assert resp.json()["detail"] == "job_not_cancellable"
    client.post(f"{BASE}/{job['id']}/execute")
    wait_for_job(client, job["id"], {"completed"})
    resp = client.post(f"{BASE}/{job['id']}/cancel")
    assert resp.status_code == 409
    assert resp.json()["detail"] == "job_not_cancellable"


def test_404s(client):
    assert client.get(f"{BASE}/999").status_code == 404
    assert client.get(f"{BASE}/999").json()["detail"] == "job_not_found"
    assert client.post(f"{BASE}/999/execute").status_code == 404
    assert client.post(f"{BASE}/999/cancel").status_code == 404
    assert client.get(f"{BASE}/999/items").status_code == 404


# ── lecturas: historial y items ────────────────────────────────────────────


def test_list_jobs_desc_with_pagination(client):
    ids = []
    for dest in ("uno", "dos", "tres"):
        job = _planned_job(client, dest=dest)
        ids.append(job["id"])

    listed = client.get(BASE).json()
    assert [job["id"] for job in listed] == ids[::-1]
    # los dos primeros quedaron descartados por el siguiente
    assert [job["status"] for job in listed] == ["planned", "discarded", "discarded"]

    assert [j["id"] for j in client.get(BASE, params={"limit": 1}).json()] == [ids[2]]
    assert [
        j["id"] for j in client.get(BASE, params={"limit": 2, "offset": 1}).json()
    ] == [ids[1], ids[0]]


def test_job_read_shape(client):
    job = _planned_job(client, dest="forma")
    assert job["dest_path"] == "forma"
    assert job["transfer_mode"] == "move"
    assert job["duplicate_strategy"] == "rename"
    assert (job["total"], job["done"], job["errors"], job["skipped"]) == (0, 0, 0, 0)
    assert job["error"] is None
    assert job["immich_status"] is None
    assert job["created_at"] is not None
    assert job["started_at"] is None


def test_items_pagination_and_status_filter(client):
    root = get_settings().input_dir
    for i in range(4):
        make_photo(root / f"p{i}.jpg")
    job = _planned_job(client)

    items_url = f"{BASE}/{job['id']}/items"
    all_items = client.get(items_url).json()
    assert len(all_items) == 4
    # orden estable por id
    page = client.get(items_url, params={"limit": 2, "offset": 1}).json()
    assert [i["id"] for i in page] == [all_items[1]["id"], all_items[2]["id"]]

    assert len(client.get(items_url, params={"status": "planned"}).json()) == 4
    assert client.get(items_url, params={"status": "done"}).json() == []

    bad = client.get(items_url, params={"status": "inventado"})
    assert bad.status_code == 422
    assert bad.json()["detail"] == "invalid_item_status"
