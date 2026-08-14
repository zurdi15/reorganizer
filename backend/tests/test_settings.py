"""Ajustes: roundtrip KV, defaults, masking de la API key y validación."""

import pytest

from app.services.settings import AppSettings, get_setting, set_setting

BASE = "/api/v1/settings"

DEFAULTS = {
    "immich_enabled": False,
    "immich_url": "",
    "immich_api_key": "",
    "immich_library_id": "",
    "default_duplicate_strategy": "rename",
    "default_transfer_mode": "move",
    "upload_duplicate_strategy": "skip",
}


# --- servicio: acceso KV tipado ---


def test_kv_roundtrip_and_default(db_session):
    assert get_setting(db_session, "missing", "fallback") == "fallback"
    assert get_setting(db_session, "missing") is None
    set_setting(db_session, "sample", {"a": [1, 2], "b": True, "c": None})
    db_session.commit()
    assert get_setting(db_session, "sample") == {"a": [1, 2], "b": True, "c": None}
    # upsert sobre la misma clave
    set_setting(db_session, "sample", 42)
    db_session.commit()
    assert get_setting(db_session, "sample") == 42


def test_appsettings_load_defaults(db_session):
    assert AppSettings.load(db_session) == DEFAULTS


def test_appsettings_save_roundtrip(db_session):
    result = AppSettings.save(db_session, {"immich_enabled": True, "desconocida": "x"})
    assert result["immich_enabled"] is True
    # las claves desconocidas se ignoran, no se persisten
    assert get_setting(db_session, "desconocida") is None


# --- API: GET/PUT ---


def test_get_defaults(client):
    resp = client.get(BASE)
    assert resp.status_code == 200
    assert resp.json() == DEFAULTS


def test_put_partial_update_persists(client):
    resp = client.put(
        BASE, json={"immich_url": "http://immich.local:2283/", "immich_enabled": True}
    )
    assert resp.status_code == 200
    body = resp.json()
    # la barra final se normaliza (luego se concatena /api/... encima)
    assert body["immich_url"] == "http://immich.local:2283"
    assert body["immich_enabled"] is True
    # el resto conserva sus defaults
    assert body["default_transfer_mode"] == "move"
    assert body["default_duplicate_strategy"] == "rename"
    # y sobrevive a una nueva lectura
    assert client.get(BASE).json()["immich_url"] == "http://immich.local:2283"


def test_put_defaults_update(client):
    resp = client.put(
        BASE,
        json={
            "default_duplicate_strategy": "skip",
            "default_transfer_mode": "copy",
            "upload_duplicate_strategy": "rename",
        },
    )
    assert resp.status_code == 200
    body = client.get(BASE).json()
    assert body["default_duplicate_strategy"] == "skip"
    assert body["default_transfer_mode"] == "copy"
    assert body["upload_duplicate_strategy"] == "rename"


# --- masking de la API key ---


def test_api_key_masked_in_reads(client, db_session):
    resp = client.put(BASE, json={"immich_api_key": "secret1234"})
    # ni la respuesta del PUT ni el GET filtran la key entera
    assert resp.json()["immich_api_key"] == "****1234"
    assert client.get(BASE).json()["immich_api_key"] == "****1234"
    # pero en DB está el valor real
    db_session.expire_all()
    assert get_setting(db_session, "immich_api_key") == "secret1234"


def test_put_masked_key_means_unchanged(client, db_session):
    client.put(BASE, json={"immich_api_key": "secret1234"})
    resp = client.put(BASE, json={"immich_api_key": "****1234", "immich_enabled": True})
    assert resp.status_code == 200
    assert resp.json()["immich_enabled"] is True
    db_session.expire_all()
    assert get_setting(db_session, "immich_api_key") == "secret1234"


def test_put_missing_key_means_unchanged(client, db_session):
    client.put(BASE, json={"immich_api_key": "secret1234"})
    client.put(BASE, json={"immich_enabled": True})
    db_session.expire_all()
    assert get_setting(db_session, "immich_api_key") == "secret1234"


def test_put_new_key_replaces(client, db_session):
    client.put(BASE, json={"immich_api_key": "secret1234"})
    client.put(BASE, json={"immich_api_key": "otherkey5678"})
    assert client.get(BASE).json()["immich_api_key"] == "****5678"
    db_session.expire_all()
    assert get_setting(db_session, "immich_api_key") == "otherkey5678"


def test_put_empty_key_clears(client, db_session):
    client.put(BASE, json={"immich_api_key": "secret1234"})
    resp = client.put(BASE, json={"immich_api_key": ""})
    assert resp.json()["immich_api_key"] == ""
    db_session.expire_all()
    assert get_setting(db_session, "immich_api_key") == ""


def test_put_masked_key_without_stored_stays_empty(client):
    # re-enviar una máscara sin key guardada no inventa nada
    resp = client.put(BASE, json={"immich_api_key": "****1234"})
    assert resp.status_code == 200
    assert client.get(BASE).json()["immich_api_key"] == ""


# --- validación (slugs i18n en detail) ---


@pytest.mark.parametrize(
    ("payload", "slug"),
    [
        ({"default_duplicate_strategy": "banana"}, "invalid_duplicate_strategy"),
        ({"default_transfer_mode": "teleport"}, "invalid_transfer_mode"),
        ({"upload_duplicate_strategy": "banana"}, "invalid_upload_duplicate_strategy"),
        # `overwrite` es válido al organizar, pero NO al subir
        ({"upload_duplicate_strategy": "overwrite"}, "invalid_upload_duplicate_strategy"),
        ({"immich_url": "ftp://immich.local"}, "invalid_immich_url"),
        ({"immich_url": "no-es-una-url"}, "invalid_immich_url"),
        ({"immich_url": "http://"}, "invalid_immich_url"),
    ],
)
def test_validation_slugs(client, payload, slug):
    resp = client.put(BASE, json=payload)
    assert resp.status_code == 400
    assert resp.json()["detail"] == slug


def test_empty_url_is_valid(client):
    client.put(BASE, json={"immich_url": "http://immich.local"})
    resp = client.put(BASE, json={"immich_url": ""})
    assert resp.status_code == 200
    assert resp.json()["immich_url"] == ""


def test_invalid_put_does_not_partially_persist(client):
    resp = client.put(BASE, json={"immich_enabled": True, "default_transfer_mode": "bad"})
    assert resp.status_code == 400
    # el 400 no deja el update aplicado a medias
    assert client.get(BASE).json()["immich_enabled"] is False
