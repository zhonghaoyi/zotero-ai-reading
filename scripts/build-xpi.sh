#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist"
VERSION="$(awk -F'"' '/"version"/ {print $4; exit}' "$ROOT_DIR/manifest.json")"
XPI_PATH="$DIST_DIR/zotero-ai-reading-$VERSION.xpi"

mkdir -p "$DIST_DIR"
cd "$ROOT_DIR"
rm -f "$XPI_PATH"

zip -X -r "$XPI_PATH" \
  manifest.json \
  bootstrap.js \
  prefs.js \
  zotero-ai-reading.js \
  preferences.xhtml \
  icons/icon.png

printf '%s\n' "$XPI_PATH"
