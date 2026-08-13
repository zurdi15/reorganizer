"""Ajustes en DB (immich_*, defaults de usuario)."""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..db import get_db
from ..schemas.settings import (
    ImmichLibrary,
    ImmichTestRequest,
    ImmichTestResult,
    SettingsRead,
    SettingsUpdate,
)
from ..services import immich
from ..services.settings import AppSettings, SettingsValidationError, mask_api_key

router = APIRouter(prefix="/settings", tags=["settings"])


def _masked(data: dict[str, Any]) -> SettingsRead:
    # la key real jamás sale por la API: solo "" o "****" + últimos 4
    return SettingsRead(**{**data, "immich_api_key": mask_api_key(data["immich_api_key"])})


@router.get("", response_model=SettingsRead)
def read_settings(db: Session = Depends(get_db)) -> SettingsRead:
    return _masked(AppSettings.load(db))


@router.put("", response_model=SettingsRead)
def update_settings(payload: SettingsUpdate, db: Session = Depends(get_db)) -> SettingsRead:
    partial = {
        key: value
        for key, value in payload.model_dump(exclude_unset=True).items()
        if value is not None
    }
    # la key enmascarada que el form re-envía tal cual = "sin cambios";
    # solo un valor genuinamente nuevo (o "" para borrarla) sobrescribe
    api_key = partial.get("immich_api_key")
    if api_key is not None and api_key.startswith("****"):
        partial.pop("immich_api_key")
    try:
        data = AppSettings.save(db, partial)
    except SettingsValidationError as exc:
        raise HTTPException(status_code=400, detail=exc.slug) from exc
    return _masked(data)


def _effective_credentials(db: Session, payload: ImmichTestRequest | None) -> tuple[str, str]:
    """Credenciales efectivas: override del request si trae valor real;
    si falta o viene enmascarado, las guardadas en DB."""
    stored = AppSettings.load(db)
    url = (payload.url if payload and payload.url else stored["immich_url"]) or ""
    api_key = payload.api_key if payload else None
    if not api_key or api_key.startswith("****"):
        api_key = stored["immich_api_key"]
    if not url.strip() or not api_key:
        raise HTTPException(status_code=400, detail="immich_not_configured")
    return url.strip(), api_key


@router.post("/immich/test", response_model=ImmichTestResult)
async def test_immich(
    payload: ImmichTestRequest | None = None, db: Session = Depends(get_db)
) -> ImmichTestResult:
    url, api_key = _effective_credentials(db, payload)
    try:
        version = await immich.test_connection(url, api_key)
    except immich.ImmichError as exc:
        raise HTTPException(status_code=502, detail=exc.slug) from exc
    return ImmichTestResult(ok=True, version=version)


@router.get("/immich/libraries", response_model=list[ImmichLibrary])
async def list_immich_libraries(db: Session = Depends(get_db)) -> list[ImmichLibrary]:
    url, api_key = _effective_credentials(db, None)
    try:
        libraries = await immich.list_libraries(url, api_key)
    except immich.ImmichError as exc:
        raise HTTPException(status_code=502, detail=exc.slug) from exc
    return [ImmichLibrary(**library) for library in libraries]
