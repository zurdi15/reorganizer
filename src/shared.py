import os
import subprocess
import shutil
from PIL import Image
import cv2
from enum import StrEnum

# Environment Variables:
# USER_ID: User ID for ownership changes (default: 1000)


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


def get_user_id():
    """Get USER_ID from environment variable, default to 1000 if not set"""
    try:
        user_id = os.getenv("USER_ID", "1000")
        return user_id
    except Exception:
        return "1000"


def check_orientation(width, height):
    return Orientation.HORIZONTAL if width > height else Orientation.VERTICAL


def classify_file(file_path):
    """Classify a file as photo, video, or unknown with orientation"""
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
    except Exception:
        pass

    # If neither, return unknown type
    return FileType.UNKNOWN, Orientation.NULL


def create_output_folders_cli(year, month, country, output_path):
    """Create output folder structure for CLI version with year/month structure"""
    if month:
        base_folder = os.path.join(output_path, str(year), str(month).zfill(2), country)
    else:
        base_folder = os.path.join(output_path, str(year), country)
    
    return _create_folder_structure(base_folder)


def create_output_folders_server(path, output_path):
    """Create output folder structure for server version with simple path structure"""
    base_folder = os.path.join(output_path, path)
    return _create_folder_structure(base_folder)


def _create_folder_structure(base_folder):
    """Internal function to create the standard folder structure"""
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
        "base": base_folder,
        "photo": photo_folder,
        "horizontal_phone": os.path.join(horizontal_folder, Device.PHONE),
        "horizontal_dron_mini3": os.path.join(
            horizontal_folder, Device.DRONE, Drone.MINI3
        ),
        "vertical_phone": os.path.join(vertical_folder, Device.PHONE),
        "vertical_dron_mini3": os.path.join(vertical_folder, Device.DRONE, Drone.MINI3),
    }


def get_destination_folder(file_name, file_type, orientation, folders):
    """Determine the destination folder for a file based on its type and orientation"""
    destination_folder = None
    
    if file_type == FileType.PHOTO:
        destination_folder = folders["photo"]
    elif file_type == FileType.VIDEO:
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
    
    return destination_folder


def change_ownership_input(input_path):
    """Change ownership of input path using USER_ID environment variable"""
    user_id = get_user_id()
    try:
        subprocess.run(
            [
                "sudo",
                "chown",
                "-R",
                f"{user_id}:{user_id}",
                input_path,
            ],
            check=True,
        )
        print(f"Input path ownership changed successfully to {user_id}:{user_id}")
        return True
    except subprocess.CalledProcessError as e:
        print(f"Error changing input path ownership: {e}")
        return False


def change_ownership_output(output_path):
    """Change ownership of output path using USER_ID environment variable"""
    user_id = get_user_id()
    try:
        subprocess.run(
            [
                "sudo",
                "chown",
                "-R",
                f"{user_id}:{user_id}",
                output_path,
            ],
            check=True,
        )
        print(f"Output path ownership changed successfully to {user_id}:{user_id}")
        return True
    except subprocess.CalledProcessError as e:
        print(f"Error changing output path ownership: {e}")
        return False


def process_files(input_path, folders, progress_callback=None):
    """
    Process files from input_path and move them to appropriate folders
    
    Args:
        input_path: Path to input directory
        folders: Dictionary with folder paths from create_output_folders_*
        progress_callback: Optional callback function for progress updates
    
    Returns:
        Dictionary with processing statistics
    """
    stats = {
        "pictures": 0,
        "videos": 0,
        "unknown": 0,
        "processed": 0,
        "total": 0
    }
    
    files = os.listdir(input_path)
    stats["total"] = len(files)
    
    if not files:
        if progress_callback:
            progress_callback("no_files", "No files to process.")
        return stats
    
    if progress_callback:
        progress_callback("total", len(files))
    
    for file_name in files:
        file_path = os.path.join(input_path, file_name)
        
        if os.path.isfile(file_path):
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
            
            # Move file to the appropriate folder
            if destination_folder:
                dest_path = os.path.join(destination_folder, file_name)
                shutil.move(file_path, dest_path)
                
                if progress_callback:
                    progress_callback("file_processed", {
                        "file_name": file_name,
                        "file_type": file_type,
                        "orientation": orientation,
                        "dest_path": dest_path,
                        "stats": stats.copy()
                    })
    
    return stats
