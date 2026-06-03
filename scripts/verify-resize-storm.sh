#!/usr/bin/env bash
# Live regression for resize-loop terminal corruption:
#   1. launch the real Tauri canvas terminal in a private Xvfb/runtime,
#   2. run real zellij + htop in the split terminal,
#   3. rapidly resize the app window through several dimensions,
#   4. prove the final headless-grid size matches the daemon PTY winsize,
#      the terminal is visually nonblank/repainted, and input still reaches
#      the same daemon-owned PTY.
set -uo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${RESIZE_STORM_OUT:-/tmp/tw-resize-storm}"
LOG_FILE="$OUT_DIR/runtime.log"
DRIVER_LOG="$OUT_DIR/driver.log"
TRACE_FILE="$OUT_DIR/pty-trace.log"
RUN_DIR="$OUT_DIR/run"
DATA_DIR="$OUT_DIR/data"
CARGO_TARGET_DIR="$OUT_DIR/target"
SOCKET="$RUN_DIR/terminal-workspace/daemon.sock"
PORT="${RESIZE_STORM_PORT:-$((21000 + RANDOM % 1000))}"
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

if [[ -z "${RESIZE_STORM_INNER:-}" ]]; then
  rm -f "$OUT_DIR"/*.png "$LOG_FILE" "$DRIVER_LOG" "$TRACE_FILE"
  rm -rf "$RUN_DIR" "$DATA_DIR"
  mkdir -p "$RUN_DIR" "$DATA_DIR"
  chmod 700 "$RUN_DIR"
  : > "$TRACE_FILE"
  exec xvfb-run -a -s "-screen 0 1700x1050x24" \
    env \
      RESIZE_STORM_INNER=1 \
      RESIZE_STORM_OUT="$OUT_DIR" \
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
  zellij delete-session tf-resize-storm -f >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

shot() { import -window "$1" "$OUT_DIR/$2" 2>>"$DRIVER_LOG" || true; }

drive() {
  local wid=""
  local wait_limit=$((APP_BUDGET * 2))
  for ((i = 1; i <= wait_limit; i += 1)); do
    wid="$(xdotool search --name "Terminal Workspace" 2>/dev/null | tail -1 || true)"
    [[ -n "$wid" ]] && break
    sleep 0.5
  done
  if [[ -z "$wid" ]]; then echo "driver: no window" >>"$DRIVER_LOG"; return; fi
  echo "driver: window=$wid" >>"$DRIVER_LOG"

  xdotool windowsize "$wid" 1600 1000
  xdotool windowactivate "$wid" 2>>"$DRIVER_LOG" || true
  sleep 7
  shot "$wid" "01-boot.png"

  xdotool mousemove --window "$wid" 900 500 click --clearmodifiers 1
  sleep 0.6
  echo "=== RESIZE-STORM-ZELLIJ ===" >> "$TRACE_FILE"
  xdotool type --clearmodifiers --delay 14 "zellij -s tf-resize-storm"
  xdotool key --clearmodifiers Return
  sleep 7
  xdotool key --clearmodifiers Return
  sleep 1
  xdotool type --clearmodifiers --delay 10 "htop"
  xdotool key --clearmodifiers Return
  sleep 4
  shot "$wid" "02-zellij-htop-before.png"

  echo "=== RESIZE-STORM-BEGIN ===" >> "$TRACE_FILE"
  for size in 1180x760 1640x1000 980x700 1510x900 1240x820 1600x1000; do
    xdotool windowsize "$wid" "${size%x*}" "${size#*x}"
    sleep 0.45
  done
  echo "=== RESIZE-STORM-END ===" >> "$TRACE_FILE"
  sleep 4
  shot "$wid" "03-after-resize-storm.png"

  # Prove the terminal still owns input after the resize storm. `q` exits htop,
  # so the screenshot should repaint and the daemon trace should show a write.
  echo "=== RESIZE-STORM-INPUT ===" >> "$TRACE_FILE"
  xdotool mousemove --window "$wid" 900 500 click --clearmodifiers 1
  sleep 0.4
  xdotool key --clearmodifiers q
  sleep 1.5
  shot "$wid" "04-after-input.png"

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
cleanup

sync
sleep 3
echo "=== driver.log ==="; cat "$DRIVER_LOG" 2>/dev/null

python3 - "$TRACE_FILE" <<'PYEOF'
import re, sys
lines = open(sys.argv[1], encoding="utf-8", errors="replace").read().splitlines()

def cols_rows(line):
    c = re.search(r"cols=(\d+)", line)
    r = re.search(r"rows=(\d+)", line)
    return (int(c.group(1)) if c else None, int(r.group(1)) if r else None)

events = []
storm_seen = False
input_seen = False
input_write = False
for line in lines:
    if "RESIZE-STORM-BEGIN" in line:
        storm_seen = True
    if "RESIZE-STORM-INPUT" in line:
        input_seen = True
    for label in ("grid.attach", "grid.resize", "daemon.ensure.receive", "daemon.ensure.done", "daemon.resize.receive", "daemon.write.receive"):
        if label in line:
            ts = re.search(r"\[TW-PTY\]\s+(\d+)", line)
            events.append((int(ts.group(1)) if ts else 0, label, line.strip()))
            if input_seen and label == "daemon.write.receive":
                input_write = True
            break

events.sort(key=lambda item: item[0])
print("=== resize storm timeline ===")
for _, _, line in events:
    if "grid.resize" in line or "daemon.resize.receive" in line or "daemon.write.receive" in line:
        print("  ", line)

def last(label_set):
    for _, label, line in reversed(events):
        if label in label_set:
            return cols_rows(line)
    return (None, None)

storm_grid_resizes = [
    cols_rows(line)
    for _, label, line in events
    if label == "grid.resize"
]
storm_pty_resizes = [
    cols_rows(line)
    for _, label, line in events
    if label == "daemon.resize.receive"
]
unique_grid = {size for size in storm_grid_resizes if size[0] and size[1]}
unique_pty = {size for size in storm_pty_resizes if size[0] and size[1]}
grid = last({"grid.resize", "grid.attach"})
pty = last({"daemon.resize.receive", "daemon.ensure.receive", "daemon.ensure.done"})

ok = True
if not storm_seen:
    print("RESIZE_STORM_MARKER_MISSING")
    ok = False
if len(unique_grid) < 3 or len(unique_pty) < 3:
    print(f"RESIZE_STORM_TOO_FEW_RESIZES grid={len(unique_grid)} pty={len(unique_pty)}")
    ok = False
else:
    print(f"RESIZE_STORM_MULTIPLE_SIZES grid={len(unique_grid)} pty={len(unique_pty)}")
if grid != pty or grid[0] is None:
    print(f"RESIZE_STORM_GRID_PTY_DIVERGED grid={grid} pty={pty}")
    ok = False
else:
    print(f"RESIZE_STORM_GRID_PTY_MATCH grid={grid} pty={pty}")
if not input_write:
    print("RESIZE_STORM_INPUT_MISSING")
    ok = False
else:
    print("RESIZE_STORM_INPUT_REACHED_DAEMON")

print("RESIZE_STORM_TRACE_OK" if ok else "RESIZE_STORM_TRACE_FAILED")
sys.exit(0 if ok else 1)
PYEOF
VERIFY_STATUS=$?

assert_terminal_image_signal() {
  local file="$1"
  local label="$2"
  if [[ ! -s "$file" ]]; then
    echo "RESIZE_STORM_SCREENSHOT_MISSING  $label $file" >&2
    return 1
  fi
  local metrics
  metrics="$(magick "$file" -crop 1180x760+300+110 -colorspace Gray -format '%[mean] %[standard-deviation]' info: 2>/dev/null)" || {
    echo "RESIZE_STORM_IMAGE_METRICS_FAILED  $label $file" >&2
    return 1
  }
  python3 - "$label" "$metrics" <<'PYEOF'
import sys
label = sys.argv[1]
mean, sd = (float(part) for part in sys.argv[2].split())
if mean < 1000 or sd < 2500:
    print(f"RESIZE_STORM_VISUAL_BLANK_OR_FLAT  {label} mean={mean:.1f} sd={sd:.1f}", file=sys.stderr)
    sys.exit(1)
print(f"RESIZE_STORM_VISUAL_CONTENT  {label} mean={mean:.1f} sd={sd:.1f}")
PYEOF
}

assert_visual_change() {
  local before="$1"
  local after="$2"
  local label="$3"
  if [[ ! -s "$before" || ! -s "$after" ]]; then
    echo "RESIZE_STORM_VISUAL_CHANGE_SCREENSHOT_MISSING  $label" >&2
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
    print(f"RESIZE_STORM_VISUAL_CHANGE_TOO_SMALL  {label} changed_pixels={pixels}", file=sys.stderr)
    sys.exit(1)
print(f"RESIZE_STORM_VISUAL_REPAINT  {label} changed_pixels={pixels}")
PYEOF
}

if (( VERIFY_STATUS == 0 )); then
  assert_terminal_image_signal "$OUT_DIR/02-zellij-htop-before.png" "before" || VERIFY_STATUS=$?
fi
if (( VERIFY_STATUS == 0 )); then
  assert_terminal_image_signal "$OUT_DIR/03-after-resize-storm.png" "after-resize-storm" || VERIFY_STATUS=$?
fi
if (( VERIFY_STATUS == 0 )); then
  assert_terminal_image_signal "$OUT_DIR/04-after-input.png" "after-input" || VERIFY_STATUS=$?
fi
if (( VERIFY_STATUS == 0 )); then
  assert_visual_change "$OUT_DIR/03-after-resize-storm.png" "$OUT_DIR/04-after-input.png" "post-storm-input" || VERIFY_STATUS=$?
fi

if (( VERIFY_STATUS != 0 )); then
  echo "=== trace tail ==="; tail -160 "$TRACE_FILE" 2>/dev/null
  echo "=== screenshots ==="; ls -1 "$OUT_DIR"/*.png 2>/dev/null
  exit "$VERIFY_STATUS"
fi

echo "RESIZE_STORM_OK"
echo "=== screenshots ==="; ls -1 "$OUT_DIR"/*.png 2>/dev/null
