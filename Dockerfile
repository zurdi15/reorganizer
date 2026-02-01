# Build stage for frontend
FROM node:20-alpine as frontend-builder

WORKDIR /app/frontend

# Copy frontend source
COPY frontend/package*.json ./
RUN npm ci

COPY frontend/src ./src
COPY frontend/index.html ./
COPY frontend/vite.config.ts ./
COPY frontend/vitest.config.ts ./
COPY frontend/tailwind.config.js ./
COPY frontend/postcss.config.js ./
COPY frontend/tsconfig.json ./
COPY frontend/tsconfig.node.json ./

# Build frontend
RUN npm run build

# Backend stage
FROM python:3.11-slim

# Install dependencies for OpenCV and system tools
RUN apt-get update && apt-get install -y \
    libgl1-mesa-dev \
    libgles2-mesa-dev \
    libglib2.0-0 \
    libgthread-2.0-0 \
    libgtk-3-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgomp1 \
    libglu1-mesa \
    libxi6 \
    libxrandr2 \
    libxss1 \
    libxcursor1 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxinerama1 \
    sudo \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the requirements file into the container
COPY requirements.txt .

# Install the dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy Python backend code
COPY src src

# Copy built frontend from builder stage
COPY --from=frontend-builder /app/frontend/dist frontend/dist

# Set Python path to include the /app directory
ENV PYTHONPATH="/app"

# Expose the port the app runs on
EXPOSE 3333

# Run the FastAPI server
CMD ["python", "-m", "uvicorn", "src.server:app", "--host", "0.0.0.0", "--port", "3333"]

# Command to run the FastAPI app
CMD ["uvicorn", "backend.server:app", "--host", "0.0.0.0", "--port", "3333"]