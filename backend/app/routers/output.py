"""Árbol de salida para el navegador del path builder (traversal-safe)."""

import logging

from fastapi import APIRouter, Query

from ..config import get_settings
from ..schemas.output import OutputDir
from ..services.paths import resolve_under

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/output", tags=["output"])


def _has_subdirs(path) -> bool:
    """¿Tiene el directorio algún subdirectorio visible? Tolera un directorio
    ilegible (p. ej. creado por otra herramienta como root): se asume sin
    hijos en vez de romper el listado con un 500."""
    try:
        return any(
            child.is_dir() and not child.name.startswith(".")
            for child in path.iterdir()
        )
    except OSError:
        return False


@router.get("/dirs", response_model=list[OutputDir])
def list_dirs(path: str = Query("")) -> list[OutputDir]:
    base = get_settings().output_dir
    # path vacío = raíz del output; el resto pasa por el guard anti-escape
    target = base if not path.strip() else resolve_under(base, path)
    if not target.is_dir():
        # para el navegador, un segmento aún no creado es un caso normal
        # (el usuario está componiendo una carpeta nueva), no un 404
        return []
    try:
        children = sorted(target.iterdir())
    except OSError:
        # el propio nivel es ilegible: se degrada a vacío en vez de 500
        logger.warning("no se pudo listar el directorio de salida: %s", target)
        return []
    dirs: list[OutputDir] = []
    for child in children:
        if not child.is_dir() or child.name.startswith("."):
            continue
        dirs.append(OutputDir(name=child.name, has_children=_has_subdirs(child)))
    return dirs
