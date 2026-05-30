#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DISPLAY_VALUE="${DISPLAY:-:0}"
XAUTHORITY_VALUE="${XAUTHORITY:-/run/user/1000/xauth_Mqgwcs}"
LOG_FILE="${TMPDIR:-/tmp}/terminal-workspace-native-vte-lifecycle.log"
SHOT_DIR="${TMPDIR:-/tmp}/terminal-workspace-native-vte-lifecycle"
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
rm -rf "$SHOT_DIR"
mkdir -p "$SHOT_DIR"
rm -f "$LOG_FILE"
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
  echo "Native VTE lifecycle verifier could not find the Terminal Workspace window." >&2
  echo "Log: $LOG_FILE" >&2
  tail -80 "$LOG_FILE" >&2 || true
  exit 1
fi

activate_window() {
  DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool windowactivate "$WINDOW_ID"
}

capture() {
  local name="$1"
  DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" import -window "$WINDOW_ID" "$SHOT_DIR/$name.png" || true
}

count_log() {
  local pattern="$1"
  grep -c "$pattern" "$LOG_FILE" 2>/dev/null || true
}

run_command() {
  local command="$1"
  activate_window
  DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool mousemove --window "$WINDOW_ID" 860 20 click --clearmodifiers 1
  sleep 0.15
  DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool key --clearmodifiers ctrl+a
  DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool type --clearmodifiers --delay 5 "$command"
  DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool key Return
}

wait_for_count_gt() {
  local pattern="$1"
  local before="$2"
  local label="$3"
  for _ in {1..100}; do
    local after
    after="$(count_log "$pattern")"
    if (( after > before )); then
      echo "$after"
      return 0
    fi
    sleep 0.2
  done
  echo "Native VTE lifecycle verifier did not observe $label." >&2
  echo "Pattern: $pattern before=$before after=$(count_log "$pattern")" >&2
  echo "Log: $LOG_FILE" >&2
  tail -160 "$LOG_FILE" >&2 || true
  exit 1
}

wait_for_attach_count() {
  local expected="$1"
  local label="$2"
  for _ in {1..120}; do
    local count
    count="$(count_log "native-terminal-vte-attached")"
    if (( count >= expected )); then
      echo "$count"
      return 0
    fi
    sleep 0.25
  done
  echo "Native VTE lifecycle verifier did not observe $label." >&2
  echo "Expected attach count: $expected actual=$(count_log "native-terminal-vte-attached")" >&2
  echo "Log: $LOG_FILE" >&2
  tail -160 "$LOG_FILE" >&2 || true
  exit 1
}

DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool windowsize "$WINDOW_ID" 1440 920
activate_window

attach_count="$(wait_for_attach_count 1 "initial native VTE attachment")"
sleep 0.5
capture "01-initial-split"

activate_window
DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool type --clearmodifiers --delay 5 "echo lifecycle-start"
DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool key Return
sleep 0.5

run_command "split right"
attach_count="$(wait_for_attach_count 2 "split-right second native VTE attachment")"
sleep 0.5
capture "02-split-right"

updates_before_resize="$(count_log "native-terminal-vte-updated")"
DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool windowsize "$WINDOW_ID" 1200 760
sleep 1
DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool windowsize "$WINDOW_ID" 1600 950
updates_after_resize="$(wait_for_count_gt "native-terminal-vte-updated" "$updates_before_resize" "native pane updates after window resize")"
unique_widths="$(
  grep "native-terminal-vte-updated" "$LOG_FILE" |
    sed -n 's/.* width=\([0-9][0-9]*\) .*/\1/p' |
    sort -u |
    wc -l
)"
if (( unique_widths < 2 )); then
  echo "Native VTE lifecycle verifier did not observe multiple pane widths after resize." >&2
  echo "unique_widths=$unique_widths log=$LOG_FILE" >&2
  tail -160 "$LOG_FILE" >&2 || true
  exit 1
fi
sleep 0.5
capture "03-after-resize"

destroy_before_map="$(count_log "native-terminal-vte-destroyed")"
run_command "map"
destroy_after_map="$(wait_for_count_gt "native-terminal-vte-destroyed" "$destroy_before_map" "native VTE destroy after map switch")"
sleep 0.75
capture "04-map-no-native-overlay"

attach_before_map_activation="$attach_count"
activate_window
DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool mousemove --window "$WINDOW_ID" 1115 392 click --clearmodifiers 1
attach_count="$(wait_for_count_gt "native-terminal-vte-attached" "$attach_before_map_activation" "native VTE reattach after activating a map terminal card")"
sleep 0.75
capture "05-returned-split"

destroy_before_close="$destroy_after_map"
run_command "close pane"
destroy_after_close="$(wait_for_count_gt "native-terminal-vte-destroyed" "$destroy_before_close" "native VTE destroy after close pane")"
sleep 0.75
capture "06-close-pane"

run_command "split right"
attach_before_reopen="$attach_count"
attach_count="$(wait_for_count_gt "native-terminal-vte-attached" "$attach_before_reopen" "native VTE reattach after close and split reopen")"
sleep 0.75
capture "07-reopen-split"

echo "Native VTE lifecycle verifier passed; attaches=$(count_log "native-terminal-vte-attached") destroys=$(count_log "native-terminal-vte-destroyed") updates=$(count_log "native-terminal-vte-updated") unique_widths=$unique_widths screenshots=$SHOT_DIR"
