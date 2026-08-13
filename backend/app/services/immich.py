"""Cliente HTTP de Immich: test de conexión, librerías y trigger de rescan.

Testabilidad (hook documentado para los tests y para el job engine):
- Toda función pública acepta `transport=` (un httpx.AsyncBaseTransport, en
  tests un httpx.MockTransport) que se inyecta al AsyncClient.
- Si no se pasa, se usa el módulo-level `transport_override`; los tests de
  router hacen `monkeypatch.setattr(app.services.immich, "transport_override",
  httpx.MockTransport(handler))` para interceptar las llamadas que hacen los
  endpoints sin tocar sus firmas. En producción ambos son None (red real).

La oleada 3 (job engine) llama `await trigger_scan(session)` al completar un
job y guarda el resultado en `Job.immich_status`.
"""

import logging
from typing import Any, Literal

import httpx
from sqlalchemy.orm import Session

from .settings import AppSettings

log = logging.getLogger(__name__)

TIMEOUT_S = 10.0

# Hook de tests (ver docstring del módulo); en producción siempre None
transport_override: httpx.AsyncBaseTransport | None = None


class ImmichError(Exception):
    """Fallo hablando con Immich; `slug` es el error i18n para `detail`."""

    def __init__(self, slug: str) -> None:
        self.slug = slug
        super().__init__(slug)


def _client(transport: httpx.AsyncBaseTransport | None = None) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        timeout=TIMEOUT_S,
        transport=transport if transport is not None else transport_override,
    )


def _raise_for_status(resp: httpx.Response) -> None:
    if resp.status_code in (401, 403):
        raise ImmichError("immich_auth_failed")
    if not resp.is_success:
        raise ImmichError("immich_error")


def _json_or_error(resp: httpx.Response) -> Any:
    try:
        return resp.json()
    except ValueError as exc:
        raise ImmichError("immich_error") from exc


def _extract_version(data: Any) -> str:
    """`/api/server/about` devuelve {"version": "v1.x.y"}; el endpoint viejo
    `/api/server-info/version` devuelve {"major","minor","patch"}."""
    if isinstance(data, dict):
        if isinstance(data.get("version"), str):
            return data["version"]
        if all(k in data for k in ("major", "minor", "patch")):
            return f"{data['major']}.{data['minor']}.{data['patch']}"
    return "unknown"


async def test_connection(
    url: str, api_key: str, *, transport: httpx.AsyncBaseTransport | None = None
) -> str:
    """Prueba credenciales contra Immich y devuelve la versión del servidor.
    Lanza ImmichError con slug immich_unreachable|immich_auth_failed|immich_error."""
    base = url.rstrip("/")
    headers = {"x-api-key": api_key}
    try:
        async with _client(transport) as client:
            resp = await client.get(f"{base}/api/server/about", headers=headers)
            if resp.status_code == 404:
                # Immich antiguo: /about aún no existía
                resp = await client.get(f"{base}/api/server-info/version", headers=headers)
    except httpx.RequestError as exc:
        log.warning("Immich inalcanzable en %s: %s", base, exc)
        raise ImmichError("immich_unreachable") from exc
    _raise_for_status(resp)
    return _extract_version(_json_or_error(resp))


async def list_libraries(
    url: str, api_key: str, *, transport: httpx.AsyncBaseTransport | None = None
) -> list[dict[str, str]]:
    """Librerías del servidor (requiere API key de admin) → [{id, name}].
    Mismos slugs de error que test_connection."""
    base = url.rstrip("/")
    try:
        async with _client(transport) as client:
            resp = await client.get(f"{base}/api/libraries", headers={"x-api-key": api_key})
    except httpx.RequestError as exc:
        log.warning("Immich inalcanzable en %s: %s", base, exc)
        raise ImmichError("immich_unreachable") from exc
    _raise_for_status(resp)
    data = _json_or_error(resp)
    if not isinstance(data, list):
        raise ImmichError("immich_error")
    return [
        {"id": str(item.get("id", "")), "name": str(item.get("name", ""))}
        for item in data
        if isinstance(item, dict)
    ]


async def trigger_scan(
    session: Session, *, transport: httpx.AsyncBaseTransport | None = None
) -> Literal["ok", "failed", "skipped"]:
    """Rescan de la librería externa al acabar un job. NUNCA lanza: un fallo
    de Immich jamás debe tumbar el job (soft-fail → "failed" + warning)."""
    cfg = AppSettings.load(session)
    if not (
        cfg["immich_enabled"]
        and cfg["immich_url"]
        and cfg["immich_api_key"]
        and cfg["immich_library_id"]
    ):
        return "skipped"
    base = str(cfg["immich_url"]).rstrip("/")
    scan_url = f"{base}/api/libraries/{cfg['immich_library_id']}/scan"
    try:
        async with _client(transport) as client:
            resp = await client.post(scan_url, headers={"x-api-key": cfg["immich_api_key"]})
        # Immich actual responde 204; se acepta cualquier 2xx por si cambia
        if resp.is_success:
            return "ok"
        log.warning("Rescan de Immich falló: HTTP %s de %s", resp.status_code, scan_url)
        return "failed"
    except Exception:
        log.warning("Rescan de Immich falló: %s inalcanzable", scan_url, exc_info=True)
        return "failed"
