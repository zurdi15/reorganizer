#!/bin/bash
set -euo pipefail

VERSION=${1:?Usage: ./build.sh <version> (e.g. v1.1.0)}
REPO="ghcr.io/zurdi15/reorganizer"

echo "🔐 Logging into GHCR..."
echo "${GITHUB_TOKEN:?Set GITHUB_TOKEN}" | docker login ghcr.io -u zurdi15 --password-stdin

echo "📦 Building ${VERSION}..."
docker build -t "${REPO}:${VERSION}" -t "${REPO}:latest" .

echo "🚀 Pushing..."
docker push "${REPO}:${VERSION}"
docker push "${REPO}:latest"

echo "✅ Done: ${REPO}:${VERSION}"
