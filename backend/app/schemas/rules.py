"""Esquemas del dominio de reglas.

La validación semántica (regex compilable, plantilla válida, enums) vive en
el router con slugs i18n en `detail` — aquí solo forma y tipos, para que un
valor inválido produzca el slug del patrón berserk y no el 422 genérico de
pydantic.
"""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class RuleBase(BaseModel):
    # `name` forma parte del contrato pero la columna aún no existe en el
    # modelo: se acepta y se ignora hasta que Rule la gane (ver informe)
    name: str | None = None
    enabled: bool = True
    # condiciones AND-combinadas; None = la condición no aplica (una regla
    # con todo a None es un catch-all legítimo)
    media_type: str | None = None
    orientation: str | None = None
    filename_regex: str | None = None
    camera_make: str | None = None
    camera_model: str | None = None
    dest_template: str


class RuleCreate(RuleBase):
    # None → el router asigna max(priority) + 10
    priority: int | None = None


class RuleUpdate(BaseModel):
    """PATCH parcial: solo se aplican los campos presentes (exclude_unset).

    En los campos-condición un None explícito BORRA la condición; en los no
    anulables (priority/enabled/dest_template) un None se ignora.
    """

    name: str | None = None
    priority: int | None = None
    enabled: bool | None = None
    media_type: str | None = None
    orientation: str | None = None
    filename_regex: str | None = None
    camera_make: str | None = None
    camera_model: str | None = None
    dest_template: str | None = None


class RuleRead(RuleBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    priority: int
    created_at: datetime
    updated_at: datetime


class RuleReorder(BaseModel):
    # permutación exacta de TODOS los ids existentes, en el nuevo orden;
    # el router reescribe priorities 10,20,30…
    ids: list[int]


class RuleTestRequest(BaseModel):
    """Caso sintético para POST /rules/test (puro, sin tocar disco).

    Cumple el contrato MediaLike del motor: se pasa tal cual como `info`.
    """

    filename: str
    media_type: str
    orientation: str | None = None
    camera_make: str | None = None
    camera_model: str | None = None
    # extra opcional sobre el contrato mínimo: permite probar plantillas
    # con {yyyy}/{mm} sin inventar un archivo real
    taken_at: datetime | None = None


class RuleTestResult(BaseModel):
    # todo null = ninguna regla matcheó y renderizó (el planner usaría el
    # fallback built-in `_unknown/`)
    matched_rule_id: int | None
    matched_rule_name: str | None
    dest: str | None
