#!/usr/bin/env bash
# Live proof that browser paste events honor the terminal's current bracketed
# paste mode and do not keep stale mode state after the mode is disabled.
set -uo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${BRACKETED_PASTE_OUT:-/tmp/tw-bracketed-paste}"
LOG_FILE="$OUT_DIR/runtime.log"
DRIVER_LOG="$OUT_DIR/driver.log"
TRACE_FILE="$OUT_DIR/pty-trace.log"
RUN_DIR="$OUT_DIR/run"
DATA_DIR="$OUT_DIR/data"
CARGO_TARGET_DIR="$OUT_DIR/target"
SOCKET="$RUN_DIR/terminal-workspace/daemon.sock"
PORT="${BRACKETED_PASTE_PORT:-$((20000 + RANDOM % 1000))}"
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

if [[ -z "${BRACKETED_PASTE_INNER:-}" ]]; then
  rm -f "$OUT_DIR"/*.png "$LOG_FILE" "$DRIVER_LOG" "$TRACE_FILE"
  rm -rf "$RUN_DIR" "$DATA_DIR"
  mkdir -p "$RUN_DIR" "$DATA_DIR"
  chmod 700 "$RUN_DIR"
  : > "$TRACE_FILE"
  exec xvfb-run -a -s "-screen 0 1600x1000x24" \
    env \
      BRACKETED_PASTE_INNER=1 \
      BRACKETED_PASTE_OUT="$OUT_DIR" \
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

set_clipboard() {
  local text="$1"
  printf '%s' "$text" | xclip -selection clipboard
}

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

  # Vim enables bracketed paste; Ctrl+Shift+V must send
  # ESC[200~ ... ESC[201~ to the PTY. Plain Ctrl+V is real terminal input
  # (literal insert / visual block in vim), so the verifier must not use it.
  xdotool type --clearmodifiers --delay 10 "vim -u NONE /tmp/tf-bracketed-paste.txt"
  xdotool key --clearmodifiers Return
  sleep 3
  xdotool key --clearmodifiers i
  sleep 0.5
  echo "=== BRACKETED-PASTE-VIM ===" >> "$TRACE_FILE"
  set_clipboard $'BRACKETED_ALPHA\nBRACKETED_BETA'
  xdotool key --clearmodifiers ctrl+shift+v
  sleep 1.2
  shot "$wid" "02-vim-paste.png"
  xdotool key --clearmodifiers Escape
  xdotool key --clearmodifiers ctrl+c
  xdotool key --clearmodifiers Escape
  sleep 0.4
  xdotool key --clearmodifiers colon
  sleep 0.1
  xdotool type --clearmodifiers "qa!"
  xdotool key --clearmodifiers Return
  sleep 2.0

  # Explicitly disable bracketed paste, keep the shell busy, and paste before
  # Bash can draw a new prompt and re-enable bracketed paste. This verifies that
  # mode changes from the grid stream are honored and old TUI mode does not leak
  # into the next paste.
  xdotool type --clearmodifiers --delay 10 "printf '\\033[?2004l'; sleep 4"
  xdotool key --clearmodifiers Return
  sleep 0.6
  echo "=== BRACKETED-PASTE-DISABLED ===" >> "$TRACE_FILE"
  set_clipboard $'PLAIN_ALPHA\nPLAIN_BETA'
  xdotool key --clearmodifiers ctrl+shift+v
  sleep 4.8
  shot "$wid" "03-disabled-paste.png"

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
sleep 2
echo "=== driver.log ==="; cat "$DRIVER_LOG" 2>/dev/null

python3 - "$TRACE_FILE" <<'PYEOF'
import re, sys
lines = open(sys.argv[1], encoding="utf-8", errors="replace").read().splitlines()

def segment(marker):
    start = next((i for i, line in enumerate(lines) if marker in line), -1)
    if start < 0:
        return []
    end = next((i for i in range(start + 1, len(lines)) if lines[i].startswith("===")), len(lines))
    return lines[start + 1:end]

def writes(seg):
    out = []
    for line in seg:
        if "daemon.write.receive" not in line:
            continue
        match = re.search(r'data="(.*)"$', line)
        if match:
            out.append(match.group(1))
    return "\n".join(out)

vim = writes(segment("BRACKETED-PASTE-VIM"))
disabled = writes(segment("BRACKETED-PASTE-DISABLED"))

ok = True
if r"\u{1b}[200~" not in vim or r"\u{1b}[201~" not in vim:
    print("BRACKETED_PASTE_MISSING_MARKERS_IN_VIM")
    ok = False
else:
    print("BRACKETED_PASTE_MARKERS_IN_VIM")

if "BRACKETED_ALPHA" not in vim or "BRACKETED_BETA" not in vim:
    print("BRACKETED_PASTE_VIM_PAYLOAD_MISSING")
    ok = False
else:
    print("BRACKETED_PASTE_VIM_PAYLOAD")

if r"\u{1b}[200~" in disabled or r"\u{1b}[201~" in disabled:
    print("BRACKETED_PASTE_STALE_MARKERS_AFTER_DISABLE")
    ok = False
else:
    print("BRACKETED_PASTE_NO_STALE_MARKERS_AFTER_DISABLE")

if "PLAIN_ALPHA" not in disabled or "PLAIN_BETA" not in disabled:
    print("BRACKETED_PASTE_DISABLED_PAYLOAD_MISSING")
    ok = False
else:
    print("BRACKETED_PASTE_DISABLED_PAYLOAD")

print("BRACKETED_PASTE_OK" if ok else "BRACKETED_PASTE_FAILED")
if not ok:
    print("=== vim writes ===")
    print(vim)
    print("=== disabled writes ===")
    print(disabled)
sys.exit(0 if ok else 1)
PYEOF
VERIFY_STATUS=$?
if (( VERIFY_STATUS != 0 )); then
  echo "=== trace tail ==="; tail -120 "$TRACE_FILE" 2>/dev/null
  exit "$VERIFY_STATUS"
fi

echo "=== screenshots ==="; ls -1 "$OUT_DIR"/*.png 2>/dev/null
