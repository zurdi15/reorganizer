import logging
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.engine import Engine

from .config import get_settings
from .db import make_engine, make_sessionmaker
from .routers import (
    input as input_router,
    jobs as jobs_router,
    output as output_router,
    rules as rules_router,
    settings as settings_router,
    uploads as uploads_router,
    ws as ws_router,
)
from .services import jobs as jobs_service
from .services import rules as rules_service
from .services import uploads as uploads_service
from .services.broadcaster import Broadcaster
from .services.paths import PathError

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
API_PREFIX = "/api/v1"


def _configure_logging(level: str) -> None:
    """Hace que los logs de la app (paquete `app`) salgan junto a los access de
    uvicorn: sin esto, uvicorn no configura el root y los logger.info del
    backend se descartan (solo se verían WARNING+). Handler propio → no depende
    del root ni duplica."""
    app_logger = logging.getLogger("app")
    app_logger.setLevel(level.upper())
    if not app_logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(
            logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
        )
        app_logger.addHandler(handler)
    app_logger.propagate = False


def create_app(engine: Engine | None = None) -> FastAPI:
    settings = get_settings()
    _configure_logging(settings.log_level)
    if engine is None:
        settings.data_dir.mkdir(parents=True, exist_ok=True)
        engine = make_engine(settings.db_url)

    app = FastAPI(
        title="reorganizer",
        description="Organizador de fotos/vídeos para librerías externas de Immich",
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
    )
    app.state.engine = engine
    app.state.sessionmaker = make_sessionmaker(engine)
    # hub WS push-only (los routers y servicios emiten a través de él)
    app.state.broadcaster = Broadcaster()
    # runner del único job activo (crea sus propias sesiones por task, nunca
    # comparte la de una request)
    app.state.job_runner = jobs_service.JobRunner(
        app.state.sessionmaker, app.state.broadcaster
    )

    # thumbs_dir cuelga de data_dir: un solo mkdir crea ambos
    settings.thumbs_dir.mkdir(parents=True, exist_ok=True)

    # arranque idempotente: seed de reglas + recovery de jobs cortados por un
    # reinicio + limpieza de .part huérfanos (cuerpos en oleadas 2/3)
    with app.state.sessionmaker() as session:
        rules_service.ensure_default_rules(session)
        jobs_service.recover_interrupted_jobs(session)
    uploads_service.clean_stale_parts(settings)

    # las rutas hostiles (traversal, absolutas, symlink-escape) fallan como
    # slug i18n en detail, patrón berserk — un solo handler para toda la app
    @app.exception_handler(PathError)
    async def _invalid_path(_request: Request, _exc: PathError) -> JSONResponse:
        return JSONResponse(status_code=400, content={"detail": "invalid_path"})

    # sin auth (LAN/VPN/reverse proxy): los guards de path aplican igualmente
    app.include_router(settings_router.router, prefix=API_PREFIX)
    app.include_router(rules_router.router, prefix=API_PREFIX)
    app.include_router(uploads_router.router, prefix=API_PREFIX)
    app.include_router(input_router.router, prefix=API_PREFIX)
    app.include_router(output_router.router, prefix=API_PREFIX)
    app.include_router(jobs_router.router, prefix=API_PREFIX)
    app.include_router(ws_router.router, prefix=API_PREFIX)

    @app.get(f"{API_PREFIX}/health", tags=["health"])
    def health():
        return {"status": "ok"}

    if settings.serve_static and STATIC_DIR.is_dir():
        assets_dir = STATIC_DIR / "assets"
        if assets_dir.is_dir():
            app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

        @app.get("/{full_path:path}", include_in_schema=False)
        @app.head("/{full_path:path}", include_in_schema=False)
        def spa_fallback(full_path: str):
            if full_path.startswith("api/"):
                return FileResponse(STATIC_DIR / "index.html", status_code=404)
            candidate = (STATIC_DIR / full_path).resolve()
            if (
                full_path
                and candidate.is_relative_to(STATIC_DIR)
                and candidate.is_file()
            ):
                # el service worker y el manifest nunca deben cachearse por HTTP:
                # un sw.js viejo retrasaría los deploys de la PWA
                if full_path == "sw.js":
                    return FileResponse(candidate, headers={"Cache-Control": "no-cache"})
                if full_path == "manifest.webmanifest":
                    return FileResponse(
                        candidate,
                        media_type="application/manifest+json",
                        headers={"Cache-Control": "no-cache"},
                    )
                return FileResponse(candidate)
            if full_path == "favicon.ico":
                raise HTTPException(status_code=404)
            # el index nunca debe cachearse: referencia assets con hash que
            # cambian en cada build (index viejo = assets rotos tras desplegar)
            return FileResponse(
                STATIC_DIR / "index.html", headers={"Cache-Control": "no-cache"}
            )

    else:

        @app.get("/", include_in_schema=False)
        def dev_root():
            return HTMLResponse(
                "<h1>reorganizer · backend</h1>"
                "<p>Modo dev: la app se sirve en "
                "<a href='http://localhost:5173'>http://localhost:5173</a> "
                "(Vite con hot reload). Docs de la API: "
                "<a href='/api/docs'>/api/docs</a>.</p>"
            )

    return app
