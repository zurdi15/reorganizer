# Stage 1: build del frontend
# --platform=$BUILDPLATFORM: el dist son estáticos (independientes de la arch),
# así el build multi-arch no emula npm/vite bajo QEMU para arm64
FROM --platform=$BUILDPLATFORM node:22-alpine AS webbuild
WORKDIR /web
# guard:tokens corre bash; alpine solo trae ash por defecto
RUN apk add --no-cache bash
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
# versión mostrada en Ajustes: el workflow de release pasa APP_VERSION desde el
# tag; en un build suelto queda "dev". Vite inlinea las VITE_* del entorno.
ARG APP_VERSION=dev
ENV VITE_APP_VERSION=$APP_VERSION
RUN npm run build

# Stage 2: runtime
FROM python:3.13-slim
COPY --from=ghcr.io/astral-sh/uv:0.11 /uv /uvx /bin/
WORKDIR /app

# ffmpeg: ffprobe para metadata de vídeo y extracción de frames para thumbnails.
# gosu: el entrypoint arranca como root para remapear PUID/PGID y baja
# privilegios antes de ejecutar la app. Una sola capa + limpieza de listas apt
# para no arrastrar la caché de paquetes en la imagen.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg gosu \
  && rm -rf /var/lib/apt/lists/*

ENV UV_COMPILE_BYTECODE=1 UV_NO_CACHE=1
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY backend/app ./app
COPY backend/alembic ./alembic
COPY backend/alembic.ini ./
COPY --from=webbuild /web/dist ./static
ENV PATH="/app/.venv/bin:$PATH"

# Usuario dedicado 1000:1000 (el uid/gid por defecto en la mayoría de hosts);
# el entrypoint lo remapea en runtime a ${PUID}/${PGID} si difieren. /data debe
# ser suyo para poder escribir la DB y los thumbs; /input y /output son mounts
# de media del host y su propiedad NUNCA se toca (ver docker-entrypoint.sh).
# Este bloque va ANTES de declarar VOLUME: el builder legacy (no-BuildKit)
# descarta cambios hechos en el mismo build sobre un path ya declarado como
# volumen, así que el chown perdería efecto si VOLUME lo precediera.
RUN groupadd --gid 1000 rg \
  && useradd --uid 1000 --gid rg --home-dir /app --shell /usr/sbin/nologin rg \
  && mkdir -p /data /input /output \
  && chown rg:rg /data

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

ENV RG_DATA_DIR=/data RG_INPUT_DIR=/input RG_OUTPUT_DIR=/output
VOLUME /data
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/v1/health')" || exit 1

# Sin USER: el entrypoint decide (root → step-down con gosu, o exec directo si
# compose ya arrancó el contenedor con `user:`). El CMD es el comando real de
# la app para que ambos caminos ejecuten exactamente lo mismo.
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.asgi:app --host 0.0.0.0 --port 8000 --proxy-headers"]
