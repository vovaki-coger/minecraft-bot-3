#!/bin/bash
set -e

echo "=== Minecraft Bot Dev Mode ==="
echo ""

cd "$(dirname "$0")/.."

echo "Installing dependencies if needed..."
if [ ! -d "node_modules" ]; then
  npm install
fi

echo "Starting development server..."
npm run dev
