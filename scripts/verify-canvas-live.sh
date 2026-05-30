#!/usr/bin/env bash
# Live desktop verification of the headless-VT + Canvas2D renderer (TC-017).
#
# Unlike the native-vte verifiers (which force the retired GTK path), this drives
# the PRODUCTION canvas renderer: VITE_TERMINAL_RENDERER_MODE=canvas2d so
# Terminal.tsx routes to <TerminalCanvas> in the live Tauri app. It proves the
# goal criteria with screenshots: fills its pane, reflows on resize, renders live,
# and survives real TUIs (vim/htop).
#
# Runs on a PRIVATE auto-allocated Xvfb (via xvfb-run) so it NEVER touches the
# user's real :0 desktop or captures their screen. WebKitGTK is forced to
# software rendering so the canvas surface is capturable by `import`.
#
# Process shape (matches verify-canvas-terminal.sh): the GUI app runs in the
# FOREGROUND under `timeout`; the xdotool/import driver runs as a short-lived
# background subshell that finishes before the app's timeout fires.
set -uo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${CANVAS_LIVE_OUT:-/tmp/tw-canvas-live}"
LOG_FILE="$OUT_DIR/runtime.log"
DRIVER_LOG="$OUT_DIR/driver.log"
APP_BUDGET="${APP_BUDGET:-150}"

mkdir -p "$OUT_DIR"

# Re-exec under a private auto-allocated Xvfb (free display + own auth).
if [[ -z "${CANVAS_LIVE_INNER:-}" ]]; then
  rm -f "$OUT_DIR"/*.png "$LOG_FILE" "$DRIVER_LOG"
  rm -f /tmp/terminal-workspace-latency-trace-*.jsonl
  exec xvfb-run -a -s "-screen 0 1600x1000x24" \
    env CANVAS_LIVE_INNER=1 bash "${BASH_SOURCE[0]}" "$@"
fi

cleanup() {
  pkill -f "$APP_ROOT/src-tauri/target/debug/terminal-workspace" >/dev/null 2>&1 || true
  pkill -f "node_modules/.bin/vite --host 127.0.0.1 --port 1420" >/dev/null 2>&1 || true
  fuser -k 1420/tcp >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

shot() { import -window "$1" "$OUT_DIR/$2" 2>>"$DRIVER_LOG" || true; }

# --- Driver: runs concurrently with the foreground app, then exits. ---
drive() {
  local wid=""
  for i in {1..120}; do
    wid="$(wmctrl -l 2>/dev/null | awk '/Terminal Workspace/ { print $1; exit }')"
    [[ -z "$wid" ]] && wid="$(xdotool search --name "Terminal Workspace" 2>/dev/null | head -1)"
    [[ -n "$wid" ]] && break
    if (( i % 10 == 0 )); then
      {
        echo "--- poll $i (DISPLAY=$DISPLAY) ---"
        echo "wmctrl:"; wmctrl -l 2>&1 | head
        echo "xdotool any window:"; xdotool search --name . 2>&1 | head
        echo "root tree:"; xwininfo -root -children 2>&1 | grep -iE "0x|terminal|webkit" | head
      } >>"$DRIVER_LOG"
    fi
    sleep 0.5
  done
  if [[ -z "$wid" ]]; then echo "driver: no window" >>"$DRIVER_LOG"; return; fi
  echo "driver: window=$wid" >>"$DRIVER_LOG"

  xdotool windowsize "$wid" 1600 1000 2>>"$DRIVER_LOG" || true
  xdotool windowactivate "$wid" 2>>"$DRIVER_LOG" || true
  sleep 6                                   # vite first paint + grid attach/full-sync
  shot "$wid" "01-default.png"

  # Live render + colors: focus the terminal pane and run a command.
  xdotool mousemove --window "$wid" 800 500 click --clearmodifiers 1; sleep 0.4
  xdotool type --clearmodifiers --delay 12 "ls --color=always -la /etc | head -30"
  xdotool key Return; sleep 1.5
  shot "$wid" "02-typed.png"

  # Reflow on resize: shrink, then grow. The canvas must re-fit + repaint.
  xdotool windowsize "$wid" 1000 680; sleep 1.5
  shot "$wid" "03-resized-small.png"
  xdotool windowsize "$wid" 1600 1000; sleep 1.5
  shot "$wid" "04-resized-large.png"

  # Real TUI #1: vim alternate-screen + insert text. Open a named file so vim
  # always has a buffer, and capture a frame right after launch (before any
  # insert) to confirm the alternate screen actually took over.
  xdotool mousemove --window "$wid" 1000 500 click --clearmodifiers 1; sleep 0.4
  # `-u NONE`: this machine aliases vim->Neovim+LazyVim, which self-exits on an
  # nvim version check. Bypassing the user config exercises a real editor TUI.
  xdotool type --clearmodifiers --delay 14 "vim -u NONE /tmp/canvas-vim-test.txt"; xdotool key Return; sleep 3
  shot "$wid" "05a-vim-open.png"
  xdotool key i; sleep 0.4
  xdotool type --clearmodifiers --delay 14 "hello from the canvas renderer"; sleep 0.6
  xdotool key Escape; sleep 0.6
  shot "$wid" "05-vim.png"
  xdotool type --clearmodifiers ":q!"; xdotool key Return; sleep 1

  # Real TUI #2: htop full-screen live redraw.
  xdotool mousemove --window "$wid" 1000 500 click --clearmodifiers 1; sleep 0.4
  xdotool type --clearmodifiers --delay 12 "htop"; xdotool key Return; sleep 3
  shot "$wid" "06-htop.png"
  sleep 1.5
  shot "$wid" "07-htop-live.png"        # second frame: confirms continuous redraw
  xdotool key q; sleep 0.8

  # Real TUI #3: tmux multiplexer (status bar + nested alternate-screen app).
  xdotool mousemove --window "$wid" 1000 500 click --clearmodifiers 1; sleep 0.4
  xdotool type --clearmodifiers --delay 14 "tmux new -s canvas"; xdotool key Return; sleep 2.5
  shot "$wid" "08-tmux.png"
  xdotool type --clearmodifiers --delay 14 "echo inside-tmux-pane"; xdotool key Return; sleep 1
  shot "$wid" "09-tmux-cmd.png"
  xdotool key ctrl+b; xdotool key d; sleep 1   # detach
  xdotool type --clearmodifiers "tmux kill-server"; xdotool key Return; sleep 0.5

  echo "driver: done" >>"$DRIVER_LOG"
}

drive &
DRIVER_PID=$!

# Foreground GUI app under timeout. `tauri dev` orchestrates vite (beforeDevCommand)
# + builds/runs the debug binary; the canvas2d env reaches vite via inheritance.
cd "$APP_ROOT"
timeout "$APP_BUDGET" env \
  CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-1}" \
  CARGO_PROFILE_DEV_DEBUG="${CARGO_PROFILE_DEV_DEBUG:-0}" \
  LIBGL_ALWAYS_SOFTWARE=1 \
  WEBKIT_DISABLE_COMPOSITING_MODE=1 \
  WEBKIT_DISABLE_DMABUF_RENDERER=1 \
  TERMINAL_WORKSPACE_TRACE_LATENCY=1 \
  VITE_TERMINAL_RENDERER_MODE=canvas2d \
  VITE_WORKSPACE_MODE=split \
  VITE_WORKSPACE_RESET_STATE=1 \
  npm run tauri -- dev --features native-vte >"$LOG_FILE" 2>&1 </dev/null || true

wait "$DRIVER_PID" 2>/dev/null || true

echo "=== driver.log ==="; cat "$DRIVER_LOG" 2>/dev/null
echo "=== screenshots ==="; ls -1 "$OUT_DIR"/*.png 2>/dev/null || echo "(none)"
echo "=== canvas2d routing in log ==="
grep -c "canvas2d" "$LOG_FILE" 2>/dev/null || echo 0
echo "=== native overlay log lines (should be 0 for canvas mode) ==="
grep -c "native-terminal-vte" "$LOG_FILE" 2>/dev/null || echo 0
echo "=== backend latency traces ==="
ls -1 /tmp/terminal-workspace-latency-trace-*.jsonl 2>/dev/null | wc -l
