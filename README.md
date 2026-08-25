<p align="center">
  <img src="docs/assets/logo.svg" width="96" alt="Reorganizer logo" />
</p>

<h1 align="center">Reorganizer</h1>

<p align="center">
  Organize your photos and videos in your own structure.
</p>

<p align="center">
  <a href="https://github.com/zurdi15/reorganizer/actions/workflows/ci.yml"><img src="https://github.com/zurdi15/reorganizer/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI" /></a>
  <a href="https://github.com/zurdi15/reorganizer/releases"><img src="https://img.shields.io/github/v/release/zurdi15/reorganizer?sort=semver" alt="Release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/zurdi15/reorganizer" alt="License" /></a>
</p>

Reorganizer is a self-hosted web frontend to organize photos and videos. You upload files (from your phone or browser), choose a destination folder, and Reorganizer classifies and moves them into a folder structure under your library — designed so [Immich](https://immich.app) can scan it as an **external library** while keeping your on-disk structure. It ships as a single Docker image (FastAPI + SQLite + a Vue PWA).

## Features

- **Installable PWA** — Android and iOS: multi-select uploads from the gallery with per-file progress. 100% responsive, mobile-first.
- **Large resumable uploads** — files of multiple GB are chunked on the client and uploaded in parts; a network drop or your phone going to the background does not kill the upload — it resumes from the last confirmed chunk. Small chunks avoid reverse proxy/ingress size limits.
- **No duplicate uploads** — if the file already exists in the inbox by name, it is skipped (by default) instead of being saved as `photo (1).jpg` — and its bytes are not uploaded. Configurable in Settings (skip / rename).
- **Free destination path** — `2025/08/croatia`, `2025/diary`, whatever you want. EXIF suggests year/month for the batch; you compose the path with autocompletion from the existing tree. No structure is ever forced.
- **Configurable classification rules** — an editor in Settings: by type, orientation, filename pattern, or camera. By default it reproduces `photo/` + `video/{horizontal|vertical}/{phone|drone/mini3}` with fixed DJI detection (works with `DJI_0001.MP4` and camera metadata).
- **Always dry-run first** — first it plans (reading EXIF/ffprobe for each file) and you can see the full plan — duplicate warnings and files without a rule (`_unknown/`) — before executing.
- **Persistent jobs** — SQLite-backed history with per-file result, cancellation, recovery after restart, live progress over WebSocket.
- **Smart duplicate handling** — if the destination already has an identical file (hash), move mode removes it from input; if it differs, you choose the strategy (rename / skip / overwrite).
- **Immich** — when a job finishes, it triggers scanning of your external library through the API (URL + API key in Settings, with connection test and library selector).

<!-- Screenshots: drop PNGs into docs/screenshots/ and uncomment this section.
## Screenshots

<table align="center">
  <tr>
    <td><img src="docs/screenshots/mobile-upload.png" width="240" alt="Upload: multi-select from the gallery with per-file progress"></td>
    <td><img src="docs/screenshots/mobile-plan.png" width="240" alt="Plan: dry-run with duplicate warnings and unmatched files"></td>
    <td><img src="docs/screenshots/mobile-jobs.png" width="240" alt="Jobs: history with per-file result and live progress"></td>
  </tr>
</table>
-->

## Quick start

```yaml
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

```
docker compose up -d
```

Open `http://localhost:8000`. There is no login and nothing to set up on first run. The commented compose file is [docker-compose.example.yml](docker-compose.example.yml).

## Configuration

All settings are environment variables with the `RG_` prefix (`PUID`/`PGID` are read by the container entrypoint).

| Variable | Default | Description |
|---|---|---|
| `RG_DATA_DIR` | `/data` | SQLite + thumbnails |
| `RG_INPUT_DIR` | `/input` | Input tray |
| `RG_OUTPUT_DIR` | `/output` | Destination library |
| `RG_MAX_UPLOAD_MB` | `10240` | Per-uploaded-file limit (10 GiB) |
| `RG_SERVE_STATIC` | `true` | Serve the SPA (disable only in dev) |
| `PUID` / `PGID` | `1000` | Effective process owner (Docker only) |

Immich settings, upload-duplicate behavior, and organizer transfer/duplicate defaults are stored in the database and edited from **Settings** in the app.

### Data

`/data` holds the SQLite database and the thumbnail cache; `/input` and `/output` are your own folders. The container starts as root only to align the internal user with `PUID/PGID`, then drops privileges (`gosu`) before running the app. It never runs `chown` on `/input` or `/output`: set `PUID/PGID` to the real owner of your folders. Pure non-root alternative: `user: "1000:1000"` in compose (then `/data` must be writable by that uid in advance).

### Reverse proxy & authentication

Reorganizer **has no login**: anyone who can reach the port can view and move your files. Expose it only on LAN/VPN (Tailscale, WireGuard) or behind a reverse proxy with authentication (Authelia, basic auth…). If you use a proxy, it needs **WebSocket upgrade** support for `/api/v1/ws`. Large uploads use chunks (small requests), so you do not need to raise body size limits; only if you also use single-POST upload (`POST /uploads`, for curl/scripts), then consider:

```nginx
client_max_body_size 0;          # or >= RG_MAX_UPLOAD_MB (single POST only)
proxy_request_buffering off;
```

## Immich

1. In Immich, create an **external library** pointing to the same path you mount at `/output`.
2. Generate an API key for an **administrator** user (the scan endpoint requires it).
3. In Reorganizer → Settings → Immich: URL, API key, "Test connection", and select the library. With the toggle enabled, each completed job triggers scanning.

## Development

Requirements: [uv](https://docs.astral.sh/uv/), Node 22+ and `ffmpeg` (ffprobe) in PATH.

```bash
./dev.sh         # backend :8000 + frontend :5173, both with hot reload
./dev.sh back    # backend only (creates ./data/{input,output})
./dev.sh front   # frontend only
```

```
backend/    FastAPI · SQLAlchemy 2 · Alembic · SQLite
frontend/   Vue 3 · Vite 7 · TypeScript · Tailwind 4 · custom design system with generated tokens
Dockerfile  multi-stage: frontend build → python runtime
```

Use the app at `http://localhost:5173`; the API and its docs live at `http://localhost:8000/api/docs`. Tests: `cd backend && uv run pytest` · `cd frontend && npm test` (`npm run build` includes the token guards).

## License

MIT — see [LICENSE](LICENSE).
