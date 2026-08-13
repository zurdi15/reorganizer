"""WebSocket push-only bajo /api/v1/ws.

Protocolo (contrato del frontend): al conectar se envía un `state-sync`
(job activo como JobRead | null + replay del ring de ≤300 eventos); el único
mensaje entrante soportado es {"action":"sync"} que re-envía el state-sync.
Todo lo demás se ignora — los jobs se lanzan por REST, jamás por WS.
"""

import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import select

from ..models import Job
from ..schemas.jobs import JobRead

router = APIRouter(tags=["ws"])

logger = logging.getLogger(__name__)

# estados con job "vivo" para el state-sync: el cliente que (re)conecta debe
# retomar tanto un plan pendiente de confirmar como un job en curso
SYNC_STATUSES = ("planning", "planned", "running")


def _current_job_payload(app) -> dict | None:
    """Job activo serializado como JobRead (dict JSON-safe) o None."""
    with app.state.sessionmaker() as session:
        job = session.scalar(
            select(Job).where(Job.status.in_(SYNC_STATUSES)).order_by(Job.id.desc()).limit(1)
        )
    if job is None:
        return None
    return JobRead.model_validate(job).model_dump(mode="json")


@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket) -> None:
    broadcaster = ws.app.state.broadcaster
    await ws.accept()
    broadcaster.add(ws)
    try:
        await ws.send_json(broadcaster.state_sync_payload(_current_job_payload(ws.app)))
        while True:
            raw = await ws.receive_text()
            try:
                message = json.loads(raw)
            except ValueError:
                continue  # basura no-JSON: se ignora (canal push-only)
            if isinstance(message, dict) and message.get("action") == "sync":
                await ws.send_json(
                    broadcaster.state_sync_payload(_current_job_payload(ws.app))
                )
            # cualquier otra acción se ignora a propósito
    except WebSocketDisconnect:
        pass
    except Exception:
        # un socket que muere a mitad de send/receive no debe subir al server
        logger.debug("websocket cerrado con error", exc_info=True)
    finally:
        broadcaster.remove(ws)
