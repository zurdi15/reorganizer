"""Acceso tipado a la tabla clave-valor `settings` (immich_* y defaults).

Los valores se guardan como JSON serializado en texto para no migrar el
esquema por cada ajuste nuevo (ver models.AppSetting).
"""

import json
from typing import Any
from urllib.parse import urlparse

from sqlalchemy.orm import Session

from ..models import DUPLICATE_STRATEGIES, TRANSFER_MODES, AppSetting


class SettingsValidationError(ValueError):
    """Valor de ajuste inválido; `slug` es el error i18n para `detail`."""

    def __init__(self, slug: str) -> None:
        self.slug = slug
        super().__init__(slug)


def get_setting(session: Session, key: str, default: Any = None) -> Any:
    """Lee una clave; ausente (o con JSON corrupto) devuelve `default`."""
    row = session.get(AppSetting, key)
    if row is None:
        return default
    try:
        return json.loads(row.value)
    except ValueError:
        # fila editada a mano/corrupta: mejor el default que un 500
        return default


def set_setting(session: Session, key: str, value: Any) -> None:
    """Upsert de una clave (el valor se codifica a JSON). No hace commit:
    la transacción es del caller (AppSettings.save agrupa varios cambios
    en un único commit)."""
    encoded = json.dumps(value)
    row = session.get(AppSetting, key)
    if row is None:
        session.add(AppSetting(key=key, value=encoded))
    else:
        row.value = encoded
    session.flush()


def mask_api_key(value: str) -> str:
    """Máscara para lecturas de la API: la key entera jamás sale por HTTP."""
    if not value:
        return ""
    return "****" + value[-4:]


def _validate(changes: dict[str, Any]) -> None:
    """Valida TODO el partial antes de escribir NADA: un 400 nunca deja
    un update aplicado a medias."""
    strategy = changes.get("default_duplicate_strategy")
    if strategy is not None and strategy not in DUPLICATE_STRATEGIES:
        raise SettingsValidationError("invalid_duplicate_strategy")
    mode = changes.get("default_transfer_mode")
    if mode is not None and mode not in TRANSFER_MODES:
        raise SettingsValidationError("invalid_transfer_mode")
    url = changes.get("immich_url")
    if url:  # cadena vacía = Immich sin configurar, estado válido
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            raise SettingsValidationError("invalid_immich_url")


class AppSettings:
    """Vista tipada sobre las claves conocidas, con sus defaults."""

    DEFAULTS: dict[str, Any] = {
        "immich_enabled": False,
        "immich_url": "",
        "immich_api_key": "",
        "immich_library_id": "",
        "default_duplicate_strategy": "rename",
        "default_transfer_mode": "move",
    }

    @staticmethod
    def load(session: Session) -> dict[str, Any]:
        """Todos los ajustes conocidos; las claves aún no guardadas salen
        con su default (la key SIN enmascarar: eso es cosa del router)."""
        return {
            key: get_setting(session, key, default)
            for key, default in AppSettings.DEFAULTS.items()
        }

    @staticmethod
    def save(session: Session, partial: dict[str, Any]) -> dict[str, Any]:
        """Update parcial: aplica solo claves conocidas, valida el conjunto
        completo y hace UN commit. Devuelve la vista completa resultante."""
        changes = {k: v for k, v in partial.items() if k in AppSettings.DEFAULTS}
        if "immich_url" in changes:
            # sin espacios ni barra final, para concatenar rutas /api/... luego
            changes["immich_url"] = str(changes["immich_url"]).strip().rstrip("/")
        _validate(changes)
        for key, value in changes.items():
            set_setting(session, key, value)
        session.commit()
        return AppSettings.load(session)
