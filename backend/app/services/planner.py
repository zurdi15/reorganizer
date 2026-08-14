"""Planificación de jobs: el planning ES el dry-run.

Corre como asyncio.Task en el event loop (lo lanza el JobRunner) con su
PROPIA sesión de DB — jamás la sesión de una request. Por cada archivo del
input: probe de metadata (Pillow/ffprobe) + motor de reglas → un JobItem con
su destino previsto; progreso por WS con `plan-progress` y cierre con
`job-status` planned (o failed/cancelled).
"""

import asyncio
import logging
import os
from collections.abc import Iterator
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from ..config import get_settings
from ..models import Job, JobItem, Rule, utcnow
from . import metadata
from . import rules as rules_engine
from .broadcaster import Broadcaster

logger = logging.getLogger(__name__)

# commit por lotes durante el planning (WAL): ni un commit por archivo ni
# una transacción gigante que se pierda entera ante un fallo
BATCH_COMMIT_EVERY = 20

# throttle de plan-progress: con pocos archivos se emite cada item; a partir
# de este umbral, cada PROGRESS_EVERY (y siempre el último)
PROGRESS_THROTTLE_THRESHOLD = 50
PROGRESS_EVERY = 5


class PlanError(Exception):
    """Fallo fatal del planning; `slug` acaba en Job.error y en el evento WS."""

    def __init__(self, slug: str) -> None:
        self.slug = slug
        super().__init__(slug)


async def run_planning(
    job_id: int,
    session_factory: sessionmaker[Session],
    broadcaster: Broadcaster,
    cancel_event: asyncio.Event,
) -> None:
    """Task de planificación de un job recién creado (status `planning`).

    Nunca deja el job en `planning`: termina en planned, cancelled o failed
    (el estado colgado del código viejo muere aquí).
    """
    with session_factory() as session:
        job = session.get(Job, job_id)
        if job is None:  # borrado entre la creación y el arranque del task
            return
        try:
            await _plan(session, job, broadcaster, cancel_event)
        except PlanError as exc:
            await _fail(session, job, broadcaster, exc.slug)
        except Exception:
            logger.exception("planning del job %s falló", job_id)
            await _fail(session, job, broadcaster, "plan_failed")


async def _plan(
    session: Session, job: Job, broadcaster: Broadcaster, cancel_event: asyncio.Event
) -> None:
    settings = get_settings()
    input_dir = settings.input_dir
    if not input_dir.is_dir():
        raise PlanError("input_dir_missing")

    # scan recursivo (solo archivos, sin dotfiles ni .rg-tmp) fuera del loop
    files = await asyncio.to_thread(lambda: list(_scan_input(input_dir)))
    total = len(files)
    job.total = total
    session.commit()
    logger.info("job %s: planificando %d archivos → %s", job.id, total, job.dest_path)

    # el motor filtra enabled/prioridad por sí mismo
    rules = list(session.scalars(select(Rule)))
    every = 1 if total <= PROGRESS_THROTTLE_THRESHOLD else PROGRESS_EVERY

    pending = 0
    for index, path in enumerate(files, start=1):
        if cancel_event.is_set():
            _cancel_planning(session, job)
            await broadcaster.broadcast(_status_event(job))
            return
        try:
            info = await metadata.probe(path)
            stat = path.stat()
        except (FileNotFoundError, OSError):
            # el archivo desapareció entre el scan y el probe: se omite en vez
            # de tumbar el plan entero (total se ajusta para no mentir)
            logger.info("archivo desaparecido durante el planning, omitido: %s", path)
            job.total -= 1
            continue
        matched = rules_engine.match_and_render(rules, info, path.name)
        if matched is None:
            rule_id: int | None = None
            rendered = rules_engine.UNKNOWN_DEST
        else:
            rule_id, rendered = matched[0].id, matched[1]
        session.add(
            JobItem(
                job_id=job.id,
                source_path=path.relative_to(input_dir).as_posix(),
                size_bytes=stat.st_size,
                media_type=info.media_type,
                orientation=info.orientation,
                taken_at=info.taken_at,
                camera_make=info.camera_make,
                camera_model=info.camera_model,
                matched_rule_id=rule_id,
                # rel a output_dir: dest del job / carpeta de la regla / nombre
                planned_dest=f"{job.dest_path}/{rendered}/{path.name}",
            )
        )
        pending += 1
        if pending >= BATCH_COMMIT_EVERY:
            session.commit()
            pending = 0
        if index % every == 0 or index == total:
            await broadcaster.broadcast(
                {
                    "type": "plan-progress",
                    "data": {"job_id": job.id, "scanned": index, "total": total},
                }
            )

    # recheck final: una cancelación que llega tras el último item pero antes
    # de sellar `planned` no debe perderse
    if cancel_event.is_set():
        _cancel_planning(session, job)
        await broadcaster.broadcast(_status_event(job))
        return

    job.status = "planned"
    session.commit()
    logger.info("job %s: plan listo (%d items)", job.id, job.total)
    await broadcaster.broadcast(_status_event(job))


def _scan_input(root: Path) -> Iterator[Path]:
    """Walker local (mismas reglas que routers/input._iter_files: solo
    archivos, orden estable, sin dotfiles ni dot-dirs como `.rg-tmp`);
    duplicado aquí a propósito para no importar un router desde un servicio."""
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if not d.startswith("."))
        for name in sorted(filenames):
            if name.startswith("."):
                continue
            yield Path(dirpath) / name


def _cancel_planning(session: Session, job: Job) -> None:
    """Cancelación cooperativa a mitad de planning: los items ya insertados
    se marcan cancelled y el job cierra en `cancelled`."""
    session.rollback()  # descarta el lote a medias sin commitear
    for item in session.scalars(
        select(JobItem).where(JobItem.job_id == job.id, JobItem.status == "planned")
    ):
        item.status = "cancelled"
    job.status = "cancelled"
    job.finished_at = utcnow()
    session.commit()


async def _fail(session: Session, job: Job, broadcaster: Broadcaster, slug: str) -> None:
    """Cierre en `failed` + job-error: un job jamás se queda en `planning`."""
    session.rollback()
    job.status = "failed"
    job.error = slug
    job.finished_at = utcnow()
    session.commit()
    await broadcaster.broadcast(
        {"type": "job-error", "data": {"job_id": job.id, "slug": slug}}
    )
    await broadcaster.broadcast(_status_event(job))


def _status_event(job: Job) -> dict:
    return {"type": "job-status", "data": {"job_id": job.id, "status": job.status}}
