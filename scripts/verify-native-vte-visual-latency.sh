#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DISPLAY_VALUE="${DISPLAY:-:0}"
XAUTHORITY_VALUE="${XAUTHORITY:-/run/user/1000/xauth_Mqgwcs}"
LOG_FILE="${TMPDIR:-/tmp}/terminal-workspace-native-vte-visual-latency.log"
SCREENSHOT_FILE="${TMPDIR:-/tmp}/terminal-workspace-native-vte-visual-latency.png"
PROBE_TEXT="${TERMINAL_WORKSPACE_NATIVE_VTE_VISUAL_PROBE_TEXT:-visual-latency-probe}"
KEY_DELAY_MS="${TERMINAL_WORKSPACE_NATIVE_VTE_VISUAL_KEY_DELAY_MS:-55}"
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
rm -f "$LOG_FILE" "$SCREENSHOT_FILE"
rm -f "${TMPDIR:-/tmp}"/terminal-workspace-latency-trace-*.jsonl

(
  cd "$APP_ROOT"
  CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-1}" \
    npm run tauri -- build --features native-vte --no-bundle \
      --config '{"build":{"beforeBuildCommand":"VITE_TERMINAL_RENDERER_MODE=native-vte VITE_WORKSPACE_MODE=split VITE_WORKSPACE_RESET_STATE=1 npm run build"}}'
) >"$LOG_FILE" 2>&1

rm -f "${TMPDIR:-/tmp}"/terminal-workspace-latency-trace-*.jsonl

DISPLAY="$DISPLAY_VALUE" \
  XAUTHORITY="$XAUTHORITY_VALUE" \
  TERMINAL_WORKSPACE_TRACE_LATENCY=1 \
  "$APP_ROOT/src-tauri/target/release/terminal-workspace" >>"$LOG_FILE" 2>&1 &
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
  echo "Native VTE visual latency benchmark could not find the Terminal Workspace window." >&2
  echo "Log: $LOG_FILE" >&2
  tail -80 "$LOG_FILE" >&2 || true
  exit 1
fi

DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool windowsize "$WINDOW_ID" 1440 920
DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool windowactivate "$WINDOW_ID"

for _ in {1..120}; do
  if grep -q "native-terminal-vte-attached" "$LOG_FILE"; then
    DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool windowactivate "$WINDOW_ID"
    sleep 0.75
    DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool key --clearmodifiers ctrl+u
    sleep 0.25
    DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool type --clearmodifiers --delay "$KEY_DELAY_MS" "$PROBE_TEXT"
    sleep 1
    DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" import -window "$WINDOW_ID" "$SCREENSHOT_FILE" || true
    grep "native-terminal-vte-attached" "$LOG_FILE" | tail -1
    TERMINAL_WORKSPACE_NATIVE_VTE_REQUIRE_DRAW=1 \
      TERMINAL_WORKSPACE_NATIVE_VTE_REQUIRE_AFTER_PAINT=1 \
      node "$APP_ROOT/scripts/summarize-native-vte-latency-trace.mjs"
    echo "Native VTE visual latency benchmark passed; key_delay_ms=$KEY_DELAY_MS probe_chars=${#PROBE_TEXT} screenshot=$SCREENSHOT_FILE"
    exit 0
  fi
  sleep 0.25
done

DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" import -window "$WINDOW_ID" "$SCREENSHOT_FILE" || true
echo "Native VTE visual latency benchmark did not observe a native VTE attachment." >&2
echo "Log: $LOG_FILE" >&2
echo "Screenshot: $SCREENSHOT_FILE" >&2
tail -120 "$LOG_FILE" >&2 || true
exit 1
