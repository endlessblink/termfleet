#!/usr/bin/env bash
set -euo pipefail

SCRIPT_PATH="$(readlink -f "${BASH_SOURCE[0]}")"
APP_DIR="$(dirname "$SCRIPT_PATH")"
PORT="${TERMINAL_WORKSPACE_REVIEW_PORT:-5177}"

kill_if_running() {
  local pattern="$1"
  local pids

  pids="$(pgrep -f "$pattern" || true)"
  if [[ -n "$pids" ]]; then
    echo "$pids" | xargs -r kill
  fi
}

cd "$APP_DIR"

echo "Starting Terminal Workspace browser review on http://127.0.0.1:${PORT} ..."

# Browser review is intentionally separate from Tauri dev. It gives screenshot
# and Playwright runs a stable URL without spawning the desktop shell.
fuser -k "${PORT}/tcp" >/dev/null 2>&1 || true
kill_if_running "$APP_DIR/node_modules/.bin/vite --host 127.0.0.1 --port ${PORT}"

exec npm run dev -- --port "$PORT" --strictPort true
