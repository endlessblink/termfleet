#!/usr/bin/env bash
set -euo pipefail
SCRIPT_PATH="$(readlink -f "${BASH_SOURCE[0]}")"
APP_DIR="$(dirname "$SCRIPT_PATH")"

kill_if_running() {
  local pattern="$1"
  local pids

  pids="$(pgrep -f "$pattern" || true)"
  if [[ -n "$pids" ]]; then
    echo "$pids" | xargs -r kill
  fi
}

cd "$APP_DIR"
echo "Starting Terminal Workspace (Canvas2D terminal, Tauri dev mode)..."

export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-1}"
export CARGO_PROFILE_DEV_DEBUG="${CARGO_PROFILE_DEV_DEBUG:-0}"

fuser -k 1420/tcp >/dev/null 2>&1 || true
kill_if_running "$APP_DIR/node_modules/.bin/vite --host 127.0.0.1 --port 1420"
kill_if_running "terminal-workspace-daemon"
kill_if_running "$APP_DIR/src-tauri/target/debug/terminal-workspace"
kill_if_running "target/debug/terminal-workspace"

exec npm run tauri -- dev
