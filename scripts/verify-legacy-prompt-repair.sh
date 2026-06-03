#!/usr/bin/env bash
# Live regression for old reused plain-shell sessions that already contain a
# duplicated prompt stack. This reproduces the broken visual shape, switches to a
# non-terminal workspace view, reattaches the same daemon-owned PTY, and proves
# the app sends a real Ctrl-L repair once.
set -uo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${LEGACY_PROMPT_REPAIR_OUT:-/tmp/tw-legacy-prompt-repair}"
LOG_FILE="$OUT_DIR/runtime.log"
DRIVER_LOG="$OUT_DIR/driver.log"
TRACE_FILE="$OUT_DIR/pty-trace.log"
RUN_DIR="$OUT_DIR/run"
DATA_DIR="$OUT_DIR/data"
CARGO_TARGET_DIR="$OUT_DIR/target"
SOCKET="$RUN_DIR/terminal-workspace/daemon.sock"
PORT="${LEGACY_PROMPT_REPAIR_PORT:-$((21000 + RANDOM % 1000))}"
APP_BUDGET="${APP_BUDGET:-180}"
APP_RUN_PID=""

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

if [[ -z "${LEGACY_PROMPT_REPAIR_INNER:-}" ]]; then
  rm -f "$OUT_DIR"/*.png "$LOG_FILE" "$DRIVER_LOG" "$TRACE_FILE"
  rm -rf "$RUN_DIR" "$DATA_DIR"
  mkdir -p "$RUN_DIR" "$DATA_DIR"
  chmod 700 "$RUN_DIR"
  : > "$TRACE_FILE"
  exec xvfb-run -a -s "-screen 0 1600x1000x24" \
    env \
      LEGACY_PROMPT_REPAIR_INNER=1 \
      LEGACY_PROMPT_REPAIR_OUT="$OUT_DIR" \
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
  echo "=== LEGACY-PROMPT-SEED ===" >> "$TRACE_FILE"
  local seed_cmd="export PS1='legacy@host:/tmp$ '; printf '%b' 'legacy@host:/tmp$ \n\n\n'"
  xdotool type --clearmodifiers --delay 0 "$seed_cmd"
  xdotool key --clearmodifiers Return
  wait_for_trace "legacy@host:/tmp" 120 || return
  sleep 0.8
  shot "$wid" "02-seeded-duplicate-prompt.png"

  echo "=== LEGACY-PROMPT-SWITCH-GRAPH ===" >> "$TRACE_FILE"
  xdotool mousemove --window "$wid" 800 22 click --clearmodifiers 1
  sleep 1.0
  xdotool type --clearmodifiers --delay 12 "links"
  xdotool key --clearmodifiers Return
  sleep 3
  shot "$wid" "03-graph-before-reattach.png"

  echo "=== LEGACY-PROMPT-REATTACH ===" >> "$TRACE_FILE"
  xdotool mousemove --window "$wid" 800 22 click --clearmodifiers 1
  sleep 1.0
  xdotool type --clearmodifiers --delay 12 "show terminal"
  xdotool key --clearmodifiers Return
  sleep 4
  shot "$wid" "04-split-after-repair.png"

  echo "=== LEGACY-PROMPT-AFTER-INPUT ===" >> "$TRACE_FILE"
  xdotool mousemove --window "$wid" 1000 520 click --clearmodifiers 1
  sleep 0.4
  local live_cmd='echo TF_LEGACY_PROMPT_LIVE_OK'
  xdotool type --clearmodifiers --delay 0 "$live_cmd"
  xdotool key --clearmodifiers Return
  wait_for_trace "TF_LEGACY_PROMPT_LIVE_OK" 80 || return
  sleep 0.8
  shot "$wid" "05-live-after-repair-input.png"

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
seeded_session_id = None
live_session_id = None
after_seed = False
after_reattach = False
after_input = False
reattached_reused = False
repair_write = False

for line in lines:
    if "daemon.ensure.done" in line:
        match = re.search(r"id=([^\s]+)", line)
        if match:
            session_id = match.group(1)
        if after_reattach and "reused=true" in line:
            reattached_reused = True
    if after_seed and "daemon.subscribe.emit" in line and "legacy@host:/tmp" in line:
        match = re.search(r"id=([^\s]+)", line)
        if match:
            seeded_session_id = match.group(1)
            session_id = seeded_session_id
    if "LEGACY-PROMPT-SEED" in line:
        after_seed = True
    if "LEGACY-PROMPT-REATTACH" in line:
        after_reattach = True
    elif "LEGACY-PROMPT-AFTER-INPUT" in line:
        after_input = True
    elif after_reattach and not after_input and "daemon.write.receive" in line and ("bytes=1" in line or "len=1" in line):
        repair_write = True
    if "daemon.subscribe.emit" in line and "TF_LEGACY_PROMPT_LIVE_OK" in line:
        match = re.search(r"id=([^\s]+)", line)
        if match:
            live_session_id = match.group(1)

if not seeded_session_id:
    print("LEGACY_PROMPT_REPAIR_NO_SEED_OUTPUT  duplicate-prompt seed never reached daemon subscriber")
    sys.exit(1)
if not reattached_reused:
    print("LEGACY_PROMPT_REPAIR_NO_REUSE  split/map/split did not reattach a reused PTY")
    sys.exit(1)
if not repair_write:
    print("LEGACY_PROMPT_REPAIR_NO_CTRL_L  reattached stale prompt stack did not send one-byte Ctrl-L repair")
    sys.exit(1)
if not live_session_id:
    print("LEGACY_PROMPT_REPAIR_NO_LIVE_OUTPUT  post-repair output never reached daemon subscriber")
    sys.exit(1)
if seeded_session_id != live_session_id:
    print(
        "LEGACY_PROMPT_REPAIR_SESSION_CHANGED  "
        f"seeded={seeded_session_id} live={live_session_id}"
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
    print(f"LEGACY_PROMPT_REPAIR_SNAPSHOT_FAILED  {error}")
    sys.exit(1)

text = data.decode("utf-8", "replace")
if "legacy@host:/tmp" not in text:
    print("LEGACY_PROMPT_REPAIR_SEED_PROMPT_MISSING")
    sys.exit(1)
if "TF_LEGACY_PROMPT_LIVE_OK" not in text:
    print("LEGACY_PROMPT_REPAIR_LIVE_MARKER_MISSING")
    sys.exit(1)

print("LEGACY_PROMPT_REPAIR_REUSED_PTY")
print("LEGACY_PROMPT_REPAIR_CTRL_L_SENT")
print("LEGACY_PROMPT_REPAIR_INPUT_REACHED_DAEMON")
print("LEGACY_PROMPT_REPAIR_OUTPUT_IN_SNAPSHOT")
PYEOF
VERIFY_STATUS=$?

if (( VERIFY_STATUS == 0 )); then
  BEFORE="$OUT_DIR/02-seeded-duplicate-prompt.png"
  AFTER="$OUT_DIR/05-live-after-repair-input.png"
  if [[ ! -s "$BEFORE" || ! -s "$AFTER" ]]; then
    echo "LEGACY_PROMPT_REPAIR_SCREENSHOT_MISSING" >&2
    VERIFY_STATUS=1
  else
    DIFF_PIXELS="$(magick compare -metric AE "$BEFORE" "$AFTER" null: 2>&1 || true)"
    python3 - "$DIFF_PIXELS" <<'PYEOF'
import re, sys
text = sys.argv[1]
match = re.search(r"\d+", text)
pixels = int(match.group(0)) if match else 0
if pixels < 250:
    print(f"LEGACY_PROMPT_REPAIR_VISUAL_REPAINT_TOO_SMALL  changed_pixels={pixels}")
    sys.exit(1)
print(f"LEGACY_PROMPT_REPAIR_VISUAL_REPAINT changed_pixels={pixels}")
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

echo "LEGACY_PROMPT_REPAIR_OK"
echo "=== driver.log ==="; cat "$DRIVER_LOG" 2>/dev/null
echo "=== screenshots ==="; ls -1 "$OUT_DIR"/*.png 2>/dev/null
