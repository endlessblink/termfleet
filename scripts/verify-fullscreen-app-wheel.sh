#!/usr/bin/env bash
# Live regression for TF-059: Claude Code's fullscreen TUI draws on the PRIMARY
# screen with any-event mouse tracking, and its screen clears push stale frames
# into the grid history. The mouse wheel must reach the app (which scrolls its
# own view), Shift+wheel must still reach TermFleet history, and a plain wheel
# after that must bring the view back from history before scrolling the app.
#
# Uses a network-free stand-in (scripts/fixtures/fake-fullscreen-app.py) in a
# private Xvfb display, daemon socket and data dir; the operator's app and
# terminals are never touched.
set -uo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${FULLSCREEN_WHEEL_OUT:-/tmp/tw-fullscreen-wheel}"
LOG_FILE="$OUT_DIR/runtime.log"
DRIVER_LOG="$OUT_DIR/driver.log"
TRACE_FILE="$OUT_DIR/pty-trace.log"
WHEEL_LOG="$OUT_DIR/app-wheel.log"
RUN_DIR="$OUT_DIR/run"
DATA_DIR="$OUT_DIR/data"
SOCKET="$RUN_DIR/terminal-workspace/daemon.sock"
PORT="${FULLSCREEN_WHEEL_PORT:-$((19000 + RANDOM % 1000))}"
APP_BUDGET="${APP_BUDGET:-240}"
APP_RUN_PID=""

mkdir -p "$OUT_DIR" "$RUN_DIR" "$DATA_DIR"
chmod 700 "$RUN_DIR"

private_daemon_pid() {
  python3 - "$SOCKET" <<'PYEOF' 2>/dev/null || true
import json, socket, sys
try:
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    s.settimeout(0.4)
    s.connect(sys.argv[1])
    s.sendall(b'{"type":"status"}')
    s.shutdown(socket.SHUT_WR)
    pid = json.loads(s.recv(4096).decode("utf-8", "replace")).get("pid")
    if pid:
        print(pid)
except Exception:
    pass
PYEOF
}

if [[ -z "${FULLSCREEN_WHEEL_INNER:-}" ]]; then
  rm -f "$OUT_DIR"/*.png "$LOG_FILE" "$DRIVER_LOG" "$TRACE_FILE" "$WHEEL_LOG"
  rm -rf "$RUN_DIR" "$DATA_DIR"
  mkdir -p "$RUN_DIR" "$DATA_DIR"
  chmod 700 "$RUN_DIR"
  : > "$TRACE_FILE"
  : > "$WHEEL_LOG"
  exec xvfb-run -a -s "-screen 0 1600x1000x24" \
    env \
      FULLSCREEN_WHEEL_INNER=1 \
      FULLSCREEN_WHEEL_OUT="$OUT_DIR" \
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
mark() { echo "=== $1 ===" >> "$TRACE_FILE"; }
wheel_count() { wc -l < "$WHEEL_LOG" | tr -d ' '; }

wait_for_trace() {
  local needle="$1" limit="${2:-80}"
  for ((i = 0; i < limit; i += 1)); do
    grep -Fq "$needle" "$TRACE_FILE" 2>/dev/null && return 0
    sleep 0.25
  done
  echo "driver: trace marker not found: $needle" >>"$DRIVER_LOG"
  return 1
}

wheel_up() {
  for ((i = 0; i < $1; i += 1)); do
    xdotool click --clearmodifiers 4
    sleep 0.08
  done
}

drive() {
  local wid=""
  for ((i = 1; i <= APP_BUDGET * 2; i += 1)); do
    wid="$(xdotool search --name "TermFleet" 2>/dev/null | head -1)"
    [[ -n "$wid" ]] && break
    sleep 0.5
  done
  if [[ -z "$wid" ]]; then echo "driver: no window" >>"$DRIVER_LOG"; return; fi
  echo "driver: window=$wid" >>"$DRIVER_LOG"

  xdotool windowsize "$wid" 1600 1000 2>>"$DRIVER_LOG" || true
  xdotool windowactivate "$wid" 2>>"$DRIVER_LOG" || true
  sleep 7
  xdotool mousemove --window "$wid" 900 500 click --clearmodifiers 1
  sleep 0.5
  xdotool type --clearmodifiers --delay 0 "python3 $APP_ROOT/scripts/fixtures/fake-fullscreen-app.py $WHEEL_LOG"
  xdotool key --clearmodifiers Return
  wait_for_trace "TF_FULLSCREEN_READY" 120 || return
  sleep 1
  shot "$wid" "01-app-ready.png"

  mark "PLAIN-WHEEL"
  xdotool mousemove --window "$wid" 1000 520
  wheel_up 5
  sleep 1
  echo "plain=$(wheel_count)" >>"$DRIVER_LOG"
  shot "$wid" "02-plain-wheel.png"

  mark "SHIFT-WHEEL"
  xdotool keydown shift
  for ((i = 0; i < 5; i += 1)); do xdotool click 4; sleep 0.08; done
  xdotool keyup shift
  sleep 1
  echo "shift=$(wheel_count)" >>"$DRIVER_LOG"
  shot "$wid" "03-shift-wheel-history.png"

  mark "WHEEL-AFTER-HISTORY"
  wheel_up 2
  sleep 1
  echo "after=$(wheel_count)" >>"$DRIVER_LOG"
  shot "$wid" "04-wheel-back-to-app.png"

  xdotool type --clearmodifiers --delay 0 "q"
  sleep 0.5
  echo "driver: done" >>"$DRIVER_LOG"
}

drive &
DRIVER_PID=$!

cd "$APP_ROOT"
TAURI_DEV_CONFIG="{\"build\":{\"devUrl\":\"http://127.0.0.1:${PORT}\",\"beforeDevCommand\":\"npm run dev -- --host 127.0.0.1 --port ${PORT} --strictPort true\"}}"
setsid timeout "$APP_BUDGET" env \
  CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-1}" \
  CARGO_PROFILE_DEV_DEBUG="${CARGO_PROFILE_DEV_DEBUG:-0}" \
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

python3 - "$TRACE_FILE" "$DRIVER_LOG" <<'PYEOF'
import re, sys

trace = open(sys.argv[1], encoding="utf-8", errors="replace").read().splitlines()
driver = open(sys.argv[2], encoding="utf-8", errors="replace").read()
counts = dict(re.findall(r"^(plain|shift|after)=(\d+)$", driver, re.M))
if len(counts) != 3:
    print("FULLSCREEN_WHEEL_DRIVER_INCOMPLETE")
    sys.exit(1)
plain, shift, after = (int(counts[k]) for k in ("plain", "shift", "after"))

phase = None
calls = {"PLAIN-WHEEL": [], "SHIFT-WHEEL": [], "WHEEL-AFTER-HISTORY": []}
for line in trace:
    m = re.match(r"=== (.+) ===$", line)
    if m:
        phase = m.group(1) if m.group(1) in calls else phase
        continue
    if phase and "grid.scroll_to_bottom" in line:
        calls[phase].append("bottom")
    elif phase and "grid.scroll " in line:
        delta = re.search(r"delta=(-?\d+)", line)
        # Positive delta moves the view UP into history.
        calls[phase].append("history-up" if delta and int(delta.group(1)) > 0 else "history-down")

failures = []
if plain < 5:
    failures.append(f"FULLSCREEN_WHEEL_NOT_SENT_TO_APP  app saw {plain}/5 wheel reports")
if any(c.startswith("history") for c in calls["PLAIN-WHEEL"]):
    failures.append("FULLSCREEN_WHEEL_SCROLLED_STALE_HISTORY  plain wheel moved TermFleet history")
if shift != plain:
    failures.append(f"FULLSCREEN_SHIFT_WHEEL_LEAKED_TO_APP  app saw {shift - plain} Shift+wheel reports")
if "history-up" not in calls["SHIFT-WHEEL"] or "history-down" in calls["SHIFT-WHEEL"]:
    failures.append(
        "FULLSCREEN_SHIFT_WHEEL_NO_HISTORY  Shift+wheel-up did not scroll UP into TermFleet history "
        f"({calls['SHIFT-WHEEL']})"
    )
if after - shift < 2:
    failures.append(f"FULLSCREEN_WHEEL_AFTER_HISTORY_NOT_SENT  app saw {after - shift}/2")
if "bottom" not in calls["WHEEL-AFTER-HISTORY"]:
    failures.append("FULLSCREEN_WHEEL_STUCK_IN_HISTORY  view did not return from history")

if failures:
    print("\n".join(failures))
    sys.exit(1)
print(f"FULLSCREEN_WHEEL_REACHES_APP plain={plain}")
print("FULLSCREEN_WHEEL_LEAVES_HISTORY_UNTOUCHED")
print("FULLSCREEN_SHIFT_WHEEL_SCROLLS_HISTORY")
print(f"FULLSCREEN_WHEEL_RETURNS_FROM_HISTORY app_reports={after - shift}")
PYEOF
VERIFY_STATUS=$?

cleanup
echo "=== driver.log ==="; cat "$DRIVER_LOG" 2>/dev/null
echo "=== screenshots ==="; ls -1 "$OUT_DIR"/*.png 2>/dev/null
if (( VERIFY_STATUS != 0 )); then
  echo "=== trace (scroll + markers) ==="
  grep -E "===|grid\.scroll" "$TRACE_FILE" 2>/dev/null | tail -60
fi
exit "$VERIFY_STATUS"
