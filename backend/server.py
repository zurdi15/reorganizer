import os
import asyncio
import logging
import dotenv

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

from backend.shared import (
    FileType,
    Orientation,
    create_output_folders_server,
    classify_file,
    get_destination_folder,
    change_ownership_input,
    change_ownership_output,
)
import shutil

dotenv.load_dotenv()
INPUT_PATH: str = "/input"
OUTPUT_PATH: str = "/output"
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(BASE_DIR)

FRONTEND_DIST = os.path.join(PROJECT_ROOT, "frontend", "dist")

file_emoji = {
    FileType.PHOTO: "🖼️",
    FileType.VIDEO: "🎞️",
    FileType.UNKNOWN: "📄",
}


# ---------------------------------------------------------------------------
# Server-side processing state (persists across WS connections)
# ---------------------------------------------------------------------------
class ProcessingState:
    def __init__(self):
        self.reset()

    def reset(self):
        self.status: str = "idle"  # idle | processing | complete | error
        self.stats: dict = {
            "total": 0,
            "processed": 0,
            "pictures": 0,
            "videos": 0,
            "unknown": 0,
            "errors": 0,
        }
        self.logs: list[str] = []
        self.errors: list[str] = []
        self.output_path: str = ""

    def to_dict(self) -> dict:
        return {
            "status": self.status,
            "stats": self.stats.copy(),
            "logs": list(self.logs),
            "errors": list(self.errors),
            "output_path": self.output_path,
        }


state = ProcessingState()
connected_clients: set[WebSocket] = set()
processing_task: asyncio.Task | None = None


# ---------------------------------------------------------------------------
# Broadcast helpers
# ---------------------------------------------------------------------------
async def broadcast(message: str):
    """Send a message to all connected WebSocket clients. Silently remove dead ones."""
    dead = set()
    for ws in connected_clients:
        try:
            await ws.send_text(message)
        except Exception:
            dead.add(ws)
    connected_clients.difference_update(dead)


async def broadcast_json(data: dict):
    """Send a JSON message to all connected WebSocket clients."""
    dead = set()
    for ws in connected_clients:
        try:
            await ws.send_json(data)
        except Exception:
            dead.add(ws)
    connected_clients.difference_update(dead)


async def send_state_sync(ws: WebSocket):
    """Send the full current state to a single client."""
    try:
        await ws.send_json({"type": "state-sync", "data": state.to_dict()})
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Background processing
# ---------------------------------------------------------------------------
async def process_folder_background(path: str):
    """Process files in a background task, broadcasting updates to all clients."""
    global state

    state.reset()
    state.status = "processing"
    state.output_path = path

    await broadcast_json({"type": "status", "data": "processing"})

    # Change ownership of input path (optional in dev)
    if not change_ownership_input(INPUT_PATH):
        print("Warning: Failed to change input path ownership (this is normal in dev mode)")
        log_msg = "<i>Note: Running without ownership changes (dev mode)</i>"
        state.logs.append(log_msg)
        await broadcast_json({"type": "log", "data": log_msg})

    # Create the structured output folders
    folders = create_output_folders_server(path, OUTPUT_PATH)
    base_output_folder = folders["base"]

    print(f"Processing files: {path}")

    # Get list of files to process
    try:
        files = [f for f in os.listdir(INPUT_PATH) if os.path.isfile(os.path.join(INPUT_PATH, f))]
    except FileNotFoundError:
        error_msg = "Input directory not found"
        state.errors.append(error_msg)
        state.stats["errors"] += 1
        state.status = "error"
        await broadcast_json({"type": "error", "data": error_msg})
        await broadcast_json({"type": "status", "data": "error"})
        return

    if not files:
        log_msg = "<b>No files to process.</b>"
        state.logs.append(log_msg)
        state.status = "complete"
        await broadcast_json({"type": "log", "data": log_msg})
        await broadcast_json({"type": "status", "data": "complete"})
        return

    state.stats["total"] = len(files)
    await broadcast_json({"type": "total", "data": len(files)})

    # Process files one by one
    for file_name in files:
        file_path = os.path.join(INPUT_PATH, file_name)

        # Classify file (CPU-bound, run in thread to avoid blocking the event loop)
        file_type, orientation = await asyncio.to_thread(classify_file, file_path)
        destination_folder = get_destination_folder(file_name, file_type, orientation, folders)

        # Update statistics
        if file_type == FileType.PHOTO:
            state.stats["pictures"] += 1
        elif file_type == FileType.VIDEO:
            state.stats["videos"] += 1
        else:
            state.stats["unknown"] += 1

        state.stats["processed"] += 1

        # Move file to destination
        if destination_folder:
            dest_path = os.path.join(destination_folder, file_name)
            await asyncio.to_thread(shutil.move, file_path, dest_path)

            # Build log entry
            orientation_part = f" - Orientation: <b>{orientation}</b><br>" if orientation else ""
            log_msg = (
                f"File: <b>{file_name}</b><br>"
                f" - Type: <b>{file_emoji[file_type]}{file_type}</b><br>"
                f"{orientation_part}"
                f" - Dest.: {dest_path}"
            )
            state.logs.append(log_msg)

            print(
                f"File: {file_name}\n\t- Type: {file_emoji[file_type]}{file_type}"
                f"\n\t- Orientation: {orientation if orientation else 'N/A'}"
                f"\n\t- Dest.: {dest_path}"
            )

            # Broadcast progress
            await broadcast_json({
                "type": "processed",
                "data": {
                    "log": log_msg,
                    "stats": state.stats.copy(),
                },
            })
        else:
            # File type unknown / no destination
            log_msg = f"File: <b>{file_name}</b><br> - Type: <b>{file_emoji.get(file_type, '📄')}{file_type}</b><br> - <span style='color:orange'>Skipped (no destination)</span>"
            state.logs.append(log_msg)
            await broadcast_json({
                "type": "processed",
                "data": {
                    "log": log_msg,
                    "stats": state.stats.copy(),
                },
            })

        # Yield control so broadcasts can flush
        await asyncio.sleep(0)

    # Change ownership of output folder
    print(f"Trying to change ownership of output folder: {base_output_folder}")
    if not change_ownership_output(base_output_folder):
        print("Warning: Failed to change output path ownership (this is normal in dev mode)")
        log_msg = "<i>Note: Output created without ownership changes (dev mode)</i>"
        state.logs.append(log_msg)
        await broadcast_json({"type": "log", "data": log_msg})

    # Final summary
    summary = (
        f"<h6 style='color: green'>Done!</h6>"
        f"{file_emoji[FileType.PHOTO]} Pictures: <b>{state.stats['pictures']}</b><br>"
        f"{file_emoji[FileType.VIDEO]} Videos: <b>{state.stats['videos']}</b><br>"
        f"{file_emoji[FileType.UNKNOWN]} Unknown: <b>{state.stats['unknown']}</b>"
    )
    state.logs.append(summary)
    state.status = "complete"

    await broadcast_json({"type": "log", "data": summary})
    await broadcast_json({"type": "status", "data": "complete"})
    print("Processing complete")


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/input")
def get_input():
    """List files in the input directory."""
    print(f"Getting input files for {INPUT_PATH}")
    try:
        dirs = os.listdir(INPUT_PATH)
        dirs.sort()
    except FileNotFoundError:
        dirs = []
    print(f"Input: {dirs}")
    return dirs


@app.get("/api/input/stats")
def get_input_stats():
    """Return input file counts broken down by type."""
    try:
        all_entries = os.listdir(INPUT_PATH)
        files = [f for f in all_entries if os.path.isfile(os.path.join(INPUT_PATH, f))]
    except FileNotFoundError:
        return {"total": 0, "pictures": 0, "videos": 0, "unknown": 0, "files": []}

    picture_extensions = {"jpg", "jpeg", "png", "gif", "bmp", "tiff", "tif", "webp", "heic", "heif"}
    video_extensions = {"mp4", "avi", "mov", "mkv", "flv", "wmv", "m4v", "3gp", "webm", "mts"}

    pictures = 0
    videos = 0
    unknown = 0

    for f in files:
        ext = f.rsplit(".", 1)[-1].lower() if "." in f else ""
        if ext in picture_extensions:
            pictures += 1
        elif ext in video_extensions:
            videos += 1
        else:
            unknown += 1

    return {
        "total": len(files),
        "pictures": pictures,
        "videos": videos,
        "unknown": unknown,
    }


@app.get("/api/output")
def get_output(subfolder: str = ""):
    print(f"Getting output tree directory for {OUTPUT_PATH}/{subfolder}")
    try:
        dirs = [
            d
            for d in os.listdir(f"{OUTPUT_PATH}/{subfolder}")
            if os.path.isdir(os.path.join(OUTPUT_PATH, subfolder, d))
            and d not in ["photo", "video", "reorganizer", "folder_template"]
        ]
        dirs.sort()
    except FileNotFoundError:
        dirs = []
    print(f"Output: {dirs}")
    return dirs


@app.get("/api/status")
def get_status():
    """Return the current processing state (REST fallback)."""
    return state.to_dict()


@app.get("/", response_class=HTMLResponse)
def read_root():
    """Serve the main HTML file for SPA."""
    index_path = os.path.join(FRONTEND_DIST, "index.html")
    if os.path.exists(index_path):
        with open(index_path, "r") as f:
            return f.read()
    else:
        return HTMLResponse(
            "<h1>Frontend not built</h1><p>Please run 'npm run build' in the frontend directory</p>",
            status_code=404,
        )


@app.websocket("/ws/reorganizer")
async def websocket_reorganizer(websocket: WebSocket):
    global processing_task

    await websocket.accept()
    connected_clients.add(websocket)
    print(f"WebSocket client connected (total: {len(connected_clients)})")

    # Send current state immediately so the client catches up
    await send_state_sync(websocket)

    try:
        while True:
            data = await websocket.receive_json()
            action = data.get("action", "start")

            if action == "start":
                path = data.get("path")
                if not path:
                    await websocket.send_json({
                        "type": "error",
                        "data": f"Invalid path ({path})",
                    })
                    continue

                # Reject if already processing
                if state.status == "processing":
                    await websocket.send_json({
                        "type": "error",
                        "data": "A processing job is already running. Please wait for it to finish.",
                    })
                    continue

                # Launch background task
                processing_task = asyncio.create_task(process_folder_background(path))

            elif action == "sync":
                # Client explicitly requests state sync
                await send_state_sync(websocket)

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logging.error(f"WebSocket error: {e}")
    finally:
        connected_clients.discard(websocket)
        print(f"WebSocket client disconnected (total: {len(connected_clients)})")


# ---------------------------------------------------------------------------
# Static file mounts (AFTER all routes)
# ---------------------------------------------------------------------------
app.mount("/media", StaticFiles(directory=INPUT_PATH), name="media")

if os.path.exists(FRONTEND_DIST):
    app.mount("/assets", StaticFiles(directory=os.path.join(FRONTEND_DIST, "assets")), name="assets")
else:
    logging.warning(f"Frontend dist directory not found at {FRONTEND_DIST}")

public_dir = os.path.join(PROJECT_ROOT, "frontend", "public")
if os.path.exists(public_dir):
    app.mount("/", StaticFiles(directory=public_dir, html=False), name="public")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("DEV_PORT", 8000)), log_level="info")
