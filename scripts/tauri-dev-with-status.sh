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

kill_app_vite() {
  local pids

  pids="$(ps -eo pid=,args= | awk -v root_dir="$ROOT_DIR" '
    index($0, root_dir "/node_modules/.bin/vite") && index($0, "--port 1420") { print $1 }
  ')" || true
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

# Status summaries are opt-in for dev launches. Even the no-model sidecar can
# create a high-frequency polling loop across many panes, so keep it off unless
# explicitly requested.
# Enable with TERMFLEET_AGENT_STATUS_ENABLE=1 TERMFLEET_AGENT_STATUS_DISABLE=0.
# When enabled, the default worker is the no-model SIDECAR worker; the Ollama
# worker remains explicitly opt-in via TERMFLEET_AGENT_STATUS_WORKER.
STATUS_WORKER="${TERMFLEET_AGENT_STATUS_WORKER:-node scripts/agent-status-summary-sidecar.mjs}"
CONTEXT_TITLE_DISABLE="${TERMFLEET_CONTEXT_TITLE_DISABLE:-0}"
if [[ "$STATUS_WORKER" == *"agent-status-summary-sidecar.mjs"* && -z "${TERMFLEET_CONTEXT_TITLE_DISABLE+x}" ]]; then
  CONTEXT_TITLE_DISABLE=1
fi

start_status_server() {
  local cockpit_snapshot_requested=0
  if [[ "${TERMFLEET_DEV_DIAGNOSTICS_ENABLE:-0}" == "1" && "${TERMFLEET_COCKPIT_SNAPSHOT_ENABLE:-0}" == "1" ]]; then
    cockpit_snapshot_requested=1
  fi

  if [[ "$cockpit_snapshot_requested" != "1" && ( "${TERMFLEET_AGENT_STATUS_ENABLE:-0}" != "1" || "${TERMFLEET_AGENT_STATUS_DISABLE:-1}" != "0" ) ]]; then
    kill_if_running "agent-status-summary-server.mjs"
    unset VITE_AGENT_STATUS_SUMMARY_ENDPOINT
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
    TERMFLEET_CONTEXT_TITLE_DISABLE="$CONTEXT_TITLE_DISABLE" \
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

if [[ -n "${TERMFLEET_PANE_ID:-}" && "${TERMFLEET_ALLOW_NESTED_DEV_ENV:-0}" != "1" ]]; then
  unset TERMFLEET_AGENT_STATUS_ENABLE
  unset TERMFLEET_AGENT_STATUS_DISABLE
  unset TERMFLEET_AGENT_STATUS_WORKER
  if [[ "${TERMFLEET_ALLOW_NESTED_DEV_DIAGNOSTICS:-0}" != "1" ]]; then
    unset TERMFLEET_DEV_DIAGNOSTICS_ENABLE
    unset TERMFLEET_COCKPIT_SNAPSHOT_ENABLE
    unset TERMFLEET_TERMINAL_HEADER_LOG_ENABLE
  fi
  unset VITE_AGENT_STATUS_SUMMARY_ENDPOINT
  unset VITE_COCKPIT_SNAPSHOT
  unset VITE_TERMINAL_HEADER_LOG
fi

kill_app_vite
if port_in_use 1420; then
  echo "Port 1420 is still in use after cleaning this app's dev processes; refusing to kill an unknown owner." >&2
  exit 1
fi

start_status_server

if [[ "${TERMFLEET_DEV_DIAGNOSTICS_ENABLE:-0}" == "1" && "${TERMFLEET_COCKPIT_SNAPSHOT_ENABLE:-0}" == "1" ]]; then
  export VITE_COCKPIT_SNAPSHOT=1
else
  unset VITE_COCKPIT_SNAPSHOT
fi

if [[ "${TERMFLEET_DEV_DIAGNOSTICS_ENABLE:-0}" == "1" && "${TERMFLEET_TERMINAL_HEADER_LOG_ENABLE:-0}" == "1" ]]; then
  export VITE_TERMINAL_HEADER_LOG=1
else
  unset VITE_TERMINAL_HEADER_LOG
fi

if [[ "${TERMFLEET_MAP_LIVE_TERMINALS_ENABLE:-1}" == "0" ]]; then
  export VITE_MAP_LIVE_TERMINALS=0
else
  export VITE_MAP_LIVE_TERMINALS=1
fi

export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-1}"
export CARGO_PROFILE_DEV_DEBUG="${CARGO_PROFILE_DEV_DEBUG:-0}"

# WebKitGTK serves stale frontend JS from its disk cache across relaunches — disable it
# for dev so the webview always loads current code. (TC-033)
export WEBKIT_DISABLE_DISK_CACHE_NOT_RECOMMENDED="${WEBKIT_DISABLE_DISK_CACHE_NOT_RECOMMENDED:-1}"

tauri dev
