"""Ciclo de vida de jobs: creación, ejecución, cancelación y recovery.

El `JobRunner` (en app.state.job_runner) gobierna el ÚNICO job activo del
proceso: lanza los tasks de planning/ejecución en el event loop y crea sus
PROPIAS sesiones de DB por task — jamás comparte la sesión de una request
con un task de fondo. La ejecución es por-item con try/except (un error
nunca mata el job), check de cancelación cooperativa entre items y commit
por item (WAL): el crash a mitad deja un historial veraz.
"""

import asyncio
import hashlib
import logging
import os
import shutil
from pathlib import Path
from uuid import uuid4

from sqlalchemy import select, update
from sqlalchemy.orm import Session, sessionmaker

from ..config import get_settings
from ..models import Job, JobItem, utcnow
from . import immich, planner
from .broadcaster import Broadcaster
from .paths import PathError, resolve_under

logger = logging.getLogger(__name__)

# estados con un task de fondo vivo (o que debería estarlo)
ACTIVE_STATUSES = ("planning", "running")
# estados cancelables por POST /jobs/{id}/cancel
CANCELLABLE_STATUSES = ("planning", "running")

# sha256 por chunks de 1 MiB (solo ante colisión de destino con mismo tamaño)
_HASH_CHUNK = 1024 * 1024


class JobConflictError(Exception):
    """Transición de estado ilegal; `slug` → 409 con detail i18n en el router."""

    def __init__(self, slug: str) -> None:
        self.slug = slug
        super().__init__(slug)


def recover_interrupted_jobs(session: Session) -> None:
    """Al arrancar, marca `interrupted` los jobs que quedaron en
    `planning|running` por un reinicio del proceso (idempotente); sus items
    aún `planned` pasan a `cancelled` — el historial nunca miente."""
    jobs = list(session.scalars(select(Job).where(Job.status.in_(ACTIVE_STATUSES))))
    if not jobs:
        return
    now = utcnow()
    for job in jobs:
        job.status = "interrupted"
        job.finished_at = now
    session.execute(
        update(JobItem)
        .where(JobItem.job_id.in_([job.id for job in jobs]), JobItem.status == "planned")
        .values(status="cancelled")
    )
    session.commit()
    logger.warning("recovery: %d job(s) marcados interrupted tras un reinicio", len(jobs))


class JobRunner:
    """Único punto que muta el ciclo de vida de jobs en caliente.

    `_lock` da exclusión mutua a las transiciones (crear/ejecutar/cancelar);
    `cancel_event` es el canal de cancelación cooperativa del task activo y
    se estrena en cada task nuevo.
    """

    def __init__(
        self, session_factory: sessionmaker[Session], broadcaster: Broadcaster
    ) -> None:
        self.session_factory = session_factory
        self.broadcaster = broadcaster
        self.active_task: asyncio.Task | None = None
        self.active_job_id: int | None = None
        self.cancel_event = asyncio.Event()
        self._lock = asyncio.Lock()
        # tasks vivos retenidos: un asyncio.Task sin referencia fuerte puede
        # ser recogido por el GC a medias. Aquí caben el task activo y los que
        # aún corren su cola (p. ej. el trigger de Immich tras completar).
        self._background: set[asyncio.Task] = set()

    # ── transiciones (las consume el router) ───────────────────────────────

    async def create_job(
        self, dest_path: str, transfer_mode: str, duplicate_strategy: str
    ) -> Job:
        """Crea el job en `planning` y lanza el task de planificación.

        409 `job_already_active` si hay un job planning|running; un job
        `planned` sin ejecutar se marca `discarded` (el input ya no es el
        mismo: su plan quedó obsoleto).
        """
        async with self._lock:
            with self.session_factory() as session:
                # la fila de DB es la autoridad: un task recién completado que
                # aún corre su cola (Immich) NO debe provocar un 409 espurio
                if self._db_active_job(session) is not None:
                    raise JobConflictError("job_already_active")
                stale_ids: list[int] = []
                for stale in session.scalars(select(Job).where(Job.status == "planned")):
                    stale.status = "discarded"
                    stale.finished_at = utcnow()
                    stale_ids.append(stale.id)
                if stale_ids:
                    # sus items dejan de estar `planned` para siempre
                    session.execute(
                        update(JobItem)
                        .where(
                            JobItem.job_id.in_(stale_ids),
                            JobItem.status == "planned",
                        )
                        .values(status="cancelled")
                    )
                job = Job(
                    status="planning",
                    dest_path=dest_path,
                    transfer_mode=transfer_mode,
                    duplicate_strategy=duplicate_strategy,
                )
                session.add(job)
                session.commit()
                self._spawn(
                    job.id,
                    lambda event: planner.run_planning(
                        job.id, self.session_factory, self.broadcaster, event
                    ),
                )
            await self.broadcaster.broadcast(_status_event(job))
            return job

    async def execute_job(self, job_id: int) -> Job:
        """`planned` → `running` + task de ejecución (409 en cualquier otro
        estado; `job_already_active` si otro job sigue vivo)."""
        async with self._lock:
            with self.session_factory() as session:
                job = session.get(Job, job_id)
                if job is None or job.status != "planned":
                    raise JobConflictError("job_not_planned")
                if self._db_active_job(session) is not None:
                    raise JobConflictError("job_already_active")
                job.status = "running"
                job.started_at = utcnow()
                session.commit()
                self._spawn(job.id, lambda _event: self._execute(job.id))
            await self.broadcaster.broadcast(_status_event(job))
            return job

    async def cancel_job(self, job_id: int) -> Job:
        """Cancelación cooperativa: válida en planning|running (el task la
        aplica entre items); 409 `job_not_cancellable` en el resto."""
        async with self._lock:
            with self.session_factory() as session:
                job = session.get(Job, job_id)
                if job is None or job.status not in CANCELLABLE_STATUSES:
                    raise JobConflictError("job_not_cancellable")
                self.cancel_event.set()
                return job

    # ── internos ───────────────────────────────────────────────────────────

    def _task_alive(self) -> bool:
        return self.active_task is not None and not self.active_task.done()

    def _db_active_job(self, session: Session) -> int | None:
        return session.scalar(
            select(Job.id).where(Job.status.in_(ACTIVE_STATUSES)).limit(1)
        )

    def _spawn(self, job_id: int, make_coro) -> None:
        """Estrena cancel_event ANTES de construir la corrutina (el task debe
        recibir el evento nuevo, no el del job anterior) y retiene el task en
        `_background` (sin referencia, el GC puede matar un asyncio.Task a
        medias — incluida la cola de Immich de un job ya completado)."""
        self.cancel_event = asyncio.Event()
        self.active_job_id = job_id
        task = asyncio.create_task(make_coro(self.cancel_event))
        self.active_task = task
        self._background.add(task)
        task.add_done_callback(self._background.discard)

    async def _execute(self, job_id: int) -> None:
        """Task de ejecución. Nunca deja el job en `running`: termina en
        completed, completed_with_errors, cancelled o failed."""
        with self.session_factory() as session:
            job = session.get(Job, job_id)
            if job is None:
                return
            try:
                await self._run_items(session, job)
            except Exception:
                logger.exception("ejecución del job %s falló", job_id)
                session.rollback()
                job.status = "failed"
                job.error = "job_failed"
                job.finished_at = utcnow()
                session.commit()
                await self.broadcaster.broadcast(
                    {"type": "job-error", "data": {"job_id": job.id, "slug": job.error}}
                )
                await self.broadcaster.broadcast(_status_event(job))

    async def _run_items(self, session: Session, job: Job) -> None:
        settings = get_settings()
        items = list(
            session.scalars(
                select(JobItem)
                .where(JobItem.job_id == job.id, JobItem.status == "planned")
                .order_by(JobItem.id)
            )
        )
        # destinos ya escritos por ESTE job: nunca sobrescribir un archivo que
        # el propio job acaba de producir (dos fuentes con el mismo nombre)
        produced: set[Path] = set()
        for index, item in enumerate(items):
            if self.cancel_event.is_set():
                await self._finish_cancelled(session, job, items[index:])
                return
            await self._run_item(
                session, job, item, settings.input_dir, settings.output_dir, produced
            )
            session.commit()
            await self.broadcaster.broadcast(_item_done_event(job, item))

        job.status = "completed" if job.errors == 0 else "completed_with_errors"
        job.finished_at = utcnow()
        session.commit()
        await self.broadcaster.broadcast(_status_event(job))

        # rescan de Immich (soft-fail: trigger_scan jamás lanza) + aviso de
        # que el input cambió, con contadores frescos
        job.immich_status = await immich.trigger_scan(session)
        session.commit()
        await self.broadcaster.broadcast(
            {"type": "immich", "data": {"job_id": job.id, "status": job.immich_status}}
        )
        await self._broadcast_input_changed()

    async def _run_item(
        self,
        session: Session,
        job: Job,
        item: JobItem,
        input_dir: Path,
        output_dir: Path,
        produced: set[Path],
    ) -> None:
        """Un archivo: resolución guarded, duplicados, transferencia. El
        try/except por item es el corazón del engine: un error jamás mata
        el job (el estado colgado del código viejo)."""
        try:
            # re-resolución guarded del source: pudo cambiar desde el planning
            source = resolve_under(input_dir, item.source_path)
            if not source.is_file():
                item.status = "missing"
                job.skipped += 1
                return
            dest = resolve_under(output_dir, item.planned_dest)
            final = dest
            await asyncio.to_thread(dest.parent.mkdir, parents=True, exist_ok=True)
            if await asyncio.to_thread(dest.exists):
                if dest.stat().st_size == source.stat().st_size:
                    src_hash = await asyncio.to_thread(_sha256, source)
                    dst_hash = await asyncio.to_thread(_sha256, dest)
                    item.content_hash = src_hash
                    if src_hash == dst_hash:
                        # duplicado idéntico: ya está organizado. En modo move
                        # se limpia del input (decisión de producto: input vacío
                        # tras cada job); en modo copy el origen se preserva
                        # porque copiar nunca debe destruir el input.
                        if job.transfer_mode == "move":
                            await asyncio.to_thread(source.unlink)
                        item.status = "duplicate"
                        item.final_dest = item.planned_dest
                        job.done += 1
                        return
                # contenido distinto (o tamaño distinto) → estrategia del job
                if job.duplicate_strategy == "skip":
                    item.status = "skipped"
                    job.skipped += 1
                    return
                # rename, O overwrite cuyo destino lo escribió ESTE job: jamás
                # sobrescribir lo recién producido → sufijo ` (n)`
                if job.duplicate_strategy == "rename" or dest.resolve() in produced:
                    final = await asyncio.to_thread(_next_free_path, dest, produced)
                # overwrite sobre un archivo preexistente ajeno: se respeta
            elif dest.resolve() in produced:
                # no está en disco pero ya lo reclamamos este job (algo lo
                # borró a mitad): igualmente se le da un nombre libre
                final = await asyncio.to_thread(_next_free_path, dest, produced)
            await self._transfer(job.transfer_mode, source, final)
            produced.add(final.resolve())
            item.final_dest = final.relative_to(output_dir.resolve()).as_posix()
            item.status = "done"
            job.done += 1
        except PathError:
            # planned_dest/source_path corrompidos o hostiles: error del item
            item.status = "error"
            item.error = "invalid_path"
            job.errors += 1
        except Exception:
            logger.exception("item %s del job %s falló", item.id, job.id)
            item.status = "error"
            item.error = "transfer_failed"
            job.errors += 1

    async def _transfer(self, mode: str, source: Path, dest: Path) -> None:
        await asyncio.to_thread(self._transfer_sync, mode, source, dest)

    @staticmethod
    def _transfer_sync(mode: str, source: Path, dest: Path) -> None:
        """Nunca escribe directamente sobre el nombre final: stage-then-replace.

        Un crash o error a mitad de una copia grande no puede dejar un archivo
        TRUNCADO con el nombre canónico en la librería (que Immich importaría o
        que un re-run trataría como preexistente). En move same-device basta un
        os.rename atómico; en el resto se copia a un temporal en la MISMA
        carpeta destino y se hace os.replace atómico.
        """
        if mode == "move":
            try:
                os.rename(source, dest)  # atómico si mismo dispositivo
                return
            except OSError:
                pass  # cross-device (EXDEV): copiar y reemplazar
        tmp = dest.parent / f".{uuid4().hex}.rg-part"
        try:
            shutil.copy2(source, tmp)
            os.replace(tmp, dest)  # atómico: jamás un final a medias
        except BaseException:
            tmp.unlink(missing_ok=True)
            raise
        if mode == "move":
            source.unlink()

    async def _finish_cancelled(
        self, session: Session, job: Job, remaining: list[JobItem]
    ) -> None:
        """Cancelación entre items: lo pendiente queda `cancelled` y se avisa
        del cambio de input (los items ya hechos movieron archivos)."""
        for item in remaining:
            item.status = "cancelled"
        job.status = "cancelled"
        job.finished_at = utcnow()
        session.commit()
        await self.broadcaster.broadcast(_status_event(job))
        await self._broadcast_input_changed()

    async def _broadcast_input_changed(self) -> None:
        """`input-changed` con contadores frescos; best-effort — un fallo del
        hub jamás degrada un job terminado."""
        try:
            # import perezoso: el helper vive en el router de input y los
            # servicios no deben importar routers en el arranque del módulo
            from ..routers.input import summary as input_summary

            # os.walk síncrono fuera del event loop
            counts = (await asyncio.to_thread(input_summary)).model_dump()
            await self.broadcaster.broadcast(
                {"type": "input-changed", "data": {"counts": counts}}
            )
        except Exception:
            logger.warning("no se pudo emitir input-changed al acabar el job", exc_info=True)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(_HASH_CHUNK):
            digest.update(chunk)
    return digest.hexdigest()


def _next_free_path(dest: Path, produced: set[Path] = frozenset()) -> Path:
    """Primer destino libre con sufijo ` (n)`: `a.jpg`, `a (1).jpg`, `a (2).jpg`…
    (misma convención que las colisiones de subida). Un candidato cuenta como
    ocupado si existe en disco O si ya lo reclamó este job (`produced`)."""
    stem, ext = dest.stem, dest.suffix
    counter = 1
    while True:
        candidate = dest.with_name(f"{stem} ({counter}){ext}")
        if not candidate.exists() and candidate.resolve() not in produced:
            return candidate
        counter += 1


def _status_event(job: Job) -> dict:
    return {"type": "job-status", "data": {"job_id": job.id, "status": job.status}}


def _item_done_event(job: Job, item: JobItem) -> dict:
    """Payload EXACTO del contrato WS `item-done` (el frontend se construye
    contra esta forma; los contadores permiten pintar progreso sin re-fetch)."""
    return {
        "type": "item-done",
        "data": {
            "job_id": job.id,
            "item_id": item.id,
            "source_path": item.source_path,
            "media_type": item.media_type,
            "orientation": item.orientation,
            "status": item.status,
            "dest": item.final_dest or item.planned_dest,
            "error": item.error,
            "counters": {
                "done": job.done,
                "errors": job.errors,
                "skipped": job.skipped,
                "total": job.total,
            },
        },
    }
