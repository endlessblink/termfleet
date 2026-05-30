#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_BIN="$APP_ROOT/src-tauri/target/release/terminal-workspace"
SOCKET="${XDG_RUNTIME_DIR:-/tmp}/terminal-workspace/daemon.sock"
DISPLAY_VALUE="${DISPLAY:-:0}"
XAUTHORITY_VALUE="${XAUTHORITY:-/run/user/1000/xauth_Mqgwcs}"
LOG_FILE="${TMPDIR:-/tmp}/terminal-workspace-native-vte-restart-reconnect.log"
SHOT_DIR="${TMPDIR:-/tmp}/terminal-workspace-native-vte-restart-reconnect"
MARKER="NATIVE_VTE_RECONNECT_${RANDOM}_${RANDOM}"
APP_PID=""
WINDOW_ID=""
SESSION_ID=""

cleanup() {
  if [[ -n "$APP_PID" ]]; then
    kill "$APP_PID" >/dev/null 2>&1 || true
  fi
  pkill -f "$APP_BIN" >/dev/null 2>&1 || true
  pkill -f "$APP_ROOT/src-tauri/target/release/terminal-workspace --terminal-workspace-daemon-stdio" >/dev/null 2>&1 || true
  pkill -f "terminal-workspace-daemon" >/dev/null 2>&1 || true
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
      --config '{"build":{"beforeBuildCommand":"VITE_TERMINAL_RENDERER_MODE=native-vte VITE_WORKSPACE_MODE=split npm run build"}}'
) >"$LOG_FILE" 2>&1

send_daemon_json() {
  local json="$1"
  printf '%s' "$json" | nc -U "$SOCKET"
}

launch_app() {
  WINDOW_ID=""
  DISPLAY="$DISPLAY_VALUE" \
    XAUTHORITY="$XAUTHORITY_VALUE" \
    TERMINAL_WORKSPACE_TRACE_LATENCY=1 \
    "$APP_BIN" >>"$LOG_FILE" 2>&1 &
  APP_PID=$!

  for _ in {1..120}; do
    WINDOW_ID="$(
      DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" wmctrl -l |
        awk '/Terminal Workspace/ { print $1; exit }'
    )"
    if [[ -n "$WINDOW_ID" ]]; then
      DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool windowsize "$WINDOW_ID" 1440 920
      DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool windowactivate "$WINDOW_ID"
      return 0
    fi
    sleep 0.25
  done

  echo "Native VTE restart verifier could not find the Terminal Workspace window." >&2
  tail -100 "$LOG_FILE" >&2 || true
  exit 1
}

wait_for_attach() {
  local previous_count="$1"
  for _ in {1..120}; do
    local count
    count="$(grep -c "native-terminal-vte-attached" "$LOG_FILE" 2>/dev/null || true)"
    if (( count > previous_count )); then
      grep "native-terminal-vte-attached" "$LOG_FILE" |
        tail -1 |
        sed -n 's/.*session_id=\([^ ]*\).*/\1/p'
      return 0
    fi
    sleep 0.25
  done

  echo "Native VTE restart verifier did not observe a new native attachment." >&2
  tail -140 "$LOG_FILE" >&2 || true
  exit 1
}

capture() {
  local name="$1"
  DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" import -window "$WINDOW_ID" "$SHOT_DIR/$name.png" || true
}

type_into_terminal() {
  local text="$1"
  DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool windowactivate "$WINDOW_ID"
  sleep 0.2
  DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool mousemove --window "$WINDOW_ID" 820 185 click --clearmodifiers 1
  sleep 0.3
  DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool type --clearmodifiers --delay 5 "$text"
  DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool key Return
}

wait_for_snapshot_text() {
  local session_id="$1"
  local needle="$2"
  for _ in {1..80}; do
    local snapshot
    snapshot="$(send_daemon_json "$(printf '{"type":"snapshotSession","id":"%s"}' "$session_id")" 2>/dev/null || true)"
    if grep -q "$needle" <<<"$snapshot"; then
      return 0
    fi
    sleep 0.25
  done

  echo "Native VTE restart verifier did not find '$needle' in daemon snapshot for $session_id." >&2
  tail -160 "$LOG_FILE" >&2 || true
  exit 1
}

launch_app
initial_attach_count="$(grep -c "native-terminal-vte-attached" "$LOG_FILE" 2>/dev/null || true)"
SESSION_ID="$(wait_for_attach 0)"
if [[ -z "$SESSION_ID" ]]; then
  echo "Could not parse native VTE session id from attach log." >&2
  tail -160 "$LOG_FILE" >&2 || true
  exit 1
fi
sleep 0.75
capture "01-initial"

type_into_terminal "export TW_NATIVE_RECONNECT_MARKER=$MARKER"
wait_for_snapshot_text "$SESSION_ID" "TW_NATIVE_RECONNECT_MARKER"
capture "02-marker-exported"

kill "$APP_PID" >/dev/null 2>&1 || true
APP_PID=""
sleep 1

if ! send_daemon_json '{"type":"status"}' 2>/dev/null | grep -q '"externalDaemon"'; then
  echo "Native VTE restart verifier: daemon did not survive app shutdown." >&2
  tail -160 "$LOG_FILE" >&2 || true
  exit 1
fi

launch_app
reattached_session="$(wait_for_attach "$initial_attach_count")"
sleep 0.75
capture "03-restarted"

if [[ "$reattached_session" != "$SESSION_ID" ]]; then
  echo "Native VTE restart verifier reattached to a different session." >&2
  echo "before=$SESSION_ID after=$reattached_session" >&2
  tail -180 "$LOG_FILE" >&2 || true
  exit 1
fi

type_into_terminal 'echo $TW_NATIVE_RECONNECT_MARKER'
wait_for_snapshot_text "$SESSION_ID" "$MARKER"
capture "04-marker-after-restart"

echo "Native VTE restart reconnect passed; session=$SESSION_ID marker=$MARKER screenshots=$SHOT_DIR"
