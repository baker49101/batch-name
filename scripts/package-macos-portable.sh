#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$ROOT_DIR/src-tauri/target/release/bundle/macos"
OUT_DIR="$ROOT_DIR/release-macos"

if [[ ! -d "$APP_DIR" ]]; then
  echo "macOS app bundle directory not found: $APP_DIR" >&2
  exit 1
fi

APP_PATH="$(find "$APP_DIR" -maxdepth 1 -name '*.app' -type d | head -n 1)"
if [[ -z "$APP_PATH" ]]; then
  echo "No .app bundle found in: $APP_DIR" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
APP_NAME="$(basename "$APP_PATH" .app)"
ZIP_PATH="$OUT_DIR/${APP_NAME}-macos-portable.zip"
rm -f "$ZIP_PATH"

ditto -c -k --sequesterRsrc --keepParent "$APP_PATH" "$ZIP_PATH"

echo "$ZIP_PATH"
