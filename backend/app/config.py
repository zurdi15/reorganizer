from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="RG_")

    # DB + thumbnails (estado propio de la app)
    data_dir: Path = Path("/data")
    # carpeta de entrada: aquí aterrizan las subidas y de aquí se organiza
    input_dir: Path = Path("/input")
    # librería externa de Immich: destino final de los jobs
    output_dir: Path = Path("/output")
    # en dev (dev.sh) se pone a 0 para que :8000 no sirva una SPA compilada obsoleta
    serve_static: bool = True
    # límite por archivo subido (10 GiB): vídeos de dron/móvil largos
    max_upload_mb: int = 10240
    # timeout de ffprobe/ffmpeg por archivo (metadata y thumbnails de vídeo)
    ffprobe_timeout_s: int = 20
    # nivel de log de la app (además de los access de uvicorn): INFO muestra lo
    # que HACE el backend (jobs, subidas, Immich); DEBUG añade el detalle fino
    log_level: str = "INFO"

    @property
    def db_path(self) -> Path:
        return self.data_dir / "reorganizer.db"

    @property
    def db_url(self) -> str:
        return f"sqlite:///{self.db_path}"

    @property
    def thumbs_dir(self) -> Path:
        return self.data_dir / "thumbs"

    @property
    def upload_tmp_dir(self) -> Path:
        # DELIBERADO: los .part van bajo input_dir (mismo filesystem que el
        # destino final) para que el os.replace de finalización sea atómico;
        # con /data e /input en mounts distintos, un .part de 10 GB costaría
        # una segunda copia completa
        return self.input_dir / ".rg-tmp"


@lru_cache
def get_settings() -> Settings:
    return Settings()
