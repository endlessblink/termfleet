#!/usr/bin/env bash
# Map-mode reproduction harness for the zellij-fragments-on-the-canvas bug.
#
# Boots the REAL Tauri app under a private Xvfb in SPLIT mode, runs real zellij at
# the FULL split-pane size (wide+tall), then switches to CANVAS (operations map)
# mode via the command palette so the SAME session reflows down into the 640x360
# map node (76x18). This is the real trigger: a fresh map-spawned zellij renders
# clean (see the first run of this harness), but a session that already emitted
# its frame at the wide split size fragments when shown on the smaller map node.
# That mirrors the user's bug (a working session viewed on the map), unlike
# verify-zellij-shortcuts.sh which only ever runs split.
#
# It is DIAGNOSTIC, not pass/fail: it prints, in order, every winsize/grid event
# from the trace so a grid-cols vs PTY-cols divergence is plainly readable:
#   grid.attach            -> headless alacritty grid attach size (app process)
#   grid.resize            -> headless grid resize       (app process)
#   daemon.ensure.receive  -> PTY spawn winsize request  (daemon process)
#   daemon.ensure.done     -> PTY spawn winsize + reused (daemon process)
#   daemon.resize.receive  -> PTY winsize (TIOCSWINSZ)   (daemon process)
# If grid cols != PTY cols at steady state, that mismatch IS the fragmentation.
set -uo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${ZJ_MAP_OUT:-/tmp/tw-zellij-map}"
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

if [[ -z "${ZJ_MAP_INNER:-}" ]]; then
  kill_daemon
  rm -f "$OUT_DIR"/*.png "$LOG_FILE" "$DRIVER_LOG" "$TRACE_FILE"
  : > "$TRACE_FILE"
  exec xvfb-run -a -s "-screen 0 1600x1000x24" \
    env ZJ_MAP_INNER=1 bash "${BASH_SOURCE[0]}" "$@"
fi

cleanup() {
  pkill -f "$APP_ROOT/src-tauri/target/debug/terminal-workspace" >/dev/null 2>&1 || true
  pkill -f "node_modules/.bin/vite --host 127.0.0.1 --port 1420" >/dev/null 2>&1 || true
  pkill -f "terminal-workspace-daemon" >/dev/null 2>&1 || true
  fuser -k 1420/tcp >/dev/null 2>&1 || true
  zellij delete-session tf-maptest -f >/dev/null 2>&1 || true
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
  sleep 8
  shot "$wid" "01-boot-split.png"

  # 1) In SPLIT mode the terminal pane fills most of the window. Click it to focus
  #    and launch real zellij at the full (wide+tall) split size.
  xdotool mousemove --window "$wid" 900 500 click --clearmodifiers 1; sleep 0.5
  echo "=== MAP-PROBE-SPLIT-ZELLIJ ===" >> "$TRACE_FILE"
  xdotool type --clearmodifiers --delay 14 "zellij -s tf-maptest"; xdotool key Return
  sleep 7
  xdotool key --clearmodifiers Return; sleep 1   # dismiss welcome/tip if present
  # Launch a FULL-SCREEN alternate-screen TUI (htop) inside zellij. This is the
  # decisive ingredient: plain scrollback reflows cleanly when shrunk to the map
  # node, but an alt-screen TUI absolutely-positions its frame for the wide size
  # (124x53) and fragments when the grid reflows to 76x18 — matching the user's
  # screenshot (a Claude Code agent TUI fragmenting on the map).
  xdotool type --clearmodifiers --delay 10 "htop"; xdotool key Return
  sleep 4
  shot "$wid" "02-split-htop.png"

  # 2) Switch to the MAP. Ctrl+K is intentionally routed to the focused terminal
  #    (terminalFocus.ts guard) so it CANNOT open the palette while the terminal
  #    is focused — verified: it types "map" straight into the shell. Click the top
  #    command bar directly to open the command menu instead, then run the Map
  #    action. Same session, reflowed into the 640x360 map node.
  echo "=== MAP-PROBE-SWITCH-TO-MAP ===" >> "$TRACE_FILE"
  xdotool mousemove --window "$wid" 800 22 click --clearmodifiers 1; sleep 1.2
  shot "$wid" "03a-palette-open.png"
  xdotool type --clearmodifiers --delay 18 "map"; sleep 1
  shot "$wid" "03-palette-map.png"
  xdotool key --clearmodifiers Return; sleep 3
  shot "$wid" "04-map-after-switch.png"
  sleep 2
  shot "$wid" "05-map-htop-settled.png"

  # 3) htop self-redraws every ~1.5s; capture another frame after it has had time
  #    to repaint at the narrow size, to distinguish a transient from a stuck frame.
  sleep 2.5
  shot "$wid" "06-map-htop-redraw.png"

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

# Let the daemon flush, then print the winsize/grid timeline for analysis.
sync; sleep 4
echo "=== driver.log ==="; cat "$DRIVER_LOG" 2>/dev/null

python3 - "$TRACE_FILE" <<'PYEOF'
import re, sys
lines = open(sys.argv[1], encoding="utf-8", errors="replace").read().splitlines()

def cols_rows(line):
    c = re.search(r"cols=(\d+)", line)
    r = re.search(r"rows=(\d+)", line)
    return (int(c.group(1)) if c else None, int(r.group(1)) if r else None)

events = []
for l in lines:
    for label in ("grid.attach", "grid.resize",
                  "daemon.ensure.receive", "daemon.ensure.done",
                  "daemon.resize.receive"):
        if label in l:
            ts = re.search(r"\[TW-PTY\]\s+(\d+)", l)
            events.append((int(ts.group(1)) if ts else 0, label, l.strip()))
            break

events.sort(key=lambda e: e[0])
print("=== winsize / grid timeline (chronological) ===")
for _, label, line in events:
    print("  ", line)

# Steady-state divergence check: last grid size vs last PTY size.
def last(label_set):
    for _, label, line in reversed(events):
        if label in label_set:
            return cols_rows(line)
    return (None, None)

grid = last({"grid.resize", "grid.attach"})
pty = last({"daemon.resize.receive", "daemon.ensure.receive", "daemon.ensure.done"})
print()
print(f"=== steady-state: grid={grid}  pty={pty} ===")
if grid[0] is not None and pty[0] is not None:
    if grid == pty:
        print(f"GRID_PTY_MATCH  (both {grid[0]}x{grid[1]} cols) -- divergence is NOT the cause; look at rendering")
    else:
        print(f"GRID_PTY_DIVERGED  grid {grid[0]} cols vs pty {pty[0]} cols -- winsize mismatch IS the fragmentation")
else:
    print("INSUFFICIENT_TRACE  (no zellij/PTY activity captured -- check focus click coords in 02-focused.png)")
PYEOF

echo "=== screenshots ==="; ls -1 "$OUT_DIR"/*.png 2>/dev/null
