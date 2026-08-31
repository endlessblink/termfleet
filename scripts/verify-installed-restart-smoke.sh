#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$APP_ROOT/scripts/restart-smoke-process-tree.sh"
COMMAND_PATH="${TERMFLEET_COMMAND_PATH:-${HOME}/.local/bin/termfleet}"
INSTALL_ROOT="${TERMFLEET_INSTALL_ROOT:-${XDG_DATA_HOME:-$HOME/.local/share}/termfleet}"
DESKTOP_LAUNCHER="${TERMFLEET_DESKTOP_LAUNCHER:-${HOME}/.local/bin/termfleet-desktop}"
RESTORE_SCRIPT="${TERMFLEET_RESTORE_SCRIPT:-}"
WAIT_SECONDS="${TERMFLEET_RESTART_SMOKE_WAIT_SECONDS:-30}"
# The installed cockpit snapshot is written asynchronously after the WebView
# mounts and the pane status poll starts; three seconds is shorter than the
# observed cold-start path on the dock release.
SETTLE_SECONDS="${TERMFLEET_RESTART_SMOKE_SETTLE_SECONDS:-10}"
ARTIFACT_DIR="${TERMFLEET_RESTART_SMOKE_ARTIFACT_DIR:-}"
LABEL_FIXTURE="${TERMFLEET_RESTART_SMOKE_LABEL_FIXTURE:-1}"
FIXTURE_TASK="Reopen the closed sentinel session after restart"
FIXTURE_GOAL="Keep the closed sentinel session available after restart"
FIXTURE_NOW="Waiting for the restored sentinel command"

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
      TERMFLEET_EXTERNAL_RESTORE="${TERMFLEET_EXTERNAL_RESTORE:-1}" \
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
[[ -n "$RESTORE_SCRIPT" ]] ||
  { printf 'Set TERMFLEET_RESTORE_SCRIPT to your agent-fleet restore script.\n' >&2; exit 1; }
[[ -f "$RESTORE_SCRIPT" ]] ||
  { printf 'Strict restore script is missing: %s\n' "$RESTORE_SCRIPT" >&2; exit 1; }

tmp_root="$(mktemp -d)"
runtime_dir="$tmp_root/runtime"
data_dir="$tmp_root/data"
state_dir="$tmp_root/state"
fake_bin="$tmp_root/bin"
app_log="$tmp_root/app.log"
screenshot="$tmp_root/termfleet.png"
pane_capture_dir="$tmp_root/pane-captures"
socket="$runtime_dir/terminal-workspace/daemon.sock"
observed_terminals="$tmp_root/observed-terminals"
resume_marker="$tmp_root/resume-marker"
manifest="$tmp_root/fleet.toml"
session_dir="$tmp_root/session"
closed_sentinel_cwd="$session_dir/closed-sentinel"
open_sentinel_cwd="$session_dir/open-sentinel"
closed_sentinel_fixture_dir="$session_dir/closed-sentinel"
restart_pane_two_cwd="$session_dir/restart-pane-two"
restart_pane_three_cwd="$session_dir/restart-pane-three"
restart_pane_four_cwd="$session_dir/restart-pane-four"
mkdir -m 0700 "$runtime_dir" "$data_dir" "$state_dir" "$fake_bin" "$session_dir" "$closed_sentinel_fixture_dir" "$open_sentinel_cwd" "$restart_pane_two_cwd" "$restart_pane_three_cwd" "$restart_pane_four_cwd" "$tmp_root/tmp"

# Hydrate one visible split tab rather than four separate restored tabs. The
# cockpit snapshot only contains mounted panes, so separate tabs make the
# restart gate observe the app's default pane instead of the intended fixture.
mkdir -p "$data_dir/terminal-workspace"
node - "$data_dir/terminal-workspace/workspace.json" "$closed_sentinel_cwd" "$restart_pane_two_cwd" "$restart_pane_three_cwd" "$restart_pane_four_cwd" <<'NODE'
const fs = require("node:fs");
const [output, ...cwds] = process.argv.slice(2);
const paneIds = [
  "installed-restart-pane-one",
  "installed-restart-pane-two",
  "installed-restart-pane-three",
  "installed-restart-pane-four",
];
const providerSessionIds = [
  "00000000-0000-0000-0000-000000000000",
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
];
const terminals = paneIds.map((paneId, index) => ({
  id: paneId,
  paneId,
  cols: 80,
  rows: 24,
  status: "starting",
  reused: false,
  agentProvider: "codex",
  providerSessionId: providerSessionIds[index],
  initialCwd: cwds[index],
}));
const leaves = terminals.map((terminal) => ({
  id: terminal.paneId,
  type: "terminal",
  cwd: terminal.initialCwd,
}));
const split = (id, direction, children) => ({
  id,
  type: "split",
  direction,
  sizes: [50, 50],
  children,
});
const tab = {
  id: "installed-restart-tab",
  title: "Installed restart panes",
  emoji: "🔁",
  color: "#7aa2f7",
  groupId: "installed-restart-group",
  initialCwd: cwds[0],
  terminals,
  splitLayout: split("installed-restart-root", "vertical", [
    split("installed-restart-top", "horizontal", leaves.slice(0, 2)),
    split("installed-restart-bottom", "horizontal", leaves.slice(2)),
  ]),
  activePaneId: paneIds[0],
};
fs.writeFileSync(output, `${JSON.stringify({
  tabs: [tab],
  groups: [{
    id: "installed-restart-group",
    name: "installed-restart",
    color: "#7aa2f7",
    emoji: "🔁",
    emojiSource: "generated",
    projectRoot: cwds[0],
    lastActiveTabId: tab.id,
  }],
  activeTabId: tab.id,
  activeGroupId: tab.groupId,
  activeGroupFilter: tab.groupId,
  projectRoot: cwds[0],
  workspaceUiState: {
    workspaceMode: "split",
    terminalRendererMode: "auto",
    primarySidebarCollapsed: true,
  },
  closedSessionIds: [],
}, null, 2)}\n`, { mode: 0o600 });
NODE

git -C "$closed_sentinel_cwd" init -q
git -C "$closed_sentinel_cwd" config user.email smoke@example.invalid
git -C "$closed_sentinel_cwd" config user.name "TermFleet smoke"
touch "$closed_sentinel_cwd/.gitkeep"
git -C "$closed_sentinel_cwd" add .gitkeep
git -C "$closed_sentinel_cwd" commit -qm "Seed installed monitor fixture"

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
  const fixtures = {
    "closed-sentinel": {
      task: "Reopen the closed sentinel session after restart",
      goal: "Keep the closed sentinel session available after restart",
      now: "Waiting for the restored sentinel command",
    },
    "restart-pane-two": {
      task: "Inspect the restarted terminal session identity",
      goal: "Keep terminal session identity clear after restart",
      now: "Waiting for the identity check",
    },
    "restart-pane-three": {
      task: "Preserve the restarted shell session context",
      goal: "Keep shell context truthful after restart",
      now: "Waiting for the next shell command",
    },
    "restart-pane-four": {
      task: "Confirm the restarted pane remains resumable",
      goal: "Keep the pane resumable after restart",
      now: "Waiting for the next pane command",
    },
  };
  const fixture = fixtures[path.basename(process.cwd())] || fixtures["closed-sentinel"];
  const sidecar = {
    provider: "codex",
    cwd: process.cwd(),
    sessionId: "00000000-0000-0000-0000-000000000000",
    updatedAt: Date.now(),
    turnEventAt: Date.now(),
    source: "codex-user-prompt",
    mainTask: fixture.goal,
    mainTaskSource: "opening-request",
    userTask: fixture.task,
    now: fixture.now,
    turn: "working",
  };
  const dir = path.join(process.env.XDG_DATA_HOME, "terminal-workspace", "agent-status");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(dir, `pane-${paneHash}.json`), JSON.stringify(sidecar));
  fs.writeFileSync(path.join(dir, `${cwdHash}.json`), JSON.stringify(sidecar));
'
printf '%s\n' "$*" >>"$SMOKE_RESUME_MARKER"
printf 'Restored provider session alive: %s\n' "$paneId"
# The visual gate verifies a live restored provider, not only that the restore
# command was invoked. Keep the fixture process alive until the isolated smoke
# harness tears it down so the pane remains reconnected while the snapshot
# settles.
while true; do sleep 60; done
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

[[session]]
name = "restart-pane-two"
cwd = "$restart_pane_two_cwd"
agent = "codex"
host = "terminal"
pin = "11111111-1111-4111-8111-111111111111"

[[session]]
name = "restart-pane-three"
cwd = "$restart_pane_three_cwd"
agent = "codex"
host = "terminal"
pin = "22222222-2222-4222-8222-222222222222"

[[session]]
name = "restart-pane-four"
cwd = "$restart_pane_four_cwd"
agent = "codex"
host = "terminal"
pin = "33333333-3333-4333-8333-333333333333"
EOF
child_env_file="$tmp_root/child.env"
printf 'AGENT_FLEET_CONFIG=%q\nAGENT_FLEET_STATE_DIR=%q\nTF_RESTORE_PATH=%q\nTERMFLEET_EXTERNAL_RESTORE=%q\nTERMFLEET_PRESERVE_RUNTIME_DIR=%q\nTERMFLEET_RESTORE_DELAY_SECONDS=0\n' \
  "$manifest" "$state_dir/agent-fleet" "$RESTORE_SCRIPT" "${TERMFLEET_EXTERNAL_RESTORE:-1}" "1" >"$child_env_file"
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
    -n "$ARTIFACT_DIR" ]]; then
    mkdir -p "$ARTIFACT_DIR"
    [[ -s "$screenshot" ]] && install -m 0644 "$screenshot" "$ARTIFACT_DIR/termfleet-installed-window.png"
    [[ -s "${screenshot%.png}-before-git-monitor.png" ]] && install -m 0644 "${screenshot%.png}-before-git-monitor.png" "$ARTIFACT_DIR/termfleet-installed-before-git-monitor.png"
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
    if [[ -d "$pane_capture_dir" ]]; then
      mkdir -p "$ARTIFACT_DIR/terminal-pane-captures"
      cp -a "$pane_capture_dir/." "$ARTIFACT_DIR/terminal-pane-captures/"
    fi
    if [[ -d "$data_dir/terminal-workspace/agent-status" ]]; then
      mkdir -p "$ARTIFACT_DIR/native-captures"
      for native_capture in "$data_dir"/terminal-workspace/agent-status/termfleet-pane-native-*.png; do
        [[ -s "$native_capture" ]] || continue
        install -m 0644 "$native_capture" "$ARTIFACT_DIR/native-captures/$(basename "$native_capture")"
      done
    fi
    ARTIFACT_DIR="$ARTIFACT_DIR" python3 - <<'PYEOF'
import json
import os
from pathlib import Path

artifact = Path(os.environ["ARTIFACT_DIR"])
snapshot_path = artifact / "cockpit-snapshot.json"
if snapshot_path.is_file():
    snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))
    native_dir = artifact / "native-captures"
    for entry in snapshot.get("terminals", []):
        native = entry.get("nativeCapture") or {}
        source = Path(str(native.get("path") or ""))
        if source.name and (native_dir / source.name).is_file():
            native["path"] = str(native_dir / source.name)
            entry["nativeCapture"] = native
    snapshot_path.write_text(json.dumps(snapshot, indent=2) + "\n", encoding="utf-8")

for manifest_path in (artifact / "terminal-pane-captures").glob("*.json"):
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    for pane in manifest.get("panes", []):
        image = Path(str(pane.get("image") or ""))
        stable_image = artifact / "terminal-pane-captures" / image.name
        if image.name and stable_image.is_file():
            pane["image"] = str(stable_image)
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
PYEOF
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
TERMFLEET_COCKPIT_SNAPSHOT_PATH="$data_dir/terminal-workspace/agent-status/cockpit-snapshot.json" \
  TERMFLEET_CHILD_CONTEXT=isolated-smoke \
  TERMFLEET_CHILD_ENV_FILE="$child_env_file" \
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
if [[ "${TERMFLEET_RESTART_SMOKE_GIT_MONITOR:-0}" == "1" ]]; then
  eval "$(xdotool getwindowgeometry --shell "$window_id")"
  xdotool windowfocus "$window_id" >/dev/null 2>&1 || true
  xdotool windowactivate "$window_id" >/dev/null 2>&1 || true
  xdotool key --clearmodifiers ctrl+alt+g
  sleep 3
fi
if [[ "$LABEL_FIXTURE" == "1" ]]; then
  snapshot_path="$data_dir/terminal-workspace/agent-status/cockpit-snapshot.json"
  for _ in {1..20}; do
    [[ -s "$snapshot_path" ]] && break
    sleep 0.5
  done
  XDG_DATA_HOME="$data_dir" node -e '
    const fs = require("node:fs");
    const path = require("node:path");
    const root = path.join(process.env.XDG_DATA_HOME, "terminal-workspace", "agent-status");
    const snapshotPath = path.join(root, "cockpit-snapshot.json");
    if (!fs.existsSync(snapshotPath)) process.exit(0);
    const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
    const panes = Array.isArray(snapshot.terminals) ? snapshot.terminals : [];
     const statusPaneIds = panes.map((pane) => pane?.paneId || pane?.terminalId).filter(Boolean);
    if (statusPaneIds.length === 0) process.exit(0);
    const fnv = (value) => {
      let hash = 2166136261;
      for (const char of String(value)) {
        hash ^= char.charCodeAt(0);
        hash = Math.imul(hash, 16777619);
      }
      return (hash >>> 0).toString(16).padStart(8, "0");
    };
    const now = Date.now();
    const fixtures = [
      ["Reopen the closed sentinel session after restart", "Keep the closed sentinel session available after restart", "Waiting for the restored sentinel command"],
      ["Inspect the restarted terminal session identity", "Keep terminal session identity clear after restart", "Waiting for the identity check"],
      ["Preserve the restarted shell session context", "Keep shell context truthful after restart", "Waiting for the next shell command"],
      ["Confirm the restarted pane remains resumable", "Keep the pane resumable after restart", "Waiting for the next pane command"],
    ];
    for (const [index, statusPaneId] of statusPaneIds.entries()) {
      const pane = panes[index] || panes[0];
      const [task, goal, nowText] = fixtures[index] || fixtures[0];
      const sidecar = JSON.stringify({
        paneId: statusPaneId,
        provider: "codex",
        cwd: pane.cwd,
        sessionId: "00000000-0000-0000-0000-000000000000",
        updatedAt: now,
        turnEventAt: now,
        source: "codex-user-prompt",
         mainTask: task,
         mainTaskSource: "opening-request",
         openingRequest: goal,
        userTask: task,
        now: nowText,
        turn: "working"
      });
      const runtimePaneId = `terminal-installed-restart-tab-${statusPaneId}`;
      for (const lookupPaneId of [statusPaneId, runtimePaneId]) {
        const lookupSidecar = JSON.stringify({ ...JSON.parse(sidecar), paneId: lookupPaneId });
        fs.writeFileSync(path.join(root, `pane-${fnv(lookupPaneId)}.json`), lookupSidecar);
      }
      if (pane.cwd) fs.writeFileSync(path.join(root, `${fnv(pane.cwd)}.json`), sidecar);
    }
  '
  if [[ -n "$ARTIFACT_DIR" ]]; then
    mkdir -p "$ARTIFACT_DIR/status-sidecars"
    cp -a "$data_dir/terminal-workspace/agent-status/." "$ARTIFACT_DIR/status-sidecars/" 2>/dev/null || true
  fi
  xdotool key --window "$window_id" Return >/dev/null 2>&1 || true
  label_gate_passed=0
  # The installed dock polls status asynchronously after the first snapshot; allow
  # two full refresh intervals before declaring the visual fixture absent.
  for _ in {1..60}; do
    if node -e '
      const fs = require("node:fs");
      const file = process.argv[1];
      if (!fs.existsSync(file)) process.exit(1);
      const snapshot = JSON.parse(fs.readFileSync(file, "utf8"));
      const terminals = Array.isArray(snapshot.terminals) ? snapshot.terminals : [];
       const validGoals = new Set([
        "Reopen the closed sentinel session after restart",
        "Inspect the restarted terminal session identity",
        "Preserve the restarted shell session context",
        "Confirm the restarted pane remains resumable",
      ]);
      const valid = terminals.length === 4 &&
         new Set(terminals.map((entry) => entry.context)).size === 4 &&
         terminals.every((entry) =>
           validGoals.has(entry.context) &&
           Boolean(entry.context) &&
           entry.context !== entry.task &&
           Boolean(entry.task) &&
           entry.status === "reconnected" &&
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
TERMFLEET_STATUS_DIR="$data_dir/terminal-workspace/agent-status" \
TERMFLEET_COCKPIT_SNAPSHOT_PATH="$data_dir/terminal-workspace/agent-status/cockpit-snapshot.json" \
TERMFLEET_PANE_CAPTURE_DIR="$pane_capture_dir" \
TERMFLEET_PANE_CAPTURE_EXPECTED_COUNT=4 \
TERMFLEET_PANE_CAPTURE_REQUIRE_HEADERS=0 \
  node "$APP_ROOT/scripts/monitor-cockpit-pane-screens.mjs" --once
TERMFLEET_STATUS_DIR="$data_dir/terminal-workspace/agent-status" \
TERMFLEET_COCKPIT_SNAPSHOT_PATH="$data_dir/terminal-workspace/agent-status/cockpit-snapshot.json" \
TERMFLEET_WORKSPACE_PATH="$data_dir/terminal-workspace/workspace.json" \
  node "$APP_ROOT/scripts/monitor-cockpit-pane-health.mjs" --once
node -e '
  const fs = require("node:fs");
  const matrix = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const failures = (Array.isArray(matrix.panes) ? matrix.panes : []).filter((pane) =>
    pane.health !== "live" || (Array.isArray(pane.reasons) && pane.reasons.includes("idle-shell-fallback")));
  if (failures.length > 0) {
    console.error(`Installed restart health gate failed: ${JSON.stringify(failures)}`);
    process.exit(1);
  }
' "$data_dir/terminal-workspace/agent-status/termfleet-pane-health.json"
if [[ -n "$ARTIFACT_DIR" && -d "$pane_capture_dir" ]]; then
  mkdir -p "$ARTIFACT_DIR/terminal-pane-captures"
  cp -a "$pane_capture_dir/." "$ARTIFACT_DIR/terminal-pane-captures/"
  install -m 0644 "$data_dir/terminal-workspace/agent-status/termfleet-pane-health.json" \
    "$ARTIFACT_DIR/termfleet-pane-health.json"
fi
if [[ "${TERMFLEET_RESTART_SMOKE_GIT_MONITOR:-0}" == "1" ]]; then
  cp "$screenshot" "${screenshot%.png}-before-git-monitor.png"
fi
if [[ "$LABEL_FIXTURE" == "1" ]]; then
  node -e '
    const fs = require("node:fs");
    const file = process.argv[1];
    const snapshot = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
    const terminals = Array.isArray(snapshot.terminals) ? snapshot.terminals : [];
     const validGoals = new Set([
      "Reopen the closed sentinel session after restart",
      "Inspect the restarted terminal session identity",
      "Preserve the restarted shell session context",
      "Confirm the restarted pane remains resumable",
    ]);
    const valid = terminals.length === 4 &&
       new Set(terminals.map((entry) => entry.context)).size === 4 &&
      terminals.every((entry) =>
        validGoals.has(entry.context) &&
        Boolean(entry.context) &&
        entry.context !== entry.task &&
        Boolean(entry.task) &&
        entry.status === "reconnected" &&
        Boolean(entry.now),
      );
    if (!valid) {
      console.error(`Installed label snapshot did not preserve Task/Goal/Now: ${JSON.stringify(terminals)}`);
      process.exit(1);
    }
  ' "$data_dir/terminal-workspace/agent-status/cockpit-snapshot.json"
  if [[ "${TERMFLEET_RESTART_SMOKE_NARROW:-0}" == "1" ]]; then
    xdotool windowsize "$window_id" 390 844
    sleep 1
    if [[ "${TERMFLEET_RESTART_SMOKE_GIT_MONITOR:-0}" == "1" ]]; then
      # Let the dock's scheduled workspace reconciliation finish before the
      # operator action; otherwise it can restore Map over the just-clicked view.
      sleep 16
      eval "$(xdotool getwindowgeometry --shell "$window_id")"
      xdotool windowfocus "$window_id" >/dev/null 2>&1 || true
      xdotool windowactivate "$window_id" >/dev/null 2>&1 || true
      # The rail begins below the 50px workbench header; Git follows file tree,
      # sessions, and map. Keep the click anchored to the installed rail geometry.
      xdotool mousemove --sync "$((X + 20))" "$((Y + 204))"
      xdotool click --clearmodifiers 1
      sleep 3
    fi
  fi
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
    original_cwd="$(node -e '
      const fs = require("node:fs");
      const workspace = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const cwd = (workspace.tabs || [])
        .map((tab) => tab.initialCwd)
        .find((value) => typeof value === "string" && value.length > 0);
      process.stdout.write(String(cwd || ""));
    ' "$data_dir/terminal-workspace/workspace.json")"
    for _ in {1..60}; do
      [[ -n "$original_cwd" ]] && break
      sleep 0.25
      original_cwd="$(node -e '
        const fs = require("node:fs");
        const workspace = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
        const cwd = (workspace.tabs || [])
          .map((tab) => tab.initialCwd)
          .find((value) => typeof value === "string" && value.length > 0);
        process.stdout.write(String(cwd || ""));
      ' "$data_dir/terminal-workspace/workspace.json")"
    done
    [[ -n "$original_cwd" ]] || { printf 'Close gate could not identify the original terminal directory.\n' >&2; exit 1; }
    xdotool mousemove --sync "$((X + WIDTH / 2))" "$((Y + 24))"
    xdotool click --clearmodifiers 1
    xdotool key --clearmodifiers ctrl+t
    for _ in {1..60}; do
      if [[ -f "$data_dir/terminal-workspace/workspace.json" ]] && node -e '
        const fs = require("node:fs");
        const workspace = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
        process.exit(Array.isArray(workspace.tabs) && workspace.tabs.length >= 2 ? 0 : 1);
      ' "$data_dir/terminal-workspace/workspace.json"; then
        break
      fi
      sleep 0.25
    done
    open_terminal_id=""
    for _ in {1..48}; do
      open_terminal_id="$(node -e '
        const fs = require("node:fs");
        const workspace = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
        const existing = new Set(fs.readFileSync(process.argv[2], "utf8").split(/\s+/).filter(Boolean));
        const tab = (workspace.tabs || []).find((candidate) => !existing.has(candidate.id));
        const terminal = tab?.terminals?.[0];
        process.stdout.write(String(terminal?.id || ""));
      ' "$data_dir/terminal-workspace/workspace.json" "$tmp_root/tabs-before-control")"
      [[ -n "$open_terminal_id" ]] && break
      sleep 0.25
    done
    [[ -n "$open_terminal_id" ]] || { printf 'Untouched installed control tab did not acquire a terminal id.\n' >&2; exit 1; }
    node -e '
      const fs = require("node:fs");
      const workspace = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const openId = process.argv[2];
      const originalCwd = process.argv[3];
      const tab = (workspace.tabs || []).find((candidate) =>
        (candidate.terminals || []).some((terminal) => terminal.id === openId));
      if (!tab || tab.initialCwd !== originalCwd) {
        console.error(`Control terminal did not remain in the original directory: control=${tab?.initialCwd || ""} original=${originalCwd}`);
        process.exit(1);
      }
    ' "$data_dir/terminal-workspace/workspace.json" "$open_terminal_id" "$original_cwd"
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
import time

socket_path, closed_id = sys.argv[1:]
deadline = time.time() + 12
while time.time() < deadline:
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as stream:
        stream.settimeout(5)
        stream.connect(socket_path)
        stream.sendall(b'{"type":"listSessions"}\n')
        response = json.loads(stream.makefile("rb").read().decode())
    sessions = response.get("sessions", [])
    if not any(session.get("id") == closed_id for session in sessions):
        break
    time.sleep(0.1)
else:
    raise SystemExit(f"Closed terminal still owns a daemon session after teardown timeout: {closed_id}")
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
    TERMFLEET_CHILD_CONTEXT=isolated-smoke \
    TERMFLEET_CHILD_ENV_FILE="$child_env_file" \
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
       // A plain shell control tab has no agent-status sidecar, so cockpit may
       // legitimately omit it. The durable workspace tab is the authoritative
       // persistence assertion; when a cockpit entry exists, it must be unique.
       if (visible.length !== 1 || cockpit.length > 1) {
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
