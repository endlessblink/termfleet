#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$APP_ROOT/scripts/restart-smoke-process-tree.sh"
COMMAND_PATH="${TERMFLEET_COMMAND_PATH:-${HOME}/.local/bin/termfleet}"
INSTALL_ROOT="${TERMFLEET_INSTALL_ROOT:-${XDG_DATA_HOME:-$HOME/.local/share}/termfleet}"
DESKTOP_LAUNCHER="${TERMFLEET_DESKTOP_LAUNCHER:-${HOME}/.local/bin/termfleet-desktop}"
RESTORE_SCRIPT="${TERMFLEET_RESTORE_SCRIPT:-/media/endlessblink/data/my-projects/ai-development/cc-linux-enhancments/scripts/agent-fleet/restore.py}"
WAIT_SECONDS="${TERMFLEET_RESTART_SMOKE_WAIT_SECONDS:-30}"
ARTIFACT_DIR="${TERMFLEET_RESTART_SMOKE_ARTIFACT_DIR:-}"

# Keep the installed visual smoke on a disposable display by default. Its
# private XDG runtime/data roots already isolate the daemon and workspace; a
# private Xvfb completes that boundary so the test window cannot appear on the
# operator's real desktop. Set the escape hatch only for deliberate headed
# acceptance on the current display.
if [[ -z "${TERMFLEET_RESTART_SMOKE_INNER:-}" &&
  "${TERMFLEET_RESTART_SMOKE_USE_CURRENT_DISPLAY:-0}" != "1" ]]; then
  command -v xvfb-run >/dev/null || {
    printf 'Missing restart-smoke prerequisite: xvfb-run\n' >&2
    exit 1
  }
  exec xvfb-run -a -s "-screen 0 1600x1000x24" \
    env \
      TERMFLEET_RESTART_SMOKE_INNER=1 \
      bash "${BASH_SOURCE[0]}" "$@"
fi

export DISPLAY="${DISPLAY:-:0}"

"$APP_ROOT/scripts/verify-installed-release.sh"

for command in xdotool xprop import identify tesseract pgrep fuser dbus-run-session; do
  command -v "$command" >/dev/null ||
    { printf 'Missing restart-smoke prerequisite: %s\n' "$command" >&2; exit 1; }
done
[[ -x "$DESKTOP_LAUNCHER" ]] ||
  { printf 'Desktop launcher is not executable: %s\n' "$DESKTOP_LAUNCHER" >&2; exit 1; }
[[ -f "$RESTORE_SCRIPT" ]] ||
  { printf 'Strict restore script is missing: %s\n' "$RESTORE_SCRIPT" >&2; exit 1; }

tmp_root="$(mktemp -d)"
runtime_dir="$tmp_root/runtime"
data_dir="$tmp_root/data"
state_dir="$tmp_root/state"
fake_bin="$tmp_root/bin"
app_log="$tmp_root/app.log"
screenshot="$tmp_root/termfleet.png"
socket="$runtime_dir/terminal-workspace/daemon.sock"
observed_terminals="$tmp_root/observed-terminals"
resume_marker="$tmp_root/resume-marker"
manifest="$tmp_root/fleet.toml"
session_dir="$tmp_root/session"
mkdir -m 0700 "$runtime_dir" "$data_dir" "$state_dir" "$fake_bin" "$session_dir" "$tmp_root/tmp"

cat >"$fake_bin/codex" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >"$SMOKE_RESUME_MARKER"
EOF
chmod 0755 "$fake_bin/codex"
cat >"$fake_bin/smoke-shell" <<'EOF'
#!/usr/bin/env bash
exec /bin/bash --noprofile --norc "$@"
EOF
chmod 0755 "$fake_bin/smoke-shell"
cat >"$manifest" <<EOF
[[session]]
name = "restart-smoke"
cwd = "$session_dir"
agent = "codex"
host = "terminal"
pin = "00000000-0000-0000-0000-000000000000"
EOF

terminal_pids() {
  {
    pgrep -x konsole || true
    pgrep -x xterm || true
  } | sort -u
}

before_terminals="$(terminal_pids)"
before_windows="$(xdotool search --onlyvisible --name '^TermFleet$' 2>/dev/null | sort -u || true)"
if [[ "${TERMFLEET_REQUIRE_CLEAN_VISIBLE_DESKTOP:-0}" == "1" && -n "$before_windows" ]]; then
  printf 'Visual gate refused to run with an existing visible TermFleet window: %s\n' "$before_windows" >&2
  exit 1
fi
app_pid=""
window_pid=""
watcher_pid=""
process_group_pid=""

cleanup() {
  status=$?
  set +e
  if (( status != 0 )); then
    printf 'Restart smoke failed with status=%s socket=%s window=%s marker=%s\n' \
      "$status" "$([[ -S "$socket" ]] && printf present || printf missing)" \
      "${window_id:-missing}" "$([[ -f "$resume_marker" ]] && printf present || printf missing)" >&2
    [[ -f "$app_log" ]] && tail -40 "$app_log" >&2
    [[ -f "$state_dir/termfleet/desktop-launch.log" ]] &&
      tail -40 "$state_dir/termfleet/desktop-launch.log" >&2
  fi
  termfleet_smoke_terminate_processes "$process_group_pid" "$runtime_dir" ||
    printf 'Failed to terminate every isolated runtime process.\n' >&2
  [[ -n "$watcher_pid" ]] && kill "$watcher_pid" 2>/dev/null || true
  [[ -n "$watcher_pid" ]] && wait "$watcher_pid" 2>/dev/null || true
  [[ -n "$app_pid" ]] && wait "$app_pid" 2>/dev/null || true
  rm -r -- "$tmp_root"
  return "$status"
}
trap cleanup EXIT

cleanup_on_signal() {
  signal_status="$1"
  trap - EXIT INT TERM
  cleanup
  exit "$signal_status"
}
trap 'cleanup_on_signal 130' INT
trap 'cleanup_on_signal 143' TERM

(
  while true; do
    terminal_pids >>"$observed_terminals"
    sleep 0.1
  done
) &
watcher_pid=$!

XAUTHORITY="${XAUTHORITY:-}" \
XDG_RUNTIME_DIR="$runtime_dir" \
XDG_DATA_HOME="$data_dir" \
XDG_STATE_HOME="$state_dir" \
AGENT_FLEET_CONFIG="$manifest" \
AGENT_FLEET_STATE_DIR="$state_dir/agent-fleet" \
SMOKE_RESUME_MARKER="$resume_marker" \
PATH="$fake_bin:$PATH" \
SHELL="$fake_bin/smoke-shell" \
  TERMFLEET_CMD="$COMMAND_PATH" \
  TERMFLEET_INSTALL_ROOT="$INSTALL_ROOT" \
  TERMFLEET_PRESERVE_RUNTIME_DIR=1 \
  TERMFLEET_RESTORE="$RESTORE_SCRIPT" \
TERMFLEET_TMPDIR="$tmp_root/tmp" \
setsid dbus-run-session -- "$DESKTOP_LAUNCHER" --child >"$app_log" 2>&1 &
app_pid=$!
process_group_pid=$app_pid

deadline=$((SECONDS + WAIT_SECONDS))
window_id=""
while (( SECONDS < deadline )); do
  kill -0 "$app_pid" 2>/dev/null || {
    printf 'Installed TermFleet exited before its window became ready.\n' >&2
    tail -40 "$app_log" >&2
    if [[ -f "$state_dir/termfleet/desktop-launch.log" ]]; then
      tail -40 "$state_dir/termfleet/desktop-launch.log" >&2
    fi
    exit 1
  }
  if [[ -S "$socket" ]]; then
    current_windows="$(xdotool search --onlyvisible --name '^TermFleet$' 2>/dev/null | sort -u || true)"
    window_id="$(
      comm -13 \
        <(printf '%s\n' "$before_windows" | sed '/^$/d') \
        <(printf '%s\n' "$current_windows" | sed '/^$/d') |
        head -1
    )"
    [[ -n "$window_id" && -f "$resume_marker" ]] && break
  fi
  sleep 1
done

[[ -S "$socket" ]] || { printf 'TermFleet daemon socket did not appear.\n' >&2; exit 1; }
[[ -n "$window_id" ]] || { printf 'Visible TermFleet window did not appear.\n' >&2; exit 1; }
[[ -f "$resume_marker" ]] ||
  { printf 'Strict desktop restore did not route the isolated terminal-host session into TermFleet.\n' >&2; exit 1; }
grep -qx 'resume 00000000-0000-0000-0000-000000000000' "$resume_marker" ||
  { printf 'Strict desktop restore invoked an unexpected resume command.\n' >&2; exit 1; }
window_pid="$(xdotool getwindowpid "$window_id" 2>/dev/null || true)"
wm_class="$(xprop -id "$window_id" WM_CLASS)"
grep -Fq '"termfleet", "Termfleet"' <<<"$wm_class" ||
  { printf 'TermFleet window identity cannot match its desktop icon: %s\n' "$wm_class" >&2; exit 1; }

import -silent -window "$window_id" "$screenshot"
colors="$(identify -format '%k' "$screenshot")"
[[ "$colors" =~ ^[0-9]+$ ]] && (( colors > 1 )) ||
  { printf 'TermFleet window capture is blank.\n' >&2; exit 1; }
window_exe="$(readlink -f "/proc/$window_pid/exe" 2>/dev/null || true)"
command_exe="$(readlink -f "$COMMAND_PATH")"
[[ -n "$window_pid" && "$window_exe" == "$command_exe" ]] || {
  printf 'Visible TermFleet window is stale or from the wrong release: pid=%s exe=%s expected=%s\n' \
    "$window_pid" "$window_exe" "$command_exe" >&2
  exit 1
}
if [[ "${TERMFLEET_RESTART_SMOKE_GAMIFICATION:-0}" == "1" ]]; then
  eval "$(xdotool getwindowgeometry --shell "$window_id")"
  # The trigger is in the WorkbenchHeader, not the bottom status bar. Keep the
  # default relative to the actual captured window geometry so this gate cannot
  # silently click an unrelated control when the desktop size changes.
  # The header content is centered inside the window; the trigger is not flush
  # with the right edge. Keep the default in the measured header zone while
  # allowing a future layout to override it explicitly.
  gamification_capture="${screenshot%.png}-gamification.png"
  gamification_opened=0
  for candidate_offset in 220 180 140 100 260 300; do
    click_x="${TERMFLEET_GAMIFICATION_CLICK_X:-$((X + WIDTH - candidate_offset))}"
    click_y="${TERMFLEET_GAMIFICATION_CLICK_Y:-$((Y + 25))}"
    xdotool windowactivate "$window_id"
    sleep 0.2
    xdotool mousemove "$click_x" "$click_y" click --clearmodifiers 1
    sleep 0.6
    import -silent -window root "$gamification_capture"
    if tesseract "$gamification_capture" stdout --psm 11 2>/dev/null | grep -Fq "Workstream quest"; then
      gamification_opened=1
      break
    fi
    xdotool key Escape
  done
  [[ "$gamification_opened" == "1" ]] || { printf 'Gamification trigger did not open the real panel.\n' >&2; exit 1; }
  xdotool key Escape
  sleep 1
  import -silent -window root "${screenshot%.png}-gamification-closed.png"
fi
if [[ -n "$ARTIFACT_DIR" ]]; then
  mkdir -p "$ARTIFACT_DIR"
  install -m 0644 "$screenshot" "$ARTIFACT_DIR/termfleet-installed-window.png"
  if [[ "${TERMFLEET_RESTART_SMOKE_GAMIFICATION:-0}" == "1" ]]; then
    install -m 0644 "${screenshot%.png}-gamification.png" "$ARTIFACT_DIR/termfleet-installed-window-gamification.png"
    install -m 0644 "${screenshot%.png}-gamification-closed.png" "$ARTIFACT_DIR/termfleet-installed-window-gamification-closed.png"
  fi
  import -silent -window root "$ARTIFACT_DIR/termfleet-installed-desktop.png"
fi

sleep 1
kill "$watcher_pid" 2>/dev/null || true
wait "$watcher_pid" 2>/dev/null || true
watcher_pid=""
new_terminals="$(
  comm -13 \
    <(printf '%s\n' "$before_terminals" | sed '/^$/d' | sort -u) \
    <(sed '/^$/d' "$observed_terminals" | sort -u)
)"
[[ -z "$new_terminals" ]] ||
  { printf 'TermFleet opened external terminal processes: %s\n' "$new_terminals" >&2; exit 1; }

printf 'TERMFLEET_INSTALLED_RESTART_OK pid=%s window_pid=%s exe=%s socket=%s window=%s colors=%s wm_class=termfleet/Termfleet external_terminals=0\n' \
  "$app_pid" "$window_pid" "$window_exe" "$socket" "$window_id" "$colors"
