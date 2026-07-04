#!/usr/bin/env bash
# Live headed regression for terminal header Task stability:
#   1. launch a private Tauri dev window with the real status sidecar worker,
#   2. submit a user ask through the live terminal input path,
#   3. verify the rendered cockpit header reports that durable submitted-input Task,
#   4. fill and scroll terminal history,
#   5. verify the rendered Task text/source did not change after scrolling.
set -uo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${TASK_SCROLL_STABILITY_OUT:-/tmp/tw-task-scroll-stability}"
LOG_FILE="$OUT_DIR/runtime.log"
STATUS_LOG="$OUT_DIR/status-server.log"
DRIVER_LOG="$OUT_DIR/driver.log"
TRACE_FILE="$OUT_DIR/pty-trace.log"
RUN_DIR="$OUT_DIR/run"
DATA_DIR="$OUT_DIR/data"
CARGO_TARGET_DIR="$OUT_DIR/target"
PORT="${TASK_SCROLL_STABILITY_PORT:-$((19100 + RANDOM % 900))}"
STATUS_PORT="${TASK_SCROLL_STABILITY_STATUS_PORT:-$((38100 + RANDOM % 900))}"
STATUS_ENDPOINT="http://127.0.0.1:${STATUS_PORT}/status"
SNAPSHOT_FILE="$DATA_DIR/terminal-workspace/agent-status/cockpit-snapshot.json"
EXPECTED_TASK="Fixing terminal task description"
APP_BUDGET="${APP_BUDGET:-240}"
APP_RUN_PID=""
STATUS_PID=""

mkdir -p "$OUT_DIR" "$RUN_DIR" "$DATA_DIR"
chmod 700 "$RUN_DIR"

if [[ -z "${TASK_SCROLL_STABILITY_INNER:-}" ]]; then
  rm -f "$OUT_DIR"/*.png "$LOG_FILE" "$STATUS_LOG" "$DRIVER_LOG" "$TRACE_FILE"
  rm -rf "$RUN_DIR" "$DATA_DIR"
  mkdir -p "$RUN_DIR" "$DATA_DIR"
  chmod 700 "$RUN_DIR"
  : > "$TRACE_FILE"
  exec xvfb-run -a -s "-screen 0 1600x1000x24" \
    env \
      TASK_SCROLL_STABILITY_INNER=1 \
      TASK_SCROLL_STABILITY_OUT="$OUT_DIR" \
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
  local limit="${2:-80}"
  for ((i = 0; i < limit; i += 1)); do
    if grep -Fq "$needle" "$TRACE_FILE" 2>/dev/null; then
      return 0
    fi
    sleep 0.25
  done
  echo "driver: trace marker not found: $needle" >>"$DRIVER_LOG"
  return 1
}

assert_snapshot_task() {
  local stage="$1"
  python3 - "$SNAPSHOT_FILE" "$EXPECTED_TASK" "$stage" <<'PYEOF'
import json, sys, time

path, expected, stage = sys.argv[1:4]
try:
    snap = json.load(open(path, encoding="utf-8"))
except Exception as error:
    print(f"TASK_SCROLL_SNAPSHOT_MISSING stage={stage} error={error}")
    sys.exit(1)

terminals = snap.get("terminals") if isinstance(snap, dict) else []
matches = [
    t for t in terminals
    if str(t.get("task") or "").strip() == expected
    and str(t.get("taskSource") or "").strip() == "user-prompt"
]
bad = [
    t for t in terminals
    if "Explaining this codebase" in str(t.get("task") or "")
    or "old scrollback" in str(t.get("task") or "")
]
age = int((time.time() * 1000 - int(snap.get("updatedAt") or 0)) / 1000)
if bad:
    print(f"TASK_SCROLL_STALE_TASK_LEAK stage={stage} entries={bad}")
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
    print(f"TASK_SCROLL_TASK_NOT_RENDERED stage={stage} age={age}s terminals={compact}")
    sys.exit(1)
print(f"TASK_SCROLL_TASK_STABLE stage={stage} age={age}s task={expected!r} source=user-prompt")
PYEOF
}

wait_for_snapshot_task() {
  local stage="$1"
  local limit="${2:-80}"
  for ((i = 0; i < limit; i += 1)); do
    if assert_snapshot_task "$stage" >/tmp/tw-task-scroll-snapshot-check.$$ 2>&1; then
      cat /tmp/tw-task-scroll-snapshot-check.$$
      rm -f /tmp/tw-task-scroll-snapshot-check.$$
      return 0
    fi
    sleep 0.25
  done
  cat /tmp/tw-task-scroll-snapshot-check.$$ 2>/dev/null || true
  rm -f /tmp/tw-task-scroll-snapshot-check.$$
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
  echo "TASK_SCROLL_STATUS_SERVER_NOT_READY" >&2
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
  xdotool type --clearmodifiers --delay 0 "fix terminal task description"
  xdotool key --clearmodifiers Return
  wait_for_snapshot_task "before-scroll" 120 || return 1
  shot "$wid" "02-task-before-scroll.png"

  local fill_cmd
  fill_cmd='for i in $(seq 1 160); do printf "TF_TASK_SCROLL_HISTORY_%03d\n" "$i"; done; echo TF_TASK_SCROLL_BOTTOM_A'
  xdotool type --clearmodifiers --delay 0 "$fill_cmd"
  xdotool key --clearmodifiers Return
  wait_for_trace "TF_TASK_SCROLL_BOTTOM_A" 120 || return 1
  sleep 0.8
  shot "$wid" "03-filled-bottom.png"

  echo "=== TASK-SCROLL-STABILITY-SCROLL-UP ===" >> "$TRACE_FILE"
  xdotool mousemove --window "$wid" 1000 560
  for ((i = 0; i < 32; i += 1)); do
    xdotool click --clearmodifiers 4
    sleep 0.02
  done
  sleep 1.2
  shot "$wid" "04-scrolled-history.png"
  wait_for_snapshot_task "after-scroll-up" 40 || return 1

  echo "=== TASK-SCROLL-STABILITY-STALE-PROMPT ===" >> "$TRACE_FILE"
  local stale_cmd
  stale_cmd='printf "\n› Explain this codebase\nold scrollback line from another viewport\n"'
  xdotool type --clearmodifiers --delay 0 "$stale_cmd"
  xdotool key --clearmodifiers Return
  sleep 1.0
  shot "$wid" "05-after-stale-output.png"
  wait_for_snapshot_task "after-stale-output" 40 || return 1

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

echo "TASK_SCROLL_STABILITY_OK"
echo "=== driver.log ==="; cat "$DRIVER_LOG" 2>/dev/null
echo "=== screenshots ==="; ls -1 "$OUT_DIR"/*.png 2>/dev/null
