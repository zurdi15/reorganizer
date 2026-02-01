import argparse

from backend.shared import (
    change_ownership_input,
    change_ownership_output,
    create_output_folders_cli,
    process_files,
)

# Environment Variables:
# USER_ID: User ID for ownership changes (default: 1000)

INPUT_PATH: str = "/mnt/media/pictures/zurdelia/reorganizer"
OUTPUT_PATH: str = "/mnt/media/pictures/zurdelia"


def process_folder(year, month, country):
    """Process files for CLI with year/month structure"""
    # Create the structured output folders and get their paths
    folders = create_output_folders_cli(year, month, country, OUTPUT_PATH)
    base_output_folder = folders["base"]

    print(
        f"Organizing files for - Year: {year}, Month: {month if month else 'None'}, Country: {country}\n"
    )

    def progress_callback(event_type, data):
        """Handle progress updates"""
        if event_type == "no_files":
            print(data)
        elif event_type == "file_processed":
            print(f"Moved {data['file_name']} to {data['dest_path']}")

    # Process all files
    stats = process_files(INPUT_PATH, folders, progress_callback)

    print("\nProcessing complete!")
    print(f"Pictures: {stats['pictures']}")
    print(f"Videos: {stats['videos']}")
    print(f"Unknown: {stats['unknown']}")

    # Change ownership of the output folder structure
    print(f"\nChanging ownership of output folder: {base_output_folder}")
    change_ownership_output(base_output_folder)


if __name__ == "__main__":
    change_ownership_input(INPUT_PATH)
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
        "--path",
        type=str,
        help="Path where files will be stored (without year/month)",
        required=True,
    )

    args = parser.parse_args()

    if not args.year or not args.path:
        print("Please provide at least year and path as arguments.")
        exit(1)

    process_folder(args.year, args.month, args.path)
