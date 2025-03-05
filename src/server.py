import os
import logging
import dotenv

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from PIL import Image
import cv2
import shutil
from enum import StrEnum

dotenv.load_dotenv()
INPUT_PATH: str = os.getenv("INPUT", "/input")
OUTPUT_PATH: str = os.getenv("OUTPUT", "/output")
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

busy = False


class Orientation(StrEnum):
    HORIZONTAL = "horizontal"
    VERTICAL = "vertical"
    NULL = ""


class Device(StrEnum):
    PHONE = "phone"
    DRONE = "dron"


class Drone(StrEnum):
    MINI3 = "mini3"


class FileType(StrEnum):
    PHOTO = "photo"
    VIDEO = "video"
    UNKNOWN = "unknown"


class FileName(StrEnum):
    DJI_FLY = "dji_fly"


def check_orientation(width, height):
    return Orientation.HORIZONTAL if width > height else Orientation.VERTICAL


async def classify_file(file_path, websocket: WebSocket):
    # Check if the file is an image
    try:
        with Image.open(file_path) as img:
            width, height = img.size
            return FileType.PHOTO, Orientation.NULL
    except (IOError, SyntaxError):
        pass

    # Check if the file is a video
    try:
        video = cv2.VideoCapture(file_path)
        if video.isOpened():
            width = int(video.get(cv2.CAP_PROP_FRAME_WIDTH))
            height = int(video.get(cv2.CAP_PROP_FRAME_HEIGHT))
            video.release()
            return FileType.VIDEO, check_orientation(width, height)
    except Exception as e:
        logging.error(f"Error while classifying file {file_path}: {e}")
        await websocket.send_text(
            f"event-error:Error while classifying {file_path}: {e}"
        )

    # If neither, return unknown type
    return FileType.UNKNOWN, Orientation.NULL


def create_output_folders(path):
    base_folder = os.path.join(OUTPUT_PATH, path)
    photo_folder = os.path.join(base_folder, FileType.PHOTO)
    video_folder = os.path.join(base_folder, FileType.VIDEO)
    horizontal_folder = os.path.join(video_folder, Orientation.HORIZONTAL)
    vertical_folder = os.path.join(video_folder, Orientation.VERTICAL)
    subfolders = [
        photo_folder,
        os.path.join(horizontal_folder, Device.PHONE),
        os.path.join(horizontal_folder, Device.DRONE, Drone.MINI3),
        os.path.join(vertical_folder, Device.PHONE),
        os.path.join(vertical_folder, Device.DRONE, Drone.MINI3),
    ]

    # Create folders if they don't exist
    for folder in subfolders:
        os.makedirs(folder, exist_ok=True)

    return {
        "photo": photo_folder,
        "horizontal_phone": os.path.join(horizontal_folder, Device.PHONE),
        "horizontal_dron_mini3": os.path.join(
            horizontal_folder, Device.DRONE, Drone.MINI3
        ),
        "vertical_phone": os.path.join(vertical_folder, Device.PHONE),
        "vertical_dron_mini3": os.path.join(vertical_folder, Device.DRONE, Drone.MINI3),
    }


async def process_folder(path, websocket: WebSocket):
    n_pictures = 0
    n_videos = 0
    n_unknown = 0

    folders = create_output_folders(path)

    files = os.listdir(INPUT_PATH)
    if not files:
        print("No files to process.")
        await websocket.send_text("<b>No files to process.</b>")
        return

    print(f"Processing files: {path}")

    await websocket.send_text(f"event-total:{len(files)}")
    for file_name in files:
        file_path = os.path.join(INPUT_PATH, file_name)

        if os.path.isfile(file_path):
            file_type, orientation = await classify_file(file_path, websocket)
            destination_folder = None

            if file_type == FileType.PHOTO:
                destination_folder = folders["photo"]
                n_pictures += 1
                await websocket.send_text(f"event-processed-pictures:{n_pictures}")
            elif file_type == FileType.VIDEO:
                n_videos += 1
                await websocket.send_text(f"event-processed-videos:{n_videos}")
                if orientation == Orientation.HORIZONTAL:
                    if file_name.startswith(FileName.DJI_FLY):
                        destination_folder = folders["horizontal_dron_mini3"]
                    else:
                        destination_folder = folders["horizontal_phone"]
                elif orientation == Orientation.VERTICAL:
                    if file_name.startswith(FileName.DJI_FLY):
                        destination_folder = folders["vertical_dron_mini3"]
                    else:
                        destination_folder = folders["vertical_phone"]

            # Move file to the appropriate folder
            if destination_folder:
                dest_path = os.path.join(destination_folder, file_name)
                shutil.move(file_path, dest_path)
                print(
                    f"File: {file_name}\n\t- Type: {file_type}\n\t- Orientation: {orientation if orientation else 'N/A'}\n\t- Dest.: {dest_path}"
                )
                await websocket.send_text(
                    f"event-processed:File: <b>{file_name}</b><br> - Type: <b style='color: {'blue' if file_type == FileType.PHOTO else 'orange'}'>{file_type}</b><br>{f' - Orientation: <b>{orientation}</b><br>' if orientation else ''} - Dest.: {dest_path}"
                )
    await websocket.send_text(
        f"<h6 style='color: green'>Done!</h6>Pictures: <b>{n_pictures}</b><br>Videos: <b>{n_videos}</b><br>Unknown: <b>{n_unknown}</b>"
    )


app = FastAPI()

# Montar la carpeta 'static' para servir archivos estáticos
app.mount(
    "/static", StaticFiles(directory=os.path.join(BASE_DIR, "static")), name="static"
)

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

    uvicorn.run(app, host="0.0.0.0", port=3334)
