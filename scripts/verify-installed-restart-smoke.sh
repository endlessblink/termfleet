#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$APP_ROOT/scripts/restart-smoke-process-tree.sh"
COMMAND_PATH="${TERMFLEET_COMMAND_PATH:-${HOME}/.local/bin/termfleet}"
INSTALL_ROOT="${TERMFLEET_INSTALL_ROOT:-${XDG_DATA_HOME:-$HOME/.local/share}/termfleet}"
DESKTOP_LAUNCHER="${TERMFLEET_DESKTOP_LAUNCHER:-${HOME}/.local/bin/termfleet-desktop}"
RESTORE_SCRIPT="${TERMFLEET_RESTORE_SCRIPT:-/media/endlessblink/data/my-projects/ai-development/cc-linux-enhancments/scripts/agent-fleet/restore.py}"
WAIT_SECONDS="${TERMFLEET_RESTART_SMOKE_WAIT_SECONDS:-30}"
SETTLE_SECONDS="${TERMFLEET_RESTART_SMOKE_SETTLE_SECONDS:-3}"
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

for command in xdotool xprop import identify compare tesseract pgrep fuser dbus-run-session; do
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
closed_sentinel_cwd="$session_dir/closed-sentinel"
open_sentinel_cwd="$session_dir/open-sentinel"
closed_sentinel_fixture_dir="$session_dir/closed-sentinel"
closed_sentinel_cwd="$HOME"
mkdir -m 0700 "$runtime_dir" "$data_dir" "$state_dir" "$fake_bin" "$session_dir" "$closed_sentinel_fixture_dir" "$open_sentinel_cwd" "$tmp_root/tmp"

cat >"$fake_bin/codex" <<'EOF'
#!/usr/bin/env bash
node -e '
  const fs = require("node:fs");
  const path = require("node:path");
  const paneId = process.env.TERMFLEET_PANE_ID || "";
  const fnv = (value) => {
    let hash = 2166136261;
    for (const char of value) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  };
  const paneHash = fnv(paneId);
  const cwdHash = fnv(process.cwd());
  const sidecar = {
    provider: "codex",
    cwd: process.cwd(),
    sessionId: "00000000-0000-0000-0000-000000000000",
    updatedAt: Date.now(),
    turnEventAt: Date.now(),
    source: "codex-user-prompt",
    mainTask: "Verify the installed terminal labels",
    mainTaskSource: "opening-request",
    userTask: "Verify the installed terminal labels",
    now: "Waiting for command",
    turn: "working",
  };
  const dir = path.join(process.env.XDG_DATA_HOME, "terminal-workspace", "agent-status");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(dir, `pane-${paneHash}.json`), JSON.stringify(sidecar));
  fs.writeFileSync(path.join(dir, `${cwdHash}.json`), JSON.stringify(sidecar));
'
printf '%s\n' "$*" >>"$SMOKE_RESUME_MARKER"
EOF
chmod 0755 "$fake_bin/codex"
cat >"$fake_bin/smoke-shell" <<'EOF'
#!/usr/bin/env bash
exec /bin/bash --noprofile --norc "$@"
EOF
chmod 0755 "$fake_bin/smoke-shell"
cat >"$manifest" <<EOF
[[session]]
name = "closed-sentinel"
cwd = "$closed_sentinel_cwd"
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
if [[ -n "$before_windows" ]]; then
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
  if [[ "${TERMFLEET_RESTART_SMOKE_KEEP_ARTIFACTS:-0}" == "1" &&
    -n "$ARTIFACT_DIR" && -s "$screenshot" ]]; then
    mkdir -p "$ARTIFACT_DIR"
    install -m 0644 "$screenshot" "$ARTIFACT_DIR/termfleet-installed-window.png"
    [[ -s "${screenshot%.png}-split-before-close.png" ]] && install -m 0644 "${screenshot%.png}-split-before-close.png" "$ARTIFACT_DIR/termfleet-installed-split-before-close.png"
    [[ -s "${screenshot%.png}-hover.png" ]] && install -m 0644 "${screenshot%.png}-hover.png" "$ARTIFACT_DIR/termfleet-installed-hover.png"
    for evidence in cockpit-snapshot.json cockpit-header-trace.jsonl; do
      if [[ -s "$data_dir/terminal-workspace/agent-status/$evidence" ]]; then
        install -m 0644 "$data_dir/terminal-workspace/agent-status/$evidence" "$ARTIFACT_DIR/$evidence"
      fi
    done
    [[ -s "$data_dir/terminal-workspace/workspace.json" ]] && install -m 0644 "$data_dir/terminal-workspace/workspace.json" "$ARTIFACT_DIR/workspace.json"
    [[ -s "$manifest" ]] && install -m 0644 "$manifest" "$ARTIFACT_DIR/fleet.toml"
    for filtered in "$tmp_root"/tmp/agent-fleet-restore-filtered-*.toml; do
      [[ -s "$filtered" ]] && install -m 0644 "$filtered" "$ARTIFACT_DIR/$(basename "$filtered")"
    done
    [[ -s "$state_dir/termfleet/desktop-launch.log" ]] && install -m 0644 "$state_dir/termfleet/desktop-launch.log" "$ARTIFACT_DIR/desktop-launch.log"
  fi
  if (( status != 0 )); then
    printf 'Restart smoke failed with status=%s socket=%s window=%s marker=%s\n' \
      "$status" "$([[ -S "$socket" ]] && printf present || printf missing)" \
      "${window_id:-missing}" "$([[ -f "$resume_marker" ]] && printf present || printf missing)" >&2
    if [[ -n "$ARTIFACT_DIR" && -s "${screenshot%.png}-gamification-beam.png" ]]; then
      mkdir -p "$ARTIFACT_DIR"
      install -m 0644 "${screenshot%.png}-gamification-beam.png" "$ARTIFACT_DIR/termfleet-installed-window-gamification-beam-failed.png"
      [[ -s "${screenshot%.png}-gamification-beam-after.png" ]] && install -m 0644 "${screenshot%.png}-gamification-beam-after.png" "$ARTIFACT_DIR/termfleet-installed-window-gamification-beam-after-failed.png"
    fi
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
grep -Fxq 'resume 00000000-0000-0000-0000-000000000000' "$resume_marker" ||
  { printf 'Strict desktop restore invoked an unexpected resume command.\n' >&2; exit 1; }
window_pid="$(xdotool getwindowpid "$window_id" 2>/dev/null || true)"
wm_class="$(xprop -id "$window_id" WM_CLASS)"
grep -Fq '"termfleet", "Termfleet"' <<<"$wm_class" ||
  { printf 'TermFleet window identity cannot match its desktop icon: %s\n' "$wm_class" >&2; exit 1; }

if [[ "$SETTLE_SECONDS" != "0" ]]; then
  sleep "$SETTLE_SECONDS"
fi

# Seed the exact pane-keyed status channel after the dock release has created its
# runtime pane. This makes the installed visual gate exercise the real opening-request
# path instead of accidentally proving only the empty shell state.
if [[ "${TERMFLEET_RESTART_SMOKE_LABEL_FIXTURE:-1}" == "1" ]]; then
  XDG_DATA_HOME="$data_dir" node -e '
    const fs = require("node:fs");
    const path = require("node:path");
    const root = path.join(process.env.XDG_DATA_HOME, "terminal-workspace", "agent-status");
    const snapshotPath = path.join(root, "cockpit-snapshot.json");
    if (!fs.existsSync(snapshotPath)) process.exit(0);
    const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
    const pane = Array.isArray(snapshot.terminals) ? snapshot.terminals[0] : null;
    const statusPaneId = pane?.terminalId || pane?.paneId;
    if (!statusPaneId) process.exit(0);
    const fnv = (value) => {
      let hash = 2166136261;
      for (const char of String(value)) {
        hash ^= char.charCodeAt(0);
        hash = Math.imul(hash, 16777619);
      }
      return (hash >>> 0).toString(16).padStart(8, "0");
    };
    const now = Date.now();
    fs.writeFileSync(path.join(root, `pane-${fnv(statusPaneId)}.json`), JSON.stringify({
      paneId: statusPaneId,
      provider: "codex",
      cwd: pane.cwd,
      sessionId: "00000000-0000-0000-0000-000000000000",
      updatedAt: now,
      turnEventAt: now,
      source: "codex-user-prompt",
      mainTask: "Verify the installed terminal labels",
      mainTaskSource: "opening-request",
      userTask: "Verify the installed terminal labels",
      now: "Waiting for command",
      turn: "working"
    }));
  '
  xdotool key --window "$window_id" Return >/dev/null 2>&1 || true
  label_gate_passed=0
  for _ in {1..24}; do
    if node -e '
      const fs = require("node:fs");
      const file = process.argv[1];
      if (!fs.existsSync(file)) process.exit(1);
      const snapshot = JSON.parse(fs.readFileSync(file, "utf8"));
      const terminals = Array.isArray(snapshot.terminals) ? snapshot.terminals : [];
      const valid = terminals.some((entry) =>
        entry.task === "Verify the installed terminal labels" &&
        entry.context === "Verify the installed terminal labels" &&
        Boolean(entry.now),
      );
      process.exit(valid ? 0 : 1);
    ' "$data_dir/terminal-workspace/agent-status/cockpit-snapshot.json"; then
      label_gate_passed=1
      break
    fi
    sleep 0.5
  done
  [[ "$label_gate_passed" == "1" ]] || {
    printf 'Installed label snapshot did not settle before the visual gate.\n' >&2
    exit 1
  }
fi

import -silent -window "$window_id" "$screenshot"
if [[ "${TERMFLEET_RESTART_SMOKE_LABEL_FIXTURE:-1}" == "1" ]]; then
  node -e '
    const fs = require("node:fs");
    const file = process.argv[1];
    const snapshot = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
    const terminals = Array.isArray(snapshot.terminals) ? snapshot.terminals : [];
    const valid = terminals.some((entry) =>
      entry.task === "Verify the installed terminal labels" &&
      entry.context === "Verify the installed terminal labels" &&
      Boolean(entry.now),
    );
    if (!valid) {
      console.error(`Installed label snapshot did not preserve Task/Goal/Now: ${JSON.stringify(terminals)}`);
      process.exit(1);
    }
  ' "$data_dir/terminal-workspace/agent-status/cockpit-snapshot.json"
  # The snapshot write is asynchronous with the WebView paint; capture again after
  # the state gate so the retained image represents the same committed header.
  sleep 1
  import -silent -window "$window_id" "$screenshot"
fi
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
  gamification_ocr_capture="${screenshot%.png}-gamification-ocr.png"
  gamification_opened=0
  centered_trigger_x="$((X + WIDTH / 2 + 315))"
  for candidate_offset in centered 220 180 140 100 260 300; do
    if [[ "$candidate_offset" == "centered" ]]; then
      click_x="${TERMFLEET_GAMIFICATION_CLICK_X:-$centered_trigger_x}"
    else
      click_x="${TERMFLEET_GAMIFICATION_CLICK_X:-$((X + WIDTH - candidate_offset))}"
    fi
    click_y="${TERMFLEET_GAMIFICATION_CLICK_Y:-$((Y + 25))}"
    wmctrl -ia "$window_id" >/dev/null 2>&1 || true
    xdotool windowraise "$window_id" >/dev/null 2>&1 || true
    xdotool windowfocus "$window_id" >/dev/null 2>&1 || true
    xdotool windowactivate "$window_id" >/dev/null 2>&1 || true
    sleep 0.2
    xdotool mousemove --sync "$click_x" "$click_y"
    xdotool click --clearmodifiers 1
    sleep 0.6
    import -silent -window "$window_id" "$gamification_capture" ||
      import -silent -window root "$gamification_capture"
    magick "$gamification_capture" -crop 1400x420+0+0 -resize 200% -colorspace Gray -contrast-stretch 0x15 "$gamification_ocr_capture"
    if tesseract "$gamification_ocr_capture" stdout --psm 11 2>/dev/null | grep -Fq "WORKSTREAM QUEST"; then
      gamification_opened=1
      break
    fi
    xdotool key Escape
  done
  if [[ "$gamification_opened" != "1" && -n "$ARTIFACT_DIR" ]]; then
    mkdir -p "$ARTIFACT_DIR"
    import -silent -window root "$ARTIFACT_DIR/termfleet-gamification-failed.png"
  fi
  [[ "$gamification_opened" == "1" ]] || { printf 'Gamification trigger did not open the real panel.\n' >&2; exit 1; }
  if ! tesseract "$gamification_ocr_capture" stdout --psm 11 2>/dev/null | tr '[:lower:]' '[:upper:]' | grep -Fq "ACCEPT QUEST"; then
    if [[ -n "$ARTIFACT_DIR" ]]; then
      mkdir -p "$ARTIFACT_DIR"
      install -m 0644 "$gamification_capture" "$ARTIFACT_DIR/termfleet-gamification-acceptance-failed.png"
      tesseract "$gamification_ocr_capture" stdout --psm 11 2>/dev/null >"$ARTIFACT_DIR/termfleet-gamification-acceptance-failed.txt" || true
    fi
    printf 'Fresh gamification panel did not require explicit quest acceptance.\n' >&2
    exit 1
  fi
  accept_x="${TERMFLEET_GAMIFICATION_ACCEPT_X:-$((X + WIDTH - 250))}"
  accept_y="${TERMFLEET_GAMIFICATION_ACCEPT_Y:-$((Y + 205))}"
  xdotool mousemove --sync "$accept_x" "$accept_y"
  xdotool click --clearmodifiers 1
  sleep 0.8
  sleep 0.6
  import -silent -window "$window_id" "$gamification_capture" ||
    import -silent -window root "$gamification_capture"
  magick "$gamification_capture" -crop 1400x420+0+0 -resize 200% -colorspace Gray -contrast-stretch 0x15 "$gamification_ocr_capture"
  if ! tesseract "$gamification_ocr_capture" stdout --psm 11 2>/dev/null | tr '[:lower:]' '[:upper:]' | grep -Fq "NEXT MILESTONE"; then
    if [[ -n "$ARTIFACT_DIR" ]]; then
      mkdir -p "$ARTIFACT_DIR"
      install -m 0644 "$gamification_capture" "$ARTIFACT_DIR/termfleet-gamification-active-failed.png"
      tesseract "$gamification_ocr_capture" stdout --psm 11 2>/dev/null >"$ARTIFACT_DIR/termfleet-gamification-active-failed.txt" || true
    fi
    printf 'Accepting the quest did not expose its live milestone state.\n' >&2
    exit 1
  fi
  xdotool key --clearmodifiers Escape
  sleep 0.5
  gamification_reopened_capture="${screenshot%.png}-gamification-reopened.png"
  gamification_reopened_ocr_capture="${screenshot%.png}-gamification-reopened-ocr.png"
  gamification_reopened=0
  for candidate_offset in centered 220 180 140 100 260 300; do
    if [[ "$candidate_offset" == "centered" ]]; then
      click_x="${TERMFLEET_GAMIFICATION_CLICK_X:-$centered_trigger_x}"
    else
      click_x="${TERMFLEET_GAMIFICATION_CLICK_X:-$((X + WIDTH - candidate_offset))}"
    fi
    wmctrl -ia "$window_id" >/dev/null 2>&1 || true
    xdotool windowraise "$window_id" >/dev/null 2>&1 || true
    xdotool windowfocus "$window_id" >/dev/null 2>&1 || true
    sleep 0.2
    xdotool mousemove --sync "$click_x" "$click_y"
    xdotool click --clearmodifiers 1
    sleep 0.6
    import -silent -window "$window_id" "$gamification_reopened_capture" ||
      import -silent -window root "$gamification_reopened_capture"
    magick "$gamification_reopened_capture" -crop 1400x420+0+0 -resize 200% -colorspace Gray -contrast-stretch 0x15 "$gamification_reopened_ocr_capture"
    if tesseract "$gamification_reopened_ocr_capture" stdout --psm 11 2>/dev/null | tr '[:lower:]' '[:upper:]' | grep -Fq "NEXT MILESTONE"; then
      gamification_reopened=1
      break
    fi
    xdotool key Escape
  done
  if [[ "$gamification_reopened" != "1" ]]; then
    if [[ -n "$ARTIFACT_DIR" ]]; then
      mkdir -p "$ARTIFACT_DIR"
      install -m 0644 "$gamification_reopened_capture" "$ARTIFACT_DIR/termfleet-gamification-reopened-failed.png"
      tesseract "$gamification_reopened_ocr_capture" stdout --psm 11 2>/dev/null >"$ARTIFACT_DIR/termfleet-gamification-reopened-failed.txt" || true
    fi
    printf 'Accepted quest did not survive closing and reopening the installed panel.\n' >&2
    exit 1
  fi
  if [[ "${TERMFLEET_RESTART_SMOKE_BEAM:-0}" == "1" ]]; then
    xdotool key --clearmodifiers Escape
    sleep 0.3
    xdotool key --clearmodifiers ctrl+shift+e
    sleep 0.8
    eval "$(xdotool getwindowgeometry --shell "$window_id")"
    # The first split is keyboard-driven.  The second split is deliberately
    # clicked through the visible pane toolbar so this gate proves the same
    # interaction a user has in the installed app, not a shortcut-only fixture.
    # In split mode the second pane toolbar is anchored at that pane's left
    # edge, immediately after the fixed sidebar and first pane.
    xdotool mousemove --sync "$((X + 318 + (WIDTH - 318) / 2 + 15))" "$((Y + 90))"
    sleep 0.3
    xdotool click --clearmodifiers 1
    sleep 0.8
    eval "$(xdotool getwindowgeometry --shell "$window_id")"
    work_left="$((X + 318))"
    work_width="$((WIDTH - 318))"
    pane_width="$((work_width / 3))"
    for pane_index in 0 1 2; do
      pane_x="$((work_left + pane_width * pane_index + pane_width / 2))"
      pane_y="$((Y + 300))"
      xdotool mousemove --sync "$pane_x" "$pane_y"
      xdotool click --clearmodifiers 1
      xdotool type --delay 15 "cd $APP_ROOT"
      xdotool key Return
      sleep 0.4
      # Keep a real process alive long enough for the accepted quest clock to
      # observe three qualifying terminals; a one-shot build is not a live
      # workstream and can fail before the timer samples it.
      xdotool type --delay 15 "sleep 20"
      xdotool key Return
    done
    sleep 2
    # This is the critical real-user assertion: after creating three panes and
    # starting live commands in each, the accepted quest timer must advance.
    # A static border or seeded localStorage state is not sufficient evidence.
    progress_capture="${screenshot%.png}-gamification-progress.png"
    progress_ocr_capture="${screenshot%.png}-gamification-progress-ocr.png"
    progress_opened=0
    progress_ocr=""
    eval "$(xdotool getwindowgeometry --shell "$window_id")"
    for candidate_offset in centered 220 180 140 100 260 300; do
      if [[ "$candidate_offset" == "centered" ]]; then
        progress_click_x="${TERMFLEET_GAMIFICATION_CLICK_X:-$((X + WIDTH / 2 + 315))}"
      else
        progress_click_x="${TERMFLEET_GAMIFICATION_CLICK_X:-$((X + WIDTH - candidate_offset))}"
      fi
      progress_click_y="${TERMFLEET_GAMIFICATION_CLICK_Y:-$((Y + 25))}"
      wmctrl -ia "$window_id" >/dev/null 2>&1 || true
      xdotool windowactivate "$window_id" >/dev/null 2>&1 || true
      xdotool mousemove --sync "$progress_click_x" "$progress_click_y"
      xdotool click --clearmodifiers 1
      sleep 1
      import -silent -window "$window_id" "$progress_capture" || import -silent -window root "$progress_capture"
      magick "$progress_capture" -crop 1400x420+0+0 -resize 200% -colorspace Gray -contrast-stretch 0x15 "$progress_ocr_capture"
      progress_ocr="$(tesseract "$progress_ocr_capture" stdout --psm 11 2>/dev/null | tr '[:lower:]' '[:upper:]' | tr '\n' ' ')"
      if [[ "$progress_ocr" == *"NEXT MILESTONE"* ]]; then
        progress_opened=1
        break
      fi
      xdotool key --clearmodifiers Escape
    done
    if [[ "$progress_opened" != "1" ]]; then
      if [[ -n "$ARTIFACT_DIR" ]]; then
        mkdir -p "$ARTIFACT_DIR"
        install -m 0644 "$progress_capture" "$ARTIFACT_DIR/termfleet-gamification-progress-failed.png" 2>/dev/null || true
        install -m 0644 "$progress_ocr_capture" "$ARTIFACT_DIR/termfleet-gamification-progress-failed-ocr.png" 2>/dev/null || true
        printf '%s\n' "$progress_ocr" >"$ARTIFACT_DIR/termfleet-gamification-progress-failed.txt"
      fi
      printf 'Real three-terminal quest gate could not find the active milestone panel: %s\n' "$progress_ocr" >&2
      exit 1
    fi
    [[ "$progress_ocr" =~ 0:0[1-9]|0:[1-5][0-9] ]] || { printf 'Real three-terminal quest timer did not advance: %s\n' "$progress_ocr" >&2; exit 1; }
    xdotool key --clearmodifiers Escape
    sleep 0.4
    beam_capture="${screenshot%.png}-gamification-beam.png"
    import -silent -window "$window_id" "$beam_capture" || import -silent -window root "$beam_capture"
    sleep 1.1
    beam_capture_after="${screenshot%.png}-gamification-beam-after.png"
    import -silent -window "$window_id" "$beam_capture_after" || import -silent -window root "$beam_capture_after"
    # Compare the full installed window across the animation interval.  The
    # captured panes have no text activity, so a nonzero delta proves the
    # border treatment is moving rather than merely present in CSS.
    beam_delta="$(compare -metric AE "$beam_capture" "$beam_capture_after" null: 2>&1 || true)"
    [[ "$beam_delta" =~ ^[1-9][0-9]*$ ]] || {
      printf 'Installed quest beam did not visibly animate across the capture interval (delta=%s).\n' "$beam_delta" >&2
      exit 1
    }
  fi
  xdotool key Escape
  sleep 1
  import -silent -window "$window_id" "${screenshot%.png}-gamification-closed.png" ||
    import -silent -window root "${screenshot%.png}-gamification-closed.png"
fi
if [[ -n "$ARTIFACT_DIR" ]]; then
  mkdir -p "$ARTIFACT_DIR"
  install -m 0644 "$screenshot" "$ARTIFACT_DIR/termfleet-installed-window.png"
  if [[ "${TERMFLEET_RESTART_SMOKE_GAMIFICATION:-0}" == "1" ]]; then
    install -m 0644 "${screenshot%.png}-gamification.png" "$ARTIFACT_DIR/termfleet-installed-window-gamification.png"
    if [[ -s "${screenshot%.png}-gamification-progress.png" ]]; then
      install -m 0644 "${screenshot%.png}-gamification-progress.png" "$ARTIFACT_DIR/termfleet-installed-window-gamification-progress.png"
    fi
    install -m 0644 "${screenshot%.png}-gamification-reopened.png" "$ARTIFACT_DIR/termfleet-installed-window-gamification-reopened.png"
    install -m 0644 "${screenshot%.png}-gamification-closed.png" "$ARTIFACT_DIR/termfleet-installed-window-gamification-closed.png"
    if [[ "${TERMFLEET_RESTART_SMOKE_BEAM:-0}" == "1" && -s "${screenshot%.png}-gamification-beam.png" ]]; then
      install -m 0644 "${screenshot%.png}-gamification-beam.png" "$ARTIFACT_DIR/termfleet-installed-window-gamification-beam.png"
      install -m 0644 "${screenshot%.png}-gamification-beam-after.png" "$ARTIFACT_DIR/termfleet-installed-window-gamification-beam-after.png"
    fi
  fi
  import -silent -window root "$ARTIFACT_DIR/termfleet-installed-desktop.png"
fi

# Optional end-to-end close gate: Ctrl+W is wired to the same closeTerminalSession
# action as the sidebar card's visible x button. Verify the durable tombstone and
# then relaunch against the same isolated data before checking the fresh window.
if [[ "${TERMFLEET_RESTART_SMOKE_CLOSE_TERMINAL:-0}" == "1" ]]; then
  close_route="${TERMFLEET_RESTART_SMOKE_CLOSE_ROUTE:-sidebar-x}"
  open_terminal_id=""
  if [[ "${TERMFLEET_RESTART_SMOKE_CLOSE_RESTORE_LOOP:-0}" == "1" ]]; then
    # Create the untouched control tab inside the installed app. This avoids
    # relying on the external fleet adapter to preserve two sessions with the
    # same visible project identity.
    eval "$(xdotool getwindowgeometry --shell "$window_id")"
    node -e '
      const fs = require("node:fs");
      const workspace = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      for (const tab of workspace.tabs || []) console.log(tab.id);
    ' "$data_dir/terminal-workspace/workspace.json" >"$tmp_root/tabs-before-control"
    xdotool mousemove --sync "$((X + WIDTH / 2))" "$((Y + 24))"
    xdotool click --clearmodifiers 1
    xdotool key --clearmodifiers ctrl+t
    for _ in {1..30}; do
      if [[ -f "$data_dir/terminal-workspace/workspace.json" ]] && node -e '
        const fs = require("node:fs");
        const workspace = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
        process.exit(Array.isArray(workspace.tabs) && workspace.tabs.length >= 2 ? 0 : 1);
      ' "$data_dir/terminal-workspace/workspace.json"; then
        break
      fi
      sleep 0.25
    done
    open_terminal_id="$(node -e '
      const fs = require("node:fs");
      const workspace = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const existing = new Set(fs.readFileSync(process.argv[2], "utf8").split(/\s+/).filter(Boolean));
      const tab = (workspace.tabs || []).find((candidate) => !existing.has(candidate.id));
      const terminal = tab?.terminals?.[0];
      process.stdout.write(String(terminal?.id || ""));
    ' "$data_dir/terminal-workspace/workspace.json" "$tmp_root/tabs-before-control")"
    [[ -n "$open_terminal_id" ]] || { printf 'Untouched installed control tab did not acquire a terminal id.\n' >&2; exit 1; }
    # Return to the original tab before exercising the requested close route.
    if [[ "$close_route" == "terminal-x" ]]; then
      xdotool mousemove --sync "$((X + WIDTH / 2))" "$((Y + 24))"
      xdotool click --clearmodifiers 1
      xdotool key --clearmodifiers ctrl+shift+Tab
    else
      xdotool mousemove --sync "$((X + 150))" "$((Y + 238))"
      xdotool click --clearmodifiers 1
    fi
    sleep 0.5
  fi
  closed_terminal_id="$(node -e '
    const fs = require("node:fs");
    const file = process.argv[1];
    const snapshot = JSON.parse(fs.readFileSync(file, "utf8"));
    const terminal = Array.isArray(snapshot.terminals) ? snapshot.terminals[0] : null;
    process.stdout.write(String(terminal?.terminalId || terminal?.paneId || ""));
  ' "$data_dir/terminal-workspace/agent-status/cockpit-snapshot.json")"
  [[ -n "$closed_terminal_id" ]] || { printf 'Close gate could not identify the active terminal.\n' >&2; exit 1; }
  wmctrl -ia "$window_id" >/dev/null 2>&1 || true
  eval "$(xdotool getwindowgeometry --shell "$window_id")"
  if [[ "$close_route" == "terminal-x" ]]; then
    # The pane toolbar X exists only when a tab has multiple panes; create the
    # second pane inside the installed app, then close that newly created pane.
    xdotool mousemove --sync "$((X + WIDTH / 2))" "$((Y + 24))"
    xdotool click --clearmodifiers 1
    xdotool key --clearmodifiers ctrl+shift+e
    for _ in {1..20}; do
      if [[ -f "$data_dir/terminal-workspace/workspace.json" ]] && node -e '
        const fs = require("node:fs");
        const workspace = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
        process.exit((workspace.tabs || []).some((tab) => (tab.terminals || []).length >= 2) ? 0 : 1);
      ' "$data_dir/terminal-workspace/workspace.json"; then
        break
      fi
      sleep 0.25
    done
    node -e '
      const fs = require("node:fs");
      const workspace = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const tabs = Array.isArray(workspace.tabs) ? workspace.tabs : [];
      const tab = tabs.find((candidate) => (candidate.terminals || []).length >= 2);
      for (const terminal of tab?.terminals || []) console.log(terminal.id);
    ' "$data_dir/terminal-workspace/workspace.json" >"$tmp_root/split-terminal-ids"
    closed_terminal_id="$(head -1 "$tmp_root/split-terminal-ids")"
    [[ -n "$closed_terminal_id" ]] || { printf 'Terminal-X gate could not identify the split pane.\n' >&2; exit 1; }
    import -silent -window "$window_id" "${screenshot%.png}-split-before-close.png" || true
  fi
  sidebar_right="$((X + WIDTH / 4))"
  close_click_x="${TERMFLEET_RESTART_SMOKE_CLOSE_X:-$((sidebar_right - 19))}"
  close_click_y="${TERMFLEET_RESTART_SMOKE_CLOSE_Y:-$((Y + 238))}"
  close_persisted=0
  if [[ "$close_route" == "slash-exit" ]]; then
    xdotool mousemove --sync "$((X + WIDTH * 3 / 4))" "$((Y + 380))"
    xdotool click --clearmodifiers 1
    xdotool type --delay 20 '/exit'
    xdotool key --clearmodifiers Return
  elif [[ "$close_route" == "terminal-x" ]]; then
    # Split-pane toolbar X: sweep the two pane edges and measured header band;
    # actions are hover-revealed, so each candidate gets a real hover first.
    for candidate_x in "${TERMFLEET_RESTART_SMOKE_TERMINAL_X:-$((X + WIDTH * 167 / 240 + 1))}" "$((X + WIDTH - 22))" "$((X + WIDTH / 2 - 22))" "$((X + WIDTH - 48))" "$((X + WIDTH * 2 / 3))" "$((X + WIDTH * 7 / 10))" "$((X + WIDTH * 167 / 240))" "$((X + WIDTH * 3 / 4))"; do
      for candidate_y in "${TERMFLEET_RESTART_SMOKE_TERMINAL_Y:-$((Y + 91))}" "$((Y + 112))" "$((Y + 88))" "$((Y + 96))" "$((Y + 104))" "$((Y + 136))" "$((Y + 160))" "$((Y + 184))" "$((Y + 208))"; do
        xdotool mousemove --sync "$candidate_x" "$candidate_y"
        sleep 0.35
        xdotool click --clearmodifiers 1
        for _ in {1..8}; do
          if [[ -f "$data_dir/terminal-workspace/workspace.json" ]] && node -e '
            const fs = require("node:fs");
            const workspace = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
            const ids = new Set(fs.readFileSync(process.argv[2], "utf8").split(/\s+/).filter(Boolean));
            const terminals = (workspace.tabs || []).flatMap((tab) => tab.terminals || []);
            const closed = (workspace.closedSessionIds || []).find((id) => ids.has(id));
            process.stdout.write(closed || "");
            process.exit(closed && !terminals.some((terminal) => terminal.id === closed) ? 0 : 1);
          ' "$data_dir/terminal-workspace/workspace.json" "$tmp_root/split-terminal-ids" >"$tmp_root/closed-terminal-id"; then
            closed_terminal_id="$(cat "$tmp_root/closed-terminal-id")"
            if [[ "$close_route" == "terminal-x" ]]; then
              open_terminal_id="$(grep -v -F -x "$closed_terminal_id" "$tmp_root/split-terminal-ids" | head -1)"
            fi
            close_persisted=1
            break 2
          fi
          sleep 0.25
        done
      done
    done
  elif [[ "$close_route" == "sidebar-x" ]]; then
    for candidate_y in "$close_click_y" "$((Y + 210))" "$((Y + 180))" "$((Y + 150))" "$((Y + 270))" "$((Y + 320))" "$((Y + 380))" "$((Y + 440))"; do
      for candidate_x in "$close_click_x" "$((sidebar_right - 25))" "$((sidebar_right - 40))" "$((sidebar_right - 60))" "$((sidebar_right - 80))" "$((sidebar_right - 100))"; do
        xdotool mousemove --sync "$candidate_x" "$candidate_y"
        sleep 0.4
        import -silent -window "$window_id" "${screenshot%.png}-hover.png" 2>/dev/null || true
        xdotool click --clearmodifiers 1
        for _ in {1..8}; do
          if [[ -f "$data_dir/terminal-workspace/workspace.json" ]] && node -e '
          const fs = require("node:fs");
          const workspace = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
          const id = process.argv[2];
          const terminals = (Array.isArray(workspace.tabs) ? workspace.tabs : [])
            .flatMap((tab) => Array.isArray(tab.terminals) ? tab.terminals : []);
          const closed = Array.isArray(workspace.closedSessionIds) && workspace.closedSessionIds.includes(id);
          process.exit(closed && !terminals.some((terminal) => terminal.id === id) ? 0 : 1);
          ' "$data_dir/terminal-workspace/workspace.json" "$closed_terminal_id"; then
            close_persisted=1
            break 3
          fi
          sleep 0.25
        done
      done
    done
  else
    printf 'Unknown installed close route: %s\n' "$close_route" >&2
    exit 1
  fi
  if [[ "$close_route" != "sidebar-x" ]]; then
    for _ in {1..8}; do
      if [[ -f "$data_dir/terminal-workspace/workspace.json" ]] && node -e '
        const fs = require("node:fs");
        const workspace = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
        const id = process.argv[2];
        const terminals = (Array.isArray(workspace.tabs) ? workspace.tabs : [])
          .flatMap((tab) => Array.isArray(tab.terminals) ? tab.terminals : []);
        const closed = Array.isArray(workspace.closedSessionIds) && workspace.closedSessionIds.includes(id);
        process.exit(closed && !terminals.some((terminal) => terminal.id === id) ? 0 : 1);
      ' "$data_dir/terminal-workspace/workspace.json" "$closed_terminal_id"; then
        close_persisted=1
        break 2
      fi
      sleep 0.25
    done
  fi
  [[ "$close_persisted" == "1" ]] || printf 'Visible sidebar close action did not persist yet; final gate will report the durable state.\n' >&2
  close_state_deadline=$((SECONDS + 12))
  while (( SECONDS < close_state_deadline )); do
    if [[ -f "$data_dir/terminal-workspace/workspace.json" ]] && node -e '
      const fs = require("node:fs");
      const workspace = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const id = process.argv[2];
      const terminals = (Array.isArray(workspace.tabs) ? workspace.tabs : [])
        .flatMap((tab) => Array.isArray(tab.terminals) ? tab.terminals : []);
      const closed = Array.isArray(workspace.closedSessionIds) && workspace.closedSessionIds.includes(id);
      process.exit(closed && !terminals.some((terminal) => terminal.id === id) ? 0 : 1);
    ' "$data_dir/terminal-workspace/workspace.json" "$closed_terminal_id"; then
      break
    fi
    sleep 0.25
  done
  node -e '
    const fs = require("node:fs");
    const workspace = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const id = process.argv[2];
    const closedCwd = process.argv[3];
    const terminals = (Array.isArray(workspace.tabs) ? workspace.tabs : [])
      .flatMap((tab) => Array.isArray(tab.terminals) ? tab.terminals : []);
    const closed = Array.isArray(workspace.closedSessionIds) && workspace.closedSessionIds.includes(id);
    const tombstone = (workspace.closedRestoreTargets || []).some((target) => target.cwd === closedCwd);
    const closedTabStillPresent = (workspace.tabs || []).some((tab) => (tab.terminals || []).some((terminal) => terminal.id === id));
    if (!closed || (!tombstone && closedTabStillPresent) || terminals.some((terminal) => terminal.id === id)) {
      console.error(`Close gate did not persist removal for ${id}: closed=${closed} tombstone=${tombstone} liveTerminal=${terminals.some((terminal) => terminal.id === id)} closedTabStillPresent=${closedTabStillPresent}`);
      process.exit(1);
    }
  ' "$data_dir/terminal-workspace/workspace.json" "$closed_terminal_id" "$closed_sentinel_cwd"
  python3 - "$socket" "$closed_terminal_id" <<'PY'
import json
import socket
import sys

socket_path, closed_id = sys.argv[1:]
with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as stream:
    stream.settimeout(5)
    stream.connect(socket_path)
    stream.sendall(b'{"type":"listSessions"}\n')
    response = json.loads(stream.makefile("rb").read().decode())
sessions = response.get("sessions", [])
if any(session.get("id") == closed_id for session in sessions):
    raise SystemExit(f"Closed terminal still owns a daemon session: {closed_id}")
PY
  xdotool windowclose "$window_id"
  close_deadline=$((SECONDS + 10))
  while kill -0 "$app_pid" 2>/dev/null && (( SECONDS < close_deadline )); do sleep 0.1; done
  kill -0 "$app_pid" 2>/dev/null && { printf 'Close gate left the first UI process alive.\n' >&2; exit 1; }
  [[ -S "$socket" ]] || { printf 'Close gate removed the PTY daemon.\n' >&2; exit 1; }

  before_windows="$(xdotool search --onlyvisible --name '^TermFleet$' 2>/dev/null | sort -u || true)"
  # The first app can leave a valid snapshot behind; a restart assertion must
  # inspect only evidence written by the fresh app.
  rm -f "$data_dir/terminal-workspace/agent-status/cockpit-snapshot.json" \
    "$data_dir/terminal-workspace/agent-status/cockpit-header-trace.jsonl"
  XAUTHORITY="${XAUTHORITY:-}" XDG_RUNTIME_DIR="$runtime_dir" XDG_DATA_HOME="$data_dir" \
    XDG_STATE_HOME="$state_dir" AGENT_FLEET_CONFIG="$manifest" \
    AGENT_FLEET_STATE_DIR="$state_dir/agent-fleet" SMOKE_RESUME_MARKER="$resume_marker" \
    PATH="$fake_bin:$PATH" SHELL="$fake_bin/smoke-shell" TERMFLEET_CMD="$COMMAND_PATH" \
    TERMFLEET_INSTALL_ROOT="$INSTALL_ROOT" TERMFLEET_PRESERVE_RUNTIME_DIR=1 \
    TERMFLEET_RESTORE="$RESTORE_SCRIPT" TERMFLEET_TMPDIR="$tmp_root/tmp" \
    setsid dbus-run-session -- "$DESKTOP_LAUNCHER" --child >>"$app_log" 2>&1 &
  app_pid=$!
  process_group_pid=$app_pid
  window_id=""
  deadline=$((SECONDS + WAIT_SECONDS))
  while (( SECONDS < deadline )); do
    kill -0 "$app_pid" 2>/dev/null || { printf 'Relaunched installed app exited during close gate.\n' >&2; exit 1; }
    current_windows="$(xdotool search --onlyvisible --name '^TermFleet$' 2>/dev/null | sort -u || true)"
    window_id="$(comm -13 <(printf '%s\n' "$before_windows" | sed '/^$/d') <(printf '%s\n' "$current_windows" | sed '/^$/d') | head -1)"
    [[ -n "$window_id" ]] && break
    sleep 1
  done
  [[ -n "$window_id" ]] || { printf 'Relaunched installed window did not appear.\n' >&2; exit 1; }
  window_pid="$(xdotool getwindowpid "$window_id" 2>/dev/null || true)"
  window_exe="$(readlink -f "/proc/$window_pid/exe" 2>/dev/null || true)"
  command_exe="$(readlink -f "$COMMAND_PATH")"
  [[ -n "$window_pid" && "$window_exe" == "$command_exe" ]] || {
    printf 'Relaunched visible window is stale or from the wrong release: pid=%s exe=%s expected=%s\n' \
      "$window_pid" "$window_exe" "$command_exe" >&2
    exit 1
  }
  sleep "$SETTLE_SECONDS"
  import -silent -window "$window_id" "${screenshot%.png}-after-close-restart.png"
  node -e '
    const fs = require("node:fs");
    const file = process.argv[1];
    const id = process.argv[2];
    const snapshot = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
    const terminals = Array.isArray(snapshot.terminals) ? snapshot.terminals : [];
    if (terminals.some((terminal) => terminal.terminalId === id || terminal.paneId === id)) {
      console.error(`Closed terminal returned in the fresh cockpit: ${id}`);
      process.exit(1);
    }
  ' "$data_dir/terminal-workspace/agent-status/cockpit-snapshot.json" "$closed_terminal_id"
  if [[ "${TERMFLEET_RESTART_SMOKE_CLOSE_RESTORE_LOOP:-0}" == "1" || "$close_route" == "terminal-x" ]]; then
    for _ in {1..20}; do
      [[ -f "$data_dir/terminal-workspace/agent-status/cockpit-snapshot.json" ]] && break
      sleep 0.5
    done
    node -e '
      const fs = require("node:fs");
      const workspace = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const snapshot = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
      const openId = process.argv[3];
      const tabs = Array.isArray(workspace.tabs) ? workspace.tabs : [];
      const visible = tabs.flatMap((tab) => Array.isArray(tab.terminals) ? tab.terminals : []).filter((terminal) => terminal.id === openId);
      const cockpit = (Array.isArray(snapshot.terminals) ? snapshot.terminals : []).filter((entry) => entry.terminalId === openId || entry.paneId === openId);
      if (visible.length !== 1 || cockpit.length !== 1) {
        console.error(`Untouched sentinel was lost, hidden, or duplicated after restart: tabs=${visible.length} cockpit=${cockpit.length}`);
        process.exit(1);
      }
    ' "$data_dir/terminal-workspace/workspace.json" "$data_dir/terminal-workspace/agent-status/cockpit-snapshot.json" "$open_terminal_id"
  fi
  if [[ -n "$ARTIFACT_DIR" ]]; then
    mkdir -p "$ARTIFACT_DIR"
    install -m 0644 "${screenshot%.png}-after-close-restart.png" "$ARTIFACT_DIR/termfleet-installed-after-close-restart.png"
  fi
  printf 'TERMFLEET_INSTALLED_CLOSE_RESTART_OK closed_terminal=%s\n' "$closed_terminal_id"
fi

# Closing the desktop window must terminate the UI process without touching the
# separately owned PTY daemon. This is the installed equivalent of clicking the
# window's X button and guards against a hidden desktop process remaining alive.
xdotool windowclose "$window_id"
close_deadline=$((SECONDS + 10))
while kill -0 "$app_pid" 2>/dev/null && (( SECONDS < close_deadline )); do
  sleep 0.1
done
if kill -0 "$app_pid" 2>/dev/null; then
  printf 'Closing the installed TermFleet window left the desktop process alive: pid=%s window=%s\n' \
    "$app_pid" "$window_id" >&2
  exit 1
fi
[[ -S "$socket" ]] || {
  printf 'Closing the installed TermFleet window also removed the PTY daemon socket.\n' >&2
  exit 1
}

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
