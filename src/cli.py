import os
import argparse
from PIL import Image
import cv2
import shutil
import subprocess
import sys
from enum import StrEnum

# Environment Variables:
# USER_ID: User ID for ownership changes (default: 1000)

INPUT_PATH: str = "/mnt/media/pictures/zurdelia/reorganizer"
OUTPUT_PATH: str = "/mnt/media/pictures/zurdelia"


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


def create_output_folders(year, month, country):
    # Define the folder structure
    if month:
        base_folder = os.path.join(OUTPUT_PATH, str(year), str(month).zfill(2), country)
    else:
        base_folder = os.path.join(OUTPUT_PATH, str(year), country)
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


def process_folder(year, month, country):
    # Create the structured output folders and get their paths
    folders = create_output_folders(year, month, country)

    # Determine the base output folder for ownership changes
    if month:
        base_output_folder = os.path.join(OUTPUT_PATH, str(year), str(month).zfill(2), country)
    else:
        base_output_folder = os.path.join(OUTPUT_PATH, str(year), country)

    print(
        f"Organizing files for - Year: {year}, Month: {month if month else 'None'}, Country: {country}\n"
    )

    for file_name in os.listdir(INPUT_PATH):
        file_path = os.path.join(INPUT_PATH, file_name)

        if os.path.isfile(file_path):
            file_type, orientation = classify_file(file_path)
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

            # Move file to the appropriate folder
            if destination_folder:
                dest_path = os.path.join(destination_folder, file_name)
                shutil.move(file_path, dest_path)
                print(f"Moved {file_name} to {dest_path}")

    # Change ownership of the output folder structure
    print(f"\nChanging ownership of output folder: {base_output_folder}")
    change_ownership_output(base_output_folder)


def change_ownership_input():
    """Change ownership of input path using USER_ID environment variable"""
    user_id = get_user_id()
    try:
        subprocess.run(
            [
                "sudo",
                "chown",
                "-R",
                f"{user_id}:{user_id}",
                INPUT_PATH,
            ],
            check=True,
        )
        print(f"Input path ownership changed successfully to {user_id}:{user_id}")
    except subprocess.CalledProcessError as e:
        print(f"Error changing input path ownership: {e}")
        sys.exit(1)


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
    except subprocess.CalledProcessError as e:
        print(f"Error changing output path ownership: {e}")
        # Don't exit here, as this is less critical than input ownership


if __name__ == "__main__":
    change_ownership_input()
    parser = argparse.ArgumentParser(
        description="Process files in a folder and classify them based on type and orientation."
    )
    parser.add_argument(
        "--year", type=int, help="Year associated with the files", required=True
    )
    parser.add_argument(
        "--month",
        type=int,
        help="Month associated with the files",
        required=False,
        default=None,
    )
    parser.add_argument(
        "--path", type=str, help="Path where files will be stored (without year/month)", required=True
    )

    args = parser.parse_args()

    if not args.year or not args.path:
        print("Please provide at least year and path as arguments.")
        exit(1)

    process_folder(args.year, args.month, args.path)
