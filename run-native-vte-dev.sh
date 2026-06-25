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

kill_app_vite() {
  local pids

  pids="$(ps -eo pid=,args= | awk -v app_dir="$APP_DIR" '
    index($0, app_dir "/node_modules/.bin/vite") && index($0, "--port 1420") { print $1 }
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

cd "$APP_DIR"
echo "Starting Terminal Workspace (Canvas2D terminal, Tauri dev mode)..."

export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-1}"
export CARGO_PROFILE_DEV_DEBUG="${CARGO_PROFILE_DEV_DEBUG:-0}"

# WebKitGTK aggressively caches frontend JS on disk and serves it across relaunches,
# so edits silently never appear in the dev window. Disable the disk cache for dev so
# the webview always loads current code from vite. (TC-033)
export WEBKIT_DISABLE_DISK_CACHE_NOT_RECOMMENDED="${WEBKIT_DISABLE_DISK_CACHE_NOT_RECOMMENDED:-1}"

# By default LEAVE THE DAEMON ALIVE across relaunches so the reopened app
# reattaches to live PTYs with full content. The app auto-replaces the daemon
# when its build_id changes (backend rebuilt). Pass --fresh-daemon (or set
# TERMINAL_WORKSPACE_FRESH_DAEMON=1) to force a clean backend instead.
FRESH_DAEMON=0
for arg in "$@"; do
  case "$arg" in
    --fresh-daemon) FRESH_DAEMON=1 ;;
  esac
done
case "${TERMINAL_WORKSPACE_FRESH_DAEMON:-}" in
  "" | 0) ;;
  *) FRESH_DAEMON=1 ;;
esac

kill_terminal_workspace() {
  # The daemon is the same binary run with --terminal-workspace-daemon, so match
  # the app binary path but skip the daemon (and its stdio bridges) unless a
  # fresh backend was requested. The [t] guard stops this grep matching itself.
  local pids
  if [[ "$FRESH_DAEMON" == "1" ]]; then
    pids="$(ps -eo pid=,args= | grep "tar[g]et/debug/terminal-workspace" | awk '{print $1}')" || true
  else
    pids="$(ps -eo pid=,args= | grep "tar[g]et/debug/terminal-workspace" | grep -v -- "--terminal-workspace-daemon" | awk '{print $1}')" || true
  fi
  if [[ -n "$pids" ]]; then
    echo "$pids" | xargs -r kill
  fi
}

kill_app_vite
kill_terminal_workspace
if port_in_use 1420; then
  echo "Port 1420 is still in use after cleaning this app's dev processes; refusing to kill an unknown owner." >&2
  exit 1
fi

# Start the status summary server. The default worker is the SIDECAR worker: it serves
# the agent's REAL task list + activity from the status hook's sidecar (free, accurate,
# no model). When no sidecar exists (e.g. Codex/OpenCode panes today) it returns the
# heuristic candidate, which the UI neutralizes — NO model hallucination of scrollback.
# The Ollama model summarizer is opt-in only (TERMFLEET_AGENT_STATUS_WORKER="node
# scripts/agent-status-summary-ollama.mjs"); it is no longer used by default — it was
# the source of the garbage titles. Disable status entirely with
# TERMFLEET_AGENT_STATUS_DISABLE=1.
STATUS_HOST="${TERMFLEET_AGENT_STATUS_HOST:-127.0.0.1}"
STATUS_PORT="${TERMFLEET_AGENT_STATUS_PORT:-37819}"
STATUS_ENDPOINT="http://${STATUS_HOST}:${STATUS_PORT}/status"
STATUS_LOG="${TERMFLEET_AGENT_STATUS_LOG:-/tmp/termfleet-agent-status-summary.log}"
STATUS_WORKER="${TERMFLEET_AGENT_STATUS_WORKER:-node scripts/agent-status-summary-sidecar.mjs}"
STATUS_PID=""

if [[ "${TERMFLEET_AGENT_STATUS_DISABLE:-0}" != "1" ]]; then
  # Always replace our own status server so a worker/code change actually takes effect.
  # Reusing a stale server (e.g. an old model-only worker) silently serves outdated
  # behavior across relaunches — the exact bug that hid the sidecar task list. (TC-033)
  kill_if_running "agent-status-summary-server.mjs"
  (
    cd "$APP_DIR"
    TERMFLEET_AGENT_STATUS_HOST="$STATUS_HOST" \
    TERMFLEET_AGENT_STATUS_PORT="$STATUS_PORT" \
    TERMFLEET_AGENT_STATUS_MODEL="${TERMFLEET_AGENT_STATUS_MODEL:-qwen3:4b}" \
      node scripts/agent-status-summary-server.mjs ${STATUS_WORKER}
  ) >"$STATUS_LOG" 2>&1 &
  STATUS_PID="$!"
  for _ in {1..40}; do
    if curl -fsS -X POST "$STATUS_ENDPOINT" -H "content-type: application/json" \
         --data '{"projectId":"termfleet","workstream":{"provider":"shell","path":"termfleet"}}' >/dev/null 2>&1; then
      export VITE_AGENT_STATUS_SUMMARY_ENDPOINT="${VITE_AGENT_STATUS_SUMMARY_ENDPOINT:-$STATUS_ENDPOINT}"
      echo "Started status summary server at $STATUS_ENDPOINT (worker: ${STATUS_WORKER})"
      break
    fi
    sleep 0.1
  done
  if [[ -z "${VITE_AGENT_STATUS_SUMMARY_ENDPOINT:-}" ]]; then
    echo "Status summary server not ready; continuing with heuristic summaries. Log: $STATUS_LOG" >&2
  fi
fi

cleanup_status_server() {
  if [[ -n "$STATUS_PID" ]]; then
    kill "$STATUS_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup_status_server EXIT INT TERM

npm run tauri:dev
