#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TAURI_ROOT="$APP_ROOT/src-tauri"
PERF_MODE="${TERMINAL_WORKSPACE_PERF_MODE:-release}"
APP_BIN="${TERMINAL_WORKSPACE_APP_BIN:-$TAURI_ROOT/target/release/terminal-workspace}"
OUT_DIR="${TERMINAL_WORKSPACE_PERF_OUT:-/tmp/tw-tauri-performance}"
RUN_DIR="$OUT_DIR/run"
DATA_DIR="$OUT_DIR/data"
SOCKET="$RUN_DIR/terminal-workspace/daemon.sock"
DISPLAY_VALUE="${DISPLAY:-:0}"
XAUTHORITY_VALUE="${XAUTHORITY:-/run/user/1000/xauth_Mqgwcs}"
NEEDLE="PERF_ECHO_$(date +%s)"
BURST_NEEDLE="PERF_BURST_DONE_$RANDOM"
TYPE_NEEDLE="TYPE_LATENCY_$RANDOM"
TYPE_PREFIX="TYPE_LAST_${RANDOM}_"
TYPE_FINAL="Z"
FAST_TYPE_TEXT="FAST_TYPE_${RANDOM}_abcdefghijklmnopqrstuvwxyz_0123456789_DONE"
WINDOW_ID=""
APP_PID=""
APP_WINDOW_PID=""
DAEMON_PID=""
STRESS_PIDS=()

mkdir -p "$RUN_DIR" "$DATA_DIR"
chmod 700 "$RUN_DIR"

if [[ "$PERF_MODE" == "dev" && "${TERMINAL_WORKSPACE_ALLOW_SHARED_DEV_CLEANUP:-}" != "1" ]]; then
  echo "Dev performance mode used to launch run-dev.sh, which may clean shared local processes." >&2
  echo "Run release mode, or set TERMINAL_WORKSPACE_ALLOW_SHARED_DEV_CLEANUP=1 after ensuring no user sessions are active." >&2
  exit 1
fi

metric() {
  printf -v "$1" '%s' "$2"
  printf 'PERF %s=%s\n' "$1" "$2"
}

now_ms() {
  date +%s%3N
}

cleanup() {
  stop_cpu_stress
  if [[ -n "$APP_PID" ]]; then
    kill "$APP_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "$DAEMON_PID" ]]; then
    kill "$DAEMON_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

start_cpu_stress() {
  local workers="${TERMFLEET_PERF_STRESS_WORKERS:-2}"
  STRESS_PIDS=()
  for _ in $(seq 1 "$workers"); do
    yes TERMFLEET_CPU_STRESS >/dev/null &
    STRESS_PIDS+=("$!")
  done
  sleep 0.25
  metric cpu_stress_workers "$workers"
}

stop_cpu_stress() {
  if (( ${#STRESS_PIDS[@]} == 0 )); then
    return
  fi
  kill "${STRESS_PIDS[@]}" >/dev/null 2>&1 || true
  wait "${STRESS_PIDS[@]}" >/dev/null 2>&1 || true
  STRESS_PIDS=()
}

if [[ "$PERF_MODE" != "dev" && ! -x "$APP_BIN" ]]; then
  echo "Missing release app binary: $APP_BIN" >&2
  exit 1
fi

launch_app() {
  local start_ms
  start_ms="$(now_ms)"
  WINDOW_ID=""
  APP_WINDOW_PID=""
  if [[ "$PERF_MODE" == "dev" ]]; then
    DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" XDG_RUNTIME_DIR="$RUN_DIR" XDG_DATA_HOME="$DATA_DIR" "$APP_ROOT/run-dev.sh" &
  else
    DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" XDG_RUNTIME_DIR="$RUN_DIR" XDG_DATA_HOME="$DATA_DIR" "$APP_BIN" &
  fi
  APP_PID=$!

  for _ in {1..140}; do
    local window_line
    if [[ "$PERF_MODE" == "dev" ]]; then
      window_line="$(
        DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" wmctrl -lp |
          awk '/TermFleet/ { print; exit }'
      )"
    else
      window_line="$(
        DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" wmctrl -lp |
          awk -v pid="$APP_PID" '$3 == pid && /TermFleet/ { print; exit }'
      )"
    fi
    WINDOW_ID="$(awk '{ print $1 }' <<<"$window_line")"
    APP_WINDOW_PID="$(awk '{ print $3 }' <<<"$window_line")"
    if [[ -n "$WINDOW_ID" ]]; then
      DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool windowsize "$WINDOW_ID" 1440 920
      DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool windowactivate "$WINDOW_ID"
      metric startup_window_ms "$(( $(now_ms) - start_ms ))"
      return 0
    fi
    sleep 0.1
  done

  echo "Could not find TermFleet window for PID $APP_PID." >&2
  return 1
}

wait_for_daemon() {
  local start_ms
  start_ms="$(now_ms)"
  for _ in {1..80}; do
    status_json="$(printf '{"type":"status"}' | nc -U "$SOCKET" 2>/dev/null || true)"
    if grep -q '"externalDaemon"' <<<"$status_json"; then
      DAEMON_PID="$(grep -o '"pid":[0-9]*' <<<"$status_json" | cut -d: -f2)"
      metric daemon_ready_ms "$(( $(now_ms) - start_ms ))"
      return 0
    fi
    sleep 0.1
  done

  echo "App did not auto-launch the daemon at $SOCKET." >&2
  return 1
}

click_terminal_surface() {
  DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool windowactivate "$WINDOW_ID"
  sleep 0.15
  DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool mousemove --window "$WINDOW_ID" 24 116 click 1
  sleep 0.35
  DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool mousemove --window "$WINDOW_ID" 820 185 click 1
  sleep 0.2
}

click_map_surface() {
  DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool windowactivate "$WINDOW_ID"
  sleep 0.1
  DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool mousemove --window "$WINDOW_ID" 24 154 click 1
  sleep 0.25
}

drag_canvas() {
  DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool windowactivate "$WINDOW_ID"
  sleep 0.1
  DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool mousemove --window "$WINDOW_ID" 760 460
  DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool mousedown 1
  for _ in {1..5}; do
    DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool mousemove_relative -- 28 0
    DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool mousemove_relative -- -28 0
  done
  DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool mouseup 1
}

paste_shell() {
  local command="$1"
  DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool windowactivate "$WINDOW_ID"
  sleep 0.1
  DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool key --clearmodifiers ctrl+u
  sleep 0.05
  DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool type --clearmodifiers --delay 0 "$command"
  sleep 0.1
  DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool key --clearmodifiers Return
}

type_shell_text() {
  local text="$1"
  DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool windowactivate "$WINDOW_ID"
  sleep 0.1
  DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool key --clearmodifiers ctrl+u
  sleep 0.05
  DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool type --clearmodifiers --delay 0 "$text"
}

type_shell_text_raw() {
  local text="$1"
  DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool windowactivate "$WINDOW_ID"
  sleep 0.02
  DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool type --clearmodifiers --delay 0 "$text"
}

clear_shell_line() {
  DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool windowactivate "$WINDOW_ID"
  DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool key --clearmodifiers ctrl+u
}

find_session_with_output() {
  local needle="$1"

  sessions_json="$(printf '{"type":"listSessions"}' | nc -U "$SOCKET")"
  while IFS= read -r id; do
    snapshot="$(printf '{"type":"snapshotSession","id":"%s"}' "$id" | nc -U "$SOCKET")"
    if grep -q "$needle" <<<"$snapshot"; then
      printf '%s' "$id"
      return 0
    fi
  done < <(grep -o '"id":"[^"]*"' <<<"$sessions_json" | cut -d'"' -f4)

  return 1
}

wait_for_output() {
  local needle="$1"
  local start_ms="$2"
  local label="$3"

  for _ in {1..160}; do
    if find_session_with_output "$needle" >/dev/null; then
      metric "$label" "$(( $(now_ms) - start_ms ))"
      return 0
    fi
    sleep 0.05
  done

  echo "Did not find $needle in daemon scrollback." >&2
  echo "Recent daemon session snapshots:" >&2
  sessions_json="$(printf '{"type":"listSessions"}' | nc -U "$SOCKET" 2>/dev/null || true)"
  while IFS= read -r id; do
    snapshot="$(printf '{"type":"snapshotSession","id":"%s"}' "$id" | nc -U "$SOCKET" 2>/dev/null || true)"
    printf '%s\n' "--- session $id ---" >&2
    printf '%s\n' "$snapshot" | tail -c 1200 >&2
    printf '\n' >&2
  done < <(grep -o '"id":"[^"]*"' <<<"$sessions_json" | cut -d'"' -f4)
  return 1
}

measure_idle_process() {
  sleep 1.5
  local pid="${APP_WINDOW_PID:-$APP_PID}"
  read -r cpu rss_kb < <(ps -p "$pid" -o %cpu=,rss=)
  metric app_idle_cpu_percent "$cpu"
  metric app_rss_kb "$rss_kb"
}

max_subscribers() {
  local sessions_json
  sessions_json="$(printf '{"type":"listSessions"}' | nc -U "$SOCKET")"
  grep -o '"subscriberCount":[0-9]*' <<<"$sessions_json" |
    cut -d: -f2 |
    sort -nr |
    head -1
}

assert_le_int() {
  local name="$1"
  local value="$2"
  local limit="$3"
  if (( value > limit )); then
    echo "Performance threshold failed: $name=$value > $limit" >&2
    exit 1
  fi
}

assert_le_float() {
  local name="$1"
  local value="$2"
  local limit="$3"
  if ! awk -v value="$value" -v limit="$limit" 'BEGIN { exit(value <= limit ? 0 : 1) }'; then
    echo "Performance threshold failed: $name=$value > $limit" >&2
    exit 1
  fi
}

startup_limit_ms=3000
if [[ "$PERF_MODE" == "dev" ]]; then
  startup_limit_ms=20000
fi
fast_type_limit_ms=700
if [[ -n "${TERMINAL_WORKSPACE_TRACE_LATENCY:-}" ]]; then
  fast_type_limit_ms=1000
fi

launch_app
wait_for_daemon
click_terminal_surface
sleep 0.5
metric max_subscribers_before "$(max_subscribers || printf '0')"
click_terminal_surface

start_ms="$(now_ms)"
paste_shell "echo $NEEDLE"
wait_for_output "$NEEDLE" "$start_ms" terminal_echo_roundtrip_ms

start_ms="$(now_ms)"
type_shell_text "$TYPE_NEEDLE"
wait_for_output "$TYPE_NEEDLE" "$start_ms" typed_echo_visible_ms
clear_shell_line

type_shell_text "$TYPE_PREFIX"
wait_for_output "$TYPE_PREFIX" "$(now_ms)" typed_prefix_warmup_ms
start_ms="$(now_ms)"
type_shell_text_raw "$TYPE_FINAL"
wait_for_output "$TYPE_PREFIX$TYPE_FINAL" "$start_ms" typed_last_char_echo_ms
clear_shell_line

start_ms="$(now_ms)"
type_shell_text "$FAST_TYPE_TEXT"
wait_for_output "$FAST_TYPE_TEXT" "$start_ms" fast_type_integrity_ms
clear_shell_line

STRESS_TYPE_PREFIX="STRESS_TYPE_${RANDOM}_"
STRESS_TYPE_FINAL="Q"
start_cpu_stress
type_shell_text "$STRESS_TYPE_PREFIX"
wait_for_output "$STRESS_TYPE_PREFIX" "$(now_ms)" stressed_typed_prefix_warmup_ms
start_ms="$(now_ms)"
type_shell_text_raw "$STRESS_TYPE_FINAL"
wait_for_output "$STRESS_TYPE_PREFIX$STRESS_TYPE_FINAL" "$start_ms" stressed_typed_last_char_echo_ms
clear_shell_line
stop_cpu_stress

start_ms="$(now_ms)"
paste_shell "for i in \$(seq 1 300); do echo PERF_BURST_\$i; done; echo $BURST_NEEDLE"
wait_for_output "$BURST_NEEDLE" "$start_ms" terminal_burst_300_lines_ms

start_ms="$(now_ms)"
for _ in {1..6}; do
  click_map_surface
  click_terminal_surface
done
metric surface_toggle_6x_ms "$(( $(now_ms) - start_ms ))"
metric max_subscribers_after_toggle "$(max_subscribers || printf '0')"

click_map_surface
start_ms="$(now_ms)"
drag_canvas
metric canvas_pan_10x_ms "$(( $(now_ms) - start_ms ))"

measure_idle_process

if ! ps -p "$APP_PID" >/dev/null; then
  echo "App exited before performance checks completed." >&2
  exit 1
fi

assert_le_int startup_window_ms "$startup_window_ms" "$startup_limit_ms"
assert_le_int daemon_ready_ms "$daemon_ready_ms" 3000
assert_le_int terminal_echo_roundtrip_ms "$terminal_echo_roundtrip_ms" 2000
assert_le_int typed_echo_visible_ms "$typed_echo_visible_ms" 700
assert_le_int typed_last_char_echo_ms "$typed_last_char_echo_ms" 150
assert_le_int fast_type_integrity_ms "$fast_type_integrity_ms" "$fast_type_limit_ms"
assert_le_int stressed_typed_last_char_echo_ms "$stressed_typed_last_char_echo_ms" 350
assert_le_int terminal_burst_300_lines_ms "$terminal_burst_300_lines_ms" 2500
assert_le_int surface_toggle_6x_ms "$surface_toggle_6x_ms" 12000
assert_le_int canvas_pan_10x_ms "$canvas_pan_10x_ms" 3000
assert_le_float app_idle_cpu_percent "$app_idle_cpu_percent" 20
assert_le_int app_rss_kb "$app_rss_kb" 500000
assert_le_int max_subscribers_before "$max_subscribers_before" 1
assert_le_int max_subscribers_after_toggle "$max_subscribers_after_toggle" 1

echo "Tauri $PERF_MODE performance smoke passed."
