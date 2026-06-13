#!/usr/bin/env bash
# Live regression for the broken reconnected-terminal viewport:
#   1. fill regular-shell scrollback,
#   2. scroll the canvas grid away from bottom,
#   3. switch split -> map -> split so the same PTY/grid reattaches,
#   4. type visible marker lines after reattach.
#
# The test requires all three layers:
# - trace evidence that scrollback moved and was reset to live bottom,
# - daemon evidence that post-reattach input reached the same PTY,
# - screenshot evidence that the canvas visibly repainted after that input.
set -uo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${SCROLLBACK_REATTACH_OUT:-/tmp/tw-scrollback-reattach}"
LOG_FILE="$OUT_DIR/runtime.log"
DRIVER_LOG="$OUT_DIR/driver.log"
TRACE_FILE="$OUT_DIR/pty-trace.log"
RUN_DIR="$OUT_DIR/run"
DATA_DIR="$OUT_DIR/data"
CARGO_TARGET_DIR="$OUT_DIR/target"
SOCKET="$RUN_DIR/terminal-workspace/daemon.sock"
PORT="${SCROLLBACK_REATTACH_PORT:-$((19000 + RANDOM % 1000))}"
APP_BUDGET="${APP_BUDGET:-180}"
APP_RUN_PID=""

mkdir -p "$OUT_DIR" "$RUN_DIR" "$DATA_DIR"
chmod 700 "$RUN_DIR"

private_daemon_pid() {
  python3 - "$SOCKET" <<'PYEOF' 2>/dev/null || true
import json, socket, sys
sock_path = sys.argv[1]
try:
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    s.settimeout(0.4)
    s.connect(sock_path)
    s.sendall(b'{"type":"status"}')
    s.shutdown(socket.SHUT_WR)
    data = s.recv(4096)
    s.close()
    pid = json.loads(data.decode("utf-8", "replace")).get("pid")
    if pid:
        print(pid)
except Exception:
    pass
PYEOF
}

if [[ -z "${SCROLLBACK_REATTACH_INNER:-}" ]]; then
  rm -f "$OUT_DIR"/*.png "$LOG_FILE" "$DRIVER_LOG" "$TRACE_FILE"
  rm -rf "$RUN_DIR" "$DATA_DIR"
  mkdir -p "$RUN_DIR" "$DATA_DIR"
  chmod 700 "$RUN_DIR"
  : > "$TRACE_FILE"
  exec xvfb-run -a -s "-screen 0 1600x1000x24" \
    env \
      SCROLLBACK_REATTACH_INNER=1 \
      SCROLLBACK_REATTACH_OUT="$OUT_DIR" \
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
  local daemon_pid
  daemon_pid="$(private_daemon_pid)"
  if [[ -n "$daemon_pid" ]]; then
    kill "$daemon_pid" >/dev/null 2>&1 || true
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

drive() {
  local wid=""
  local wait_limit=$((APP_BUDGET * 2))
  for ((i = 1; i <= wait_limit; i += 1)); do
    wid="$(wmctrl -l 2>/dev/null | awk '/Terminal Workspace/ { print $1; exit }')"
    [[ -z "$wid" ]] && wid="$(xdotool search --name "Terminal Workspace" 2>/dev/null | head -1)"
    [[ -n "$wid" ]] && break
    sleep 0.5
  done
  if [[ -z "$wid" ]]; then echo "driver: no window" >>"$DRIVER_LOG"; return; fi
  echo "driver: window=$wid" >>"$DRIVER_LOG"

  xdotool windowsize "$wid" 1600 1000 2>>"$DRIVER_LOG" || true
  xdotool windowactivate "$wid" 2>>"$DRIVER_LOG" || true
  sleep 7
  shot "$wid" "01-boot-split.png"

  xdotool mousemove --window "$wid" 900 500 click --clearmodifiers 1
  sleep 0.5
  local fill_cmd='for i in $(seq 1 180); do printf "TF_SCROLL_REATTACH_%03d\n" "$i"; done; echo TF_SCROLL_REATTACH_BOTTOM_A'
  xdotool type --clearmodifiers --delay 0 "$fill_cmd"
  xdotool key --clearmodifiers Return
  wait_for_trace "TF_SCROLL_REATTACH_BOTTOM_A" 120 || return
  sleep 0.8
  shot "$wid" "02-filled-bottom.png"

  echo "=== SCROLL-REATTACH-SCROLL-UP ===" >> "$TRACE_FILE"
  xdotool mousemove --window "$wid" 1000 520
  for ((i = 0; i < 28; i += 1)); do
    xdotool click --clearmodifiers 4
    sleep 0.02
  done
  sleep 1
  shot "$wid" "03-scrolled-history.png"

  echo "=== SCROLL-REATTACH-SWITCH-MAP ===" >> "$TRACE_FILE"
  xdotool mousemove --window "$wid" 800 22 click --clearmodifiers 1
  sleep 1.0
  xdotool type --clearmodifiers --delay 12 "map"
  xdotool key --clearmodifiers Return
  sleep 3
  shot "$wid" "04-map-reattach.png"

  echo "=== SCROLL-REATTACH-SWITCH-SPLIT ===" >> "$TRACE_FILE"
  xdotool mousemove --window "$wid" 800 22 click --clearmodifiers 1
  sleep 1.0
  xdotool type --clearmodifiers --delay 12 "show terminal"
  xdotool key --clearmodifiers Return
  sleep 3
  shot "$wid" "05-split-reattach-before-input.png"

  echo "=== SCROLL-REATTACH-LIVE-INPUT ===" >> "$TRACE_FILE"
  xdotool mousemove --window "$wid" 1000 520 click --clearmodifiers 1
  sleep 0.4
  local live_cmd='for i in 1 2 3 4 5 6 7 8; do echo TF_SCROLL_REATTACH_LIVE_OK_$i; done'
  xdotool type --clearmodifiers --delay 0 "$live_cmd"
  xdotool key --clearmodifiers Return
  wait_for_trace "TF_SCROLL_REATTACH_LIVE_OK_8" 80 || return
  sleep 0.8
  shot "$wid" "06-split-reattach-after-input.png"

  echo "driver: done" >>"$DRIVER_LOG"
}

drive &
DRIVER_PID=$!

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
  VITE_TERMINAL_RENDERER_MODE=canvas2d \
  VITE_WORKSPACE_MODE=split \
  VITE_WORKSPACE_RESET_STATE=1 \
  npm run tauri -- dev --config "$TAURI_DEV_CONFIG" >"$LOG_FILE" 2>&1 </dev/null &
APP_RUN_PID=$!

wait "$DRIVER_PID" 2>/dev/null || true
sync
sleep 2

python3 - "$TRACE_FILE" "$SOCKET" <<'PYEOF'
import json, re, socket, sys

trace_path, sock_path = sys.argv[1], sys.argv[2]
lines = open(trace_path, encoding="utf-8", errors="replace").read().splitlines()
session_id = None
filled_session_id = None
live_session_id = None
scrolled = False
reattached_reused = False
after_input = False
bottom_after_input = False
write_after_input = False

for line in lines:
    if "daemon.ensure.done" in line:
        match = re.search(r"id=([^\s]+)", line)
        if match:
            session_id = match.group(1)
        if "reused=true" in line:
            reattached_reused = True
    if "daemon.subscribe.emit" in line and "TF_SCROLL_REATTACH_BOTTOM_A" in line:
        match = re.search(r"id=([^\s]+)", line)
        if match:
            filled_session_id = match.group(1)
            session_id = filled_session_id
    if "daemon.subscribe.emit" in line and "TF_SCROLL_REATTACH_LIVE_OK_8" in line:
        match = re.search(r"id=([^\s]+)", line)
        if match:
            live_session_id = match.group(1)
    if "grid.scroll " in line or "grid.scroll\t" in line:
        scrolled = True
    if "SCROLL-REATTACH-LIVE-INPUT" in line:
        after_input = True
    elif after_input and "grid.scroll_to_bottom" in line:
        bottom_after_input = True
    elif after_input and ("daemon.write.receive" in line or "daemon.input_stream.receive" in line):
        write_after_input = True

if not scrolled:
    print("SCROLLBACK_REATTACH_NO_SCROLL  verifier never moved the grid into history")
    sys.exit(1)
if not reattached_reused:
    print("SCROLLBACK_REATTACH_NO_REUSE  split/map/split did not reattach a reused PTY")
    sys.exit(1)
if not bottom_after_input:
    print("SCROLLBACK_REATTACH_NO_BOTTOM_RESET  post-reattach input did not reset grid to bottom")
    sys.exit(1)
if not write_after_input:
    print("SCROLLBACK_REATTACH_NO_INPUT_WRITE  post-reattach input did not reach daemon")
    sys.exit(1)
if not session_id:
    print("SCROLLBACK_REATTACH_NO_SESSION")
    sys.exit(1)
if not filled_session_id:
    print("SCROLLBACK_REATTACH_NO_FILLED_SESSION  fill output never reached daemon subscriber")
    sys.exit(1)
if not live_session_id:
    print("SCROLLBACK_REATTACH_NO_LIVE_SESSION  post-reattach output never reached daemon subscriber")
    sys.exit(1)
if filled_session_id != live_session_id:
    print(
        "SCROLLBACK_REATTACH_SESSION_CHANGED  "
        f"filled={filled_session_id} live={live_session_id}"
    )
    sys.exit(1)

request = json.dumps({"type": "snapshotSession", "id": session_id}).encode()
try:
    client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    client.settimeout(2.0)
    client.connect(sock_path)
    client.sendall(request)
    client.shutdown(socket.SHUT_WR)
    data = b""
    while True:
        chunk = client.recv(65536)
        if not chunk:
            break
        data += chunk
    client.close()
except Exception as error:
    print(f"SCROLLBACK_REATTACH_SNAPSHOT_FAILED  {error}")
    sys.exit(1)

text = data.decode("utf-8", "replace")
if "TF_SCROLL_REATTACH_BOTTOM_A" not in text:
    print("SCROLLBACK_REATTACH_BOTTOM_MARKER_MISSING")
    sys.exit(1)
if "TF_SCROLL_REATTACH_LIVE_OK_8" not in text:
    print("SCROLLBACK_REATTACH_LIVE_MARKER_MISSING")
    sys.exit(1)

print("SCROLLBACK_MOVED_INTO_HISTORY")
print("SCROLLBACK_REATTACHED_REUSED_PTY")
print("SCROLLBACK_RESET_TO_BOTTOM_BEFORE_INPUT")
print("SCROLLBACK_INPUT_REACHED_DAEMON")
print("SCROLLBACK_OUTPUT_IN_SNAPSHOT")
PYEOF
VERIFY_STATUS=$?

if (( VERIFY_STATUS == 0 )); then
  BEFORE="$OUT_DIR/05-split-reattach-before-input.png"
  AFTER="$OUT_DIR/06-split-reattach-after-input.png"
  if [[ ! -s "$BEFORE" || ! -s "$AFTER" ]]; then
    echo "SCROLLBACK_REATTACH_SCREENSHOT_MISSING" >&2
    VERIFY_STATUS=1
  else
    DIFF_PIXELS="$(magick compare -metric AE "$BEFORE" "$AFTER" null: 2>&1 || true)"
    python3 - "$DIFF_PIXELS" <<'PYEOF'
import re, sys
text = sys.argv[1]
match = re.search(r"\d+", text)
pixels = int(match.group(0)) if match else 0
if pixels < 250:
    print(f"SCROLLBACK_REATTACH_VISUAL_REPAINT_TOO_SMALL  changed_pixels={pixels}")
    sys.exit(1)
print(f"SCROLLBACK_REATTACH_VISUAL_REPAINT changed_pixels={pixels}")
PYEOF
    VERIFY_STATUS=$?
  fi
fi

cleanup
if (( VERIFY_STATUS != 0 )); then
  echo "=== driver.log ==="; cat "$DRIVER_LOG" 2>/dev/null
  echo "=== trace tail ==="; tail -80 "$TRACE_FILE" 2>/dev/null
  exit "$VERIFY_STATUS"
fi

echo "=== driver.log ==="; cat "$DRIVER_LOG" 2>/dev/null
echo "=== screenshots ==="; ls -1 "$OUT_DIR"/*.png 2>/dev/null
