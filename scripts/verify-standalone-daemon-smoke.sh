#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TAURI_ROOT="$APP_ROOT/src-tauri"
OUT_DIR="${STANDALONE_DAEMON_OUT:-/tmp/tw-standalone-daemon-smoke}"
RUN_DIR="$OUT_DIR/run"
DATA_DIR="$OUT_DIR/data"
CARGO_TARGET_DIR="$OUT_DIR/target"
APP_BIN="$CARGO_TARGET_DIR/release/terminal-workspace"
SOCKET="$RUN_DIR/terminal-workspace/daemon.sock"
APP_LOG="$OUT_DIR/app.log"
DRIVER_LOG="$OUT_DIR/driver.log"
DISPLAY_VALUE="${DISPLAY:-:0}"
XAUTHORITY_VALUE="${XAUTHORITY:-/run/user/1000/xauth_Mqgwcs}"
NEEDLE="STANDALONE_CLIP_OK_680"
RESTART_NEEDLE="STANDALONE_RECONNECT_OK_681"
COLD_RESTORE_NEEDLE="STANDALONE_COLD_RESTORE_OK_682"
WINDOW_ID=""
APP_PID=""
DAEMON_PID=""

mkdir -p "$OUT_DIR" "$RUN_DIR" "$DATA_DIR"
chmod 700 "$RUN_DIR"
: >"$DRIVER_LOG"

log() {
  printf '[standalone-daemon] %s\n' "$*" | tee -a "$DRIVER_LOG" >&2
}

tail_app_log() {
  if [[ -f "$APP_LOG" ]]; then
    log "app log tail ($APP_LOG):"
    tail -80 "$APP_LOG" >&2 || true
  else
    log "app log missing: $APP_LOG"
  fi
}

if [[ -z "${STANDALONE_DAEMON_INNER:-}" ]]; then
  rm -rf "$RUN_DIR" "$DATA_DIR"
  mkdir -p "$RUN_DIR" "$DATA_DIR"
  chmod 700 "$RUN_DIR"
  exec xvfb-run -a -s "-screen 0 1600x1000x24" \
    env \
      STANDALONE_DAEMON_INNER=1 \
      STANDALONE_DAEMON_OUT="$OUT_DIR" \
      XDG_RUNTIME_DIR="$RUN_DIR" \
      XDG_DATA_HOME="$DATA_DIR" \
      bash "${BASH_SOURCE[0]}" "$@"
fi

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

log "building standalone release app in private target $CARGO_TARGET_DIR"
(
  cd "$APP_ROOT"
  CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-1}" \
  CARGO_TARGET_DIR="$CARGO_TARGET_DIR" \
    npm run tauri -- build --no-bundle \
      --config '{"build":{"beforeBuildCommand":"npm run build"}}'
)

if [[ ! -x "$APP_BIN" ]]; then
  echo "Missing release app binary after standalone build: $APP_BIN" >&2
  exit 1
fi
log "using release app binary $APP_BIN"

launch_app() {
  WINDOW_ID=""
  : >"$APP_LOG"
  log "launching app with private XDG runtime $RUN_DIR"
  DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" XDG_RUNTIME_DIR="$RUN_DIR" XDG_DATA_HOME="$DATA_DIR" "$APP_BIN" >"$APP_LOG" 2>&1 &
  APP_PID=$!

  for _ in {1..50}; do
    if ! kill -0 "$APP_PID" >/dev/null 2>&1; then
      log "app process exited before a window appeared"
      tail_app_log
      return 1
    fi
    WINDOW_ID="$(
      DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" wmctrl -l 2>/dev/null |
        awk '/Terminal Workspace/ { print $1; exit }' || true
    )"
    if [[ -z "$WINDOW_ID" ]]; then
      WINDOW_ID="$(
        DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" \
          xdotool search --name "Terminal Workspace" 2>/dev/null | head -1 || true
      )"
    fi
    if [[ -n "$WINDOW_ID" ]]; then
      return 0
    fi
    sleep 0.2
  done

  echo "Could not find Terminal Workspace window." >&2
  tail_app_log
  return 1
}

wait_for_daemon() {
  log "waiting for daemon socket $SOCKET"
  for _ in {1..50}; do
    status_json="$(printf '{"type":"status"}' | nc -U "$SOCKET" 2>/dev/null || true)"
    if grep -q '"externalDaemon"' <<<"$status_json"; then
      DAEMON_PID="$(grep -o '"pid":[0-9]*' <<<"$status_json" | cut -d: -f2)"
      log "daemon is running as pid ${DAEMON_PID:-unknown}"
      return 0
    fi
    sleep 0.2
  done

  echo "App did not auto-launch the daemon at $SOCKET." >&2
  tail_app_log
  return 1
}

wait_for_daemon_down() {
  log "waiting for daemon socket to go down"
  for _ in {1..50}; do
    status_json="$(printf '{"type":"status"}' | nc -U "$SOCKET" 2>/dev/null || true)"
    if ! grep -q '"externalDaemon"' <<<"$status_json"; then
      return 0
    fi
    sleep 0.2
  done

  echo "Daemon socket stayed reachable after daemon kill." >&2
  return 1
}

focus_terminal_section() {
  log "focusing terminal section in window $WINDOW_ID"
  DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool windowactivate "$WINDOW_ID" 2>/dev/null || true
  sleep 0.5
  DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool mousemove --window "$WINDOW_ID" 24 116 click 1 || return 1
  sleep 0.8
  DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool mousemove --window "$WINDOW_ID" 238 209 click 1 || return 1
  sleep 1.0
}

paste_command() {
  local needle="$1"
  local command="echo $needle"
  log "typing marker command $needle"
  DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool windowactivate "$WINDOW_ID" 2>/dev/null || true
  sleep 0.2
  DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool mousemove --window "$WINDOW_ID" 820 185 click 1 || return 1
  sleep 0.4
  DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool key --clearmodifiers ctrl+u || return 1
  sleep 0.2
  DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool type --clearmodifiers --delay 0 "$command" || return 1
  sleep 0.2
  DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" xdotool key --clearmodifiers Return || return 1
}

find_session_with_output() {
  local needle="$1"
  local required_id="${2:-}"

  log "searching daemon scrollback for $needle"
  for _ in {1..40}; do
    sessions_json="$(printf '{"type":"listSessions"}' | nc -U "$SOCKET" 2>/dev/null || true)"
    while IFS= read -r id; do
      if [[ -n "$required_id" && "$id" != "$required_id" ]]; then
        continue
      fi
      snapshot="$(printf '{"type":"snapshotSession","id":"%s"}' "$id" | nc -U "$SOCKET" 2>/dev/null || true)"
      if grep -q "$needle" <<<"$snapshot"; then
        log "found marker in session $id"
        printf '%s' "$id"
        return 0
      fi
    done < <(grep -o '"id":"[^"]*"' <<<"$sessions_json" | cut -d'"' -f4)
    sleep 0.25
  done

  return 1
}

capture_failure() {
  if [[ -n "$WINDOW_ID" ]]; then
    DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" import -window "$WINDOW_ID" "$OUT_DIR/failure.png" || true
    echo "Failure screenshot: $OUT_DIR/failure.png" >&2
  else
    echo "No window id available for failure screenshot." >&2
  fi
  tail_app_log
  echo "Driver log: $DRIVER_LOG" >&2
}

capture_window() {
  local file="$1"
  if [[ -z "$WINDOW_ID" ]]; then
    echo "No window id available for screenshot $file." >&2
    return 1
  fi
  DISPLAY="$DISPLAY_VALUE" XAUTHORITY="$XAUTHORITY_VALUE" import -window "$WINDOW_ID" "$OUT_DIR/$file" || return 1
}

assert_terminal_image_signal() {
  local file="$1"
  local label="$2"
  local path="$OUT_DIR/$file"
  if [[ ! -s "$path" ]]; then
    echo "STANDALONE_RESTART_SCREENSHOT_MISSING  $label $path" >&2
    return 1
  fi
  local metrics
  metrics="$(magick "$path" -crop 1050x680+300+80 -colorspace Gray -format '%[mean] %[standard-deviation]' info: 2>/dev/null)" || {
    echo "STANDALONE_RESTART_IMAGE_METRICS_FAILED  $label $path" >&2
    return 1
  }
  python3 - "$label" "$metrics" <<'PYEOF'
import sys
label = sys.argv[1]
mean, sd = (float(part) for part in sys.argv[2].split())
if mean < 1000 or sd < 1200:
    print(f"STANDALONE_RESTART_VISUAL_BLANK_OR_FLAT  {label} mean={mean:.1f} sd={sd:.1f}", file=sys.stderr)
    sys.exit(1)
print(f"STANDALONE_RESTART_VISUAL_CONTENT  {label} mean={mean:.1f} sd={sd:.1f}")
PYEOF
}

assert_visual_change() {
  local before="$OUT_DIR/$1"
  local after="$OUT_DIR/$2"
  local label="$3"
  if [[ ! -s "$before" || ! -s "$after" ]]; then
    echo "STANDALONE_RESTART_VISUAL_CHANGE_SCREENSHOT_MISSING  $label" >&2
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
    print(f"STANDALONE_RESTART_VISUAL_CHANGE_TOO_SMALL  {label} changed_pixels={pixels}", file=sys.stderr)
    sys.exit(1)
print(f"STANDALONE_RESTART_VISUAL_REPAINT  {label} changed_pixels={pixels}")
PYEOF
}

launch_app
wait_for_daemon
if ! focus_terminal_section; then
  capture_failure
  echo "Standalone daemon smoke could not focus the terminal section." >&2
  exit 1
fi
if ! paste_command "$NEEDLE"; then
  capture_failure
  echo "Standalone daemon smoke could not type into the terminal." >&2
  exit 1
fi

SESSION_ID="$(find_session_with_output "$NEEDLE" || true)"
if [[ -z "$SESSION_ID" ]]; then
  capture_failure
  echo "Standalone daemon smoke did not find $NEEDLE in daemon scrollback." >&2
  exit 1
fi
sleep 0.8
if ! capture_window "01-before-app-restart.png"; then
  capture_failure
  echo "Standalone daemon smoke could not capture before-restart visual evidence." >&2
  exit 1
fi
if ! assert_terminal_image_signal "01-before-app-restart.png" "before-app-restart"; then
  capture_failure
  exit 1
fi

log "stopping app process $APP_PID while daemon remains alive"
kill "$APP_PID" >/dev/null 2>&1 || true
APP_PID=""
sleep 0.6

if ! printf '{"type":"status"}' | nc -U "$SOCKET" | grep -q '"externalDaemon"'; then
  echo "Daemon did not survive app restart." >&2
  exit 1
fi

launch_app
wait_for_daemon
if ! focus_terminal_section; then
  capture_failure
  echo "Standalone daemon smoke could not focus after app restart." >&2
  exit 1
fi
if ! paste_command "$RESTART_NEEDLE"; then
  capture_failure
  echo "Standalone daemon smoke could not type after app restart." >&2
  exit 1
fi
sleep 0.8
if ! capture_window "02-after-app-restart.png"; then
  capture_failure
  echo "Standalone daemon smoke could not capture after-restart visual evidence." >&2
  exit 1
fi
if ! assert_terminal_image_signal "02-after-app-restart.png" "after-app-restart"; then
  capture_failure
  exit 1
fi
if ! assert_visual_change "01-before-app-restart.png" "02-after-app-restart.png" "app-restart"; then
  capture_failure
  exit 1
fi

if find_session_with_output "$RESTART_NEEDLE" "$SESSION_ID" >/dev/null; then
  echo "Standalone daemon restart reattach passed for $SESSION_ID"
else
  capture_failure
  echo "Standalone daemon restart did not reconnect to $SESSION_ID." >&2
  exit 1
fi

log "stopping app and daemon to simulate daemon crash/reboot"
kill "$APP_PID" >/dev/null 2>&1 || true
APP_PID=""
sleep 0.4
if [[ -n "$DAEMON_PID" ]]; then
  kill "$DAEMON_PID" >/dev/null 2>&1 || true
fi
wait_for_daemon_down
DAEMON_PID=""
sleep 1.2

launch_app
wait_for_daemon
if ! focus_terminal_section; then
  capture_failure
  echo "Standalone daemon smoke could not focus after daemon cold restore." >&2
  exit 1
fi
sleep 1.0
if ! capture_window "03-after-daemon-restart-before-input.png"; then
  capture_failure
  echo "Standalone daemon smoke could not capture cold-restore visual evidence." >&2
  exit 1
fi
if ! assert_terminal_image_signal "03-after-daemon-restart-before-input.png" "after-daemon-restart-before-input"; then
  capture_failure
  exit 1
fi
if ! find_session_with_output "$RESTART_NEEDLE" "$SESSION_ID" >/dev/null; then
  capture_failure
  echo "Standalone daemon cold restore did not replay prior marker in $SESSION_ID." >&2
  exit 1
fi

if ! paste_command "$COLD_RESTORE_NEEDLE"; then
  capture_failure
  echo "Standalone daemon smoke could not type after daemon cold restore." >&2
  exit 1
fi
sleep 0.8
if ! capture_window "04-after-daemon-restart-input.png"; then
  capture_failure
  echo "Standalone daemon smoke could not capture post-cold-restore input evidence." >&2
  exit 1
fi
if ! assert_terminal_image_signal "04-after-daemon-restart-input.png" "after-daemon-restart-input"; then
  capture_failure
  exit 1
fi
if ! assert_visual_change "03-after-daemon-restart-before-input.png" "04-after-daemon-restart-input.png" "daemon-cold-restore-input"; then
  capture_failure
  exit 1
fi
if find_session_with_output "$COLD_RESTORE_NEEDLE" "$SESSION_ID" >/dev/null; then
  echo "Standalone daemon cold restore passed for $SESSION_ID"
  echo "Standalone daemon smoke passed for $SESSION_ID"
  exit 0
fi

capture_failure
echo "Standalone daemon cold restore did not reconnect to $SESSION_ID." >&2
exit 1
