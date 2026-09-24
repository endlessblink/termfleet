#!/usr/bin/env bash
# First-launch proof for a published download, as a brand-new user would see it.
#
# Runs a TermFleet AppImage or .deb on a private Xvfb display with a throwaway
# HOME and private XDG dirs — its own background service and socket — so it
# never touches the operator's desktop, daemon, or terminals. It opens the first
# terminal the way a new user does (the sessions header button), types a marker
# command, and proves the output reached a real shell through the daemon.
#
# Usage: scripts/verify-fresh-install.sh <TermFleet_*.AppImage | TermFleet_*.deb>
# Output: /tmp/tf-fresh-install/<artifact>/ (screenshots + logs)
set -euo pipefail

ARTIFACT="$(realpath "${1:?usage: verify-fresh-install.sh <AppImage|deb>}")"
NAME="$(basename "$ARTIFACT")"
OUT_DIR="${FRESH_INSTALL_OUT:-/tmp/tf-fresh-install}/$NAME"
NEEDLE="FRESH_INSTALL_OK_$$"

log() { printf '[fresh-install] %s\n' "$*" >&2; }

if [[ -z "${FRESH_INSTALL_INNER:-}" ]]; then
  rm -rf "$OUT_DIR"
  mkdir -p "$OUT_DIR/home/.claude" "$OUT_DIR/run" "$OUT_DIR/data"
  chmod 700 "$OUT_DIR/run"
  # DISPLAY/XAUTHORITY must come from xvfb-run itself. Passing the caller's
  # values here once put the test window, clicks, and typing on the operator's
  # real desktop; the inner run refuses to start on the caller's display.
  exec xvfb-run -a -s "-screen 0 1600x1000x24" \
    env \
      FRESH_INSTALL_INNER=1 \
      FRESH_INSTALL_CALLER_DISPLAY="${DISPLAY:-none}" \
      FRESH_INSTALL_OUT="${FRESH_INSTALL_OUT:-/tmp/tf-fresh-install}" \
      PATH="$(dirname "$(command -v node)"):/usr/local/bin:/usr/bin:/bin" \
      HOME="$OUT_DIR/home" \
      SHELL=/bin/bash \
      LANG="${LANG:-C.UTF-8}" \
      XDG_RUNTIME_DIR="$OUT_DIR/run" \
      XDG_DATA_HOME="$OUT_DIR/data" \
      XDG_CONFIG_HOME="$OUT_DIR/home/.config" \
      XDG_CACHE_HOME="$OUT_DIR/home/.cache" \
      bash "${BASH_SOURCE[0]}" "$ARTIFACT"
fi

if [[ -z "${DISPLAY:-}" || "$DISPLAY" == "$FRESH_INSTALL_CALLER_DISPLAY" ]]; then
  echo "refusing to run: not on a private Xvfb display (DISPLAY=${DISPLAY:-unset})" >&2
  exit 3
fi

SOCKET="$XDG_RUNTIME_DIR/terminal-workspace/daemon.sock"
APP_PID=""
cleanup() {
  # Only this run's own processes: the app's process group and the private
  # daemon it started (found through its private socket).
  local daemon_pid
  daemon_pid="$(printf '%s\n' '{"type":"status"}' | nc -U "$SOCKET" 2>/dev/null | grep -o '"pid":[0-9]*' | head -1 | cut -d: -f2 || true)"
  [[ -n "$APP_PID" ]] && { kill -- "-$APP_PID" 2>/dev/null || kill "$APP_PID" 2>/dev/null || true; }
  if [[ -n "$daemon_pid" ]]; then kill "$daemon_pid" 2>/dev/null || true; fi
}
trap cleanup EXIT

case "$NAME" in
  *.AppImage)
    APP_CMD=(env APPIMAGE_EXTRACT_AND_RUN=1 "$ARTIFACT")
    ;;
  *.deb)
    dpkg-deb -x "$ARTIFACT" "$OUT_DIR/pkg"
    APP_CMD=("$OUT_DIR/pkg/usr/bin/terminal-workspace")
    export PATH="$OUT_DIR/pkg/usr/bin:$PATH"
    ;;
  *) echo "unsupported artifact: $NAME" >&2; exit 2 ;;
esac

log "launching $NAME with an empty profile"
setsid "${APP_CMD[@]}" >"$OUT_DIR/app.log" 2>&1 &
APP_PID=$!

WINDOW_ID=""
for _ in {1..150}; do
  kill -0 "$APP_PID" 2>/dev/null || { log "app exited before a window appeared"; tail -40 "$OUT_DIR/app.log" >&2; exit 1; }
  WINDOW_ID="$(xdotool search --name "TermFleet" 2>/dev/null | head -1 || true)"
  [[ -n "$WINDOW_ID" ]] && break
  sleep 0.2
done
[[ -n "$WINDOW_ID" ]] || { log "no TermFleet window"; tail -40 "$OUT_DIR/app.log" >&2; exit 1; }
xdotool windowsize "$WINDOW_ID" 1600 1000 2>/dev/null || true
sleep 6
import -window root "$OUT_DIR/01-first-launch.png" 2>>"$OUT_DIR/shot.log" || true
log "window up; first-launch screenshot saved"

# A new user starts their first terminal from the sessions header.
xdotool windowactivate "$WINDOW_ID" 2>/dev/null || true
xdotool mousemove --window "$WINDOW_ID" 280 28 click 1
sleep 3

for _ in {1..50}; do
  printf '%s\n' '{"type":"status"}' | nc -U "$SOCKET" 2>/dev/null | grep -q '"externalDaemon"' && break
  sleep 0.2
done
printf '%s\n' '{"type":"status"}' | nc -U "$SOCKET" 2>/dev/null | grep -q '"externalDaemon"' \
  || { log "the app did not start its background service"; tail -40 "$OUT_DIR/app.log" >&2; exit 1; }
log "background service is running on the private socket"

xdotool mousemove --window "$WINDOW_ID" 820 185 click 1
sleep 0.4
xdotool type --clearmodifiers --delay 20 "echo $NEEDLE"
xdotool key --clearmodifiers Return
sleep 2
import -window root "$OUT_DIR/02-first-command.png" 2>>"$OUT_DIR/shot.log" || true

found=""
for _ in {1..40}; do
  sessions="$(printf '%s\n' '{"type":"listSessions"}' | nc -U "$SOCKET" 2>/dev/null || true)"
  while IFS= read -r id; do
    snap="$(printf '{"type":"snapshotSession","id":"%s"}\n' "$id" | nc -U "$SOCKET" 2>/dev/null || true)"
    if grep -q "$NEEDLE" <<<"$snap"; then found="$id"; break; fi
  done < <(grep -o '"id":"[^"]*"' <<<"$sessions" | cut -d'"' -f4)
  [[ -n "$found" ]] && break
  sleep 0.25
done
[[ -n "$found" ]] || { log "typed command never reached a shell"; exit 1; }

log "first command ran in a real shell (session $found)"

# Agent status: this profile has a Claude Code config dir, so the status bar
# offers "Connect agents". Click it, prove the bundled hook got registered from a
# stable copy, then emit one real Claude hook event from inside the pane.
xdotool mousemove --window "$WINDOW_ID" 1057 988 click 1
settings="$HOME/.claude/settings.json"
hook="$XDG_DATA_HOME/termfleet/agent-hooks/termfleet-claude-status-hook.mjs"
for _ in {1..40}; do
  grep -q "$hook" "$settings" 2>/dev/null && [[ -f "$hook" ]] && break
  sleep 0.25
done
grep -q "$hook" "$settings" 2>/dev/null && [[ -f "$hook" ]] \
  || { log "Connect agents did not register the Claude hook"; exit 1; }
log "Connect agents registered the bundled Claude hook"
sleep 1
import -window root "$OUT_DIR/03-agents-connected.png" 2>>"$OUT_DIR/shot.log" || true

TASK_TEXT="Add a login page to the demo app"
event="{\"hook_event_name\":\"UserPromptSubmit\",\"session_id\":\"00000000-0000-4000-8000-00000000f1ee\",\"cwd\":\"$HOME\",\"prompt\":\"$TASK_TEXT\"}"
xdotool mousemove --window "$WINDOW_ID" 820 185 click 1
sleep 0.4
xdotool type --clearmodifiers --delay 8 "printf '%s' '$event' | node \"$hook\""
xdotool key --clearmodifiers Return
sidecar=""
for _ in {1..40}; do
  sidecar="$(grep -l "$TASK_TEXT" "$XDG_DATA_HOME"/terminal-workspace/agent-status/pane-*.json 2>/dev/null | head -1 || true)"
  [[ -n "$sidecar" ]] && break
  sleep 0.25
done
[[ -n "$sidecar" ]] || { log "the hook ran but wrote no pane status"; exit 1; }
log "hook wrote pane status $(basename "$sidecar")"
sleep 6
import -window root "$OUT_DIR/04-agent-task.png" 2>>"$OUT_DIR/shot.log" || true

echo "FRESH_INSTALL_OK $NAME screenshots=$OUT_DIR"
