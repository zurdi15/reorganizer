"""CRUD de reglas de clasificación + reorder + probador de casos.

Errores de validación → 422 con slug i18n en `detail` (patrón berserk):
invalid_media_type · invalid_orientation · invalid_regex ·
invalid_dest_template · unknown_placeholder · priority_taken ·
invalid_rule_order · rule_not_found (404).
"""

import re

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import MEDIA_TYPES, ORIENTATIONS, Rule
from ..schemas.rules import (
    RuleCreate,
    RuleRead,
    RuleReorder,
    RuleTestRequest,
    RuleTestResult,
    RuleUpdate,
)
from ..services import rules as rules_engine
from ..services.paths import PathError, validate_rel_dest

router = APIRouter(prefix="/rules", tags=["rules"])

# paso entre prioridades: deja hueco para insertar reglas a mano entre dos
PRIORITY_STEP = 10

# condiciones de regla: photo|video (un archivo `unknown` va al fallback
# built-in, no tiene sentido enrutar por regla)
RULE_MEDIA_TYPES = ("photo", "video")

# campos que jamás aceptan null en un PATCH (null = "no tocar")
_NON_NULLABLE = frozenset({"enabled", "dest_template"})


def _validate_payload(data: dict) -> None:
    """Valida los campos presentes en la petición; 422 con slug si algo falla."""
    media_type = data.get("media_type")
    if media_type is not None and media_type not in RULE_MEDIA_TYPES:
        raise HTTPException(status_code=422, detail="invalid_media_type")
    orientation = data.get("orientation")
    if orientation is not None and orientation not in ORIENTATIONS:
        raise HTTPException(status_code=422, detail="invalid_orientation")
    regex = data.get("filename_regex")
    if regex is not None:
        try:
            re.compile(regex)
        except re.error:
            raise HTTPException(status_code=422, detail="invalid_regex") from None
    template = data.get("dest_template")
    if template is not None:
        for name in rules_engine.PLACEHOLDER_RE.findall(template):
            if name not in rules_engine.KNOWN_PLACEHOLDERS:
                raise HTTPException(status_code=422, detail="unknown_placeholder")
        try:
            # la forma de la ruta se valida con los placeholders sustituidos
            # por un valor neutro; el render real se re-valida en el motor
            validate_rel_dest(rules_engine.PLACEHOLDER_RE.sub("x", template))
        except PathError:
            raise HTTPException(status_code=422, detail="invalid_dest_template") from None


def _model_fields(data: dict) -> dict:
    """Filtra a columnas existentes en Rule — `name` viaja en el contrato
    pero su columna aún no existe (ver informe de oleada)."""
    return {key: value for key, value in data.items() if hasattr(Rule, key)}


def _priority_taken(db: Session, priority: int) -> bool:
    return db.scalar(select(Rule.id).where(Rule.priority == priority)) is not None


@router.get("", response_model=list[RuleRead])
def list_rules(db: Session = Depends(get_db)) -> list[Rule]:
    return list(db.scalars(select(Rule).order_by(Rule.priority)))


@router.post("", response_model=RuleRead, status_code=201)
def create_rule(payload: RuleCreate, db: Session = Depends(get_db)) -> Rule:
    data = payload.model_dump(exclude_unset=True)
    _validate_payload(data)
    priority = data.pop("priority", None)
    if priority is None:
        # al final de la cadena: max + paso (10 si no hay ninguna)
        priority = (db.scalar(select(func.max(Rule.priority))) or 0) + PRIORITY_STEP
    elif _priority_taken(db, priority):
        raise HTTPException(status_code=422, detail="priority_taken")
    rule = Rule(priority=priority, **_model_fields(data))
    db.add(rule)
    db.commit()
    db.refresh(rule)  # server defaults (enabled, timestamps) para la respuesta
    return rule


@router.patch("/{rule_id}", response_model=RuleRead)
def update_rule(rule_id: int, payload: RuleUpdate, db: Session = Depends(get_db)) -> Rule:
    rule = db.get(Rule, rule_id)
    if rule is None:
        raise HTTPException(status_code=404, detail="rule_not_found")
    data = payload.model_dump(exclude_unset=True)
    _validate_payload(data)
    priority = data.pop("priority", None)
    if priority is not None and priority != rule.priority:
        if _priority_taken(db, priority):
            raise HTTPException(status_code=422, detail="priority_taken")
        rule.priority = priority
    for key, value in _model_fields(data).items():
        if value is None and key in _NON_NULLABLE:
            continue
        setattr(rule, key, value)
    db.commit()
    db.refresh(rule)
    return rule


@router.delete("/{rule_id}", status_code=204)
def delete_rule(rule_id: int, db: Session = Depends(get_db)) -> None:
    rule = db.get(Rule, rule_id)
    if rule is None:
        raise HTTPException(status_code=404, detail="rule_not_found")
    db.delete(rule)
    db.commit()


@router.post("/reorder", response_model=list[RuleRead])
def reorder_rules(payload: RuleReorder, db: Session = Depends(get_db)) -> list[Rule]:
    rules_by_id = {rule.id: rule for rule in db.scalars(select(Rule))}
    # permutación exacta del conjunto actual (los ids son únicos, así que la
    # comparación ordenada también caza duplicados y faltantes)
    if sorted(payload.ids) != sorted(rules_by_id):
        raise HTTPException(status_code=422, detail="invalid_rule_order")
    # dos fases por el unique de priority: primero valores temporales
    # negativos (imposibles en datos reales), luego los definitivos 10,20,30…
    for index, rule_id in enumerate(payload.ids):
        rules_by_id[rule_id].priority = -(index + 1)
    db.flush()
    for index, rule_id in enumerate(payload.ids):
        rules_by_id[rule_id].priority = PRIORITY_STEP * (index + 1)
    db.commit()
    return [rules_by_id[rule_id] for rule_id in payload.ids]


@router.post("/test", response_model=RuleTestResult)
def test_rules(payload: RuleTestRequest, db: Session = Depends(get_db)) -> RuleTestResult:
    # puro: evalúa el motor contra un caso sintético, sin tocar disco.
    # aquí `unknown` sí es un media_type legal (describe un archivo, no una regla)
    if payload.media_type not in MEDIA_TYPES:
        raise HTTPException(status_code=422, detail="invalid_media_type")
    if payload.orientation is not None and payload.orientation not in ORIENTATIONS:
        raise HTTPException(status_code=422, detail="invalid_orientation")
    rules = list(db.scalars(select(Rule)))
    # el payload cumple MediaLike: se pasa tal cual como `info`
    result = rules_engine.match_and_render(rules, payload, payload.filename)
    if result is None:
        return RuleTestResult(matched_rule_id=None, matched_rule_name=None, dest=None)
    rule, dest = result
    return RuleTestResult(
        matched_rule_id=rule.id,
        matched_rule_name=getattr(rule, "name", None),
        dest=dest,
    )
