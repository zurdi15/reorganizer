import os
import shutil
import tempfile
from pathlib import Path

# Debe fijarse antes de importar la app: get_settings() lee el entorno una sola vez
_TMP = Path(tempfile.mkdtemp(prefix="rg-test-"))
os.environ["RG_DATA_DIR"] = str(_TMP / "data")
os.environ["RG_INPUT_DIR"] = str(_TMP / "input")
os.environ["RG_OUTPUT_DIR"] = str(_TMP / "output")

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.pool import StaticPool

from app.config import get_settings
from app.db import Base, make_sessionmaker
from app.main import create_app


@pytest.fixture
def engine():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    @event.listens_for(engine, "connect")
    def _fk_on(dbapi_conn, _record):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    yield engine
    engine.dispose()


@pytest.fixture
def db_session(engine):
    maker = make_sessionmaker(engine)
    session = maker()
    yield session
    session.close()


@pytest.fixture(autouse=True)
def media_dirs():
    """Deja input/, output/ y thumbs/ limpios en cada test (las rutas de
    settings son fijas para toda la sesión: lru_cache + env de arriba)."""
    settings = get_settings()
    for directory in (settings.input_dir, settings.output_dir):
        shutil.rmtree(directory, ignore_errors=True)
        directory.mkdir(parents=True, exist_ok=True)
    shutil.rmtree(settings.thumbs_dir, ignore_errors=True)
    yield settings


@pytest.fixture
def app(engine):
    return create_app(engine=engine)


@pytest.fixture
def client(app):
    with TestClient(app) as client:
        yield client
