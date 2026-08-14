<p align="center">
  <img src="docs/assets/reorganizer.svg" width="96" alt="Reorganizer logo" />
</p>

<h1 align="center">Reorganizer</h1>

<p align="center">
  Organiza tus fotos y vídeos en una estructura propia.
</p>

<p align="center">
  <a href="https://github.com/zurdi15/reorganizer/actions/workflows/ci.yml"><img src="https://github.com/zurdi15/reorganizer/actions/workflows/ci.yml/badge.svg?branch=master" alt="CI" /></a>
  <a href="https://github.com/zurdi15/reorganizer/releases"><img src="https://img.shields.io/github/v/release/zurdi15/reorganizer?sort=semver" alt="Release" /></a>
</p>

Frontal web self-hosted para organizar fotos y vídeos. Subes archivos (desde el
móvil o el navegador), eliges una carpeta destino, y Reorganizer los clasifica y
mueve a una estructura de carpetas bajo tu librería — pensado para que
[Immich](https://immich.app) la escanee como **librería externa** manteniendo tu
estructura en disco.

- 📱 **PWA instalable** (Android e iOS): subida multi-selección desde la galería
  con progreso por archivo. 100% responsive, mobile-first.
- ⬆️ **Subidas grandes (varios GB) reanudables**: se trocean en el cliente y se
  suben por partes; un corte de red o el móvil pasando a segundo plano no tira
  la subida — se reanuda desde el último trozo confirmado. Los trozos pequeños
  esquivan límites de tamaño del reverse proxy/ingress.
- 🗂️ **Ruta destino libre**: `2025/08/croacia`, `2025/diario`, lo que quieras.
  El EXIF sugiere año/mes del lote; tú compones la ruta con autocompletado del
  árbol existente. Nunca se fuerza una estructura.
- ⚙️ **Reglas de clasificación configurables** (editor en Ajustes): por tipo,
  orientación, patrón de nombre o cámara. Por defecto reproduce
  `photo/` + `video/{horizontal|vertical}/{phone|dron/mini3}` con la detección
  DJI arreglada (funciona con `DJI_0001.MP4` y con metadata de cámara).
- 🔍 **Dry-run siempre**: primero se planifica (leyendo EXIF/ffprobe de cada
  archivo) y ves el plan completo — avisos de duplicados y de archivos sin
  regla (`_unknown/`) — antes de ejecutar.
- 🔁 **Jobs persistentes** (SQLite): historial con resultado por archivo,
  cancelación, recuperación tras reinicio, progreso en vivo por WebSocket.
- 🧬 **Duplicados con cabeza**: si el destino ya tiene un archivo idéntico
  (hash), en modo mover se limpia del input; si difiere, eliges estrategia
  (renombrar / saltar / sobrescribir).
- 📸 **Immich**: al terminar un job lanza el escaneo de tu librería externa vía
  API (URL + API key en Ajustes, con test de conexión y selector de librería).

## Arranque rápido (Docker)

```yaml
# docker-compose.yml — ver docker-compose.example.yml para el archivo completo
services:
  reorganizer:
    image: ghcr.io/zurdi15/reorganizer:latest
    ports: ["8000:8000"]
    environment:
      PUID: 1000   # uid propietario de tus carpetas de media
      PGID: 1000
    volumes:
      - ./data:/data                       # DB + caché de miniaturas
      - /ruta/a/subidas:/input             # bandeja de entrada
      - /ruta/a/libreria:/output           # tu librería (la que escanea Immich)
    restart: unless-stopped
```

El contenedor arranca como root solo para ajustar el usuario interno a
`PUID/PGID` y cede privilegios (`gosu`) antes de ejecutar la app. Nunca hace
`chown` de `/input` ni `/output`: pon `PUID/PGID` con el dueño real de tus
carpetas. Alternativa pure-non-root: `user: "1000:1000"` en compose (entonces
`/data` debe ser escribible por ese uid de antemano).

### Variables de entorno

| Variable | Default | Descripción |
|---|---|---|
| `RG_DATA_DIR` | `/data` | SQLite + miniaturas |
| `RG_INPUT_DIR` | `/input` | Bandeja de entrada |
| `RG_OUTPUT_DIR` | `/output` | Librería destino |
| `RG_MAX_UPLOAD_MB` | `10240` | Límite por archivo subido (10 GiB) |
| `RG_SERVE_STATIC` | `true` | Servir la SPA (desactivar solo en dev) |
| `PUID` / `PGID` | `1000` | Dueño efectivo del proceso (solo Docker) |

La configuración de Immich y los defaults de duplicados/transferencia viven en
la base de datos y se editan desde **Ajustes** en la propia app.

## Immich

1. En Immich, crea una **librería externa** apuntando a la misma ruta que
   montas en `/output`.
2. Genera una API key de un usuario **administrador** (el endpoint de escaneo
   lo exige).
3. En Reorganizer → Ajustes → Immich: URL, API key, «Probar conexión» y elige
   la librería. Con el toggle activado, cada job terminado lanza el escaneo.

## Sin autenticación — léelo

Reorganizer **no tiene login**: cualquiera que alcance el puerto puede ver y
mover tus archivos. Exponlo solo en LAN/VPN (Tailscale, WireGuard) o detrás de
un reverse proxy con autenticación (Authelia, basic auth…). Si usas proxy,
necesita soporte de **upgrade WebSocket** para `/api/v1/ws`. Las subidas grandes
van por trozos (peticiones pequeñas), así que no hace falta subir el límite de
tamaño del cuerpo; solo si además usas la subida en un único POST (`POST
/uploads`, para curl/scripts) conviene:

```nginx
client_max_body_size 0;          # o >= RG_MAX_UPLOAD_MB (solo el POST único)
proxy_request_buffering off;
```

## Desarrollo

Requisitos: `uv`, Node 22+, `ffmpeg` (ffprobe) en el PATH.

```bash
./dev.sh all     # backend :8000 + Vite :5173 (trabaja siempre en :5173)
./dev.sh back    # solo backend (crea ./data/{input,output})
./dev.sh front   # solo frontend
```

- Backend: FastAPI + SQLAlchemy 2 + Alembic (`backend/`, tests con
  `uv run pytest`).
- Frontend: Vue 3 + Vite 7 + Tailwind 4 con design system propio y tokens
  generados (`frontend/`, tests con `npm test`; `npm run build` incluye los
  guards de tokens).
- API docs en `http://localhost:8000/api/docs`.

## Licencia

Uso personal. Repo: [zurdi15/reorganizer](https://github.com/zurdi15/reorganizer).
