#!/usr/bin/env bash
# Live end-to-end proof that terminal keyboard shortcuts reach the PTY when a
# canvas terminal is focused — i.e. the app chrome / WebKitGTK no longer steals
# Ctrl+T, Ctrl+P, Shift+Tab, or Ctrl+W from a focused zellij.
#
# Boots the REAL Tauri app under a private Xvfb, focuses the canvas terminal,
# launches real zellij, sends the contested combos with xdotool, and asserts the
# exact VT bytes landed in the daemon's PTY-write trace:
#   Ctrl+T    -> 0x14      (zellij Tab mode)
#   Ctrl+P    -> 0x10      (zellij Pane mode)
#   Shift+Tab -> ESC [ Z   (back-tab; fixed via the Linux GTK key interceptor)
#   Ctrl+W    -> 0x17
# Machine-checkable, no OCR: TERMINAL_WORKSPACE_TRACE_PTY logs every PTY write.
set -uo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${ZJ_SHORTCUT_OUT:-/tmp/tw-zellij-keys}"
LOG_FILE="$OUT_DIR/runtime.log"
DRIVER_LOG="$OUT_DIR/driver.log"
TRACE_FILE="$OUT_DIR/pty-trace.log"
RUN_DIR="$OUT_DIR/run"
DATA_DIR="$OUT_DIR/data"
CARGO_TARGET_DIR="$OUT_DIR/target"
SOCKET="$RUN_DIR/terminal-workspace/daemon.sock"
PORT="${ZJ_SHORTCUT_PORT:-$((19000 + RANDOM % 1000))}"
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

if [[ -z "${ZJ_SHORTCUT_INNER:-}" ]]; then
  rm -f "$OUT_DIR"/*.png "$LOG_FILE" "$DRIVER_LOG" "$TRACE_FILE"
  rm -rf "$RUN_DIR" "$DATA_DIR"
  mkdir -p "$RUN_DIR" "$DATA_DIR"
  chmod 700 "$RUN_DIR"
  : > "$TRACE_FILE"
  exec xvfb-run -a -s "-screen 0 1600x1000x24" \
    env \
      ZJ_SHORTCUT_INNER=1 \
      ZJ_SHORTCUT_OUT="$OUT_DIR" \
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
  zellij delete-session tf-keytest -f >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

find_window() {
  local wait_limit=$((APP_BUDGET * 2))
  local wid=""
  for ((i = 0; i < wait_limit; i += 1)); do
    wid="$(xdotool search --name "Terminal Workspace" 2>/dev/null | tail -1 || true)"
    if [[ -n "$wid" ]] && xdotool getwindowname "$wid" >/dev/null 2>&1; then
      printf '%s' "$wid"
      return 0
    fi
    sleep 0.5
  done
  return 1
}

ensure_window() {
  local current="${1:-}"
  if [[ -n "$current" ]] && xdotool getwindowname "$current" >/dev/null 2>&1; then
    printf '%s' "$current"
    return 0
  fi
  find_window
}

shot() {
  local wid="$1"
  local name="$2"
  wid="$(ensure_window "$wid" || true)"
  if [[ -z "$wid" ]]; then
    echo "driver: no live window for screenshot $name" >>"$DRIVER_LOG"
    return 1
  fi
  import -window "$wid" "$OUT_DIR/$name" 2>>"$DRIVER_LOG" || true
}

drive() {
  local wid=""
  wid="$(find_window || true)"
  if [[ -z "$wid" ]]; then echo "driver: no window" >>"$DRIVER_LOG"; return; fi
  echo "driver: window=$wid" >>"$DRIVER_LOG"

  xdotool windowsize "$wid" 1600 1000
  xdotool windowactivate "$wid" 2>>"$DRIVER_LOG" || true
  sleep 7
  shot "$wid" "01-boot.png"

  # Focus the terminal pane and launch a throwaway zellij session.
  wid="$(ensure_window "$wid" || true)"
  if [[ -z "$wid" ]]; then echo "driver: window gone before focus" >>"$DRIVER_LOG"; return; fi
  xdotool mousemove --window "$wid" 800 500 click --clearmodifiers 1; sleep 0.5
  xdotool type --clearmodifiers --delay 14 "zellij -s tf-keytest"; xdotool key Return
  sleep 6
  shot "$wid" "02-zellij.png"
  xdotool key --clearmodifiers Return; sleep 1   # dismiss welcome/tip if present

  # Each combo is sent fresh from zellij NORMAL mode (Escape first) so it isn't
  # swallowed by a mode entered by the previous combo. A 'q'/'w' letter brackets
  # Shift+Tab to prove focus stays in the terminal across it.
  echo "=== SHORTCUT-PROBE-START ===" >> "$TRACE_FILE"

  wid="$(ensure_window "$wid" || true)"
  if [[ -z "$wid" ]]; then echo "driver: window gone before shortcut probe" >>"$DRIVER_LOG"; return; fi
  xdotool key --clearmodifiers Escape; sleep 0.4
  xdotool key --clearmodifiers ctrl+t;    sleep 1;  shot "$wid" "03-ctrl-t.png"
  xdotool key --clearmodifiers Escape;    sleep 0.6
  xdotool key --clearmodifiers ctrl+p;    sleep 1;  shot "$wid" "04-ctrl-p.png"
  xdotool key --clearmodifiers Escape;    sleep 0.6
  xdotool key --clearmodifiers q;         sleep 0.4
  xdotool key --clearmodifiers shift+Tab; sleep 0.6
  xdotool key --clearmodifiers w;         sleep 0.4
  xdotool key --clearmodifiers Escape;    sleep 0.4
  xdotool key --clearmodifiers ctrl+w;    sleep 0.8
  xdotool key --clearmodifiers Escape;    sleep 0.6
  shot "$wid" "05-after.png"

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

# Let the daemon flush the last async PTY writes, then assert with a Python
# matcher (bash grep -F mangles the \u{..} literals, causing false negatives).
sync; sleep 4
echo "=== driver.log ==="; cat "$DRIVER_LOG" 2>/dev/null

python3 - "$TRACE_FILE" <<'PYEOF'
import re, sys
lines = open(sys.argv[1], encoding="utf-8", errors="replace").read().splitlines()
mi = max((i for i, l in enumerate(lines) if "SHORTCUT-PROBE-START" in l), default=-1)
got = []
for l in lines[mi + 1:]:
    if "daemon.write.receive" in l or "pty.write.start" in l:
        m = re.search(r'data="([^"]*)"', l)
        if m:
            got.append(m.group(1))
joined = "\n".join(got)
checks = [
    ("Ctrl+T -> 0x14", r"\u{14}"),
    ("Ctrl+P -> 0x10", r"\u{10}"),
    ("Shift+Tab -> ESC[Z", r"\u{1b}[Z"),
    ("Ctrl+W -> 0x17", r"\u{17}"),
]
print("=== post-marker PTY writes ===")
for g in got:
    print("  ", repr(g))
passed = sum(1 for _, n in checks if n in joined)
for name, needle in checks:
    print(f"{'PASS' if needle in joined else 'FAIL'}  {name}  ({needle})")
print(f"=== RESULT: {passed} passed, {len(checks) - passed} failed ===")
print("ZELLIJ_SHORTCUTS_OK" if passed == len(checks) else "ZELLIJ_SHORTCUTS_FAILED")
sys.exit(0 if passed == len(checks) else 1)
PYEOF
rc=$?

echo "=== screenshots ==="; ls -1 "$OUT_DIR"/*.png 2>/dev/null
exit "$rc"
