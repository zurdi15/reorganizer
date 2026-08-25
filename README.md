<p align="center">
  <img src="docs/assets/reorganizer.svg" width="96" alt="Reorganizer logo" />
</p>

<h1 align="center">Reorganizer</h1>

<p align="center">
  Organize your photos and videos in your own structure.
</p>

<p align="center">
  <a href="https://github.com/zurdi15/reorganizer/actions/workflows/ci.yml"><img src="https://github.com/zurdi15/reorganizer/actions/workflows/ci.yml/badge.svg?branch=master" alt="CI" /></a>
  <a href="https://github.com/zurdi15/reorganizer/releases"><img src="https://img.shields.io/github/v/release/zurdi15/reorganizer?sort=semver" alt="Release" /></a>
</p>

Self-hosted web frontend to organize photos and videos. You upload files (from
your phone or browser), choose a destination folder, and Reorganizer classifies
and moves them into a folder structure under your library — designed so
[Immich](https://immich.app) can scan it as an **external library** while keeping
your on-disk structure.

- 📱 **Installable PWA** (Android and iOS): multi-select uploads from the gallery
  with per-file progress. 100% responsive, mobile-first.
- ⬆️ **Large resumable uploads (multiple GB)**: files are chunked on the client
  and uploaded in parts; a network drop or your phone going to the background
  does not kill the upload — it resumes from the last confirmed chunk. Small
  chunks avoid reverse proxy/ingress size limits.
- 🔁 **No duplicate uploads**: if the file already exists in the inbox by name,
  it is skipped (by default) instead of being saved as `photo (1).jpg` — and
  its bytes are not uploaded. Configurable in Settings (skip / rename).
- 🗂️ **Free destination path**: `2025/08/croatia`, `2025/diary`, whatever you want.
  EXIF suggests year/month for the batch; you compose the path with
  autocompletion from the existing tree. No structure is ever forced.
- ⚙️ **Configurable classification rules** (editor in Settings): by type,
  orientation, filename pattern, or camera. By default it reproduces
  `photo/` + `video/{horizontal|vertical}/{phone|drone/mini3}` with fixed DJI
  detection (works with `DJI_0001.MP4` and camera metadata).
- 🔍 **Always dry-run first**: first it plans (reading EXIF/ffprobe for each
  file) and you can see the full plan — duplicate warnings and files without a
  rule (`_unknown/`) — before executing.
- 🔁 **Persistent jobs** (SQLite): history with per-file result, cancellation,
  recovery after restart, live progress over WebSocket.
- 🧬 **Smart duplicate handling**: if the destination already has an identical
  file (hash), move mode removes it from input; if it differs, you choose the
  strategy (rename / skip / overwrite).
- 📸 **Immich**: when a job finishes, it triggers scanning of your external
  library through the API (URL + API key in Settings, with connection test and
  library selector).

## Quick start (Docker)

```yaml
# docker-compose.yml — see docker-compose.example.yml for the full file
services:
  reorganizer:
    image: ghcr.io/zurdi15/reorganizer:latest
    ports: ["8000:8000"]
    environment:
      PUID: 1000   # owner uid of your media folders
      PGID: 1000
    volumes:
      - ./data:/data                       # DB + thumbnail cache
      - /path/to/uploads:/input            # input tray
      - /path/to/library:/output           # your library (the one Immich scans)
    restart: unless-stopped
```

The container starts as root only to align the internal user with `PUID/PGID`,
then drops privileges (`gosu`) before running the app. It never runs `chown` on
`/input` or `/output`: set `PUID/PGID` to the real owner of your folders.
Pure non-root alternative: `user: "1000:1000"` in compose (then `/data` must be
writable by that uid in advance).

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `RG_DATA_DIR` | `/data` | SQLite + thumbnails |
| `RG_INPUT_DIR` | `/input` | Input tray |
| `RG_OUTPUT_DIR` | `/output` | Destination library |
| `RG_MAX_UPLOAD_MB` | `10240` | Per-uploaded-file limit (10 GiB) |
| `RG_SERVE_STATIC` | `true` | Serve the SPA (disable only in dev) |
| `PUID` / `PGID` | `1000` | Effective process owner (Docker only) |

Immich settings, upload-duplicate behavior, and organizer transfer/duplicate
defaults are stored in the database and edited from **Settings** in the app.

## Immich

1. In Immich, create an **external library** pointing to the same path you mount
   at `/output`.
2. Generate an API key for an **administrator** user (the scan endpoint requires
   it).
3. In Reorganizer → Settings → Immich: URL, API key, "Test connection", and
   select the library. With the toggle enabled, each completed job triggers
   scanning.

## No authentication — read this

Reorganizer **has no login**: anyone who can reach the port can view and move
your files. Expose it only on LAN/VPN (Tailscale, WireGuard) or behind a reverse
proxy with authentication (Authelia, basic auth…). If you use a proxy, it needs
**WebSocket upgrade** support for `/api/v1/ws`. Large uploads use chunks (small
requests), so you do not need to raise body size limits; only if you also use
single-POST upload (`POST /uploads`, for curl/scripts), then consider:

```nginx
client_max_body_size 0;          # or >= RG_MAX_UPLOAD_MB (single POST only)
proxy_request_buffering off;
```

## Development

Requirements: `uv`, Node 22+, `ffmpeg` (ffprobe) in PATH.

```bash
./dev.sh all     # backend :8000 + Vite :5173 (always work on :5173)
./dev.sh back    # backend only (creates ./data/{input,output})
./dev.sh front   # frontend only
```

- Backend: FastAPI + SQLAlchemy 2 + Alembic (`backend/`, tests with
  `uv run pytest`).
- Frontend: Vue 3 + Vite 7 + Tailwind 4 with custom design system and generated
  tokens (`frontend/`, tests with `npm test`; `npm run build` includes token
  guards).
- API docs at `http://localhost:8000/api/docs`.

## License

Personal use. Repo: [zurdi15/reorganizer](https://github.com/zurdi15/reorganizer).
