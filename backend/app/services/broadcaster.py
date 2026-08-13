"""Hub WebSocket push-only. Vive en app.state.broadcaster; los servicios
emiten con `await broadcaster.broadcast({...})` y el router ws (oleada 3)
registra/retira clientes y responde al único mensaje entrante {"action":"sync"}
con `state_sync_payload()`.

Los mensajes son JSON puro, CERO HTML (mata el XSS del código viejo: los
nombres de archivo se renderizan como nodos de texto en el cliente).
"""

import asyncio
from collections import deque
from typing import Any

from fastapi import WebSocket

# un cliente con el socket atascado no puede congelar el job entero: cada send
# se corta a los 5s y ese cliente se trata como muerto
_SEND_TIMEOUT_S = 5.0


class Broadcaster:
    def __init__(self) -> None:
        self.clients: set[WebSocket] = set()
        # ring de replay para el state-sync tras una reconexión: acota el
        # histórico a 300 eventos (adiós al sync gigante del código viejo)
        self.events: deque[dict[str, Any]] = deque(maxlen=300)

    def add(self, ws: WebSocket) -> None:
        self.clients.add(ws)

    def remove(self, ws: WebSocket) -> None:
        self.clients.discard(ws)

    async def broadcast(self, event: dict[str, Any]) -> None:
        """Apunta el evento en el ring y lo empuja a todos los clientes;
        los que fallen al enviar se barren (móviles que mataron el socket)."""
        self.events.append(event)
        dead: list[WebSocket] = []
        for ws in list(self.clients):
            try:
                # timeout: un send parado (cliente atascado) no bloquea al resto
                # ni congela las transiciones del job
                await asyncio.wait_for(ws.send_json(event), timeout=_SEND_TIMEOUT_S)
            except (Exception, asyncio.TimeoutError):
                dead.append(ws)
        for ws in dead:
            self.clients.discard(ws)

    def state_sync_payload(self, job: dict[str, Any] | None = None) -> dict[str, Any]:
        """Mensaje state-sync: job activo serializado (JobRead | None) +
        replay de los últimos ≤300 eventos, en orden de emisión."""
        return {"type": "state-sync", "data": {"job": job, "events": list(self.events)}}
