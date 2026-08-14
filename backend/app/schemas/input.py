from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class InputFile(BaseModel):
    # ruta relativa a input_dir en formato POSIX (es la que viaja de vuelta
    # en preview/probe/delete)
    path: str
    name: str
    size_bytes: int
    # epoch seconds (float): el cliente formatea según su locale
    mtime: float
    # photo|video|unknown por extensión (barato; la clasificación real por
    # contenido solo ocurre en planning)
    kind: str


class InputFilesPage(BaseModel):
    """Página del listado de input (paginado para escalar a miles de ficheros
    sin renderizarlos todos de golpe)."""

    files: list[InputFile]
    # total de ficheros en el input (para saber si quedan más páginas)
    total: int


class InputSummary(BaseModel):
    total: int
    photo: int
    video: int
    unknown: int


class InputProbe(BaseModel):
    """Probe on-demand de UN archivo para la sheet de detalle: clasificación
    real por contenido (Pillow/ffprobe), no la barata por extensión."""

    path: str
    name: str
    size_bytes: int
    media_type: Literal["photo", "video", "unknown"]
    width: int | None
    height: int | None
    # post-rotación (tag EXIF / display matrix); horizontal si width>=height
    orientation: Literal["horizontal", "vertical"] | None
    taken_at: datetime | None
    camera_make: str | None
    camera_model: str | None
    # regla que matchearía en un plan: {id, name, dest} o null (→ `_unknown`)
    matched_rule: dict | None = None


class InputDates(BaseModel):
    """Sugerencias EXIF para el path builder (muestreo, no censo)."""

    # años desc como strings ("2024") — igual que los placeholders {yyyy}/{mm}
    years: list[str]
    # meses asc con cero inicial ("08") por año
    months_by_year: dict[str, list[str]]
