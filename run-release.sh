#!/usr/bin/env bash
set -euo pipefail

SCRIPT_PATH="$(readlink -f "${BASH_SOURCE[0]}")"
APP_DIR="$(dirname "$SCRIPT_PATH")"

cd "$APP_DIR"

echo "Building latest Terminal Workspace release UI..."
npm run tauri build

exec "$APP_DIR/src-tauri/target/release/terminal-workspace"
