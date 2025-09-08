import os
import logging
import dotenv

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from src.shared import (
    FileType,
    create_output_folders_server,
    classify_file,
    get_destination_folder,
    change_ownership_input,
    change_ownership_output,
)
import shutil

dotenv.load_dotenv()
INPUT_PATH: str = os.getenv("INPUT", "/input")
OUTPUT_PATH: str = os.getenv("OUTPUT", "/output")
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

busy = False

file_emoji = {
    FileType.PHOTO: "🖼️",
    FileType.VIDEO: "🎞️",
    FileType.UNKNOWN: "📄",
}


async def process_folder(path, websocket: WebSocket):
    """Process files with real-time WebSocket progress updates"""
    # Change ownership of input path first
    if not change_ownership_input(INPUT_PATH):
        await websocket.send_text("event-error:Failed to change input path ownership")
        return

    # Create the structured output folders
    folders = create_output_folders_server(path, OUTPUT_PATH)
    base_output_folder = folders["base"]

    print(f"Processing files: {path}")

    # Get list of files to process
    try:
        files = [f for f in os.listdir(INPUT_PATH) if os.path.isfile(os.path.join(INPUT_PATH, f))]
    except FileNotFoundError:
        await websocket.send_text("event-error:Input directory not found")
        return

    if not files:
        await websocket.send_text("<b>No files to process.</b>")
        return

    # Send total count
    await websocket.send_text(f"event-total:{len(files)}")

    # Initialize counters
    stats = {
        "pictures": 0,
        "videos": 0,
        "unknown": 0,
        "processed": 0,
        "total": len(files)
    }

    # Process files one by one with real-time updates
    for file_name in files:
        file_path = os.path.join(INPUT_PATH, file_name)
        
        # Classify file
        file_type, orientation = classify_file(file_path)
        destination_folder = get_destination_folder(file_name, file_type, orientation, folders)
        
        # Update statistics
        if file_type == FileType.PHOTO:
            stats["pictures"] += 1
        elif file_type == FileType.VIDEO:
            stats["videos"] += 1
        else:
            stats["unknown"] += 1
        
        stats["processed"] += 1
        
        # Move file to destination
        if destination_folder:
            dest_path = os.path.join(destination_folder, file_name)
            shutil.move(file_path, dest_path)
            
            # Send real-time progress updates
            await websocket.send_text(f"event-processed-pictures:{stats['pictures']}")
            await websocket.send_text(f"event-processed-videos:{stats['videos']}")
            
            # Log the processing
            print(
                f"File: {file_name}\n\t- Type: {file_emoji[file_type]}{file_type}\n\t- Orientation: {orientation if orientation else 'N/A'}\n\t- Dest.: {dest_path}"
            )
            
            # Send detailed processing info to frontend
            await websocket.send_text(
                f"event-processed:File: <b>{file_name}</b><br> - Type: <b>{file_emoji[file_type]}{file_type}</b><br>{f' - Orientation: <b>{orientation}</b><br>' if orientation else ''} - Dest.: {dest_path}"
            )

    # Change ownership of output folder
    print(f"Changing ownership of output folder: {base_output_folder}")
    if not change_ownership_output(base_output_folder):
        await websocket.send_text(
            "event-warning:Failed to change output path ownership"
        )

    await websocket.send_text(
        f"<h6 style='color: green'>Done!</h6>{file_emoji[FileType.PHOTO]} Pictures: <b>{stats['pictures']}</b><br>{file_emoji[FileType.VIDEO]} Videos: <b>{stats['videos']}</b><br>{file_emoji[FileType.UNKNOWN]} Unknown: <b>{stats['unknown']}</b>"
    )


app = FastAPI()

# Montar la carpeta 'static' para servir archivos estáticos
app.mount(
    "/static",
    StaticFiles(directory=os.path.join(BASE_DIR, "static")),
    name="static",
)
# Montar el input para mostrar previsualizaciones
app.mount("/input", StaticFiles(directory=INPUT_PATH), name="input")

# Configurar la carpeta de plantillas
templates = Jinja2Templates(directory=os.path.join(BASE_DIR, "templates"))


@app.get("/", response_class=HTMLResponse)
def read_root(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


@app.get("/input")
def get_input():
    print(f"Getting input files for {INPUT_PATH}")
    try:
        dirs = os.listdir(f"{INPUT_PATH}")
        dirs.sort()
    except FileNotFoundError:
        dirs = []
    print(f"Input: {dirs}")
    return dirs


@app.get("/output")
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


@app.websocket("/ws/reorganizer")
async def websocket_reorganizer(websocket: WebSocket):
    global busy

    await websocket.accept()
    print("WebSocket client connected")

    # if busy:
    #     await websocket.send_text("event-busy:true")
    #     await websocket.close()
    #     return
    try:
        data = await websocket.receive_json()
        path = data.get("path")

        if not path:
            await websocket.send_text(
                f"<b style='color: red;'>Error:</b> Invalid <b>path ({path})</b>"
            )
        else:
            await process_folder(path, websocket)

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logging.error(f"Error: {e}")
        try:
            # busy = False
            await websocket.send_text(f"<b style='color: red;'>Error:</b> {e}")
            # await websocket.send_text("event-busy:false")
            await websocket.close()
            return
        except RuntimeError:
            pass
    finally:
        try:
            # busy = False
            # await websocket.send_text("event-busy:false")
            await websocket.send_text("event-complete")
            await websocket.close()
        except RuntimeError:
            pass


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("DEV_PORT", 3333)), log_level="info")
