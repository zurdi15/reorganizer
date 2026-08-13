from pydantic import BaseModel


class OutputDir(BaseModel):
    name: str
    # si tiene subdirectorios (el path builder pinta el chevron de "entrar")
    has_children: bool
