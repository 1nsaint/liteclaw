#!/bin/sh
# Seed the gateway workspace with lite core files (only if missing).
# Usage: ./scripts/seed-lite-core-files.sh [container_name]
# Or from host: docker cp scripts/lite-core-files/. liteclaw:/tmp/lite-core-files && docker exec liteclaw sh -c 'for f in /tmp/lite-core-files/*; do [ -f "$f" ] && [ ! -f "/home/node/.openclaw/workspace/$(basename "$f")" ] && cp "$f" /home/node/.openclaw/workspace/; done'
set -e
CONTAINER="${1:-liteclaw}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LITE_DIR="$SCRIPT_DIR/lite-core-files"
WORKSPACE="/home/node/.openclaw/workspace"
for f in "$LITE_DIR"/*.md; do
  [ -f "$f" ] || continue
  name="$(basename "$f")"
  if ! docker exec "$CONTAINER" test -f "$WORKSPACE/$name" 2>/dev/null; then
    docker cp "$f" "$CONTAINER:$WORKSPACE/$name"
    echo "Created $WORKSPACE/$name"
  else
    echo "Skip $name (exists)"
  fi
done
echo "Done. Reload Core Files in the dashboard if needed."
