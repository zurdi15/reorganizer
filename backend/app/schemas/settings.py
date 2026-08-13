"""Esquemas de /settings (la API key viaja siempre enmascarada en lecturas)."""

from pydantic import BaseModel


class SettingsRead(BaseModel):
    immich_enabled: bool
    immich_url: str
    # enmascarada: "" o "****" + últimos 4 caracteres, nunca la key entera
    immich_api_key: str
    immich_library_id: str
    default_duplicate_strategy: str
    default_transfer_mode: str


class SettingsUpdate(BaseModel):
    """Update parcial: campo ausente (o null) = sin cambios. Una api_key
    enmascarada (empieza por "****") también significa "sin cambios";
    "" la borra y cualquier otro valor la sobrescribe."""

    immich_enabled: bool | None = None
    immich_url: str | None = None
    immich_api_key: str | None = None
    immich_library_id: str | None = None
    default_duplicate_strategy: str | None = None
    default_transfer_mode: str | None = None


class ImmichTestRequest(BaseModel):
    """Override opcional para probar credenciales antes de guardarlas;
    campo vacío/enmascarado → se usa el valor almacenado."""

    url: str | None = None
    api_key: str | None = None


class ImmichTestResult(BaseModel):
    ok: bool
    version: str


class ImmichLibrary(BaseModel):
    id: str
    name: str
