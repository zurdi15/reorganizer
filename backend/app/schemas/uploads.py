"""Schemas de la API de subidas."""

from pydantic import BaseModel, Field


class UploadSessionCreate(BaseModel):
    """Apertura de una subida por trozos."""

    filename: str
    total_size: int = Field(ge=0)


class UploadSession(BaseModel):
    """Estado de una sesión por trozos (creación y reanudación)."""

    upload_id: str
    received: int
    total_size: int


class ChunkAck(BaseModel):
    """Confirmación de un trozo: bytes recibidos hasta ahora."""

    received: int


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
