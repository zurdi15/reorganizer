"""Esquemas del dominio de jobs (creación, historial y progreso).

La validación semántica (modos, estrategia, dest) vive en el router con slugs
i18n en `detail` — aquí solo forma y tipos, patrón berserk.
"""

from datetime import UTC, datetime

from pydantic import BaseModel, ConfigDict, field_serializer


class JobCreate(BaseModel):
    # ruta relativa bajo output_dir compuesta en el path builder
    dest_path: str
    # None → default del usuario en settings (default_transfer_mode /
    # default_duplicate_strategy)
    transfer_mode: str | None = None
    duplicate_strategy: str | None = None


class JobRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    status: str
    dest_path: str
    transfer_mode: str
    duplicate_strategy: str
    # contadores denormalizados (el de errores se llama `errors`: `error` es
    # el slug del fallo fatal del job)
    total: int
    done: int
    errors: int
    skipped: int
    error: str | None
    immich_status: str | None
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None

    # el modelo guarda UTC naive (utcnow); se serializa con offset explícito
    # para que el cliente no lo interprete en su zona local (fechas futuras).
    # OJO: NO aplica a JobItem.taken_at, que es hora local de cámara (EXIF)
    @field_serializer("created_at", "started_at", "finished_at")
    def _serialize_utc(self, value: datetime | None) -> datetime | None:
        return None if value is None else value.replace(tzinfo=UTC)


class JobItemRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    job_id: int
    source_path: str
    size_bytes: int
    media_type: str | None
    orientation: str | None
    taken_at: datetime | None
    camera_make: str | None
    camera_model: str | None
    matched_rule_id: int | None
    planned_dest: str | None
    final_dest: str | None
    status: str
    error: str | None
    content_hash: str | None
    # colisión prevista, calculada SOLO al leer items de un job `planned`
    # (sin columna en DB): el destino ya existe en disco o dos items del
    # plan comparten planned_dest; None fuera del estado planned
    collision: bool | None = None
