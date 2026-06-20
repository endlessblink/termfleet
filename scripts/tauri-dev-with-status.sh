#!/usr/bin/env bash
set -euo pipefail

SCRIPT_PATH="$(readlink -f "${BASH_SOURCE[0]}")"
ROOT_DIR="$(dirname "$(dirname "$SCRIPT_PATH")")"
STATUS_HOST="${TERMFLEET_AGENT_STATUS_HOST:-127.0.0.1}"
STATUS_PORT="${TERMFLEET_AGENT_STATUS_PORT:-37819}"
STATUS_ENDPOINT="http://${STATUS_HOST}:${STATUS_PORT}/status"
STATUS_LOG="${TERMFLEET_AGENT_STATUS_LOG:-/tmp/termfleet-agent-status-summary.log}"
STATUS_PID=""

kill_if_running() {
  local pattern="$1"
  local pids

  pids="$(pgrep -f "$pattern" || true)"
  if [[ -n "$pids" ]]; then
    echo "$pids" | xargs -r kill
  fi
}

port_in_use() {
  python3 - "$1" <<'PYEOF'
import socket, sys
port = int(sys.argv[1])
sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
try:
    sock.bind(("127.0.0.1", port))
except OSError:
    sys.exit(0)
finally:
    sock.close()
sys.exit(1)
PYEOF
}

status_server_ready() {
  curl -fsS -X POST "$STATUS_ENDPOINT" \
    -H "content-type: application/json" \
    --data '{"projectId":"termfleet","workstream":{"provider":"shell","path":"termfleet"}}' \
    >/dev/null 2>&1
}

# Default worker = the no-model SIDECAR worker: serves the agent's REAL task list from
# the status hook. The Ollama model summarizer is opt-in only via
# TERMFLEET_AGENT_STATUS_WORKER (it produced hallucinated/jargon titles).
STATUS_WORKER="${TERMFLEET_AGENT_STATUS_WORKER:-node scripts/agent-status-summary-sidecar.mjs}"

start_status_server() {
  if [[ "${TERMFLEET_AGENT_STATUS_DISABLE:-0}" == "1" ]]; then
    return
  fi

  # Always REPLACE our own status server so a worker/code change actually takes effect.
  # Reusing a stale server silently served the old (model) worker across relaunches —
  # the exact bug that hid the sidecar task list and kept showing jargon titles. (TC-033)
  kill_if_running "agent-status-summary-server.mjs"

  (
    cd "$ROOT_DIR"
    TERMFLEET_AGENT_STATUS_HOST="$STATUS_HOST" \
    TERMFLEET_AGENT_STATUS_PORT="$STATUS_PORT" \
    TERMFLEET_AGENT_STATUS_MODEL="${TERMFLEET_AGENT_STATUS_MODEL:-qwen3:4b}" \
      node scripts/agent-status-summary-server.mjs ${STATUS_WORKER}
  ) >"$STATUS_LOG" 2>&1 &
  STATUS_PID="$!"

  for _ in {1..40}; do
    if status_server_ready; then
      export VITE_AGENT_STATUS_SUMMARY_ENDPOINT="${VITE_AGENT_STATUS_SUMMARY_ENDPOINT:-$STATUS_ENDPOINT}"
      echo "Started TermFleet status summary server at $STATUS_ENDPOINT (worker: ${STATUS_WORKER})"
      return
    fi
    sleep 0.1
  done

  echo "Status summary server did not become ready; continuing with deterministic summaries. Log: $STATUS_LOG" >&2
}

cleanup() {
  if [[ -n "$STATUS_PID" ]]; then
    kill "$STATUS_PID" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

cd "$ROOT_DIR"

kill_if_running "$ROOT_DIR/node_modules/.bin/vite --host 127.0.0.1 --port 1420"
if port_in_use 1420; then
  echo "Port 1420 is still in use after cleaning this app's dev processes; refusing to kill an unknown owner." >&2
  exit 1
fi

start_status_server

export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-1}"
export CARGO_PROFILE_DEV_DEBUG="${CARGO_PROFILE_DEV_DEBUG:-0}"

# WebKitGTK serves stale frontend JS from its disk cache across relaunches — disable it
# for dev so the webview always loads current code. (TC-033)
export WEBKIT_DISABLE_DISK_CACHE_NOT_RECOMMENDED="${WEBKIT_DISABLE_DISK_CACHE_NOT_RECOMMENDED:-1}"

tauri dev
