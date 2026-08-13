"""Integración Immich vía httpx.MockTransport (nunca toca la red).

Dos hooks de inyección (ver docstring de app/services/immich.py):
- llamadas directas al servicio → parámetro `transport=`;
- endpoints del router → monkeypatch de `immich.transport_override`.
"""

import httpx
import pytest

# import del módulo (no `from ... import test_connection`: pytest intentaría
# colectar cualquier `test_*` importado al namespace del fichero)
from app.services import immich
from app.services.settings import AppSettings

BASE = "/api/v1/settings"


def _configure(session, **overrides):
    """Deja Immich completamente configurado en DB (overrides opcionales)."""
    data = {
        "immich_enabled": True,
        "immich_url": "http://immich.test",
        "immich_api_key": "adminkey",
        "immich_library_id": "lib-1",
    }
    data.update(overrides)
    AppSettings.save(session, data)


# --- test_connection ---


async def test_connection_ok():
    def handler(request):
        assert request.url.path == "/api/server/about"
        assert request.headers["x-api-key"] == "k123"
        return httpx.Response(200, json={"version": "v1.119.0"})

    version = await immich.test_connection(
        "http://immich.test/", "k123", transport=httpx.MockTransport(handler)
    )
    assert version == "v1.119.0"


async def test_connection_fallback_old_immich():
    paths = []

    def handler(request):
        paths.append(request.url.path)
        if request.url.path == "/api/server/about":
            return httpx.Response(404)
        return httpx.Response(200, json={"major": 1, "minor": 90, "patch": 2})

    version = await immich.test_connection(
        "http://immich.test", "k", transport=httpx.MockTransport(handler)
    )
    assert version == "1.90.2"
    assert paths == ["/api/server/about", "/api/server-info/version"]


async def test_connection_auth_failed():
    transport = httpx.MockTransport(lambda request: httpx.Response(401))
    with pytest.raises(immich.ImmichError) as exc:
        await immich.test_connection("http://immich.test", "bad", transport=transport)
    assert exc.value.slug == "immich_auth_failed"


async def test_connection_unreachable():
    def handler(request):
        raise httpx.ConnectError("boom", request=request)

    with pytest.raises(immich.ImmichError) as exc:
        await immich.test_connection(
            "http://down.test", "k", transport=httpx.MockTransport(handler)
        )
    assert exc.value.slug == "immich_unreachable"


async def test_connection_server_error():
    transport = httpx.MockTransport(lambda request: httpx.Response(500))
    with pytest.raises(immich.ImmichError) as exc:
        await immich.test_connection("http://immich.test", "k", transport=transport)
    assert exc.value.slug == "immich_error"


# --- list_libraries ---


async def test_list_libraries_ok():
    def handler(request):
        assert request.url.path == "/api/libraries"
        assert request.headers["x-api-key"] == "adminkey"
        return httpx.Response(
            200,
            json=[
                {"id": "lib-1", "name": "Fotos", "type": "EXTERNAL"},
                {"id": "lib-2", "name": "Backup"},
            ],
        )

    libs = await immich.list_libraries(
        "http://immich.test", "adminkey", transport=httpx.MockTransport(handler)
    )
    # el proxy reduce a {id, name}, sin campos extra de Immich
    assert libs == [{"id": "lib-1", "name": "Fotos"}, {"id": "lib-2", "name": "Backup"}]


async def test_list_libraries_forbidden():
    transport = httpx.MockTransport(lambda request: httpx.Response(403))
    with pytest.raises(immich.ImmichError) as exc:
        await immich.list_libraries("http://immich.test", "k", transport=transport)
    assert exc.value.slug == "immich_auth_failed"


# --- trigger_scan (lo llama el job engine al completar un job) ---


async def test_trigger_scan_ok(db_session):
    _configure(db_session)
    seen = []

    def handler(request):
        seen.append(request)
        assert request.method == "POST"
        assert request.url.path == "/api/libraries/lib-1/scan"
        assert request.headers["x-api-key"] == "adminkey"
        return httpx.Response(204)

    result = await immich.trigger_scan(db_session, transport=httpx.MockTransport(handler))
    assert result == "ok"
    assert len(seen) == 1


async def test_trigger_scan_skipped_when_unconfigured(db_session):
    def handler(request):
        raise AssertionError("con Immich sin configurar no debe salir ninguna llamada")

    result = await immich.trigger_scan(db_session, transport=httpx.MockTransport(handler))
    assert result == "skipped"


async def test_trigger_scan_skipped_when_disabled(db_session):
    _configure(db_session, immich_enabled=False)

    def handler(request):
        raise AssertionError("deshabilitado = ninguna llamada")

    result = await immich.trigger_scan(db_session, transport=httpx.MockTransport(handler))
    assert result == "skipped"


async def test_trigger_scan_http_error_is_failed(db_session):
    _configure(db_session)
    transport = httpx.MockTransport(lambda request: httpx.Response(500))
    # nunca lanza: soft-fail
    assert await immich.trigger_scan(db_session, transport=transport) == "failed"


async def test_trigger_scan_unreachable_is_failed(db_session):
    _configure(db_session)

    def handler(request):
        raise httpx.ConnectError("boom", request=request)

    result = await immich.trigger_scan(db_session, transport=httpx.MockTransport(handler))
    assert result == "failed"


# --- endpoints del router (inyección vía transport_override) ---


def test_endpoint_test_not_configured(client):
    resp = client.post(f"{BASE}/immich/test", json={})
    assert resp.status_code == 400
    assert resp.json()["detail"] == "immich_not_configured"


def test_endpoint_test_with_stored_settings(client, monkeypatch):
    client.put(BASE, json={"immich_url": "http://immich.test", "immich_api_key": "adminkey"})

    def handler(request):
        # usa la key REAL guardada, no la máscara
        assert request.headers["x-api-key"] == "adminkey"
        return httpx.Response(200, json={"version": "v1.119.0"})

    monkeypatch.setattr(immich, "transport_override", httpx.MockTransport(handler))
    resp = client.post(f"{BASE}/immich/test", json={})
    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "version": "v1.119.0"}


def test_endpoint_test_with_override_credentials(client, monkeypatch):
    # nada guardado en DB: el body aporta url+key para probar antes de guardar
    seen = {}

    def handler(request):
        seen["key"] = request.headers["x-api-key"]
        seen["host"] = request.url.host
        return httpx.Response(200, json={"version": "v2.0.0"})

    monkeypatch.setattr(immich, "transport_override", httpx.MockTransport(handler))
    resp = client.post(
        f"{BASE}/immich/test", json={"url": "http://other.test", "api_key": "newkey"}
    )
    assert resp.status_code == 200
    assert resp.json()["version"] == "v2.0.0"
    assert seen == {"key": "newkey", "host": "other.test"}


def test_endpoint_test_masked_key_uses_stored(client, monkeypatch):
    client.put(BASE, json={"immich_url": "http://immich.test", "immich_api_key": "adminkey"})
    seen = {}

    def handler(request):
        seen["key"] = request.headers["x-api-key"]
        return httpx.Response(200, json={"version": "v1.119.0"})

    monkeypatch.setattr(immich, "transport_override", httpx.MockTransport(handler))
    # el form re-envía la máscara → se prueba con la key guardada
    resp = client.post(f"{BASE}/immich/test", json={"api_key": "****nkey"})
    assert resp.status_code == 200
    assert seen["key"] == "adminkey"


def test_endpoint_test_unreachable_is_502(client, monkeypatch):
    client.put(BASE, json={"immich_url": "http://immich.test", "immich_api_key": "adminkey"})

    def handler(request):
        raise httpx.ConnectError("boom", request=request)

    monkeypatch.setattr(immich, "transport_override", httpx.MockTransport(handler))
    resp = client.post(f"{BASE}/immich/test", json={})
    assert resp.status_code == 502
    assert resp.json()["detail"] == "immich_unreachable"


def test_endpoint_libraries_ok(client, monkeypatch):
    client.put(BASE, json={"immich_url": "http://immich.test", "immich_api_key": "adminkey"})

    def handler(request):
        assert request.url.path == "/api/libraries"
        return httpx.Response(200, json=[{"id": "lib-1", "name": "Fotos", "extra": 1}])

    monkeypatch.setattr(immich, "transport_override", httpx.MockTransport(handler))
    resp = client.get(f"{BASE}/immich/libraries")
    assert resp.status_code == 200
    assert resp.json() == [{"id": "lib-1", "name": "Fotos"}]


def test_endpoint_libraries_auth_failed_is_502(client, monkeypatch):
    client.put(BASE, json={"immich_url": "http://immich.test", "immich_api_key": "adminkey"})
    monkeypatch.setattr(
        immich, "transport_override", httpx.MockTransport(lambda request: httpx.Response(403))
    )
    resp = client.get(f"{BASE}/immich/libraries")
    assert resp.status_code == 502
    assert resp.json()["detail"] == "immich_auth_failed"


def test_endpoint_libraries_not_configured(client):
    resp = client.get(f"{BASE}/immich/libraries")
    assert resp.status_code == 400
    assert resp.json()["detail"] == "immich_not_configured"
