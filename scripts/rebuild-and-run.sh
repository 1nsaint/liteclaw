#!/bin/sh
# Rebuild LiteClaw image from source (no cache) and restart. Run from repo root: ./scripts/rebuild-and-run.sh
set -e
cd "$(dirname "$0")/.."
echo "Building from $(pwd) (no cache)..."
docker compose build --no-cache
echo "Starting container..."
docker compose up -d
echo "Done. Open http://localhost:18789 and hard-refresh (Ctrl+Shift+R). You should see 'LiteClaw' in the top bar."
