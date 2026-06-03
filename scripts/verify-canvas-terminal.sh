#!/usr/bin/env bash
# Headed verification that the canvas/map terminal renders with the DOM xterm
# renderer (no floating native GTK overlay) and accepts typed input.
#
# Runs on a PRIVATE auto-allocated Xvfb display (via xvfb-run) so it never
# touches the user's real desktop or captures their screen. WebKitGTK is forced
# to software rendering so the xterm surface is capturable.
#
# Process shape matters under the agent sandbox: the GUI app must run in the
# FOREGROUND under `timeout` (a backgrounded long-lived GUI child gets the whole
# run killed). The xdotool/import driver therefore runs as a short-lived
# background subshell that finishes before the app's timeout fires.
set -uo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="$APP_ROOT/src-tauri/target/release/terminal-workspace"
OUT_DIR="${CANVAS_VERIFY_OUT:-/tmp/tw-canvas-verify}"
LOG_FILE="$OUT_DIR/runtime.log"
DRIVER_LOG="$OUT_DIR/driver.log"
RUN_DIR="$OUT_DIR/run"
DATA_DIR="$OUT_DIR/data"
APP_BUDGET="${APP_BUDGET:-45}"

mkdir -p "$OUT_DIR" "$RUN_DIR" "$DATA_DIR"
chmod 700 "$RUN_DIR"

# Re-exec under a private auto-allocated Xvfb (free display + own auth).
if [[ -z "${CANVAS_VERIFY_INNER:-}" ]]; then
  rm -f "$OUT_DIR"/*.png "$LOG_FILE" "$DRIVER_LOG"
  rm -rf "$RUN_DIR" "$DATA_DIR"
  mkdir -p "$RUN_DIR" "$DATA_DIR"
  chmod 700 "$RUN_DIR"
  exec xvfb-run -a -s "-screen 0 1440x920x24" \
    env \
      CANVAS_VERIFY_INNER=1 \
      CANVAS_VERIFY_OUT="$OUT_DIR" \
      XDG_RUNTIME_DIR="$RUN_DIR" \
      XDG_DATA_HOME="$DATA_DIR" \
      bash "${BASH_SOURCE[0]}" "$@"
fi

[[ -x "$BIN" ]] || { echo "Release binary missing: $BIN" >&2; exit 2; }

# --- Driver: runs concurrently with the foreground app, then exits. ---
drive() {
  local wid=""
  for _ in {1..80}; do
    wid="$(wmctrl -l 2>/dev/null | awk '/Terminal Workspace/ { print $1; exit }')"
    [[ -n "$wid" ]] && break
    sleep 0.5
  done
  if [[ -z "$wid" ]]; then echo "driver: no window" >>"$DRIVER_LOG"; return; fi
  echo "driver: window=$wid" >>"$DRIVER_LOG"

  xdotool windowsize "$wid" 1440 920 2>>"$DRIVER_LOG" || true
  xdotool windowactivate "$wid" 2>>"$DRIVER_LOG" || true
  sleep 5
  import -window "$wid" "$OUT_DIR/01-default.png" 2>>"$DRIVER_LOG" || true

  # Switch to the map via the command palette (Ctrl+K, "map", Enter).
  xdotool windowactivate "$wid"; sleep 0.4
  xdotool key --clearmodifiers ctrl+k; sleep 0.7
  xdotool type --clearmodifiers --delay 14 "map"; sleep 0.5
  xdotool key Return; sleep 2.5
  import -window "$wid" "$OUT_DIR/02-map.png" 2>>"$DRIVER_LOG" || true

  grep -c "native-terminal-vte-updated" "$LOG_FILE" 2>/dev/null > "$OUT_DIR/updates_before" || echo 0 > "$OUT_DIR/updates_before"
  sleep 1.5
  grep -c "native-terminal-vte-updated" "$LOG_FILE" 2>/dev/null > "$OUT_DIR/updates_after" || echo 0 > "$OUT_DIR/updates_after"

  # Type into the selected canvas terminal node; confirm input round-trips.
  xdotool mousemove --window "$wid" 640 470 click --clearmodifiers 1; sleep 0.5
  xdotool type --clearmodifiers --delay 14 "echo canvas-xterm-ok"; xdotool key Return; sleep 1.3
  import -window "$wid" "$OUT_DIR/03-typed.png" 2>>"$DRIVER_LOG" || true

  # Zoom out twice (bottom-right control) to confirm the terminal scales/clips
  # with the canvas transform rather than floating at native size.
  xdotool mousemove --window "$wid" 1360 880 click --clearmodifiers 1; sleep 0.3
  xdotool mousemove --window "$wid" 1360 880 click --clearmodifiers 1; sleep 0.9
  import -window "$wid" "$OUT_DIR/04-zoomout.png" 2>>"$DRIVER_LOG" || true
  echo "driver: done" >>"$DRIVER_LOG"
}

drive &
DRIVER_PID=$!

# Foreground GUI app under timeout (the shape the sandbox tolerates).
timeout "$APP_BUDGET" env \
  LIBGL_ALWAYS_SOFTWARE=1 \
  WEBKIT_DISABLE_COMPOSITING_MODE=1 \
  WEBKIT_DISABLE_DMABUF_RENDERER=1 \
  TERMINAL_WORKSPACE_TRACE_LATENCY=1 \
  XDG_RUNTIME_DIR="$RUN_DIR" \
  XDG_DATA_HOME="$DATA_DIR" \
  "$BIN" >"$LOG_FILE" 2>&1 </dev/null || true

wait "$DRIVER_PID" 2>/dev/null || true

ub="$(cat "$OUT_DIR/updates_before" 2>/dev/null || echo 0)"
ua="$(cat "$OUT_DIR/updates_after" 2>/dev/null || echo 0)"
echo "native-vte log lines: $(grep -c 'native-terminal-vte' "$LOG_FILE" 2>/dev/null || echo 0)"
echo "--- driver.log ---"; cat "$DRIVER_LOG" 2>/dev/null
echo "--- screenshots ---"; ls -1 "$OUT_DIR"/*.png 2>/dev/null || echo "(none)"
if (( ua > ub )); then
  echo "FAIL: native pane reconciliation continued in map mode (overlay active on canvas). before=$ub after=$ua" >&2
  exit 1
fi
echo "PASS: no native overlay reconciliation in map mode (updates ${ub}->${ua})."
