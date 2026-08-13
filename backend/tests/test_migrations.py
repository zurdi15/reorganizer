"""Pruebas de migraciones de verdad (alembic upgrade real, no create_all):
el resto de la suite usa Base.metadata.create_all sobre SQLite en memoria
(ver conftest.engine). Aquí se verifica que `alembic upgrade head` sobre un
fichero produce exactamente el esquema de models.py (cero drift)."""

from pathlib import Path

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from sqlalchemy import create_engine, inspect

from app.config import get_settings
from app.db import Base

BACKEND_DIR = Path(__file__).resolve().parent.parent


def _alembic_config() -> Config:
    return Config(str(BACKEND_DIR / "alembic.ini"))


@pytest.fixture
def alembic_settings(tmp_path, monkeypatch):
    """Settings apuntando a un data_dir de usar y tirar; deja la cache de
    get_settings limpia al salir para que el resto de la suite recupere los
    dirs del conftest."""
    monkeypatch.setenv("RG_DATA_DIR", str(tmp_path))
    get_settings.cache_clear()
    yield get_settings()
    get_settings.cache_clear()


def test_upgrade_head_matches_models(alembic_settings):
    command.upgrade(_alembic_config(), "head")

    engine = create_engine(f"sqlite:///{alembic_settings.db_path}")
    try:
        tables = set(inspect(engine).get_table_names())
        assert tables == set(Base.metadata.tables) | {"alembic_version"}

        # cero drift: autogenerate contra el esquema migrado no propone nada
        with engine.connect() as conn:
            ctx = MigrationContext.configure(conn)
            diff = compare_metadata(ctx, Base.metadata)
        assert diff == [], f"models.py difiere de las migraciones: {diff}"
    finally:
        engine.dispose()


def test_downgrade_base_drops_everything(alembic_settings):
    cfg = _alembic_config()
    command.upgrade(cfg, "head")
    command.downgrade(cfg, "base")

    engine = create_engine(f"sqlite:///{alembic_settings.db_path}")
    try:
        tables = set(inspect(engine).get_table_names())
        assert tables == {"alembic_version"}
    finally:
        engine.dispose()
