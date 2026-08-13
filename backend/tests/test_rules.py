"""Motor de reglas: seed, matching, render y fall-through (unitario, sin API)."""

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import func, select

from app.models import Rule
from app.services.rules import (
    UNKNOWN_DEST,
    ensure_default_rules,
    match,
    match_and_render,
    render_dest,
)


@dataclass
class Info:
    """Doble mínimo de MediaInfo: el motor duck-typea (solo lee atributos),
    así que este test no importa services.metadata."""

    media_type: str | None = None
    orientation: str | None = None
    taken_at: datetime | None = None
    camera_make: str | None = None
    camera_model: str | None = None


def rule(**kwargs) -> Rule:
    # los defaults de columna (enabled=True) solo aplican al INSERT: para
    # reglas en memoria hay que fijarlos explícitamente
    kwargs.setdefault("enabled", True)
    kwargs.setdefault("dest_template", "x")
    return Rule(**kwargs)


# ── seed ───────────────────────────────────────────────────────────────────


def test_seed_creates_legacy_tree(db_session):
    ensure_default_rules(db_session)
    rules = db_session.scalars(select(Rule).order_by(Rule.priority)).all()
    assert [r.priority for r in rules] == [10, 15, 20, 30]
    assert all(r.enabled for r in rules)
    assert (rules[0].media_type, rules[0].dest_template) == ("photo", "photo")
    # el fix DJI: regla por metadata de cámara ANTES que la regla por nombre
    assert rules[1].camera_make == "DJI"
    assert rules[1].dest_template == "video/{orientation}/dron/mini3"
    assert rules[2].filename_regex == "^dji"
    assert rules[2].dest_template == "video/{orientation}/dron/mini3"
    assert (rules[3].media_type, rules[3].dest_template) == ("video", "video/{orientation}/phone")


def test_seed_idempotent(db_session):
    ensure_default_rules(db_session)
    ensure_default_rules(db_session)
    assert db_session.scalar(select(func.count(Rule.id))) == 4


def test_seed_never_touches_non_empty_table(db_session):
    # una tabla con CUALQUIER regla es del usuario: no se re-siembra nada
    db_session.add(rule(priority=5, dest_template="custom"))
    db_session.commit()
    ensure_default_rules(db_session)
    rules = db_session.scalars(select(Rule)).all()
    assert len(rules) == 1
    assert rules[0].dest_template == "custom"


# ── matching ───────────────────────────────────────────────────────────────


def test_match_orders_by_priority_first_wins():
    # se pasan desordenadas a propósito: el motor ordena por priority asc
    rules = [
        rule(priority=20, media_type="video", dest_template="b"),
        rule(priority=10, media_type="video", dest_template="a"),
    ]
    assert match(rules, Info(media_type="video"), "clip.mp4").dest_template == "a"


def test_match_skips_disabled():
    rules = [
        rule(priority=10, media_type="video", enabled=False, dest_template="a"),
        rule(priority=20, media_type="video", dest_template="b"),
    ]
    assert match(rules, Info(media_type="video"), "clip.mp4").dest_template == "b"


def test_match_all_conditions_are_anded():
    r = rule(priority=10, media_type="video", orientation="horizontal", camera_make="dji")
    ok = Info(media_type="video", orientation="horizontal", camera_make="DJI Technology")
    assert match([r], ok, "clip.mp4") is r
    bad_orientation = Info(media_type="video", orientation="vertical", camera_make="DJI Technology")
    assert match([r], bad_orientation, "clip.mp4") is None
    # condición de cámara presente pero el archivo no trae make → no matchea
    assert match([r], Info(media_type="video", orientation="horizontal"), "clip.mp4") is None


def test_match_filename_regex_case_insensitive():
    r = rule(priority=10, filename_regex="^dji")
    assert match([r], Info(), "DJI_0001.MP4") is r
    assert match([r], Info(), "dji_fly_20240101.mp4") is r
    assert match([r], Info(), "IMG_1234.MP4") is None


def test_match_camera_make_substring():
    r = rule(priority=10, camera_make="DJI")
    assert match([r], Info(camera_make="DJI Technology"), "a.mp4") is r
    assert match([r], Info(camera_make="dji technology co."), "a.mp4") is r
    assert match([r], Info(camera_make="Apple"), "a.mp4") is None
    assert match([r], Info(), "a.mp4") is None


def test_match_catch_all_rule_matches_everything():
    r = rule(priority=10)  # todas las condiciones NULL
    assert match([r], Info(media_type="unknown"), "cosa.bin") is r


def test_match_invalid_stored_regex_is_no_match():
    # solo posible con una DB editada a mano (la API valida al guardar)
    r = rule(priority=10, filename_regex="[")
    assert match([r], Info(), "a.mp4") is None


# ── render ─────────────────────────────────────────────────────────────────


def test_render_all_placeholders():
    r = rule(priority=1, dest_template="{media_type}/{orientation}/{make}/{model}/{yyyy}/{mm}")
    info = Info(
        media_type="video",
        orientation="vertical",
        taken_at=datetime(2024, 8, 7, 10, 30),
        camera_make="DJI",
        camera_model="Mini 3",
    )
    assert render_dest(r, info) == "video/vertical/DJI/Mini 3/2024/08"


def test_render_missing_placeholder_value_returns_none():
    r = rule(priority=1, dest_template="{yyyy}/{mm}")
    assert render_dest(r, Info(media_type="photo")) is None  # sin taken_at


def test_render_invalid_dest_returns_none():
    # plantilla hostil metida a mano en DB: validate_rel_dest la para
    r = rule(priority=1, dest_template="../evil")
    assert render_dest(r, Info()) is None


def test_render_unknown_placeholder_returns_none():
    r = rule(priority=1, dest_template="video/{nope}")
    assert render_dest(r, Info(media_type="video")) is None


# ── match_and_render (fall-through + fallback) ─────────────────────────────


def test_match_and_render_falls_through_unrenderable_rule():
    rules = [
        rule(priority=10, media_type="video", dest_template="{yyyy}/video"),
        rule(priority=20, media_type="video", dest_template="video/plain"),
    ]
    result = match_and_render(rules, Info(media_type="video"), "clip.mp4")
    assert result is not None
    matched, dest = result
    assert (matched.priority, dest) == (20, "video/plain")


def test_match_and_render_none_when_nothing_renders():
    rules = [rule(priority=10, media_type="video", dest_template="{orientation}")]
    assert match_and_render(rules, Info(media_type="video"), "clip.mp4") is None
    # contrato del fallback built-in: con None, el caller enruta a _unknown/
    assert UNKNOWN_DEST == "_unknown"


def test_default_rules_route_legacy_tree(db_session):
    ensure_default_rules(db_session)
    rules = db_session.scalars(select(Rule)).all()

    matched, dest = match_and_render(rules, Info(media_type="photo"), "IMG_0001.jpg")
    assert (matched.priority, dest) == (10, "photo")

    # dron por metadata: gana a la regla por nombre aunque ambas matcheen
    info = Info(media_type="video", orientation="horizontal", camera_make="DJI Technology")
    matched, dest = match_and_render(rules, info, "DJI_0042.MP4")
    assert (matched.priority, dest) == (15, "video/horizontal/dron/mini3")

    # dron por nombre (case-insensitive), sin metadata de cámara
    matched, dest = match_and_render(
        rules, Info(media_type="video", orientation="vertical"), "dji_fly_20240101.mp4"
    )
    assert (matched.priority, dest) == (20, "video/vertical/dron/mini3")

    matched, dest = match_and_render(
        rules, Info(media_type="video", orientation="horizontal"), "VID_20240807.mp4"
    )
    assert (matched.priority, dest) == (30, "video/horizontal/phone")

    # vídeo sin orientación: ninguna plantilla {orientation} renderiza → fallback
    assert match_and_render(rules, Info(media_type="video"), "clip.mp4") is None
