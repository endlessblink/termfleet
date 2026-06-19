#!/usr/bin/env bash
# Live desktop verification of the headless-VT + Canvas2D renderer (TC-017).
#
# Drives the PRODUCTION canvas renderer: VITE_TERMINAL_RENDERER_MODE=canvas2d so
# Terminal.tsx routes to <TerminalCanvas> in the live Tauri app. It proves the
# goal criteria with screenshots: fills its pane, reflows on resize, renders live,
# and survives real TUIs (vim/htop).
#
# Runs on a PRIVATE auto-allocated Xvfb (via xvfb-run) so it NEVER touches the
# user's real :0 desktop or captures their screen. WebKitGTK is forced to
# software rendering so the canvas surface is capturable by `import`.
#
# Process shape (matches verify-canvas-terminal.sh): the GUI app runs in the
# FOREGROUND under `timeout`; the xdotool/import driver runs as a short-lived
# background subshell that finishes before the app's timeout fires.
set -uo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${CANVAS_LIVE_OUT:-/tmp/tw-canvas-live}"
LOG_FILE="$OUT_DIR/runtime.log"
DRIVER_LOG="$OUT_DIR/driver.log"
TRACE_FILE="$OUT_DIR/pty-trace.log"
RUN_DIR="$OUT_DIR/run"
DATA_DIR="$OUT_DIR/data"
CARGO_TARGET_DIR="$OUT_DIR/target"
SOCKET="$RUN_DIR/terminal-workspace/daemon.sock"
TMUX_SOCKET="$OUT_DIR/tmux.sock"
PORT="${CANVAS_LIVE_PORT:-$((17000 + RANDOM % 1000))}"
APP_BUDGET="${APP_BUDGET:-150}"
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

# Re-exec under a private auto-allocated Xvfb (free display + own auth).
if [[ -z "${CANVAS_LIVE_INNER:-}" ]]; then
  rm -f "$OUT_DIR"/*.png "$LOG_FILE" "$DRIVER_LOG" "$TRACE_FILE"
  rm -rf "$RUN_DIR" "$DATA_DIR"
  mkdir -p "$RUN_DIR" "$DATA_DIR"
  chmod 700 "$RUN_DIR"
  : > "$TRACE_FILE"
  exec xvfb-run -a -s "-screen 0 1600x1000x24" \
    env \
      CANVAS_LIVE_INNER=1 \
      CANVAS_LIVE_OUT="$OUT_DIR" \
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

assert_visual_change() {
  local before="$1"
  local after="$2"
  local label="$3"
  if [[ ! -s "$before" || ! -s "$after" ]]; then
    echo "CANVAS_LIVE_VISUAL_CHANGE_SCREENSHOT_MISSING  $label" >&2
    return 1
  fi
  local diff_pixels
  diff_pixels="$(magick compare -metric AE "$before" "$after" null: 2>&1 || true)"
  python3 - "$label" "$diff_pixels" <<'PYEOF'
import re, sys
label = sys.argv[1]
match = re.search(r"\d+", sys.argv[2])
pixels = int(match.group(0)) if match else 0
if pixels < 1000:
    print(f"CANVAS_LIVE_VISUAL_CHANGE_TOO_SMALL  {label} changed_pixels={pixels}", file=sys.stderr)
    sys.exit(1)
print(f"CANVAS_LIVE_VISUAL_REPAINT  {label} changed_pixels={pixels}")
PYEOF
}

# --- Driver: runs concurrently with the foreground app, then exits. ---
drive() {
  local wid=""
  local wait_limit=$((APP_BUDGET * 2))
  for ((i = 1; i <= wait_limit; i += 1)); do
    wid="$(wmctrl -l 2>/dev/null | awk '/TermFleet/ { print $1; exit }')"
    [[ -z "$wid" ]] && wid="$(xdotool search --name "TermFleet" 2>/dev/null | head -1)"
    [[ -n "$wid" ]] && break
    if (( i % 10 == 0 )); then
      {
        echo "--- poll $i (DISPLAY=$DISPLAY) ---"
        echo "wmctrl:"; wmctrl -l 2>&1 | head
        echo "xdotool any window:"; xdotool search --name . 2>&1 | head
        echo "root tree:"; xwininfo -root -children 2>&1 | grep -iE "0x|terminal|webkit" | head
      } >>"$DRIVER_LOG"
    fi
    sleep 0.5
  done
  if [[ -z "$wid" ]]; then echo "driver: no window" >>"$DRIVER_LOG"; return; fi
  echo "driver: window=$wid" >>"$DRIVER_LOG"

  xdotool windowsize "$wid" 1600 1000 2>>"$DRIVER_LOG" || true
  xdotool windowactivate "$wid" 2>>"$DRIVER_LOG" || true
  sleep 6                                   # vite first paint + grid attach/full-sync
  shot "$wid" "01-default.png"

  # Live render + colors: focus the terminal pane and run a command.
  xdotool mousemove --window "$wid" 800 500 click --clearmodifiers 1; sleep 0.4
  echo "=== CANVAS-LIVE-SHELL-INPUT ===" >> "$TRACE_FILE"
  xdotool type --clearmodifiers --delay 12 "echo TF_CANVAS_LIVE_INPUT_OK && ls --color=always -la /etc | head -30"
  xdotool key Return; sleep 1.5
  shot "$wid" "02-typed.png"

  # Reflow on resize: shrink, then grow. The canvas must re-fit + repaint.
  xdotool windowsize "$wid" 1000 680; sleep 1.5
  shot "$wid" "03-resized-small.png"
  xdotool windowsize "$wid" 1600 1000; sleep 1.5
  shot "$wid" "04-resized-large.png"

  # Real TUI #1: vim alternate-screen + insert text. Open a named file so vim
  # always has a buffer, and capture a frame right after launch (before any
  # insert) to confirm the alternate screen actually took over.
  xdotool mousemove --window "$wid" 1000 500 click --clearmodifiers 1; sleep 0.4
  # `-u NONE`: this machine aliases vim->Neovim+LazyVim, which self-exits on an
  # nvim version check. Bypassing the user config exercises a real editor TUI.
  xdotool type --clearmodifiers --delay 14 "vim -u NONE /tmp/canvas-vim-test.txt"; xdotool key Return; sleep 3
  shot "$wid" "05a-vim-open.png"
  xdotool key i; sleep 0.4
  xdotool type --clearmodifiers --delay 14 "hello from the canvas renderer"; sleep 0.6
  xdotool key Escape; sleep 0.6
  shot "$wid" "05-vim.png"
  xdotool type --clearmodifiers ":q!"; xdotool key Return; sleep 1

  # Real TUI #2: htop full-screen live redraw.
  xdotool mousemove --window "$wid" 1000 500 click --clearmodifiers 1; sleep 0.4
  xdotool type --clearmodifiers --delay 12 "htop"; xdotool key Return; sleep 3
  shot "$wid" "06-htop.png"
  xdotool mousemove --window "$wid" 1000 500 click --clearmodifiers 5; sleep 0.8
  shot "$wid" "06a-htop-wheel-down.png"
  sleep 1.5
  shot "$wid" "07-htop-live.png"        # second frame: confirms continuous redraw
  xdotool key q; sleep 0.8

  # Real TUI #3: tmux multiplexer (status bar + nested alternate-screen app).
  xdotool mousemove --window "$wid" 1000 500 click --clearmodifiers 1; sleep 0.4
  xdotool type --clearmodifiers --delay 14 "tmux -S $TMUX_SOCKET new -s canvas"; xdotool key Return; sleep 2.5
  shot "$wid" "08-tmux.png"
  xdotool type --clearmodifiers --delay 14 "echo inside-tmux-pane"; xdotool key Return; sleep 1
  shot "$wid" "09-tmux-cmd.png"
  xdotool key ctrl+b; xdotool key d; sleep 1   # detach
  xdotool type --clearmodifiers --delay 14 "tmux -S $TMUX_SOCKET kill-server"; xdotool key Return; sleep 0.5

  echo "driver: done" >>"$DRIVER_LOG"
}

drive &
DRIVER_PID=$!

# Foreground GUI app under timeout. `tauri dev` orchestrates vite (beforeDevCommand)
# + builds/runs the debug binary; the canvas2d env reaches vite via inheritance.
cd "$APP_ROOT"
TAURI_DEV_CONFIG="{\"build\":{\"devUrl\":\"http://127.0.0.1:${PORT}\",\"beforeDevCommand\":\"npm run dev -- --host 127.0.0.1 --port ${PORT} --strictPort true\"}}"
setsid timeout "$APP_BUDGET" env \
  CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-1}" \
  CARGO_PROFILE_DEV_DEBUG="${CARGO_PROFILE_DEV_DEBUG:-0}" \
  CARGO_TARGET_DIR="$CARGO_TARGET_DIR" \
  LIBGL_ALWAYS_SOFTWARE=1 \
  WEBKIT_DISABLE_COMPOSITING_MODE=1 \
  WEBKIT_DISABLE_DMABUF_RENDERER=1 \
  TERMINAL_WORKSPACE_TRACE_LATENCY=1 \
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
sync; sleep 2

python3 - "$TRACE_FILE" "$SOCKET" <<'PYEOF'
import json, re, socket, sys

trace_path, sock_path = sys.argv[1], sys.argv[2]
lines = open(trace_path, encoding="utf-8", errors="replace").read().splitlines()
marker_seen = False
input_write = False
session_id = None
for line in lines:
    if "CANVAS-LIVE-SHELL-INPUT" in line:
        marker_seen = True
    if "daemon.ensure.done" in line or "daemon.write.receive" in line or "daemon.input_stream.receive" in line:
        match = re.search(r"id=([^\s]+)", line)
        if match:
            session_id = match.group(1)
    if marker_seen and ("daemon.write.receive" in line or "daemon.input_stream.receive" in line):
        input_write = True

if not marker_seen:
    print("CANVAS_LIVE_INPUT_MARKER_MISSING")
    sys.exit(1)
if not input_write:
    print("CANVAS_LIVE_INPUT_MISSING  shell command did not reach daemon")
    sys.exit(1)
if not session_id:
    print("CANVAS_LIVE_SESSION_MISSING")
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
    print(f"CANVAS_LIVE_SNAPSHOT_FAILED  {error}")
    sys.exit(1)

text = data.decode("utf-8", "replace")
if "TF_CANVAS_LIVE_INPUT_OK" not in text:
    print("CANVAS_LIVE_OUTPUT_MISSING  daemon snapshot did not contain shell marker")
    sys.exit(1)

print("CANVAS_LIVE_INPUT_REACHED_DAEMON")
print("CANVAS_LIVE_OUTPUT_IN_SNAPSHOT")
PYEOF
VERIFY_STATUS=$?
if (( VERIFY_STATUS == 0 )); then
  assert_visual_change "$OUT_DIR/06-htop.png" "$OUT_DIR/06a-htop-wheel-down.png" "htop-wheel-down" || VERIFY_STATUS=$?
fi
cleanup
if (( VERIFY_STATUS != 0 )); then
  exit "$VERIFY_STATUS"
fi

echo "=== driver.log ==="; cat "$DRIVER_LOG" 2>/dev/null
echo "=== screenshots ==="; ls -1 "$OUT_DIR"/*.png 2>/dev/null || echo "(none)"
echo "=== canvas2d routing in log ==="
grep -c "canvas2d" "$LOG_FILE" 2>/dev/null || echo 0
echo "=== native overlay log lines (should be 0 for canvas mode) ==="
grep -c "native-terminal-vte" "$LOG_FILE" 2>/dev/null || echo 0
echo "=== backend latency traces ==="
ls -1 /tmp/terminal-workspace-latency-trace-*.jsonl 2>/dev/null | wc -l
