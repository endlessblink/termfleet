#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DISPLAY_VALUE="${DISPLAY:-:0}"
XAUTHORITY_VALUE="${XAUTHORITY:-/run/user/1000/xauth_Mqgwcs}"
RUNTIME_MODE="${NATIVE_VTE_RUNTIME_MODE:-dev}"
LOG_FILE="${TMPDIR:-/tmp}/terminal-workspace-native-vte-${RUNTIME_MODE}-runtime.log"
SCREENSHOT_FILE="${TMPDIR:-/tmp}/terminal-workspace-native-vte-${RUNTIME_MODE}-runtime.png"
RESYNC_SCREENSHOT_FILE="${TMPDIR:-/tmp}/terminal-workspace-native-vte-${RUNTIME_MODE}-runtime-resync.png"
SPLIT_SCREENSHOT_FILE="${TMPDIR:-/tmp}/terminal-workspace-native-vte-${RUNTIME_MODE}-runtime-split.png"
APP_PID=""
WINDOW_ID=""

cleanup() {
  if [[ -n "$APP_PID" ]]; then
    kill "$APP_PID" >/dev/null 2>&1 || true
  fi
  pkill -f "$APP_ROOT/src-tauri/target/debug/terminal-workspace" >/dev/null 2>&1 || true
  pkill -f "$APP_ROOT/src-tauri/target/release/terminal-workspace" >/dev/null 2>&1 || true
}
trap cleanup EXIT

cleanup
rm -f "$LOG_FILE" "$SCREENSHOT_FILE" "$RESYNC_SCREENSHOT_FILE" "$SPLIT_SCREENSHOT_FILE"
rm -f "${TMPDIR:-/tmp}"/terminal-workspace-latency-trace-*.jsonl

case "$RUNTIME_MODE" in
  dev)
    DISPLAY="$DISPLAY_VALUE" \
      XAUTHORITY="$XAUTHORITY_VALUE" \
      TERMINAL_WORKSPACE_TRACE_LATENCY=1 \
      VITE_TERMINAL_RENDERER_MODE=native-vte \
      VITE_WORKSPACE_MODE=split \
      VITE_WORKSPACE_RESET_STATE=1 \
      "$APP_ROOT/run-native-vte-dev.sh" >"$LOG_FILE" 2>&1 &
    ;;
  release)
    (
      cd "$APP_ROOT"
      CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-1}" \
        npm run tauri -- build --features native-vte --no-bundle \
          --config '{"build":{"beforeBuildCommand":"VITE_TERMINAL_RENDERER_MODE=native-vte VITE_WORKSPACE_MODE=split VITE_WORKSPACE_RESET_STATE=1 npm run build"}}'
    ) >"$LOG_FILE" 2>&1
    cleanup
    DISPLAY="$DISPLAY_VALUE" \
      XAUTHORITY="$XAUTHORITY_VALUE" \
      TERMINAL_WORKSPACE_TRACE_LATENCY=1 \
      "$APP_ROOT/src-tauri/target/release/terminal-workspace" >>"$LOG_FILE" 2>&1 &
    ;;
  *)
    echo "Unknown native VTE runtime mode: $RUNTIME_MODE" >&2
    exit 2
    ;;
esac
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
  echo "Native VTE runtime smoke could not find the Terminal Workspace window." >&2
  echo "Mode: $RUNTIME_MODE" >&2
  echo "Log: $LOG_FILE" >&2
  tail -80 "$LOG_FILE" >&2 || true
  exit 1
fi

DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool windowsize "$WINDOW_ID" 1440 920
DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool windowactivate "$WINDOW_ID"

for _ in {1..80}; do
  if grep -q "native-terminal-vte-attached" "$LOG_FILE"; then
    DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool windowactivate "$WINDOW_ID"
    sleep 0.5
    DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool type --clearmodifiers --delay 4 "echo native-vte-input-ok"
    DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool key Return
    sleep 0.75
    DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" import -window "$WINDOW_ID" "$SCREENSHOT_FILE" || true
    update_count_before="$(grep -c "native-terminal-vte-updated" "$LOG_FILE" || true)"
    sleep 1
    update_count_after="$(grep -c "native-terminal-vte-updated" "$LOG_FILE" || true)"
    if (( update_count_after <= update_count_before )); then
      echo "Native VTE runtime smoke did not observe continuing native pane reconciliation updates." >&2
      echo "Mode: $RUNTIME_MODE" >&2
      echo "Log: $LOG_FILE" >&2
      tail -120 "$LOG_FILE" >&2 || true
      exit 1
    fi
    attach_count_before="$(grep -c "native-terminal-vte-attached" "$LOG_FILE" || true)"
    DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool mousemove --window "$WINDOW_ID" 860 20 click --clearmodifiers 1
    DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool key --clearmodifiers ctrl+a
    DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool type --clearmodifiers --delay 4 "split right"
    DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool key Return
    for _ in {1..80}; do
      attach_count_after="$(grep -c "native-terminal-vte-attached" "$LOG_FILE" || true)"
      if (( attach_count_after > attach_count_before )); then
        break
      fi
      sleep 0.25
    done
    if (( attach_count_after <= attach_count_before )); then
      DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" import -window "$WINDOW_ID" "$SPLIT_SCREENSHOT_FILE" || true
      echo "Native VTE runtime smoke did not observe a second native VTE attachment after split right." >&2
      echo "Mode: $RUNTIME_MODE" >&2
      echo "Log: $LOG_FILE" >&2
      echo "Split failure screenshot: $SPLIT_SCREENSHOT_FILE" >&2
      tail -160 "$LOG_FILE" >&2 || true
      exit 1
    fi
    sleep 0.75
    DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool type --clearmodifiers --delay 4 "echo native-vte-split-ok"
    DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool key Return
    sleep 0.75
    DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" import -window "$WINDOW_ID" "$SPLIT_SCREENSHOT_FILE" || true
    DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" import -window "$WINDOW_ID" "$RESYNC_SCREENSHOT_FILE" || true
    grep "native-terminal-vte-attached" "$LOG_FILE" | tail -1
    grep "native-terminal-vte-updated" "$LOG_FILE" | tail -1
    node "$APP_ROOT/scripts/summarize-native-vte-latency-trace.mjs"
    echo "Native VTE $RUNTIME_MODE runtime smoke passed; screenshot=$SCREENSHOT_FILE resync_screenshot=$RESYNC_SCREENSHOT_FILE split_screenshot=$SPLIT_SCREENSHOT_FILE"
    exit 0
  fi
  sleep 0.25
done

DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" import -window "$WINDOW_ID" "$SCREENSHOT_FILE" || true
echo "Native VTE runtime smoke did not observe a native VTE attachment." >&2
echo "Mode: $RUNTIME_MODE" >&2
echo "Log: $LOG_FILE" >&2
echo "Screenshot: $SCREENSHOT_FILE" >&2
tail -120 "$LOG_FILE" >&2 || true
exit 1
