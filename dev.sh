#!/usr/bin/env bash
# Lanza backend (FastAPI :8000) y frontend (Vite :5173) en modo dev con hot reload.
#
#   ./dev.sh           → backend + frontend
#   ./dev.sh back      → solo backend
#   ./dev.sh front     → solo frontend
#   ./dev.sh --open    → además abre el navegador en :5173
#
# Los datos de dev se guardan en ./data (ignorado por git): DB + thumbs en
# ./data, carpeta de entrada en ./data/input y salida en ./data/output. La app
# se usa desde http://localhost:5173 (Vite proxya /api al backend y recarga en
# caliente; :8000 solo expone la API en dev).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
DATA_DIR="${RG_DATA_DIR:-$ROOT/data}"
INPUT_DIR="${RG_INPUT_DIR:-$DATA_DIR/input}"
OUTPUT_DIR="${RG_OUTPUT_DIR:-$DATA_DIR/output}"

MODE="all"
OPEN=0
for arg in "$@"; do
  case "$arg" in
    back | front | all) MODE="$arg" ;;
    --open) OPEN=1 ;;
    *)
      echo "Uso: ./dev.sh [back|front] [--open]" >&2
      exit 1
      ;;
  esac
done

check_migrations() {
  # Aviso (nunca bloquea) si models.py difiere de las migraciones aplicadas.
  if ! RG_DATA_DIR="$DATA_DIR" uv run alembic check >/dev/null 2>&1; then
    echo "⚠ models.py difiere de las migraciones. Genera una con:" >&2
    echo "    cd backend && uv run alembic revision --autogenerate -m 'descripcion'" >&2
  fi
}

start_back() {
  if ! command -v uv >/dev/null 2>&1; then
    echo "✗ uv no encontrado. Instálalo con:" >&2
    echo "    sudo pacman -S uv        # Arch/CachyOS" >&2
    echo "    curl -LsSf https://astral.sh/uv/install.sh | sh   # cualquier distro" >&2
    exit 1
  fi
  if ! command -v ffprobe >/dev/null 2>&1; then
    echo "⚠ ffprobe no encontrado: los vídeos quedarán como 'unknown' y sin miniatura." >&2
    echo "    sudo pacman -S ffmpeg    # Arch/CachyOS" >&2
  fi
  cd "$ROOT/backend"
  mkdir -p "$DATA_DIR" "$INPUT_DIR" "$OUTPUT_DIR"
  uv sync
  RG_DATA_DIR="$DATA_DIR" uv run alembic upgrade head
  check_migrations
  # RG_SERVE_STATIC=0: que :8000 no sirva una SPA compilada obsoleta en dev
  RG_DATA_DIR="$DATA_DIR" RG_INPUT_DIR="$INPUT_DIR" RG_OUTPUT_DIR="$OUTPUT_DIR" \
    RG_SERVE_STATIC=0 exec uv run uvicorn app.asgi:app --reload --port 8000
}

start_front() {
  if ! command -v npm >/dev/null 2>&1; then
    echo "✗ npm no encontrado. Instala Node 22+ (https://nodejs.org) para el modo dev del frontend." >&2
    exit 1
  fi
  cd "$ROOT/frontend"
  if [ ! -d node_modules ]; then
    echo "▸ Instalando dependencias del frontend…"
    npm install --no-audit --no-fund
  fi
  if [ "$OPEN" = 1 ]; then
    npm run dev -- --open
  else
    npm run dev
  fi
}

wait_for_back() {
  for _ in $(seq 1 60); do
    if ! kill -0 "$BACK_PID" 2>/dev/null; then
      echo "✗ El backend no arrancó; revisa los mensajes anteriores." >&2
      exit 1
    fi
    if curl -sf http://localhost:8000/api/v1/health >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.5
  done
  echo "⚠ El backend no responde en :8000 tras 30 s; sigo con el frontend igualmente." >&2
}

case "$MODE" in
  back)
    echo "▸ Backend: http://localhost:8000 (API docs: http://localhost:8000/api/docs)"
    start_back
    ;;
  front)
    echo "▸ Frontend: http://localhost:5173 (proxy /api → :8000)"
    start_front
    ;;
  all)
    start_back &
    BACK_PID=$!
    trap 'kill "$BACK_PID" 2>/dev/null || true' EXIT INT TERM
    wait_for_back
    echo ""
    echo "──────────────────────────────────────────────────"
    echo "  reorganizer · modo dev (hot reload activo)"
    echo "  App        →  http://localhost:5173   ← usa esta"
    echo "  API docs   →  http://localhost:8000/api/docs"
    echo "──────────────────────────────────────────────────"
    echo ""
    start_front
    ;;
esac
