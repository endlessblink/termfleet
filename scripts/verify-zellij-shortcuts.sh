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
TRACE_FILE="/tmp/terminal-workspace-pty-trace.log"
APP_BUDGET="${APP_BUDGET:-150}"

mkdir -p "$OUT_DIR"

# The user-local PTY daemon outlives the app (process_group(0)) and owns the
# trace file. It MUST be dead before we truncate the trace, or a stale daemon
# keeps writing to the old inode and the run asserts against nothing.
kill_daemon() {
  pkill -9 -f "terminal-workspace-daemon" >/dev/null 2>&1 || true
  for _ in {1..20}; do
    pgrep -f "terminal-workspace-daemon" >/dev/null 2>&1 || break
    sleep 0.2
  done
}

if [[ -z "${ZJ_SHORTCUT_INNER:-}" ]]; then
  kill_daemon
  rm -f "$OUT_DIR"/*.png "$LOG_FILE" "$DRIVER_LOG" "$TRACE_FILE"
  : > "$TRACE_FILE"
  exec xvfb-run -a -s "-screen 0 1600x1000x24" \
    env ZJ_SHORTCUT_INNER=1 bash "${BASH_SOURCE[0]}" "$@"
fi

cleanup() {
  pkill -f "$APP_ROOT/src-tauri/target/debug/terminal-workspace" >/dev/null 2>&1 || true
  pkill -f "node_modules/.bin/vite --host 127.0.0.1 --port 1420" >/dev/null 2>&1 || true
  pkill -f "terminal-workspace-daemon" >/dev/null 2>&1 || true
  fuser -k 1420/tcp >/dev/null 2>&1 || true
  zellij delete-session tf-keytest -f >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

shot() { import -window "$1" "$OUT_DIR/$2" 2>>"$DRIVER_LOG" || true; }

drive() {
  local wid=""
  for _ in {1..120}; do
    wid="$(xdotool search --name "Terminal Workspace" 2>/dev/null | head -1)"
    [[ -n "$wid" ]] && break
    sleep 0.5
  done
  if [[ -z "$wid" ]]; then echo "driver: no window" >>"$DRIVER_LOG"; return; fi
  echo "driver: window=$wid" >>"$DRIVER_LOG"

  xdotool windowsize "$wid" 1600 1000; xdotool windowactivate "$wid"
  sleep 7
  shot "$wid" "01-boot.png"

  # Focus the terminal pane and launch a throwaway zellij session.
  xdotool mousemove --window "$wid" 800 500 click --clearmodifiers 1; sleep 0.5
  xdotool type --clearmodifiers --delay 14 "zellij -s tf-keytest"; xdotool key Return
  sleep 6
  shot "$wid" "02-zellij.png"
  xdotool key --clearmodifiers Return; sleep 1   # dismiss welcome/tip if present

  # Each combo is sent fresh from zellij NORMAL mode (Escape first) so it isn't
  # swallowed by a mode entered by the previous combo. A 'q'/'w' letter brackets
  # Shift+Tab to prove focus stays in the terminal across it.
  echo "=== SHORTCUT-PROBE-START ===" >> "$TRACE_FILE"

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
timeout "$APP_BUDGET" env \
  CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-1}" \
  CARGO_PROFILE_DEV_DEBUG="${CARGO_PROFILE_DEV_DEBUG:-0}" \
  LIBGL_ALWAYS_SOFTWARE=1 \
  WEBKIT_DISABLE_COMPOSITING_MODE=1 \
  WEBKIT_DISABLE_DMABUF_RENDERER=1 \
  TERMINAL_WORKSPACE_TRACE_PTY=1 \
  VITE_TERMINAL_RENDERER_MODE=canvas2d \
  VITE_WORKSPACE_MODE=split \
  VITE_WORKSPACE_RESET_STATE=1 \
  npm run tauri -- dev >"$LOG_FILE" 2>&1 </dev/null || true

wait "$DRIVER_PID" 2>/dev/null || true

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
    if "daemon.write.receive" in l:
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
