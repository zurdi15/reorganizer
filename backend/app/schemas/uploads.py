"""Schemas de la API de subidas."""

from pydantic import BaseModel


class UploadResult(BaseModel):
    """Un archivo subido y ya finalizado en input_dir (espejo de
    services.uploads.StoredUpload)."""

    # nombre tal cual lo mandó el cliente (el frontend lo renderiza como
    # nodo de texto, nunca HTML)
    original_name: str
    # nombre final en input_dir (saneado y des-colisionado)
    stored_name: str
    size_bytes: int
    # photo|video|unknown por extensión
    media_type: str
