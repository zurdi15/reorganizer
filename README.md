# File Reorganizer

A tool to automatically organize photos and videos into a structured folder hierarchy based on file type, orientation, and device type.

## Features

- **File Classification**: Automatically detects photos and videos
- **Orientation Detection**: Identifies horizontal vs vertical videos
- **Device Detection**: Distinguishes between phone and drone (DJI) content
- **Structured Organization**: Creates organized folder hierarchies
- **Ownership Management**: Sets proper file ownership using USER_ID environment variable
- **Dual Interface**: Available as both CLI tool and web interface

## Environment Variables

- `USER_ID`: User ID for ownership changes (default: 1000)
- `INPUT`: Input path for web interface (default: /input)
- `OUTPUT`: Output path for web interface (default: /output)

## Usage

### Command Line Interface

```bash
# Set user ID for ownership
export USER_ID=1000

# Basic usage
python3 src/cli.py --year 2023 --path hungary

# With month specification
python3 src/cli.py --year 2023 --month 12 --path croatia
```

### Web Interface

#### Local Development
```bash
# Run the FastAPI server
python3 src/server.py
```

#### Docker
```bash
# Build and run with Docker
docker build -t reorganizer .
docker run -p 3333:3333 -e USER_ID=1000 -v /path/to/input:/input -v /path/to/output:/output reorganizer
```

#### Docker Compose (Recommended)
```bash
# Copy and edit environment variables
cp .env.example .env
# Edit .env with your paths and settings

# Build and start
./build.sh --start

# Or manually
docker-compose up -d
```

#### Environment Variables for Docker
- `USER_ID`: User ID for ownership changes (default: 1000)
- `INPUT`: Input path inside container (default: /input)
- `OUTPUT`: Output path inside container (default: /output)
- `SYS_VOL_INPUT`: Host path for input files
- `SYS_VOL_OUTPUT`: Host path for output files
- `SYS_PORT`: Host port to expose (default: 3333)

## Folder Structure

The tool creates the following structure:

```
output/
├── YEAR/
│   ├── MM/                    # Month (if specified)
│   │   └── COUNTRY/
│   │       ├── photo/
│   │       └── video/
│   │           ├── horizontal/
│   │           │   ├── phone/
│   │           │   └── dron/
│   │           │       └── mini3/
│   │           └── vertical/
│   │               ├── phone/
│   │               └── dron/
│   │                   └── mini3/
│   └── COUNTRY/               # When no month specified
│       └── [same structure]
```

## Architecture

- `shared.py`: Common functionality used by both CLI and server
- `cli.py`: Command-line interface with year/month structure
- `server.py`: FastAPI web interface with WebSocket progress updates
- `Dockerfile`: Container configuration with all dependencies

## File Types Supported

- **Photos**: JPG, PNG, and other image formats supported by PIL
- **Videos**: MP4, AVI, MOV, and other formats supported by OpenCV
- **Device Detection**: DJI drone files identified by "dji_fly" prefix

## Ownership Management

The tool automatically changes file ownership using the `USER_ID` environment variable:

1. **Input Path**: Ownership changed before processing (critical - will exit on failure)
2. **Output Path**: Ownership changed after processing (warning on failure)

This is especially useful when running in Docker containers where files might be created with root ownership.
