#!/usr/bin/env bash
# Map-mode reproduction harness for the zellij-fragments-on-the-canvas bug.
#
# Boots the REAL Tauri app under a private Xvfb in SPLIT mode, runs real zellij at
# the FULL split-pane size (wide+tall), then switches to CANVAS (operations map)
# mode via the command palette so the SAME session reflows down into the map
# terminal node. This is the real trigger: a fresh map-spawned zellij renders
# clean (see the first run of this harness), but a session that already emitted
# its frame at the wide split size fragments when shown on the smaller map node.
# That mirrors the user's bug (a working session viewed on the map), unlike
# verify-zellij-shortcuts.sh which only ever runs split.
#
# It is a pass/fail regression gate: it prints, in order, every winsize/grid
# event from the trace so a grid-cols vs PTY-cols divergence is plainly readable:
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
TRACE_FILE="$OUT_DIR/pty-trace.log"
RUN_DIR="$OUT_DIR/run"
DATA_DIR="$OUT_DIR/data"
CARGO_TARGET_DIR="$OUT_DIR/target"
SOCKET="$RUN_DIR/terminal-workspace/daemon.sock"
PORT="${ZJ_MAP_PORT:-$((18000 + RANDOM % 1000))}"
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

if [[ -z "${ZJ_MAP_INNER:-}" ]]; then
  rm -f "$OUT_DIR"/*.png "$LOG_FILE" "$DRIVER_LOG" "$TRACE_FILE"
  rm -rf "$RUN_DIR" "$DATA_DIR"
  mkdir -p "$RUN_DIR" "$DATA_DIR"
  chmod 700 "$RUN_DIR"
  : > "$TRACE_FILE"
  exec xvfb-run -a -s "-screen 0 1600x1000x24" \
    env \
      ZJ_MAP_INNER=1 \
      ZJ_MAP_OUT="$OUT_DIR" \
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
  zellij delete-session tf-maptest -f >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

shot() { import -window "$1" "$OUT_DIR/$2" 2>>"$DRIVER_LOG" || true; }

drive() {
  local wid=""
  local wait_limit=$((APP_BUDGET * 2))
  for ((i = 0; i < wait_limit; i += 1)); do
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

  # 4) Zoom churn must remain a visual viewport operation. It must not trigger
  #    grid.resize / daemon.resize for the selected zellij/tmux alt-screen PTY.
  echo "=== MAP-PROBE-ZOOM-CHURN ===" >> "$TRACE_FILE"
  for _ in 1 2 3 4; do
    xdotool mousemove --window "$wid" 1348 944 click --clearmodifiers 1; sleep 0.12
    xdotool mousemove --window "$wid" 1460 944 click --clearmodifiers 1; sleep 0.12
  done
  sleep 1
  shot "$wid" "06a-map-after-zoom-churn.png"

  # 5) Prove the selected map terminal still owns input at readable zoom. Below
  # 100% zoom, map terminals intentionally render a state/shape preview instead
  # of a blurry downscaled live canvas. First click the preview/node to focus it
  # back to 100%, then click the live terminal body and send one key; the trace
  # parser below requires both a TUI mouse report from the click and a
  # daemon.write after this marker.
  echo "=== MAP-PROBE-MAP-INPUT ===" >> "$TRACE_FILE"
  xdotool mousemove --window "$wid" 760 190 click --clearmodifiers 1; sleep 1.2
  shot "$wid" "06b-map-focused-readable.png"
  xdotool mousemove --window "$wid" 900 500 click --clearmodifiers 1; sleep 0.4
  xdotool key --clearmodifiers q; sleep 1
  shot "$wid" "07-map-after-input.png"

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
input_marker = None
zoom_marker = None
map_input_write = False
map_mouse_report_write = False
zoom_resize_events = []
for l in lines:
    if "MAP-PROBE-MAP-INPUT" in l:
        input_marker = len(events)
    if "MAP-PROBE-ZOOM-CHURN" in l:
        zoom_marker = len(events)
    for label in ("grid.attach", "grid.resize",
                  "daemon.ensure.receive", "daemon.ensure.done",
                  "daemon.resize.receive", "daemon.write.receive",
                  "daemon.input_stream.receive"):
        if label in l:
            ts = re.search(r"\[TW-PTY\]\s+(\d+)", l)
            events.append((int(ts.group(1)) if ts else 0, label, l.strip()))
            if zoom_marker is not None and input_marker is None and label in {"grid.resize", "daemon.resize.receive"}:
                zoom_resize_events.append(l.strip())
            if input_marker is not None and label in {"daemon.write.receive", "daemon.input_stream.receive", "pty.write.start"}:
                map_input_write = True
                if "[<" in l:
                    map_mouse_report_write = True
            break
    if input_marker is not None and "pty.write.start" in l:
        map_input_write = True
        if "[<" in l:
            map_mouse_report_write = True

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
        if map_input_write:
            print("MAP_INPUT_REACHED_DAEMON  selected map terminal accepted input")
        else:
            print("MAP_INPUT_MISSING  selected map terminal did not send input to daemon after map click")
            sys.exit(1)
        if map_mouse_report_write:
            print("MAP_MOUSE_REPORT_REACHED_DAEMON  selected map terminal forwarded TUI mouse report bytes")
        else:
            print("MAP_MOUSE_REPORT_MISSING  selected map terminal click did not send VT mouse report bytes")
            sys.exit(1)
        if zoom_resize_events:
            print("MAP_ZOOM_CAUSED_TERMINAL_RESIZE  zoom churn triggered terminal resize events:")
            for event in zoom_resize_events:
                print("  ", event)
            sys.exit(1)
        print("MAP_ZOOM_VISUAL_ONLY  zoom churn did not resize grid/PTY")
        sys.exit(0)
    else:
        print(f"GRID_PTY_DIVERGED  grid {grid[0]} cols vs pty {pty[0]} cols -- winsize mismatch IS the fragmentation")
        sys.exit(1)
else:
    print("INSUFFICIENT_TRACE  (no zellij/PTY activity captured -- check focus click coords in 02-focused.png)")
    sys.exit(1)
PYEOF
VERIFY_STATUS=$?

assert_terminal_image_signal() {
  local file="$1"
  local label="$2"
  if [[ ! -s "$file" ]]; then
    echo "ZELLIJ_MAP_SCREENSHOT_MISSING  $label $file" >&2
    return 1
  fi
  local metrics
  metrics="$(magick "$file" -crop 760x430+520+80 -colorspace Gray -format '%[mean] %[standard-deviation]' info: 2>/dev/null)" || {
    echo "ZELLIJ_MAP_IMAGE_METRICS_FAILED  $label $file" >&2
    return 1
  }
  python3 - "$label" "$metrics" <<'PYEOF'
import sys
label = sys.argv[1]
mean, sd = (float(part) for part in sys.argv[2].split())
if mean < 1000 or sd < 3000:
    print(f"ZELLIJ_MAP_VISUAL_BLANK_OR_FLAT  {label} mean={mean:.1f} sd={sd:.1f}", file=sys.stderr)
    sys.exit(1)
print(f"ZELLIJ_MAP_VISUAL_CONTENT  {label} mean={mean:.1f} sd={sd:.1f}")
PYEOF
}

assert_visual_change() {
  local before="$1"
  local after="$2"
  local label="$3"
  if [[ ! -s "$before" || ! -s "$after" ]]; then
    echo "ZELLIJ_MAP_VISUAL_CHANGE_SCREENSHOT_MISSING  $label" >&2
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
    print(f"ZELLIJ_MAP_VISUAL_CHANGE_TOO_SMALL  {label} changed_pixels={pixels}", file=sys.stderr)
    sys.exit(1)
print(f"ZELLIJ_MAP_VISUAL_REPAINT  {label} changed_pixels={pixels}")
PYEOF
}

if (( VERIFY_STATUS == 0 )); then
  assert_terminal_image_signal "$OUT_DIR/04-map-after-switch.png" "map-after-switch" || VERIFY_STATUS=$?
fi
if (( VERIFY_STATUS == 0 )); then
  assert_terminal_image_signal "$OUT_DIR/05-map-htop-settled.png" "map-htop-settled" || VERIFY_STATUS=$?
fi
if (( VERIFY_STATUS == 0 )); then
  assert_terminal_image_signal "$OUT_DIR/06-map-htop-redraw.png" "map-htop-redraw" || VERIFY_STATUS=$?
fi
if (( VERIFY_STATUS == 0 )); then
  assert_visual_change "$OUT_DIR/05-map-htop-settled.png" "$OUT_DIR/06-map-htop-redraw.png" "htop-redraw" || VERIFY_STATUS=$?
fi
if (( VERIFY_STATUS == 0 )); then
  assert_visual_change "$OUT_DIR/06-map-htop-redraw.png" "$OUT_DIR/07-map-after-input.png" "map-input" || VERIFY_STATUS=$?
fi

if (( VERIFY_STATUS != 0 )); then
  echo "=== screenshots ==="; ls -1 "$OUT_DIR"/*.png 2>/dev/null
  exit "$VERIFY_STATUS"
fi

echo "=== screenshots ==="; ls -1 "$OUT_DIR"/*.png 2>/dev/null
