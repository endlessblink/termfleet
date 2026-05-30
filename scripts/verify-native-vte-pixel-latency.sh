#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DISPLAY_VALUE="${DISPLAY:-:0}"
XAUTHORITY_VALUE="${XAUTHORITY:-/run/user/1000/xauth_Mqgwcs}"
LOG_FILE="${TMPDIR:-/tmp}/terminal-workspace-native-vte-pixel-latency.log"
REPORT_FILE="${TMPDIR:-/tmp}/terminal-workspace-native-vte-pixel-latency-report.json"
SCREENSHOT_FILE="${TMPDIR:-/tmp}/terminal-workspace-native-vte-pixel-latency.png"
FPS="${TERMINAL_WORKSPACE_NATIVE_VTE_PIXEL_FPS:-180}"
P95_LIMIT_MS="${TERMINAL_WORKSPACE_NATIVE_VTE_PIXEL_P95_LIMIT_MS:-25}"
PROBE_TEXT="${TERMINAL_WORKSPACE_NATIVE_VTE_PIXEL_PROBE_TEXT:-wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww}"
TRACE_LATENCY="${TERMINAL_WORKSPACE_NATIVE_VTE_PIXEL_TRACE_LATENCY:-0}"
APP_PID=""
WINDOW_ID=""

cleanup() {
  if [[ -n "$APP_PID" ]]; then
    kill "$APP_PID" >/dev/null 2>&1 || true
  fi
  pkill -f "$APP_ROOT/src-tauri/target/release/terminal-workspace" >/dev/null 2>&1 || true
}
trap cleanup EXIT

cleanup
rm -f "$LOG_FILE" "$REPORT_FILE" "$SCREENSHOT_FILE"
rm -f "${TMPDIR:-/tmp}"/terminal-workspace-latency-trace-*.jsonl

(
  cd "$APP_ROOT"
  CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-1}" \
    npm run tauri -- build --features native-vte --no-bundle \
      --config '{"build":{"beforeBuildCommand":"VITE_TERMINAL_RENDERER_MODE=native-vte VITE_WORKSPACE_MODE=split VITE_WORKSPACE_RESET_STATE=1 npm run build"}}'
) >"$LOG_FILE" 2>&1

rm -f "${TMPDIR:-/tmp}"/terminal-workspace-latency-trace-*.jsonl

if [[ "$TRACE_LATENCY" == "1" ]]; then
  DISPLAY="$DISPLAY_VALUE" \
    XAUTHORITY="$XAUTHORITY_VALUE" \
    TERMINAL_WORKSPACE_NATIVE_VTE_LOG_LIFECYCLE=1 \
    TERMINAL_WORKSPACE_TRACE_LATENCY=1 \
    "$APP_ROOT/src-tauri/target/release/terminal-workspace" >>"$LOG_FILE" 2>&1 &
else
  DISPLAY="$DISPLAY_VALUE" \
    XAUTHORITY="$XAUTHORITY_VALUE" \
    TERMINAL_WORKSPACE_NATIVE_VTE_LOG_LIFECYCLE=1 \
    "$APP_ROOT/src-tauri/target/release/terminal-workspace" >>"$LOG_FILE" 2>&1 &
fi
APP_PID=$!

for _ in {1..1200}; do
  WINDOW_ID="$(
    DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" wmctrl -l |
      awk '/Terminal Workspace/ { print $1; exit }'
  )"
  if [[ -n "$WINDOW_ID" ]]; then
    break
  fi
  sleep 0.25
done

if [[ -z "$WINDOW_ID" ]]; then
  echo "Native VTE pixel latency benchmark could not find the Terminal Workspace window." >&2
  echo "Log: $LOG_FILE" >&2
  tail -80 "$LOG_FILE" >&2 || true
  exit 1
fi

DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool windowsize "$WINDOW_ID" 1440 920
DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool windowactivate "$WINDOW_ID"
DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool mousemove 5 5

for _ in {1..160}; do
  if grep -q "native-terminal-vte-attached" "$LOG_FILE" &&
    grep -q "native-terminal-vte-updated" "$LOG_FILE"; then
    break
  fi
  sleep 0.25
done

if ! grep -q "native-terminal-vte-attached" "$LOG_FILE"; then
  echo "Native VTE pixel latency benchmark did not observe native attach." >&2
  tail -120 "$LOG_FILE" >&2 || true
  exit 1
fi

DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool windowactivate "$WINDOW_ID"
sleep 0.75
DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool key --clearmodifiers ctrl+u
sleep 0.15
DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool type --clearmodifiers --delay 8 "printf '\\033[?25l'"
DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool key --clearmodifiers Return
sleep 0.5
DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool key --clearmodifiers ctrl+u
sleep 0.15

eval "$(
  DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool getwindowgeometry --shell "$WINDOW_ID"
)"

last_bounds="$(
  grep "native-terminal-vte-updated" "$LOG_FILE" |
    tail -1 |
    sed -E 's/.*x=([-0-9]+) y=([-0-9]+) width=([0-9]+) height=([0-9]+).*/\1 \2 \3 \4/'
)"
read -r PANE_X PANE_Y PANE_W PANE_H <<<"$last_bounds"

CAPTURE_X=$((X + PANE_X + 184))
CAPTURE_Y=$((Y + PANE_Y + 8))
CAPTURE_W=$((PANE_W - 192))
CAPTURE_H=$((PANE_H - 16))

if (( CAPTURE_W > 180 )); then
  CAPTURE_W=180
fi
if (( CAPTURE_H > 32 )); then
  CAPTURE_H=32
fi
if (( CAPTURE_W < 160 || CAPTURE_H < 28 )); then
  echo "Native VTE pixel latency crop is unexpectedly small: ${CAPTURE_W}x${CAPTURE_H}" >&2
  echo "Window geometry: X=$X Y=$Y WIDTH=$WIDTH HEIGHT=$HEIGHT" >&2
  echo "Pane bounds: $last_bounds" >&2
  exit 1
fi

DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" import -window "$WINDOW_ID" "$SCREENSHOT_FILE" || true

python3 "$APP_ROOT/scripts/capture-native-vte-pixel-latency.py" \
  --display "$DISPLAY_VALUE" \
  --xauthority "$XAUTHORITY_VALUE" \
  --window-id "$WINDOW_ID" \
  --x "$CAPTURE_X" \
  --y "$CAPTURE_Y" \
  --width "$CAPTURE_W" \
  --height "$CAPTURE_H" \
  --fps "$FPS" \
  --chars "$PROBE_TEXT" \
  --p95-limit-ms "$P95_LIMIT_MS" \
  --report "$REPORT_FILE" \
  --debug-prefix "${TMPDIR:-/tmp}/terminal-workspace-native-vte-pixel-latency"

if [[ "$TRACE_LATENCY" == "1" ]]; then
  TERMINAL_WORKSPACE_NATIVE_VTE_REQUIRE_DRAW=1 \
    TERMINAL_WORKSPACE_NATIVE_VTE_REQUIRE_AFTER_PAINT=1 \
    node "$APP_ROOT/scripts/summarize-native-vte-latency-trace.mjs"
fi

echo "Native VTE external pixel latency benchmark passed; fps=$FPS crop=${CAPTURE_W}x${CAPTURE_H}+${CAPTURE_X},${CAPTURE_Y} p95_limit_ms=$P95_LIMIT_MS report=$REPORT_FILE screenshot=$SCREENSHOT_FILE"
