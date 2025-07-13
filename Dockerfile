FROM python:3.11-slim

# Install dependencies for OpenCV and system tools
RUN apt-get update && apt-get install -y \
    libgl1-mesa-glx \
    libglib2.0-0 \
    sudo

WORKDIR /app

# Copy the requirements file into the container
COPY requirements.txt .

# Install the dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Create necessary directories
RUN mkdir -p /app/src/static /app/src/templates
COPY src/static /app/src/static
COPY src/templates /app/src/templates

# Copy the FastAPI app code into the container
COPY src/__init__.py /app/src/__init__.py
COPY src/server.py /app/src/server.py
COPY src/shared.py /app/src/shared.py

# Expose the port the app runs on
EXPOSE 3333

# Command to run the FastAPI app
CMD ["uvicorn", "src.server:app", "--host", "0.0.0.0", "--port", "3333"]