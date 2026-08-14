"""APIs de lectura/limpieza del folder de entrada. Todo `path` que llega del
cliente pasa por resolve_under (PathError → 400 invalid_path en el handler
global de main.py)."""

import os
import re
from collections.abc import Iterator
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from PIL import ExifTags, Image
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..models import Rule
from ..schemas.input import InputDates, InputFile, InputProbe, InputSummary
from ..services import metadata, thumbs
from ..services import rules as rules_engine
from ..services.paths import resolve_under

router = APIRouter(prefix="/input", tags=["input"])

# muestreo máximo de fotos para las sugerencias EXIF del path builder
DATE_SAMPLE_LIMIT = 50


def _iter_files(root: Path) -> Iterator[Path]:
    """Solo archivos, recursivo, en orden estable; se saltan dotfiles y
    dot-dirs (incluido `.rg-tmp`, los .part de subidas a medias)."""
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if not d.startswith("."))
        for name in sorted(filenames):
            if name.startswith("."):
                continue
            yield Path(dirpath) / name


@router.get("/files", response_model=list[InputFile])
def list_files() -> list[InputFile]:
    root = get_settings().input_dir
    if not root.is_dir():
        return []
    files: list[InputFile] = []
    for path in _iter_files(root):
        try:
            # el archivo puede desaparecer entre el walk y el stat (borrado
            # concurrente, ESTALE de NFS): se salta sin romper el listado
            stat = path.stat()
        except OSError:
            continue
        files.append(
            InputFile(
                path=path.relative_to(root).as_posix(),
                name=path.name,
                size_bytes=stat.st_size,
                mtime=stat.st_mtime,
                kind=thumbs.kind_for(path),
            )
        )
    return files


@router.get("/summary", response_model=InputSummary)
def summary() -> InputSummary:
    root = get_settings().input_dir
    counts = {"photo": 0, "video": 0, "unknown": 0}
    total = 0
    if root.is_dir():
        for path in _iter_files(root):
            counts[thumbs.kind_for(path)] += 1
            total += 1
    return InputSummary(total=total, **counts)


def _exif_year_month(path: Path) -> tuple[str, str] | None:
    """(yyyy, mm) del EXIF de una foto, o None si no hay/está corrupta.
    Preferimos DateTimeOriginal (sub-IFD Exif); fallback al DateTime del IFD0."""
    try:
        with Image.open(path) as img:
            exif = img.getexif()
            value = exif.get_ifd(ExifTags.IFD.Exif).get(ExifTags.Base.DateTimeOriginal)
            if not value:
                value = exif.get(ExifTags.Base.DateTime)
    except Exception:
        return None
    if not value:
        return None
    match = re.match(r"(\d{4})[:-](\d{2})", str(value))
    if not match:
        return None
    return match.group(1), match.group(2)


@router.get("/dates", response_model=InputDates)
def input_dates() -> InputDates:
    # muestreo ligero inline: el servicio de metadata completo (ffprobe,
    # orientación, cámara…) llega en la oleada 2
    root = get_settings().input_dir
    months_by_year: dict[str, set[str]] = {}
    sampled = 0
    if root.is_dir():
        for path in _iter_files(root):
            if thumbs.kind_for(path) != "photo":
                continue
            if sampled >= DATE_SAMPLE_LIMIT:
                break
            sampled += 1
            parsed = _exif_year_month(path)
            if parsed is None:
                continue
            year, month = parsed
            months_by_year.setdefault(year, set()).add(month)
    return InputDates(
        years=sorted(months_by_year, reverse=True),
        months_by_year={year: sorted(months) for year, months in months_by_year.items()},
    )


@router.get("/probe", response_model=InputProbe)
async def probe(path: str = Query(...), db: Session = Depends(get_db)) -> InputProbe:
    settings = get_settings()
    target = resolve_under(settings.input_dir, path)
    if not target.is_file():
        raise HTTPException(status_code=404, detail="file_not_found")
    info = await metadata.probe(target)
    stat = target.stat()
    # regla que matchearía este archivo en un plan (mismo motor que el planner)
    matched = rules_engine.match_and_render(list(db.scalars(select(Rule))), info, target.name)
    matched_rule = (
        None
        if matched is None
        else {"id": matched[0].id, "name": matched[0].name, "dest": matched[1]}
    )
    return InputProbe(
        # rel POSIX normalizada (resolve_under ya resolvió symlinks/base)
        path=target.relative_to(settings.input_dir.resolve()).as_posix(),
        name=target.name,
        size_bytes=stat.st_size,
        media_type=info.media_type,
        width=info.width,
        height=info.height,
        orientation=info.orientation,
        taken_at=info.taken_at,
        camera_make=info.camera_make,
        camera_model=info.camera_model,
        matched_rule=matched_rule,
    )


@router.get("/preview")
async def preview(path: str = Query(...), thumb: bool = Query(False)) -> FileResponse:
    settings = get_settings()
    target = resolve_under(settings.input_dir, path)
    if not target.is_file():
        raise HTTPException(status_code=404, detail="file_not_found")
    if thumb:
        try:
            # get_thumb acota la concurrencia (semáforo) y corre la generación
            # en un hilo: la grid puede pedir cientos sin reventar la memoria
            cached = await thumbs.get_thumb(target)
        except thumbs.ThumbUnavailableError:
            raise HTTPException(status_code=404, detail="thumb_unavailable") from None
        return FileResponse(cached, media_type="image/jpeg")
    # el FileResponse de Starlette moderno responde Range (scrub de vídeo);
    # verificado en tests/test_input_api.py::test_preview_supports_range.
    # nosniff + Content-Disposition attachment: un .html/.svg subido jamás se
    # renderiza como documento same-origin (stored XSS); <img>/<video> y los
    # Range siguen funcionando igual
    return FileResponse(
        target,
        headers={"X-Content-Type-Options": "nosniff"},
        content_disposition_type="attachment",
        filename=target.name,
    )


@router.delete("/files", status_code=204)
def delete_file(path: str = Query(...)) -> None:
    target = resolve_under(get_settings().input_dir, path)
    if not target.is_file():
        raise HTTPException(status_code=404, detail="file_not_found")
    target.unlink()
