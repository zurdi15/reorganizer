"""Ejecución de jobs: transferencias, duplicados, errores por item, cancel,
missing, Immich y recovery. El planning se cubre en test_planner.py."""

import shutil
import threading
import time
from pathlib import Path

from PIL import Image

from app.config import get_settings
from app.models import Job, JobItem
from app.services import immich, jobs
from app.services.jobs import recover_interrupted_jobs

BASE = "/api/v1/jobs"


def make_photo(path: Path, size=(64, 32), color="red") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", size, color).save(path)


def wait_for_job(client, job_id: int, statuses, timeout: float = 15.0) -> dict:
    deadline = time.monotonic() + timeout
    data: dict = {}
    while time.monotonic() < deadline:
        data = client.get(f"{BASE}/{job_id}").json()
        if data["status"] in statuses:
            return data
        time.sleep(0.02)
    raise AssertionError(f"job {job_id} no llegó a {statuses}: quedó en {data.get('status')}")


def plan(client, dest: str = "d", **body) -> dict:
    created = client.post(BASE, json={"dest_path": dest, **body}).json()
    return wait_for_job(client, created["id"], {"planned"})


def run(client, job_id: int, final=("completed",)) -> dict:
    assert client.post(f"{BASE}/{job_id}/execute").status_code == 202
    return wait_for_job(client, job_id, final)


def items_by_source(client, job_id: int) -> dict[str, dict]:
    return {i["source_path"]: i for i in client.get(f"{BASE}/{job_id}/items").json()}


# ── camino feliz ───────────────────────────────────────────────────────────


def test_execute_moves_files_and_empties_input(client):
    root = get_settings().input_dir
    make_photo(root / "foto1.jpg")
    make_photo(root / "foto2.jpg")
    (root / "notas.txt").write_text("hola")

    job = plan(client, dest="2025/08/prueba")
    result = run(client, job["id"])

    out = get_settings().output_dir
    assert (out / "2025/08/prueba/photo/foto1.jpg").is_file()
    assert (out / "2025/08/prueba/photo/foto2.jpg").is_file()
    assert (out / "2025/08/prueba/_unknown/notas.txt").is_file()
    # move: el input queda vacío
    assert client.get("/api/v1/input/summary").json()["total"] == 0

    assert (result["done"], result["errors"], result["skipped"]) == (3, 0, 0)
    assert result["total"] == 3
    assert result["started_at"] is not None
    assert result["finished_at"] is not None
    # sin Immich configurado el trigger es soft: skipped
    assert result["immich_status"] == "skipped"

    items = items_by_source(client, job["id"])
    assert all(item["status"] == "done" for item in items.values())
    assert all(item["final_dest"] == item["planned_dest"] for item in items.values())


def test_copy_mode_keeps_source(client):
    root = get_settings().input_dir
    make_photo(root / "a.jpg")
    job = plan(client, transfer_mode="copy")
    run(client, job["id"])
    assert (root / "a.jpg").is_file()
    assert (get_settings().output_dir / "d/photo/a.jpg").is_file()
    assert client.get("/api/v1/input/summary").json()["total"] == 1


# ── duplicados ─────────────────────────────────────────────────────────────


def _seed_collision(dest_bytes: bytes | None = None) -> Path:
    """input/a.jpg + output/d/photo/a.jpg (idéntico si dest_bytes es None)."""
    root = get_settings().input_dir
    make_photo(root / "a.jpg")
    out = get_settings().output_dir / "d" / "photo"
    out.mkdir(parents=True)
    if dest_bytes is None:
        shutil.copyfile(root / "a.jpg", out / "a.jpg")
    else:
        (out / "a.jpg").write_bytes(dest_bytes)
    return out / "a.jpg"


def test_identical_duplicate_deletes_source(client):
    existing = _seed_collision()
    original = existing.read_bytes()
    job = plan(client)
    result = run(client, job["id"])

    item = items_by_source(client, job["id"])["a.jpg"]
    assert item["status"] == "duplicate"
    assert item["final_dest"] == "d/photo/a.jpg"
    # hash calculado y persistido (solo hay colisión con mismo tamaño)
    assert isinstance(item["content_hash"], str) and len(item["content_hash"]) == 64
    # el source se borra del input (ya estaba organizado) y el destino no se toca
    assert not (get_settings().input_dir / "a.jpg").exists()
    assert existing.read_bytes() == original
    assert result["done"] == 1


def test_identical_duplicate_copy_mode_keeps_source(client):
    # en modo copy el origen se preserva: copiar nunca destruye el input
    existing = _seed_collision()
    original = existing.read_bytes()
    job = plan(client, transfer_mode="copy")
    result = run(client, job["id"])

    item = items_by_source(client, job["id"])["a.jpg"]
    assert item["status"] == "duplicate"
    assert (get_settings().input_dir / "a.jpg").is_file()
    assert existing.read_bytes() == original
    assert result["done"] == 1


def test_duplicate_rename_strategy(client):
    existing = _seed_collision(dest_bytes=b"contenido distinto")
    job = plan(client, duplicate_strategy="rename")
    run(client, job["id"])

    item = items_by_source(client, job["id"])["a.jpg"]
    assert item["status"] == "done"
    assert item["final_dest"] == "d/photo/a (1).jpg"
    out = get_settings().output_dir
    assert existing.read_bytes() == b"contenido distinto"  # el viejo no se pisa
    assert (out / "d/photo/a (1).jpg").is_file()
    assert not (get_settings().input_dir / "a.jpg").exists()


def test_duplicate_skip_strategy(client):
    _seed_collision(dest_bytes=b"contenido distinto")
    job = plan(client, duplicate_strategy="skip")
    result = run(client, job["id"])

    item = items_by_source(client, job["id"])["a.jpg"]
    assert item["status"] == "skipped"
    assert item["final_dest"] is None
    # el archivo sigue en el input (no se pierde nada en silencio)
    assert (get_settings().input_dir / "a.jpg").is_file()
    assert result["skipped"] == 1
    assert result["status"] == "completed"


def test_duplicate_overwrite_strategy(client):
    existing = _seed_collision(dest_bytes=b"viejo")
    source_bytes = (get_settings().input_dir / "a.jpg").read_bytes()
    job = plan(client, duplicate_strategy="overwrite")
    run(client, job["id"])

    item = items_by_source(client, job["id"])["a.jpg"]
    assert item["status"] == "done"
    assert item["final_dest"] == "d/photo/a.jpg"
    assert existing.read_bytes() == source_bytes
    assert not (get_settings().input_dir / "a.jpg").exists()


def test_same_size_different_content_follows_strategy(client):
    # mismo tamaño pero bytes distintos: se hashean ambos y NO es duplicado
    root = get_settings().input_dir
    (root / "data.bin").write_bytes(b"AAAA")
    out = get_settings().output_dir / "d" / "_unknown"
    out.mkdir(parents=True)
    (out / "data.bin").write_bytes(b"AAAB")

    job = plan(client, duplicate_strategy="rename")
    run(client, job["id"])

    item = items_by_source(client, job["id"])["data.bin"]
    assert item["status"] == "done"
    assert item["final_dest"] == "d/_unknown/data (1).bin"
    assert isinstance(item["content_hash"], str) and len(item["content_hash"]) == 64
    assert (out / "data.bin").read_bytes() == b"AAAB"
    assert (out / "data (1).bin").read_bytes() == b"AAAA"


def test_intra_batch_collision_overwrite_keeps_both(client):
    # dos fuentes distintas con el mismo nombre en subcarpetas del input →
    # mismo planned_dest. Con overwrite, la segunda JAMÁS debe machacar a la
    # primera que este mismo job acaba de escribir (pérdida de datos).
    root = get_settings().input_dir
    make_photo(root / "viaje" / "IMG.jpg", color="red")
    make_photo(root / "casa" / "IMG.jpg", color="blue")

    job = plan(client, duplicate_strategy="overwrite")
    result = run(client, job["id"])

    out = get_settings().output_dir / "d" / "photo"
    # ambos preservados: el segundo se renombra pese a la estrategia overwrite
    assert (out / "IMG.jpg").is_file()
    assert (out / "IMG (1).jpg").is_file()
    assert result["done"] == 2
    assert result["errors"] == 0


def test_failed_transfer_leaves_no_truncated_final(client):
    # una copia que falla a mitad NO debe dejar un archivo con el nombre
    # canónico en la librería (stage-then-replace): ni final ni .rg-part.
    root = get_settings().input_dir
    make_photo(root / "grande.jpg")

    real_copy = jobs.shutil.copy2

    def broken_copy(src, dst, *a, **k):
        Path(dst).write_bytes(b"copia a medias")  # deja un temporal parcial
        raise OSError("disco lleno a mitad de copia")

    # forzamos la rama cross-device (copy+replace) y rompemos la copia
    real_rename = jobs.os.rename

    def exdev_rename(src, dst):
        raise OSError("EXDEV")

    jobs.os.rename = exdev_rename
    jobs.shutil.copy2 = broken_copy
    try:
        job = plan(client)
        result = run(client, job["id"], final=("completed_with_errors",))
    finally:
        jobs.os.rename = real_rename
        jobs.shutil.copy2 = real_copy

    item = items_by_source(client, job["id"])["grande.jpg"]
    assert item["status"] == "error"
    assert item["error"] == "transfer_failed"
    out_dir = get_settings().output_dir / "d" / "photo"
    # ni el final canónico ni ningún temporal .rg-part sobreviven
    assert not (out_dir / "grande.jpg").exists()
    assert list(out_dir.glob(".*rg-part")) == []
    # el origen intacto en el input para reintentar
    assert (root / "grande.jpg").is_file()
    assert result["errors"] == 1


# ── errores por item, missing y cancelación ────────────────────────────────


def test_item_error_does_not_kill_job(client):
    root = get_settings().input_dir
    make_photo(root / "bien1.jpg")
    make_photo(root / "boom.jpg")
    make_photo(root / "bien2.jpg")

    real_transfer = jobs.JobRunner._transfer_sync

    def failing_transfer(mode, source, dest):
        if "boom" in str(source):
            raise OSError("disco lleno")
        return real_transfer(mode, source, dest)

    jobs.JobRunner._transfer_sync = staticmethod(failing_transfer)
    try:
        job = plan(client)
        result = run(client, job["id"], final=("completed_with_errors",))
    finally:
        jobs.JobRunner._transfer_sync = staticmethod(real_transfer)

    assert (result["done"], result["errors"], result["skipped"]) == (2, 1, 0)
    items = items_by_source(client, job["id"])
    assert items["boom.jpg"]["status"] == "error"
    assert items["boom.jpg"]["error"] == "transfer_failed"
    assert items["bien1.jpg"]["status"] == "done"
    assert items["bien2.jpg"]["status"] == "done"
    out = get_settings().output_dir
    assert (out / "d/photo/bien1.jpg").is_file()
    assert (out / "d/photo/bien2.jpg").is_file()
    # el archivo fallido se queda en el input para reintentar organizando otra vez
    assert (root / "boom.jpg").is_file()


def test_missing_source_between_plan_and_execute(client):
    root = get_settings().input_dir
    make_photo(root / "queda.jpg")
    make_photo(root / "desaparece.jpg")
    job = plan(client)
    (root / "desaparece.jpg").unlink()

    result = run(client, job["id"])
    items = items_by_source(client, job["id"])
    assert items["desaparece.jpg"]["status"] == "missing"
    assert items["queda.jpg"]["status"] == "done"
    assert (result["done"], result["errors"], result["skipped"]) == (1, 0, 1)
    assert result["status"] == "completed"


def test_cancel_mid_run(client):
    root = get_settings().input_dir
    for i in range(4):
        make_photo(root / f"p{i}.jpg")
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
        assert client.post(f"{BASE}/{job['id']}/execute").status_code == 202
        assert in_second.wait(5)  # item 1 hecho, item 2 en vuelo
        resp = client.post(f"{BASE}/{job['id']}/cancel")
        assert resp.status_code == 202
        release.set()
        result = wait_for_job(client, job["id"], {"cancelled"})
    finally:
        jobs.JobRunner._transfer_sync = staticmethod(real_transfer)

    # el item en vuelo termina (cancelación cooperativa entre items);
    # el resto queda cancelled y el job cierra en cancelled
    assert result["done"] == 2
    statuses = [i["status"] for i in client.get(f"{BASE}/{job['id']}/items").json()]
    assert statuses.count("done") == 2
    assert statuses.count("cancelled") == 2
    assert result["finished_at"] is not None
    assert result["immich_status"] is None  # cancelado → sin rescan


# ── Immich y eventos de cierre ─────────────────────────────────────────────


def test_immich_triggered_on_completion(app, client, monkeypatch):
    calls: list[int] = []

    async def fake_trigger(session, **kwargs):
        calls.append(1)
        return "ok"

    monkeypatch.setattr(immich, "trigger_scan", fake_trigger)
    make_photo(get_settings().input_dir / "a.jpg")
    job = plan(client)
    result = run(client, job["id"])

    assert calls == [1]
    assert result["immich_status"] == "ok"
    events = list(app.state.broadcaster.events)
    assert {"type": "immich", "data": {"job_id": job["id"], "status": "ok"}} in events
    # input-changed con contadores frescos al cerrar el job
    input_changed = [e for e in events if e["type"] == "input-changed"]
    assert input_changed
    assert input_changed[-1]["data"]["counts"]["total"] == 0


def test_job_status_events_on_execute(app, client):
    make_photo(get_settings().input_dir / "a.jpg")
    job = plan(client)
    run(client, job["id"])
    statuses = [
        e["data"]["status"]
        for e in app.state.broadcaster.events
        if e["type"] == "job-status" and e["data"]["job_id"] == job["id"]
    ]
    assert statuses == ["planning", "planned", "running", "completed"]


# ── recovery al arrancar ───────────────────────────────────────────────────


def test_recover_interrupted_jobs(db_session):
    planning = Job(status="planning", dest_path="d")
    running = Job(status="running", dest_path="d")
    finished = Job(status="completed", dest_path="d")
    db_session.add_all([planning, running, finished])
    db_session.flush()
    pending = JobItem(job_id=running.id, source_path="a.jpg", status="planned")
    done = JobItem(job_id=running.id, source_path="b.jpg", status="done")
    db_session.add_all([pending, done])
    db_session.commit()

    recover_interrupted_jobs(db_session)

    assert planning.status == "interrupted"
    assert running.status == "interrupted"
    assert planning.finished_at is not None
    assert finished.status == "completed"
    db_session.refresh(pending)
    db_session.refresh(done)
    assert pending.status == "cancelled"
    assert done.status == "done"

    # idempotente: una segunda pasada no toca nada
    recover_interrupted_jobs(db_session)
    assert planning.status == "interrupted"
