from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def utcnow() -> datetime:
    """UTC naive, coherente con el resto de fechas de la app."""
    return datetime.now(UTC).replace(tzinfo=None)


# planning → planned → running → estado terminal
JOB_STATUSES = (
    "planning",
    "planned",
    "running",
    "completed",
    "completed_with_errors",
    "cancelled",
    "failed",
    "interrupted",
    "discarded",
)
# planned → estado terminal por item
ITEM_STATUSES = ("planned", "done", "skipped", "duplicate", "error", "cancelled", "missing")
TRANSFER_MODES = ("move", "copy")
DUPLICATE_STRATEGIES = ("rename", "skip", "overwrite")
MEDIA_TYPES = ("photo", "video", "unknown")
ORIENTATIONS = ("horizontal", "vertical")


class AppSetting(Base):
    """Ajustes clave-valor: immich_* y defaults de usuario. `value` es JSON
    serializado (texto) para no migrar el esquema por cada ajuste nuevo."""

    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(Text)


class Rule(Base):
    """Regla de clasificación: la primera (por priority) cuyas condiciones
    no-NULL matcheen TODAS (AND) gana. Sin match → fallback built-in
    `_unknown/` bajo el destino del job (no vive en DB)."""

    __tablename__ = "rules"

    id: Mapped[int] = mapped_column(primary_key=True)
    # nombre legible mostrado en la UI de ajustes
    name: Mapped[str | None] = mapped_column(String(120), default=None)
    # orden de evaluación; único para que el reorder no deje empates
    priority: Mapped[int] = mapped_column(unique=True)
    enabled: Mapped[bool] = mapped_column(default=True)
    # condiciones AND-combinadas; NULL = la condición no aplica
    media_type: Mapped[str | None] = mapped_column(String(10), default=None)
    orientation: Mapped[str | None] = mapped_column(String(12), default=None)
    # re.IGNORECASE sobre el nombre de archivo (arregla el bug DJI histórico)
    filename_regex: Mapped[str | None] = mapped_column(String(300), default=None)
    # substring case-insensitive sobre la metadata de cámara
    camera_make: Mapped[str | None] = mapped_column(String(120), default=None)
    camera_model: Mapped[str | None] = mapped_column(String(120), default=None)
    # placeholders: {orientation},{media_type},{make},{model},{yyyy},{mm}
    # (placeholder sin valor → la regla no matchea ese archivo)
    dest_template: Mapped[str] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class Job(Base):
    """Un lote de organización. El planning ES el dry-run (asíncrono, con
    progreso WS); execute solo se permite desde `planned`."""

    __tablename__ = "jobs"

    id: Mapped[int] = mapped_column(primary_key=True)
    status: Mapped[str] = mapped_column(String(24), default="planning")
    # ruta relativa bajo output_dir compuesta por el usuario (p. ej. 2024/08/croacia)
    dest_path: Mapped[str] = mapped_column(String(500))
    transfer_mode: Mapped[str] = mapped_column(String(8), default="move")
    duplicate_strategy: Mapped[str] = mapped_column(String(12), default="rename")
    # contadores denormalizados para pintar progreso sin agregar job_items
    # (el contador de errores se llama `errors` porque `error` es el slug)
    total: Mapped[int] = mapped_column(default=0)
    done: Mapped[int] = mapped_column(default=0)
    errors: Mapped[int] = mapped_column(default=0)
    skipped: Mapped[int] = mapped_column(default=0)
    # slug i18n del error fatal del job (los errores por archivo van en su item)
    error: Mapped[str | None] = mapped_column(String(64), default=None)
    # resultado del rescan de Immich al acabar: ok|failed|skipped
    immich_status: Mapped[str | None] = mapped_column(String(12), default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, default=None)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, default=None)

    items: Mapped[list["JobItem"]] = relationship(
        back_populates="job", cascade="all, delete-orphan", passive_deletes=True
    )


class JobItem(Base):
    """Un archivo dentro de un job. Los job_items SON el log durable del
    historial (no hay tabla de logs aparte)."""

    __tablename__ = "job_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    job_id: Mapped[int] = mapped_column(
        ForeignKey("jobs.id", ondelete="CASCADE"), index=True
    )
    # ruta relativa bajo input_dir en el momento del planning
    source_path: Mapped[str] = mapped_column(String(1024))
    size_bytes: Mapped[int] = mapped_column(default=0)
    # metadata probada durante el planning (Pillow/ffprobe)
    media_type: Mapped[str | None] = mapped_column(String(10), default=None)
    orientation: Mapped[str | None] = mapped_column(String(12), default=None)
    taken_at: Mapped[datetime | None] = mapped_column(DateTime, default=None)
    camera_make: Mapped[str | None] = mapped_column(String(120), default=None)
    camera_model: Mapped[str | None] = mapped_column(String(120), default=None)
    # snapshot SIN FK: si la regla se edita o borra después, el historial
    # conserva qué regla decidió el destino en su momento
    matched_rule_id: Mapped[int | None] = mapped_column(default=None)
    # destino calculado en planning (rel output_dir) y el efectivo tras
    # ejecutar (puede diferir por la estrategia de duplicados, p. ej. ` (1)`)
    planned_dest: Mapped[str | None] = mapped_column(String(1024), default=None)
    final_dest: Mapped[str | None] = mapped_column(String(1024), default=None)
    status: Mapped[str] = mapped_column(String(12), default="planned")
    # slug i18n del error de ESTE archivo (un error nunca mata el job)
    error: Mapped[str | None] = mapped_column(String(64), default=None)
    # sha256, solo calculado si hubo colisión de destino (detección de duplicados)
    content_hash: Mapped[str | None] = mapped_column(String(64), default=None)

    job: Mapped[Job] = relationship(back_populates="items")
