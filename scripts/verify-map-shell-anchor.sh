#!/usr/bin/env bash
# Live map-shell visual canary for sparse prompts.
#
# Reproduces a fresh primary-screen shell opened directly on the operations map
# and fails if the cursor/prompt is painted away from the top of the selected
# terminal node. Map terminals should match normal terminal semantics: a fresh
# prompt starts at row 0 unless the shell itself prints content below it.
set -uo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${MAP_SHELL_ANCHOR_OUT:-/tmp/tw-map-shell-anchor}"
LOG_FILE="$OUT_DIR/runtime.log"
DRIVER_LOG="$OUT_DIR/driver.log"
RUN_DIR="$OUT_DIR/run"
DATA_DIR="$OUT_DIR/data"
CARGO_TARGET_DIR="$OUT_DIR/target"
SOCKET="$RUN_DIR/terminal-workspace/daemon.sock"
PORT="${MAP_SHELL_ANCHOR_PORT:-$((19000 + RANDOM % 1000))}"
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

if [[ -z "${MAP_SHELL_ANCHOR_INNER:-}" ]]; then
  rm -f "$OUT_DIR"/*.png "$LOG_FILE" "$DRIVER_LOG"
  rm -rf "$RUN_DIR" "$DATA_DIR"
  mkdir -p "$RUN_DIR" "$DATA_DIR"
  chmod 700 "$RUN_DIR"
  exec xvfb-run -a -s "-screen 0 1400x900x24" \
    env \
      MAP_SHELL_ANCHOR_INNER=1 \
      MAP_SHELL_ANCHOR_OUT="$OUT_DIR" \
      XDG_RUNTIME_DIR="$RUN_DIR" \
      XDG_DATA_HOME="$DATA_DIR" \
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

drive() {
  local wid=""
  local wait_limit=$((APP_BUDGET * 2))
  for ((i = 0; i < wait_limit; i += 1)); do
    wid="$(xdotool search --name "TermFleet" 2>/dev/null | head -1)"
    [[ -n "$wid" ]] && break
    sleep 0.5
  done
  if [[ -z "$wid" ]]; then echo "driver: no window" >>"$DRIVER_LOG"; return; fi
  echo "driver: window=$wid" >>"$DRIVER_LOG"

  xdotool windowsize "$wid" 1400 900
  xdotool windowactivate "$wid" >/dev/null 2>&1 || true
  sleep 9
  import -window "$wid" "$OUT_DIR/01-map-shell.png" 2>>"$DRIVER_LOG" || true
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
  XDG_RUNTIME_DIR="$RUN_DIR" \
  XDG_DATA_HOME="$DATA_DIR" \
  VITE_TERMINAL_RENDERER_MODE=canvas2d \
  VITE_WORKSPACE_MODE=canvas \
  VITE_WORKSPACE_RESET_STATE=1 \
  npm run tauri -- dev --config "$TAURI_DEV_CONFIG" >"$LOG_FILE" 2>&1 </dev/null &
APP_RUN_PID=$!

wait "$DRIVER_PID" 2>/dev/null || true
cleanup

echo "=== driver.log ==="; cat "$DRIVER_LOG" 2>/dev/null

python3 - "$OUT_DIR/01-map-shell.png" <<'PYEOF'
import subprocess, sys
from pathlib import Path

image = Path(sys.argv[1])
if not image.exists() or image.stat().st_size == 0:
    print(f"MAP_SHELL_ANCHOR_SCREENSHOT_MISSING {image}", file=sys.stderr)
    sys.exit(1)

crop = "720x430+670+175"
ppm = subprocess.check_output(["magick", str(image), "-crop", crop, "ppm:-"])
header, rest = ppm.split(b"\n", 1)
if header != b"P6":
    print("MAP_SHELL_ANCHOR_BAD_PPM", file=sys.stderr)
    sys.exit(1)
while rest.startswith(b"#"):
    rest = rest.split(b"\n", 1)[1]
dims, rest = rest.split(b"\n", 1)
width, height = (int(part) for part in dims.split())
maxv, data = rest.split(b"\n", 1)
if int(maxv) != 255:
    print("MAP_SHELL_ANCHOR_BAD_MAXV", file=sys.stderr)
    sys.exit(1)

points = []
for i in range(0, min(len(data), width * height * 3), 3):
    r, g, b = data[i], data[i + 1], data[i + 2]
    if r >= 160 and 80 <= g <= 190 and b <= 120 and r > g and g > b:
        y = (i // 3) // width
        x = (i // 3) % width
        points.append((x, y))

if len(points) < 12:
    print(f"MAP_SHELL_ANCHOR_CURSOR_NOT_FOUND pixels={len(points)}", file=sys.stderr)
    sys.exit(1)

ys = sorted(y for _, y in points)
median_y = ys[len(ys) // 2]
threshold = int(height * 0.35)
if median_y > threshold:
    print(
        f"MAP_SHELL_PROMPT_TOO_LOW median_y={median_y} threshold={threshold} crop={crop}",
        file=sys.stderr,
    )
    sys.exit(1)

print(
    f"MAP_SHELL_PROMPT_TOP_OK median_y={median_y} threshold={threshold} cursor_pixels={len(points)} crop={crop}"
)
PYEOF
VERIFY_STATUS=$?

if (( VERIFY_STATUS != 0 )); then
  echo "=== runtime tail ==="; tail -80 "$LOG_FILE" 2>/dev/null
  echo "=== screenshots ==="; ls -1 "$OUT_DIR"/*.png 2>/dev/null
  exit "$VERIFY_STATUS"
fi

echo "=== screenshots ==="; ls -1 "$OUT_DIR"/*.png 2>/dev/null
