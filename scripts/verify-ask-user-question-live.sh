#!/usr/bin/env bash
# Live Tauri regression for AskUserQuestion-style provider prompts.
#
# This is intentionally stronger than the mocked Playwright grid-stream test:
# it launches the production Tauri app under a private Xvfb, focuses a real map
# terminal, types a local provider-shaped command into the real PTY, enables
# primary-screen mouse-report mode, captures the map canvas, and verifies the
# daemon/grid snapshot contains the question/options exactly once.
set -uo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${ASK_USER_QUESTION_LIVE_OUT:-/tmp/tw-ask-user-question-live}"
LOG_FILE="$OUT_DIR/runtime.log"
DRIVER_LOG="$OUT_DIR/driver.log"
TRACE_FILE="$OUT_DIR/pty-trace.log"
RUN_DIR="$OUT_DIR/run"
DATA_DIR="$OUT_DIR/data"
CARGO_TARGET_DIR="$OUT_DIR/target"
SOCKET="$RUN_DIR/terminal-workspace/daemon.sock"
PORT="${ASK_USER_QUESTION_LIVE_PORT:-$((23000 + RANDOM % 1000))}"
APP_BUDGET="${APP_BUDGET:-210}"
APP_RUN_PID=""
FIXTURE="$OUT_DIR/ask-user-question-provider.sh"

mkdir -p "$OUT_DIR" "$RUN_DIR" "$DATA_DIR"
chmod 700 "$RUN_DIR"

private_daemon_pid() {
  python3 - "$SOCKET" <<'PYEOF' 2>/dev/null || true
import json, socket, sys
sock_path = sys.argv[1]
try:
    client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    client.settimeout(0.4)
    client.connect(sock_path)
    client.sendall(b'{"type":"status"}')
    client.shutdown(socket.SHUT_WR)
    data = client.recv(4096)
    client.close()
    pid = json.loads(data.decode("utf-8", "replace")).get("pid")
    if pid:
        print(pid)
except Exception:
    pass
PYEOF
}

if [[ -z "${ASK_USER_QUESTION_LIVE_INNER:-}" ]]; then
  rm -f "$OUT_DIR"/*.png "$LOG_FILE" "$DRIVER_LOG" "$TRACE_FILE"
  rm -rf "$RUN_DIR" "$DATA_DIR"
  mkdir -p "$RUN_DIR" "$DATA_DIR"
  chmod 700 "$RUN_DIR"
  : > "$TRACE_FILE"
  exec xvfb-run -a -s "-screen 0 1600x1000x24" \
    env \
      ASK_USER_QUESTION_LIVE_INNER=1 \
      ASK_USER_QUESTION_LIVE_OUT="$OUT_DIR" \
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

cat >"$FIXTURE" <<'SHEOF'
#!/usr/bin/env bash
printf '\033[?1000h\033[?1006h'
printf 'Auth\n'
printf 'How should the extension authenticate to your arthouse backend?\n\n'
printf '> 1. Static API token you paste in (Recommended)\n'
printf '     Arthouse Settings generates a long-lived bearer token; you paste it once.\n\n'
printf '> 2. Reuse arthouse login session\n'
printf '     Extension background page calls the arthouse API with your existing session.\n\n'
printf '  3. Type something.\n'
sleep 12
printf '\033[?1006l\033[?1000l'
SHEOF
chmod +x "$FIXTURE"

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

drive() {
  local wid=""
  local wait_limit=$((APP_BUDGET * 2))
  for ((i = 1; i <= wait_limit; i += 1)); do
    wid="$(wmctrl -l 2>/dev/null | awk '/TermFleet/ { print $1; exit }')"
    [[ -z "$wid" ]] && wid="$(xdotool search --name "TermFleet" 2>/dev/null | head -1)"
    [[ -n "$wid" ]] && break
    sleep 0.5
  done
  if [[ -z "$wid" ]]; then echo "driver: no window" >>"$DRIVER_LOG"; return; fi
  echo "driver: window=$wid" >>"$DRIVER_LOG"

  xdotool windowsize "$wid" 1600 1000 2>>"$DRIVER_LOG" || true
  xdotool windowactivate "$wid" 2>>"$DRIVER_LOG" || true
  wait_for_trace "grid.attach" 180 || return
  sleep 2
  shot "$wid" "01-boot-map.png"

  # Select/focus the fresh map terminal, then type the local provider-shaped
  # prompt command into the real shell PTY.
  xdotool mousemove --window "$wid" 420 205 click --clearmodifiers 1
  sleep 1
  xdotool mousemove --window "$wid" 900 500 click --clearmodifiers 1
  sleep 0.5
  echo "=== ASK-USER-QUESTION-LIVE-INPUT ===" >> "$TRACE_FILE"
  xdotool type --clearmodifiers --delay 0 "$FIXTURE"
  xdotool key --clearmodifiers Return
  wait_for_trace "How should the extension authenticate to your arthouse backend" 120 || return
  sleep 3
  shot "$wid" "ask-user-question-map.png"
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
  VITE_WORKSPACE_MODE=canvas \
  VITE_WORKSPACE_RESET_STATE=1 \
  npm run tauri -- dev --config "$TAURI_DEV_CONFIG" >"$LOG_FILE" 2>&1 </dev/null &
APP_RUN_PID=$!

wait "$DRIVER_PID" 2>/dev/null || true
sync
sleep 2

python3 - "$TRACE_FILE" "$SOCKET" "$OUT_DIR/ask-user-question-map.png" <<'PYEOF'
import json, re, socket, subprocess, sys
from pathlib import Path

trace_path, sock_path, screenshot_path = sys.argv[1], sys.argv[2], Path(sys.argv[3])
lines = Path(trace_path).read_text(encoding="utf-8", errors="replace").splitlines()
session_id = None
after_marker = False
input_write = False

for line in lines:
    if "ASK-USER-QUESTION-LIVE-INPUT" in line:
        after_marker = True
    if after_marker and ("daemon.write.receive" in line or "daemon.input_stream.receive" in line):
        input_write = True
        match = re.search(r"id=([^\s]+)", line)
        if match:
            session_id = match.group(1)

if not input_write:
    print("ASK_USER_QUESTION_LIVE_INPUT_MISSING  command did not reach daemon", file=sys.stderr)
    sys.exit(1)
if not session_id:
    print("ASK_USER_QUESTION_LIVE_SESSION_MISSING", file=sys.stderr)
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
    print(f"ASK_USER_QUESTION_LIVE_SNAPSHOT_FAILED  {error}", file=sys.stderr)
    sys.exit(1)

text = data.decode("utf-8", "replace")
required = [
    "How should the extension authenticate to your arthouse backend?",
    "Static API token you paste in (Recommended)",
    "Reuse arthouse login session",
]
for needle in required:
    count = text.count(needle)
    if count != 1:
        print(f"ASK_USER_QUESTION_LIVE_TEXT_COUNT_BAD  {needle!r} count={count}", file=sys.stderr)
        sys.exit(1)

if not screenshot_path.exists() or screenshot_path.stat().st_size == 0:
    print(f"ASK_USER_QUESTION_LIVE_SCREENSHOT_MISSING  {screenshot_path}", file=sys.stderr)
    sys.exit(1)

ppm = subprocess.check_output(["magick", str(screenshot_path), "ppm:-"])
header, rest = ppm.split(b"\n", 1)
if header != b"P6":
    print("ASK_USER_QUESTION_LIVE_BAD_PPM", file=sys.stderr)
    sys.exit(1)
while rest.startswith(b"#"):
    rest = rest.split(b"\n", 1)[1]
dims, rest = rest.split(b"\n", 1)
width, height = (int(part) for part in dims.split())
maxv, data = rest.split(b"\n", 1)
if int(maxv) != 255:
    print("ASK_USER_QUESTION_LIVE_BAD_MAXV", file=sys.stderr)
    sys.exit(1)

lit = 0
for i in range(0, min(len(data), width * height * 3), 3):
    r, g, b = data[i], data[i + 1], data[i + 2]
    if r > 100 or g > 100 or b > 100:
        lit += 1
if lit < 8000:
    print(f"ASK_USER_QUESTION_LIVE_SCREENSHOT_TOO_DARK  lit_pixels={lit}", file=sys.stderr)
    sys.exit(1)

print("ASK_USER_QUESTION_LIVE_INPUT_REACHED_DAEMON")
print("ASK_USER_QUESTION_LIVE_TEXT_ONCE_IN_SNAPSHOT")
print(f"ASK_USER_QUESTION_LIVE_SCREENSHOT_OK lit_pixels={lit} path={screenshot_path}")
PYEOF
VERIFY_STATUS=$?
cleanup
if (( VERIFY_STATUS != 0 )); then
  echo "=== driver.log ==="; cat "$DRIVER_LOG" 2>/dev/null
  echo "=== runtime tail ==="; tail -80 "$LOG_FILE" 2>/dev/null
  echo "=== screenshots ==="; ls -1 "$OUT_DIR"/*.png 2>/dev/null || echo "(none)"
  exit "$VERIFY_STATUS"
fi

echo "=== driver.log ==="; cat "$DRIVER_LOG" 2>/dev/null
echo "=== screenshots ==="; ls -1 "$OUT_DIR"/*.png 2>/dev/null || echo "(none)"
echo "ASK_USER_QUESTION_LIVE_OK"
