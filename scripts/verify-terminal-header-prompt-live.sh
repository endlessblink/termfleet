#!/usr/bin/env bash
set -uo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${TERMFLEET_HEADER_PROMPT_LIVE_OUT:-/tmp/tw-header-prompt-live}"
LOG_FILE="$OUT_DIR/runtime.log"
STATUS_LOG="$OUT_DIR/status-server.log"
DRIVER_LOG="$OUT_DIR/driver.log"
TRACE_FILE="$OUT_DIR/pty-trace.log"
RUN_DIR="$OUT_DIR/run"
DATA_DIR="$OUT_DIR/data"
CARGO_TARGET_DIR="$OUT_DIR/target"
PORT="${TERMFLEET_HEADER_PROMPT_LIVE_PORT:-$((19600 + RANDOM % 700))}"
STATUS_PORT="${TERMFLEET_HEADER_PROMPT_LIVE_STATUS_PORT:-$((38900 + RANDOM % 700))}"
STATUS_ENDPOINT="http://127.0.0.1:${STATUS_PORT}/status"
SNAPSHOT_FILE="$DATA_DIR/terminal-workspace/agent-status/cockpit-snapshot.json"
APP_BUDGET="${APP_BUDGET:-240}"
APP_RUN_PID=""
STATUS_PID=""

mkdir -p "$OUT_DIR" "$RUN_DIR" "$DATA_DIR"
chmod 700 "$RUN_DIR"

if [[ -z "${TERMFLEET_HEADER_PROMPT_LIVE_INNER:-}" ]]; then
  rm -f "$OUT_DIR"/*.png "$LOG_FILE" "$STATUS_LOG" "$DRIVER_LOG" "$TRACE_FILE"
  rm -rf "$RUN_DIR" "$DATA_DIR"
  mkdir -p "$RUN_DIR" "$DATA_DIR"
  chmod 700 "$RUN_DIR"
  : > "$TRACE_FILE"
  exec xvfb-run -a -s "-screen 0 1600x1000x24" \
    env \
      TERMFLEET_HEADER_PROMPT_LIVE_INNER=1 \
      TERMFLEET_HEADER_PROMPT_LIVE_OUT="$OUT_DIR" \
      XDG_RUNTIME_DIR="$RUN_DIR" \
      XDG_DATA_HOME="$DATA_DIR" \
      TERMINAL_WORKSPACE_TRACE_PTY_FILE="$TRACE_FILE" \
      bash "${BASH_SOURCE[0]}" "$@"
fi

cleanup() {
  if [[ -n "$APP_RUN_PID" ]]; then
    kill -- "-$APP_RUN_PID" >/dev/null 2>&1 || true
    wait "$APP_RUN_PID" >/dev/null 2>&1 || true
    APP_RUN_PID=""
  fi
  if [[ -n "$STATUS_PID" ]]; then
    kill "$STATUS_PID" >/dev/null 2>&1 || true
    wait "$STATUS_PID" >/dev/null 2>&1 || true
    STATUS_PID=""
  fi
}
trap cleanup EXIT
cleanup

shot() { import -window "$1" "$OUT_DIR/$2" 2>>"$DRIVER_LOG" || true; }

wait_for_trace() {
  local needle="$1"
  local limit="${2:-120}"
  for ((i = 0; i < limit; i += 1)); do
    if grep -Fq "$needle" "$TRACE_FILE" 2>/dev/null; then
      return 0
    fi
    sleep 0.25
  done
  echo "driver: trace marker not found: $needle" >>"$DRIVER_LOG"
  return 1
}

assert_prompt_header() {
  local stage="$1"
  python3 - "$SNAPSHOT_FILE" "$stage" <<'PYEOF'
import json, sys, time

path, stage = sys.argv[1:3]
try:
    snap = json.load(open(path, encoding="utf-8"))
except Exception as error:
    print(f"HEADER_PROMPT_SNAPSHOT_MISSING stage={stage} error={error}")
    sys.exit(1)

terminals = snap.get("terminals") if isinstance(snap, dict) else []
matches = [
    t for t in terminals
    if str(t.get("title") or "").strip() == "Waiting for operator selection"
    and str(t.get("now") or "").strip() == "Waiting for operator selection"
]
bad = [
    t for t in terminals
    if "npm test" in str(t.get("title") or "")
    or "npm test" in str(t.get("now") or "")
]
age = int((time.time() * 1000 - int(snap.get("updatedAt") or 0)) / 1000)
if bad:
    print(f"HEADER_PROMPT_STALE_COMMAND_LEAK stage={stage} entries={bad}")
    sys.exit(1)
if not matches:
    compact = [
        {
            "paneId": t.get("paneId"),
            "task": t.get("task"),
            "taskSource": t.get("taskSource"),
            "title": t.get("title"),
            "now": t.get("now"),
        }
        for t in terminals
    ]
    print(f"HEADER_PROMPT_NOT_RENDERED stage={stage} age={age}s terminals={compact}")
    sys.exit(1)
print(f"HEADER_PROMPT_STABLE stage={stage} age={age}s title='Waiting for operator selection'")
PYEOF
}

wait_for_prompt_header() {
  local stage="$1"
  local limit="${2:-120}"
  for ((i = 0; i < limit; i += 1)); do
    if assert_prompt_header "$stage" >/tmp/tw-header-prompt-check.$$ 2>&1; then
      cat /tmp/tw-header-prompt-check.$$
      rm -f /tmp/tw-header-prompt-check.$$
      return 0
    fi
    sleep 0.25
  done
  cat /tmp/tw-header-prompt-check.$$ 2>/dev/null || true
  rm -f /tmp/tw-header-prompt-check.$$
  return 1
}

start_status_server() {
  (
    cd "$APP_ROOT"
    TERMFLEET_AGENT_STATUS_HOST=127.0.0.1 \
    TERMFLEET_AGENT_STATUS_PORT="$STATUS_PORT" \
      node scripts/agent-status-summary-server.mjs node scripts/agent-status-summary-sidecar.mjs
  ) >"$STATUS_LOG" 2>&1 &
  STATUS_PID="$!"

  for ((i = 0; i < 80; i += 1)); do
    if curl -fsS -X POST "$STATUS_ENDPOINT" \
      -H "content-type: application/json" \
      --data '{"projectId":"termfleet","workstream":{"provider":"shell","path":"termfleet"}}' \
      >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.1
  done
  echo "HEADER_PROMPT_STATUS_SERVER_NOT_READY" >&2
  return 1
}

drive() {
  local wid=""
  local wait_limit=$((APP_BUDGET * 2))
  for ((i = 1; i <= wait_limit; i += 1)); do
    wid="$(wmctrl -l 2>/dev/null | awk '/TermFleet/ { print $1; exit }')"
    [[ -z "$wid" ]] && wid="$(xdotool search --name "TermFleet" 2>/dev/null | head -1)"
    [[ -n "$wid" ]] && break
    sleep 0.5
  done
  if [[ -z "$wid" ]]; then echo "driver: no window" >>"$DRIVER_LOG"; return 1; fi
  echo "driver: window=$wid" >>"$DRIVER_LOG"

  xdotool windowsize "$wid" 1600 1000 2>>"$DRIVER_LOG" || true
  xdotool windowactivate "$wid" 2>>"$DRIVER_LOG" || true
  sleep 7
  shot "$wid" "01-boot.png"

  xdotool mousemove --window "$wid" 980 560 click --clearmodifiers 1
  sleep 0.5
  local prompt_cmd
  prompt_cmd="printf 'This is a clean checkpoint.\\n\\nWhere to go:\\nNext step\\n\\nThe GI-lightmap pipeline is proven end-to-end. How do you want to proceed?\\n1. Commit + pause here\\n2. Push on to full shell now\\n3. Commit, then continue\\n4. Type something.\\nEnter to select - Up/Down to navigate - Esc to cancel\\n'; echo TF_HEADER_PROMPT_WRITTEN"
  xdotool type --clearmodifiers --delay 0 "$prompt_cmd"
  xdotool key --clearmodifiers Return
  wait_for_trace "TF_HEADER_PROMPT_WRITTEN" 120 || return 1
  wait_for_prompt_header "next-step-prompt" 120 || return 1
  shot "$wid" "02-next-step-header.png"
  echo "driver: done" >>"$DRIVER_LOG"
}

start_status_server || exit 1

cd "$APP_ROOT"
TAURI_DEV_CONFIG="{\"build\":{\"devUrl\":\"http://127.0.0.1:${PORT}\",\"beforeDevCommand\":\"npm run dev -- --host 127.0.0.1 --port ${PORT} --strictPort true\"}}"
setsid timeout "$APP_BUDGET" env \
  CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-1}" \
  CARGO_PROFILE_DEV_DEBUG="${CARGO_PROFILE_DEV_DEBUG:-0}" \
  CARGO_TARGET_DIR="$CARGO_TARGET_DIR" \
  LIBGL_ALWAYS_SOFTWARE=1 \
  WEBKIT_DISABLE_COMPOSITING_MODE=1 \
  WEBKIT_DISABLE_DMABUF_RENDERER=1 \
  TERMINAL_WORKSPACE_TRACE_PTY=1 \
  TERMINAL_WORKSPACE_TRACE_PTY_FILE="$TRACE_FILE" \
  XDG_RUNTIME_DIR="$RUN_DIR" \
  XDG_DATA_HOME="$DATA_DIR" \
  VITE_AGENT_STATUS_SUMMARY_ENDPOINT="$STATUS_ENDPOINT" \
  VITE_COCKPIT_SNAPSHOT=1 \
  VITE_TERMINAL_RENDERER_MODE=canvas2d \
  VITE_WORKSPACE_MODE=canvas \
  VITE_WORKSPACE_RESET_STATE=1 \
  npm run tauri -- dev --config "$TAURI_DEV_CONFIG" >"$LOG_FILE" 2>&1 </dev/null &
APP_RUN_PID=$!

VERIFY_STATUS=0
drive || VERIFY_STATUS=$?
sync
sleep 1

if (( VERIFY_STATUS != 0 )); then
  echo "=== driver.log ==="; cat "$DRIVER_LOG" 2>/dev/null
  echo "=== status-server.log ==="; tail -80 "$STATUS_LOG" 2>/dev/null
  echo "=== runtime.log tail ==="; tail -100 "$LOG_FILE" 2>/dev/null
  echo "=== trace tail ==="; tail -100 "$TRACE_FILE" 2>/dev/null
  exit "$VERIFY_STATUS"
fi

echo "HEADER_PROMPT_LIVE_OK"
echo "=== driver.log ==="; cat "$DRIVER_LOG" 2>/dev/null
echo "=== screenshots ==="; ls -1 "$OUT_DIR"/*.png 2>/dev/null
