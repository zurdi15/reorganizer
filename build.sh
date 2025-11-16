#!/bin/bash

# Build and deploy reorganizer application

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 Building Reorganizer Application${NC}"

# Build the Docker image
echo -e "${YELLOW}📦 Building Docker image...${NC}"
docker build -t zurdi15/reorganizer:latest .

echo -e "${GREEN}✅ Docker image built successfully${NC}"

# Push the Docker image
echo -e "${YELLOW}📦 Pushing Docker image...${NC}"
docker push zurdi15/reorganizer:latest

echo -e "${GREEN}✅ Docker image pushed successfully${NC}"
