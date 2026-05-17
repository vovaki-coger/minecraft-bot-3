#!/bin/bash
set -e

echo "=== Minecraft Bot Build Script ==="
echo ""

cd "$(dirname "$0")/.."

echo "[1/4] Installing dependencies..."
npm install

echo "[2/4] Building renderer (React/Vite)..."
npm run build:renderer

echo "[3/4] Building Electron app..."
npm run build:electron

echo "[4/4] Build complete!"
echo ""
echo "Output files:"
ls -lh dist-electron/ 2>/dev/null || echo "(check dist-electron folder)"
