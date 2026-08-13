"""Guard central de rutas: TODO acceso a disco derivado de input del usuario
pasa por aquí. `PathError` se traduce a 400 `detail="invalid_path"` en el
exception handler global (main.py) — los errores son slugs i18n, patrón berserk.
"""

import re
import unicodedata
import uuid
from pathlib import Path

# prohibidos en nombres de archivo y segmentos de destino (Windows-safe y
# anti-separadores); el slash se valida aparte porque hace de separador
_FORBIDDEN_CHARS = set('\\:*?"<>|')
_MAX_NAME_LEN = 180
_MAX_EXT_LEN = 16


class PathError(Exception):
    """Ruta fuera del árbol permitido o con formato inválido (→ 400 invalid_path)."""


def resolve_under(base: Path, rel: str) -> Path:
    """Resuelve `rel` bajo `base` con garantía anti-escape.

    Rechaza rutas vacías, absolutas o con `..`; resuelve symlinks y exige que
    el resultado final siga bajo `base` (un symlink interno que apunte fuera
    también se rechaza). La ruta NO tiene por qué existir.
    """
    if not rel or not rel.strip():
        raise PathError("empty path")
    try:
        raw = Path(rel)
        if raw.is_absolute():
            raise PathError("absolute path")
        if any(part == ".." for part in raw.parts):
            raise PathError("path traversal")
        base_resolved = base.resolve()
        candidate = (base_resolved / raw).resolve()
    except ValueError as exc:  # p. ej. bytes nulos embebidos
        raise PathError("malformed path") from exc
    if not candidate.is_relative_to(base_resolved):
        raise PathError("path escapes base")
    return candidate


def sanitize_filename(name: str) -> str:
    """Normaliza un nombre de archivo hostil a algo seguro y portable.

    Solo basename (traga rutas completas de clientes raros), NFC, sin chars
    de control ni `/\\:*?"<>|`, espacios colapsados, sin puntos iniciales
    (nada de dotfiles), cap 180 chars preservando la extensión. Si no queda
    nada usable → `upload-<uuid8><ext>`.
    """
    # basename con ambos separadores: "C:\\fotos\\a.jpg" y "a/b/c.jpg" → último tramo
    base = name.replace("\\", "/").rsplit("/", 1)[-1]
    base = unicodedata.normalize("NFC", base)
    # fuera control chars (categoría C: Cc/Cf/Co/Cn — incluye RTL-override) y prohibidos
    base = "".join(
        ch
        for ch in base
        if ch not in _FORBIDDEN_CHARS and ch != "/" and unicodedata.category(ch)[0] != "C"
    )
    base = re.sub(r"\s+", " ", base).strip()
    # la extensión de fallback se captura ANTES de recortar puntos iniciales
    fallback_ext = _safe_ext(base)
    base = base.lstrip(".").strip()
    if not base:
        return f"upload-{uuid.uuid4().hex[:8]}{fallback_ext}"
    ext = _safe_ext(base)
    if len(base) > _MAX_NAME_LEN:
        stem = base[: len(base) - len(ext)]
        base = stem[: _MAX_NAME_LEN - len(ext)] + ext
    return base


def _safe_ext(name: str) -> str:
    """Sufijo del nombre acotado en longitud ('' si no hay o es absurdo)."""
    ext = Path(name).suffix
    return ext if len(ext) <= _MAX_EXT_LEN else ""


def validate_rel_dest(dest: str) -> str:
    """Valida una ruta destino relativa compuesta por el usuario (path builder).

    Relativa, sin `..`, y con charset seguro por segmento (sin control chars,
    sin `\\:*?"<>|`, sin segmentos que empiecen por punto). Devuelve la forma
    normalizada `seg/seg/seg`. Se aplica al guardar Y tras renderizar
    plantillas — el resultado sigue pasando por resolve_under al tocar disco.
    """
    if not dest or not dest.strip():
        raise PathError("empty dest")
    if dest.startswith(("/", "\\")):
        raise PathError("absolute dest")
    segments = [seg.strip() for seg in dest.split("/")]
    segments = [seg for seg in segments if seg]
    if not segments:
        raise PathError("empty dest")
    for seg in segments:
        if seg.startswith("."):  # cubre ".", ".." y carpetas ocultas
            raise PathError(f"bad segment: {seg}")
        if any(ch in _FORBIDDEN_CHARS or unicodedata.category(ch)[0] == "C" for ch in seg):
            raise PathError(f"bad segment charset: {seg}")
    return "/".join(segments)
