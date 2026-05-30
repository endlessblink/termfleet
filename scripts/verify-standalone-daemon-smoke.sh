#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TAURI_ROOT="$APP_ROOT/src-tauri"
APP_BIN="$TAURI_ROOT/target/release/terminal-workspace"
SOCKET="${XDG_RUNTIME_DIR:-/tmp}/terminal-workspace/daemon.sock"
DISPLAY_VALUE="${DISPLAY:-:0}"
XAUTHORITY_VALUE="${XAUTHORITY:-/run/user/1000/xauth_Mqgwcs}"
NEEDLE="STANDALONE_CLIP_OK_680"
RESTART_NEEDLE="STANDALONE_RECONNECT_OK_681"
WINDOW_ID=""
APP_PID=""
DAEMON_PID=""

cleanup() {
  if [[ -n "$APP_PID" ]]; then
    kill "$APP_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "$DAEMON_PID" ]]; then
    kill "$DAEMON_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

if [[ ! -x "$APP_BIN" ]]; then
  echo "Missing release app binary before build: $APP_BIN" >&2
fi

(
  cd "$APP_ROOT"
  CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-1}" \
    npm run tauri -- build --no-bundle \
      --config '{"build":{"beforeBuildCommand":"npm run build"}}'
)

if [[ ! -x "$APP_BIN" ]]; then
  echo "Missing release app binary after standalone build: $APP_BIN" >&2
  exit 1
fi

launch_app() {
  WINDOW_ID=""
  DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" "$APP_BIN" &
  APP_PID=$!

  for _ in {1..50}; do
    WINDOW_ID="$(DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" wmctrl -l | awk '/Terminal Workspace/ { print $1; exit }')"
    if [[ -n "$WINDOW_ID" ]]; then
      return 0
    fi
    sleep 0.2
  done

  echo "Could not find Terminal Workspace window." >&2
  return 1
}

wait_for_daemon() {
  for _ in {1..50}; do
    status_json="$(printf '{"type":"status"}' | nc -U "$SOCKET" 2>/dev/null || true)"
    if grep -q '"externalDaemon"' <<<"$status_json"; then
      DAEMON_PID="$(grep -o '"pid":[0-9]*' <<<"$status_json" | cut -d: -f2)"
      return 0
    fi
    sleep 0.2
  done

  echo "App did not auto-launch the daemon at $SOCKET." >&2
  return 1
}

focus_terminal_section() {
  DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool windowactivate "$WINDOW_ID"
  sleep 0.5
  DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool mousemove --window "$WINDOW_ID" 24 116 click 1
  sleep 0.8
  DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool mousemove --window "$WINDOW_ID" 238 209 click 1
  sleep 1.0
}

paste_command() {
  local needle="$1"
  local command="echo $needle"
  DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool windowactivate "$WINDOW_ID"
  sleep 0.2
  DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool mousemove --window "$WINDOW_ID" 820 185 click 1
  sleep 0.4
  DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool key --clearmodifiers ctrl+u
  sleep 0.2
  DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool type --clearmodifiers --delay 0 "$command"
  sleep 0.2
  DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool key --clearmodifiers Return
}

find_session_with_output() {
  local needle="$1"
  local required_id="${2:-}"

  for _ in {1..40}; do
    sessions_json="$(printf '{"type":"listSessions"}' | nc -U "$SOCKET")"
    while IFS= read -r id; do
      if [[ -n "$required_id" && "$id" != "$required_id" ]]; then
        continue
      fi
      snapshot="$(printf '{"type":"snapshotSession","id":"%s"}' "$id" | nc -U "$SOCKET")"
      if grep -q "$needle" <<<"$snapshot"; then
        printf '%s' "$id"
        return 0
      fi
    done < <(grep -o '"id":"[^"]*"' <<<"$sessions_json" | cut -d'"' -f4)
    sleep 0.25
  done

  return 1
}

capture_failure() {
  DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" import -window "$WINDOW_ID" /tmp/terminal-workspace-standalone-daemon-smoke-failure.png || true
  echo "Failure screenshot: /tmp/terminal-workspace-standalone-daemon-smoke-failure.png" >&2
}

launch_app
wait_for_daemon
focus_terminal_section
paste_command "$NEEDLE"

SESSION_ID="$(find_session_with_output "$NEEDLE" || true)"
if [[ -z "$SESSION_ID" ]]; then
  capture_failure
  echo "Standalone daemon smoke did not find $NEEDLE in daemon scrollback." >&2
  exit 1
fi

kill "$APP_PID" >/dev/null 2>&1 || true
APP_PID=""
sleep 0.6

if ! printf '{"type":"status"}' | nc -U "$SOCKET" | grep -q '"externalDaemon"'; then
  echo "Daemon did not survive app restart." >&2
  exit 1
fi

launch_app
wait_for_daemon
focus_terminal_section
paste_command "$RESTART_NEEDLE"

if find_session_with_output "$RESTART_NEEDLE" "$SESSION_ID" >/dev/null; then
  echo "Standalone daemon smoke passed for $SESSION_ID"
  echo "Standalone daemon restart reattach passed for $SESSION_ID"
  exit 0
fi

capture_failure
echo "Standalone daemon restart did not reconnect to $SESSION_ID." >&2
exit 1
