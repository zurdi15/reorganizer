"""API de reglas: CRUD, reorder, validación con slugs y POST /rules/test.

El fixture `client` arranca la app, que siembra las 4 reglas por defecto
(priorities 10/15/20/30) — los tests parten de ese estado.
"""

BASE = "/api/v1/rules"


def get_rules(client) -> list[dict]:
    resp = client.get(BASE)
    assert resp.status_code == 200
    return resp.json()


def rule_by_priority(client, priority: int) -> dict:
    return next(r for r in get_rules(client) if r["priority"] == priority)


# ── GET /rules ─────────────────────────────────────────────────────────────


def test_list_returns_seed_ordered_by_priority(client):
    rules = get_rules(client)
    assert [r["priority"] for r in rules] == [10, 15, 20, 30]
    assert rules[0]["dest_template"] == "photo"
    assert rules[3]["dest_template"] == "video/{orientation}/phone"
    expected_keys = {
        "id", "name", "priority", "enabled", "media_type", "orientation",
        "filename_regex", "camera_make", "camera_model", "dest_template",
        "created_at", "updated_at",
    }
    assert expected_keys <= set(rules[0])


# ── POST /rules ────────────────────────────────────────────────────────────


def test_create_auto_assigns_priority(client):
    resp = client.post(BASE, json={"dest_template": "misc"})
    assert resp.status_code == 201
    body = resp.json()
    assert body["priority"] == 40  # max(30) + 10
    assert body["enabled"] is True
    assert body["media_type"] is None
    assert len(get_rules(client)) == 5


def test_create_with_explicit_priority(client):
    resp = client.post(BASE, json={"priority": 12, "media_type": "photo", "dest_template": "x"})
    assert resp.status_code == 201
    assert resp.json()["priority"] == 12
    # el hueco 12 queda entre 10 y 15
    assert [r["priority"] for r in get_rules(client)] == [10, 12, 15, 20, 30]


def test_create_priority_collision(client):
    resp = client.post(BASE, json={"priority": 15, "dest_template": "x"})
    assert resp.status_code == 422
    assert resp.json()["detail"] == "priority_taken"


def test_create_validation_slugs(client):
    cases = [
        ({"dest_template": "x", "filename_regex": "["}, "invalid_regex"),
        ({"dest_template": "../evil"}, "invalid_dest_template"),
        ({"dest_template": ""}, "invalid_dest_template"),
        ({"dest_template": "/absoluta"}, "invalid_dest_template"),
        ({"dest_template": "video/{nope}"}, "unknown_placeholder"),
        ({"dest_template": "x", "media_type": "audio"}, "invalid_media_type"),
        # `unknown` es un media_type de archivo, no de regla (fallback built-in)
        ({"dest_template": "x", "media_type": "unknown"}, "invalid_media_type"),
        ({"dest_template": "x", "orientation": "diagonal"}, "invalid_orientation"),
    ]
    for payload, slug in cases:
        resp = client.post(BASE, json=payload)
        assert resp.status_code == 422, payload
        assert resp.json()["detail"] == slug
    assert len(get_rules(client)) == 4  # nada llegó a guardarse


def test_create_template_placeholders_are_ignored_by_path_check(client):
    # una plantilla hecha SOLO de placeholders es válida como ruta
    resp = client.post(BASE, json={"dest_template": "{yyyy}/{mm}"})
    assert resp.status_code == 201


# ── PATCH /rules/{id} ──────────────────────────────────────────────────────


def test_patch_updates_fields(client):
    rid = rule_by_priority(client, 10)["id"]
    resp = client.patch(f"{BASE}/{rid}", json={"enabled": False, "dest_template": "fotos"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["enabled"] is False
    assert body["dest_template"] == "fotos"
    # persistido de verdad
    assert rule_by_priority(client, 10)["enabled"] is False


def test_patch_null_clears_condition(client):
    rid = rule_by_priority(client, 10)["id"]
    resp = client.patch(f"{BASE}/{rid}", json={"media_type": None})
    assert resp.status_code == 200
    assert resp.json()["media_type"] is None


def test_patch_priority_move_and_collision(client):
    rid = rule_by_priority(client, 10)["id"]
    resp = client.patch(f"{BASE}/{rid}", json={"priority": 15})
    assert resp.status_code == 422
    assert resp.json()["detail"] == "priority_taken"
    resp = client.patch(f"{BASE}/{rid}", json={"priority": 25})
    assert resp.status_code == 200
    assert [r["priority"] for r in get_rules(client)] == [15, 20, 25, 30]


def test_patch_validation_and_404(client):
    rid = rule_by_priority(client, 10)["id"]
    resp = client.patch(f"{BASE}/{rid}", json={"filename_regex": "("})
    assert resp.status_code == 422
    assert resp.json()["detail"] == "invalid_regex"
    resp = client.patch(f"{BASE}/99999", json={"enabled": False})
    assert resp.status_code == 404
    assert resp.json()["detail"] == "rule_not_found"


# ── DELETE /rules/{id} ─────────────────────────────────────────────────────


def test_delete_rule(client):
    rid = rule_by_priority(client, 20)["id"]
    assert client.delete(f"{BASE}/{rid}").status_code == 204
    assert [r["priority"] for r in get_rules(client)] == [10, 15, 30]
    resp = client.delete(f"{BASE}/{rid}")
    assert resp.status_code == 404
    assert resp.json()["detail"] == "rule_not_found"


# ── POST /rules/reorder ────────────────────────────────────────────────────


def test_reorder_rewrites_priorities(client):
    ids = [r["id"] for r in get_rules(client)]
    new_order = list(reversed(ids))
    resp = client.post(f"{BASE}/reorder", json={"ids": new_order})
    assert resp.status_code == 200
    assert [r["id"] for r in resp.json()] == new_order
    rules = get_rules(client)
    assert [r["id"] for r in rules] == new_order
    assert [r["priority"] for r in rules] == [10, 20, 30, 40]


def test_reorder_requires_exact_id_set(client):
    ids = [r["id"] for r in get_rules(client)]
    bad_sets = [
        ids[:-1],              # falta uno
        [*ids, 99999],         # sobra uno inexistente
        [ids[0]] * len(ids),   # duplicados
        [],                    # vacío
    ]
    for bad in bad_sets:
        resp = client.post(f"{BASE}/reorder", json={"ids": bad})
        assert resp.status_code == 422, bad
        assert resp.json()["detail"] == "invalid_rule_order"
    # y no se ha movido nada
    assert [r["priority"] for r in get_rules(client)] == [10, 15, 20, 30]


# ── POST /rules/test ───────────────────────────────────────────────────────


def test_rules_test_photo(client):
    resp = client.post(f"{BASE}/test", json={"filename": "IMG_0001.jpg", "media_type": "photo"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["matched_rule_id"] == rule_by_priority(client, 10)["id"]
    assert body["dest"] == "photo"
    assert "matched_rule_name" in body


def test_rules_test_dji_by_filename(client):
    body = {"filename": "DJI_0001.MP4", "media_type": "video", "orientation": "horizontal"}
    resp = client.post(f"{BASE}/test", json=body)
    result = resp.json()
    # sin camera_make no matchea la regla 15: cae en la 20 (nombre, case-insensitive)
    assert result["matched_rule_id"] == rule_by_priority(client, 20)["id"]
    assert result["dest"] == "video/horizontal/dron/mini3"


def test_rules_test_dji_by_camera_make_wins(client):
    body = {
        "filename": "clip.mp4",
        "media_type": "video",
        "orientation": "vertical",
        "camera_make": "DJI Technology",
    }
    result = client.post(f"{BASE}/test", json=body).json()
    assert result["matched_rule_id"] == rule_by_priority(client, 15)["id"]
    assert result["dest"] == "video/vertical/dron/mini3"


def test_rules_test_no_match_returns_nulls(client):
    # vídeo sin orientación: ninguna plantilla {orientation} renderiza
    resp = client.post(f"{BASE}/test", json={"filename": "clip.mp4", "media_type": "video"})
    assert resp.status_code == 200
    assert resp.json() == {"matched_rule_id": None, "matched_rule_name": None, "dest": None}


def test_rules_test_unknown_media_falls_to_builtin(client):
    resp = client.post(f"{BASE}/test", json={"filename": "doc.txt", "media_type": "unknown"})
    assert resp.status_code == 200
    assert resp.json()["dest"] is None


def test_rules_test_validates_case(client):
    resp = client.post(f"{BASE}/test", json={"filename": "a.bin", "media_type": "audio"})
    assert resp.status_code == 422
    assert resp.json()["detail"] == "invalid_media_type"
    resp = client.post(
        f"{BASE}/test",
        json={"filename": "a.mp4", "media_type": "video", "orientation": "sideways"},
    )
    assert resp.status_code == 422
    assert resp.json()["detail"] == "invalid_orientation"


def test_rules_test_respects_disabled_rules(client):
    rid = rule_by_priority(client, 10)["id"]
    client.patch(f"{BASE}/{rid}", json={"enabled": False})
    resp = client.post(f"{BASE}/test", json={"filename": "IMG_0001.jpg", "media_type": "photo"})
    assert resp.json() == {"matched_rule_id": None, "matched_rule_name": None, "dest": None}
