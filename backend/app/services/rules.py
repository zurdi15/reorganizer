"""Motor de reglas de clasificación (evaluación + seed).

La primera regla habilitada (por `priority` asc) cuyas condiciones no-NULL
matcheen TODAS (AND) gana. Si su plantilla no renderiza (placeholder sin
valor o destino inválido), la regla se trata como no-matcheante y se sigue
con la siguiente (fall-through). Sin resultado → el caller usa el fallback
built-in `UNKNOWN_DEST` bajo el destino del job (no vive en DB).

`info` se duck-typea (ver `MediaLike`): el MediaInfo real lo define el
servicio de metadata, pero aquí solo se leen atributos — cero acoplamiento.
"""

import logging
import re
from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import Protocol

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Rule
from .paths import PathError, validate_rel_dest

logger = logging.getLogger(__name__)

# fallback built-in cuando ninguna regla matchea Y renderiza: el planner
# enruta el archivo a `_unknown/` bajo el destino del job (adiós abandonados)
UNKNOWN_DEST = "_unknown"

# placeholders admitidos en dest_template; cualquier otro `{nombre}` es un
# error de guardado (unknown_placeholder) y un no-render en evaluación
KNOWN_PLACEHOLDERS = frozenset({"orientation", "media_type", "make", "model", "yyyy", "mm"})
PLACEHOLDER_RE = re.compile(r"\{([A-Za-z_][A-Za-z0-9_]*)\}")

# seed = árbol legacy (`photo/` + `video/{h|v}/{phone|dron/mini3}`) con el bug
# DJI arreglado: regex case-insensitive por nombre + regla previa por metadata
# de cámara. `name` viaja en el spec pero la columna aún no existe en Rule
# (ver informe de oleada): _model_kwargs la filtra hoy y empezará a
# persistirse sola cuando el modelo la gane.
DEFAULT_RULES: tuple[dict[str, object], ...] = (
    {
        "priority": 10,
        "name": "Fotos",
        "enabled": True,
        "media_type": "photo",
        "dest_template": "photo",
    },
    {
        "priority": 15,
        "name": "Vídeo dron (metadata DJI)",
        "enabled": True,
        "media_type": "video",
        "camera_make": "DJI",
        "dest_template": "video/{orientation}/dron/mini3",
    },
    {
        "priority": 20,
        "name": "Vídeo dron (nombre DJI)",
        "enabled": True,
        "media_type": "video",
        "filename_regex": "^dji",
        "dest_template": "video/{orientation}/dron/mini3",
    },
    {
        "priority": 30,
        "name": "Vídeo teléfono",
        "enabled": True,
        "media_type": "video",
        "dest_template": "video/{orientation}/phone",
    },
)


class MediaLike(Protocol):
    """Contrato estructural de la metadata probada de un archivo.

    Lo cumplen el MediaInfo del servicio de metadata, los JobItem del planner
    y el payload de POST /rules/test — el motor solo lee estos atributos.
    """

    media_type: str | None
    orientation: str | None
    taken_at: datetime | None
    camera_make: str | None
    camera_model: str | None


def _model_kwargs(spec: Mapping[str, object]) -> dict[str, object]:
    """Filtra claves que (aún) no existen como columna en Rule — hoy `name`."""
    return {key: value for key, value in spec.items() if hasattr(Rule, key)}


def ensure_default_rules(session: Session) -> None:
    """Siembra las reglas por defecto si la tabla está vacía (idempotente).

    Una tabla NO vacía nunca se toca: las reglas son del usuario en cuanto
    existen, aunque haya borrado o editado las de serie.
    """
    if session.scalar(select(Rule.id).limit(1)) is not None:
        return
    for spec in DEFAULT_RULES:
        session.add(Rule(**_model_kwargs(spec)))
    session.commit()


def _enabled_by_priority(rules: Sequence[Rule]) -> list[Rule]:
    """Solo habilitadas, en orden de evaluación (priority asc)."""
    return sorted((rule for rule in rules if rule.enabled), key=lambda rule: rule.priority)


def _rule_matches(rule: Rule, info: MediaLike, filename: str) -> bool:
    """AND de todas las condiciones no-NULL (una regla sin condiciones es un
    catch-all legítimo)."""
    if rule.media_type is not None and info.media_type != rule.media_type:
        return False
    if rule.orientation is not None and info.orientation != rule.orientation:
        return False
    if rule.filename_regex is not None:
        try:
            # case-insensitive: el fix del bug DJI histórico (dji_fly_*.mp4)
            if not re.search(rule.filename_regex, filename, re.IGNORECASE):
                return False
        except re.error:
            # la API valida al guardar; esto solo pasa con una DB tocada a mano
            logger.warning("regla %s: filename_regex inválida %r", rule.id, rule.filename_regex)
            return False
    if rule.camera_make is not None:
        if not info.camera_make or rule.camera_make.lower() not in info.camera_make.lower():
            return False
    if rule.camera_model is not None:
        if not info.camera_model or rule.camera_model.lower() not in info.camera_model.lower():
            return False
    return True


def _placeholder_values(info: MediaLike) -> dict[str, str | None]:
    """Valores de plantilla disponibles para este archivo (None = sin valor)."""
    taken_at = info.taken_at
    return {
        "orientation": info.orientation,
        "media_type": info.media_type,
        "make": info.camera_make,
        "model": info.camera_model,
        "yyyy": f"{taken_at.year:04d}" if taken_at else None,
        "mm": f"{taken_at.month:02d}" if taken_at else None,
    }


def match(rules: Sequence[Rule], info: MediaLike, filename: str) -> Rule | None:
    """Primera regla habilitada (priority asc) que matchea, o None."""
    for rule in _enabled_by_priority(rules):
        if _rule_matches(rule, info, filename):
            return rule
    return None


def render_dest(rule: Rule, info: MediaLike) -> str | None:
    """Renderiza dest_template para este archivo, o None si no es posible.

    None cuando falta el valor de algún placeholder (p. ej. `{yyyy}` sin
    taken_at) o cuando el resultado no pasa validate_rel_dest (metadata
    hostil, plantilla rota en DB): el caller trata la regla como
    no-matcheante y cae a la siguiente.
    """
    values = _placeholder_values(info)
    for name in PLACEHOLDER_RE.findall(rule.dest_template):
        if name not in KNOWN_PLACEHOLDERS or not values.get(name):
            return None
    rendered = PLACEHOLDER_RE.sub(lambda m: str(values[m.group(1)]), rule.dest_template)
    try:
        # re-validación tras renderizar: los valores vienen de metadata del
        # archivo (potencialmente hostil), no solo de la plantilla guardada
        return validate_rel_dest(rendered)
    except PathError:
        logger.warning("regla %s: destino renderizado inválido %r", rule.id, rendered)
        return None


def match_and_render(
    rules: Sequence[Rule], info: MediaLike, filename: str
) -> tuple[Rule, str] | None:
    """Primera regla que matchea Y renderiza → (regla, destino relativo).

    Encapsula el fall-through: una regla matcheante cuya plantilla no
    renderiza se salta. None → el caller enruta a `UNKNOWN_DEST`.
    """
    for rule in _enabled_by_priority(rules):
        if not _rule_matches(rule, info, filename):
            continue
        dest = render_dest(rule, info)
        if dest is not None:
            return rule, dest
    return None
