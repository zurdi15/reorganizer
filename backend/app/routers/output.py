"""Árbol de salida para el autocompletado del path builder (traversal-safe)."""

from fastapi import APIRouter, Query

from ..config import get_settings
from ..schemas.output import OutputDir
from ..services.paths import resolve_under

router = APIRouter(prefix="/output", tags=["output"])


@router.get("/dirs", response_model=list[OutputDir])
def list_dirs(path: str = Query("")) -> list[OutputDir]:
    base = get_settings().output_dir
    # path vacío = raíz del output; el resto pasa por el guard anti-escape
    target = base if not path.strip() else resolve_under(base, path)
    if not target.is_dir():
        # para el autocompletado, un segmento aún no creado es un caso normal
        # (el usuario está componiendo una carpeta nueva), no un 404
        return []
    dirs: list[OutputDir] = []
    for child in sorted(target.iterdir()):
        if not child.is_dir() or child.name.startswith("."):
            continue
        has_children = any(
            grandchild.is_dir() and not grandchild.name.startswith(".")
            for grandchild in child.iterdir()
        )
        dirs.append(OutputDir(name=child.name, has_children=has_children))
    return dirs
