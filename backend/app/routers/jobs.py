"""Jobs de organización: dry-run (planning), ejecución e historial.

Endpoints deliberadamente `async` con sesiones abiertas a mano (no
Depends(get_db)): así todo acceso a DB corre en el MISMO event loop que los
tasks del JobRunner y con SQLite jamás se cruza una transacción del task con
el rollback de cierre de una sesión de request en otro hilo.
"""

from fastapi import APIRouter, HTTPException, Query, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import (
    DUPLICATE_STRATEGIES,
    ITEM_STATUSES,
    TRANSFER_MODES,
    Job,
    JobItem,
)
from ..schemas.jobs import JobCreate, JobItemRead, JobRead
from ..services.jobs import JobConflictError, JobRunner
from ..services.paths import PathError, resolve_under, validate_rel_dest
from ..services.settings import AppSettings

router = APIRouter(prefix="/jobs", tags=["jobs"])


def _runner(request: Request) -> JobRunner:
    return request.app.state.job_runner


def _session(request: Request) -> Session:
    return request.app.state.sessionmaker()


@router.post("", status_code=202, response_model=JobRead)
async def create_job(payload: JobCreate, request: Request) -> Job:
    # dest validada dos veces: forma (validate_rel_dest) y anti-escape bajo
    # output_dir (resolve_under); PathError → 400 invalid_path global
    dest_path = validate_rel_dest(payload.dest_path)
    resolve_under(get_settings().output_dir, dest_path)
    with _session(request) as session:
        defaults = AppSettings.load(session)
    mode = payload.transfer_mode or defaults["default_transfer_mode"]
    strategy = payload.duplicate_strategy or defaults["default_duplicate_strategy"]
    if mode not in TRANSFER_MODES:
        raise HTTPException(status_code=422, detail="invalid_transfer_mode")
    if strategy not in DUPLICATE_STRATEGIES:
        raise HTTPException(status_code=422, detail="invalid_duplicate_strategy")
    try:
        return await _runner(request).create_job(dest_path, mode, strategy)
    except JobConflictError as exc:
        raise HTTPException(status_code=409, detail=exc.slug) from exc


@router.post("/{job_id}/execute", status_code=202, response_model=JobRead)
async def execute_job(job_id: int, request: Request) -> Job:
    _ensure_exists(request, job_id)
    try:
        return await _runner(request).execute_job(job_id)
    except JobConflictError as exc:
        raise HTTPException(status_code=409, detail=exc.slug) from exc


@router.post("/{job_id}/cancel", status_code=202, response_model=JobRead)
async def cancel_job(job_id: int, request: Request) -> Job:
    _ensure_exists(request, job_id)
    try:
        # la cancelación es cooperativa: el 202 devuelve el job aún
        # planning|running y el task lo cerrará en `cancelled` entre items
        return await _runner(request).cancel_job(job_id)
    except JobConflictError as exc:
        raise HTTPException(status_code=409, detail=exc.slug) from exc


@router.get("", response_model=list[JobRead])
async def list_jobs(
    request: Request,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> list[Job]:
    with _session(request) as session:
        return list(
            session.scalars(
                select(Job).order_by(Job.id.desc()).limit(limit).offset(offset)
            )
        )


@router.get("/{job_id}", response_model=JobRead)
async def read_job(job_id: int, request: Request) -> Job:
    with _session(request) as session:
        job = session.get(Job, job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="job_not_found")
        return job


@router.get("/{job_id}/items", response_model=list[JobItemRead])
async def list_job_items(
    job_id: int,
    request: Request,
    status: str | None = Query(None),
    limit: int = Query(500, ge=1, le=2000),
    offset: int = Query(0, ge=0),
) -> list[JobItemRead]:
    if status is not None and status not in ITEM_STATUSES:
        raise HTTPException(status_code=422, detail="invalid_item_status")
    with _session(request) as session:
        job = session.get(Job, job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="job_not_found")
        query = select(JobItem).where(JobItem.job_id == job_id)
        if status is not None:
            query = query.where(JobItem.status == status)
        items = list(session.scalars(query.order_by(JobItem.id).limit(limit).offset(offset)))
        reads = [JobItemRead.model_validate(item) for item in items]
        if job.status == "planned":
            _annotate_collisions(session, job, items, reads)
        return reads


def _ensure_exists(request: Request, job_id: int) -> None:
    with _session(request) as session:
        if session.get(Job, job_id) is None:
            raise HTTPException(status_code=404, detail="job_not_found")


def _annotate_collisions(
    session: Session, job: Job, items: list[JobItem], reads: list[JobItemRead]
) -> None:
    """Colisiones previstas del plan, calculadas al leer (sin columna en DB):
    dos items del job comparten planned_dest o el destino ya existe en disco.
    Solo tiene sentido con el job en `planned` — tras ejecutar, el resultado
    real vive en status/final_dest."""
    shared = {
        dest
        for dest in session.scalars(
            select(JobItem.planned_dest)
            .where(JobItem.job_id == job.id)
            .group_by(JobItem.planned_dest)
            .having(func.count() > 1)
        )
    }
    output_dir = get_settings().output_dir
    for item, read in zip(items, reads, strict=True):
        exists = False
        if item.planned_dest:
            try:
                exists = resolve_under(output_dir, item.planned_dest).exists()
            except PathError:
                exists = False
        read.collision = item.planned_dest in shared or exists
