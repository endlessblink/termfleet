#!/usr/bin/env bash
set -uo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${TERMFLEET_AGENT_RESTORE_VISIBLE_OUT:-/tmp/tw-agent-restore-visible}"
RUN_DIR="$OUT_DIR/run"
DATA_DIR="$OUT_DIR/data"
CONFIG_DIR="$OUT_DIR/config"
CARGO_TARGET_DIR="$OUT_DIR/target"
BIN_DIR="$OUT_DIR/bin"
LOG_FILE="$OUT_DIR/runtime.log"
STATUS_LOG="$OUT_DIR/status-server.log"
DRIVER_LOG="$OUT_DIR/driver.log"
TRACE_FILE="$OUT_DIR/pty-trace.log"
STATUS_PORT="${TERMFLEET_AGENT_RESTORE_STATUS_PORT:-$((39200 + RANDOM % 700))}"
PORT="${TERMFLEET_AGENT_RESTORE_PORT:-$((20300 + RANDOM % 700))}"
STATUS_ENDPOINT="http://127.0.0.1:${STATUS_PORT}/status"
SNAPSHOT_FILE="$DATA_DIR/terminal-workspace/agent-status/cockpit-snapshot.json"
SOCKET="$RUN_DIR/terminal-workspace/daemon.sock"
APP_BUDGET="${APP_BUDGET:-240}"
TAB_ID="11111111-1111-4111-8111-111111111111"
PANE_ID="22222222-2222-4222-8222-222222222222"
NODE_ID="node-restored-agent-visible"
SESSION_ID="terminal-${TAB_ID}-${PANE_ID}"
PROVIDER_SESSION_ID="019f-agent-visible-session"
WORKSPACE="$OUT_DIR/workspace"
INPUT_MARKER="VISIBLE_AGENT_RESTORE_INPUT_OK_941"
APP_RUN_PID=""
STATUS_PID=""
WINDOW_ID=""

mkdir -p "$OUT_DIR" "$RUN_DIR" "$DATA_DIR" "$CONFIG_DIR" "$BIN_DIR" "$WORKSPACE"
chmod 700 "$RUN_DIR"

log() {
  printf '[agent-restore-visible] %s\n' "$*" | tee -a "$DRIVER_LOG" >&2
}

if [[ -z "${TERMFLEET_AGENT_RESTORE_VISIBLE_INNER:-}" ]]; then
  rm -f "$OUT_DIR"/*.png "$LOG_FILE" "$STATUS_LOG" "$DRIVER_LOG" "$TRACE_FILE"
  rm -rf "$RUN_DIR" "$DATA_DIR" "$CONFIG_DIR" "$BIN_DIR" "$WORKSPACE"
  mkdir -p "$RUN_DIR" "$DATA_DIR" "$CONFIG_DIR" "$BIN_DIR" "$WORKSPACE"
  chmod 700 "$RUN_DIR"
  : >"$TRACE_FILE"
  exec xvfb-run -a -s "-screen 0 1600x1000x24" \
    env \
      TERMFLEET_AGENT_RESTORE_VISIBLE_INNER=1 \
      TERMFLEET_AGENT_RESTORE_VISIBLE_OUT="$OUT_DIR" \
      XDG_RUNTIME_DIR="$RUN_DIR" \
      XDG_DATA_HOME="$DATA_DIR" \
      XDG_CONFIG_HOME="$CONFIG_DIR" \
      TERMINAL_WORKSPACE_TRACE_PTY_FILE="$TRACE_FILE" \
      bash "${BASH_SOURCE[0]}" "$@"
fi

cleanup() {
  if [[ -n "$APP_RUN_PID" ]]; then
    kill -- "-$APP_RUN_PID" >/dev/null 2>&1 || true
    wait "$APP_RUN_PID" >/dev/null 2>&1 || true
    APP_RUN_PID=""
  fi
  if [[ -n "$STATUS_PID" ]]; then
    kill "$STATUS_PID" >/dev/null 2>&1 || true
    wait "$STATUS_PID" >/dev/null 2>&1 || true
    STATUS_PID=""
  fi
}
trap cleanup EXIT
cleanup

encode_id() {
  python3 - "$1" <<'PYEOF'
import sys
print(sys.argv[1].encode("utf-8").hex())
PYEOF
}

seed_fake_codex() {
  cat >"$BIN_DIR/codex" <<'EOF'
#!/bin/sh
printf 'FAKE_CODEX_PWD=%s\n' "$PWD"
printf 'FAKE_CODEX_PANE=%s\n' "$TERMFLEET_PANE_ID"
printf 'FAKE_CODEX_ARGS=%s\n' "$*"
sleep 300
EOF
  chmod +x "$BIN_DIR/codex"
}

seed_restore_fixture() {
  local sessions_dir="$DATA_DIR/terminal-workspace/sessions"
  local hex_id
  hex_id="$(encode_id "$SESSION_ID")"
  mkdir -p "$sessions_dir"
  python3 - "$sessions_dir/$hex_id.scrollback" <<'PYEOF'
import sys
path = sys.argv[1]
with open(path, "wb") as f:
    f.write((0).to_bytes(8, "little"))
    f.write(b"previous visible codex transcript\n")
PYEOF
  python3 - "$DATA_DIR/terminal-workspace/workspace.json" "$TAB_ID" "$PANE_ID" "$NODE_ID" "$SESSION_ID" "$WORKSPACE" "$PROVIDER_SESSION_ID" <<'PYEOF'
import json, os, sys, time
path, tab_id, pane_id, node_id, session_id, workspace, provider_session_id = sys.argv[1:8]
os.makedirs(os.path.dirname(path), exist_ok=True)
mission = "Resume durable Codex lane"
payload = {
    "tabs": [{
        "id": tab_id,
        "title": "Codex restore lane",
        "emoji": "[]",
        "color": "#7aa2f7",
        "groupId": "group-visible-restore",
        "initialCwd": workspace,
        "terminals": [{
            "id": session_id,
            "paneId": pane_id,
            "cols": 118,
            "rows": 33,
            "status": "stale",
            "reused": False,
        }],
        "splitLayout": {"id": pane_id, "type": "terminal"},
        "activePaneId": pane_id,
        "workstream": {
            "kind": "agent",
            "provider": "codex",
            "role": "Codex",
            "mission": mission,
            "prompt": mission,
            "cwd": workspace,
            "cwdLabel": "visible-restore-workspace",
            "startupCommand": "codex",
            "launchProfile": "terminal",
            "providerSessionId": provider_session_id,
            "restoreStatus": "resuming",
            "status": "running",
            "phase": "active",
            "currentActivity": "Resuming Codex session",
            "activityKind": "running",
            "activitySource": "structured",
            "lastSummary": "Restoring durable Codex lane",
            "nextAction": "Watch provider resume",
            "terminalOutput": "previous visible codex transcript",
            "readiness": "provider-ready",
            "readinessCheck": "Provider session id captured",
            "isolationMode": "shared-worktree",
            "isolationStatus": "shared",
            "runId": "codex-visible-restore",
            "createdAt": int(time.time() * 1000) - 5000,
            "updatedAt": int(time.time() * 1000),
            "lastActivityAt": int(time.time() * 1000),
            "events": [],
            "inputQueue": [],
        },
    }],
    "groups": [{
        "id": "group-visible-restore",
        "name": "visible-restore-workspace",
        "color": "#7aa2f7",
        "projectRoot": workspace,
        "lastActiveTabId": tab_id,
    }],
    "activeTabId": tab_id,
    "activeGroupId": "group-visible-restore",
    "activeGroupFilter": "group-visible-restore",
    "projectRoot": workspace,
    "workspaceUiState": {
        "workspaceMode": "canvas",
        "terminalRendererMode": "canvas2d",
        "primarySidebarPanel": "map",
        "primarySidebarCollapsed": False,
        "canvasSidebarCollapsed": False,
    },
    "canvasState": {
        "selectedNodeId": node_id,
        "selectedNodeIds": [node_id],
        "viewport": {"x": -120, "y": 48, "zoom": 0.82},
        "nodes": [{
            "id": node_id,
            "type": "terminal",
            "title": "Codex restore lane",
            "terminalTabId": tab_id,
            "terminalCwd": workspace,
            "x": 240,
            "y": 120,
            "width": 820,
            "height": 460,
        }],
    },
}
with open(path, "w", encoding="utf-8") as f:
    json.dump(payload, f)
PYEOF
  python3 - "$sessions_dir/$hex_id.meta.json" "$WORKSPACE" "$PROVIDER_SESSION_ID" "$BIN_DIR/codex" <<'PYEOF'
import json, sys
path, workspace, provider_session_id, fake_codex = sys.argv[1:5]
with open(path, "w", encoding="utf-8") as f:
    json.dump({
        "cwd": workspace,
        "command": "codex",
        "cols": 118,
        "rows": 33,
        "recoveryKind": "agent-terminal",
        "provider": "codex",
        "launchProfile": "terminal",
        "providerSessionId": provider_session_id,
        "originalCommand": "codex",
        "sanitizedResumeCommand": f"{fake_codex} resume {provider_session_id}",
        "mission": "Resume durable Codex lane",
        "restoreStatus": "resuming",
    }, f)
PYEOF
}

start_status_server() {
  (
    cd "$APP_ROOT"
    TERMFLEET_AGENT_STATUS_HOST=127.0.0.1 \
    TERMFLEET_AGENT_STATUS_PORT="$STATUS_PORT" \
      node scripts/agent-status-summary-server.mjs node scripts/agent-status-summary-sidecar.mjs
  ) >"$STATUS_LOG" 2>&1 &
  STATUS_PID="$!"

  for ((i = 0; i < 80; i += 1)); do
    if curl -fsS -X POST "$STATUS_ENDPOINT" \
      -H "content-type: application/json" \
      --data '{"projectId":"termfleet","workstream":{"provider":"shell","path":"termfleet"}}' \
      >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.1
  done
  echo "AGENT_RESTORE_STATUS_SERVER_NOT_READY" >&2
  return 1
}

wait_for_window() {
  local wait_limit=$((APP_BUDGET * 2))
  for ((i = 1; i <= wait_limit; i += 1)); do
    WINDOW_ID="$(wmctrl -l 2>/dev/null | awk '/TermFleet/ { print $1; exit }')"
    [[ -z "$WINDOW_ID" ]] && WINDOW_ID="$(xdotool search --name "TermFleet" 2>/dev/null | head -1)"
    [[ -n "$WINDOW_ID" ]] && return 0
    sleep 0.5
  done
  echo "AGENT_RESTORE_NO_WINDOW" >&2
  return 1
}

wait_for_daemon() {
  for ((i = 0; i < 120; i += 1)); do
    local status_json
    status_json="$(printf '{"type":"status"}' | nc -U "$SOCKET" 2>/dev/null || true)"
    if grep -q '"externalDaemon"' <<<"$status_json"; then
      return 0
    fi
    sleep 0.25
  done
  echo "AGENT_RESTORE_DAEMON_NOT_READY" >&2
  return 1
}

snapshot_session() {
  printf '{"type":"snapshotSession","id":"%s"}' "$SESSION_ID" | nc -U "$SOCKET" 2>/dev/null || true
}

wait_for_session_text() {
  local needle="$1"
  local limit="${2:-120}"
  for ((i = 0; i < limit; i += 1)); do
    local snapshot
    snapshot="$(snapshot_session)"
    if grep -Fq "$needle" <<<"$snapshot"; then
      return 0
    fi
    sleep 0.25
  done
  echo "AGENT_RESTORE_SESSION_TEXT_MISSING needle=$needle" >&2
  snapshot_session >&2
  return 1
}

wait_for_cockpit_snapshot() {
  local limit="${1:-120}"
  for ((i = 0; i < limit; i += 1)); do
    if [[ -s "$SNAPSHOT_FILE" ]] && python3 - "$SNAPSHOT_FILE" "$PANE_ID" <<'PYEOF'
import json, sys, time
path, pane_id = sys.argv[1:3]
snap = json.load(open(path, encoding="utf-8"))
age = (time.time() * 1000 - int(snap.get("updatedAt") or 0)) / 1000
if age > 20:
    sys.exit(1)
terms = snap.get("terminals") or []
for term in terms:
    if term.get("paneId") == pane_id and "Resume durable Codex lane" in str(term.get("title") or term.get("task") or ""):
        sys.exit(0)
sys.exit(1)
PYEOF
    then
      return 0
    fi
    sleep 0.25
  done
  echo "AGENT_RESTORE_COCKPIT_SNAPSHOT_MISSING" >&2
  cat "$SNAPSHOT_FILE" 2>/dev/null >&2 || true
  return 1
}

capture_window() {
  local file="$1"
  import -window "$WINDOW_ID" "$OUT_DIR/$file" 2>>"$DRIVER_LOG" || return 1
}

assert_image_signal() {
  local file="$1"
  local label="$2"
  local path="$OUT_DIR/$file"
  if [[ ! -s "$path" ]]; then
    echo "AGENT_RESTORE_SCREENSHOT_MISSING label=$label path=$path" >&2
    return 1
  fi
  local metrics
  metrics="$(magick "$path" -crop 1100x760+250+110 -colorspace Gray -format '%[mean] %[standard-deviation]' info: 2>/dev/null)" || {
    echo "AGENT_RESTORE_IMAGE_METRICS_FAILED label=$label path=$path" >&2
    return 1
  }
  python3 - "$label" "$metrics" <<'PYEOF'
import sys
label = sys.argv[1]
mean, sd = (float(part) for part in sys.argv[2].split())
if mean < 700 or sd < 700:
    print(f"AGENT_RESTORE_VISUAL_BLANK_OR_FLAT label={label} mean={mean:.1f} sd={sd:.1f}", file=sys.stderr)
    sys.exit(1)
print(f"AGENT_RESTORE_VISUAL_CONTENT label={label} mean={mean:.1f} sd={sd:.1f}")
PYEOF
}

type_into_restored_terminal() {
  xdotool windowsize "$WINDOW_ID" 1600 1000 2>>"$DRIVER_LOG" || true
  xdotool windowactivate "$WINDOW_ID" 2>>"$DRIVER_LOG" || true
  sleep 0.8
  # Click the restored terminal's visible cursor area below the agent summary.
  # This intentionally avoids the agent prompt composer, so the marker must
  # travel through the PTY input path to satisfy the verifier.
  xdotool mousemove --window "$WINDOW_ID" 700 590 click --clearmodifiers 1 || return 1
  sleep 0.4
  xdotool type --clearmodifiers --delay 0 "echo $INPUT_MARKER" || return 1
  sleep 0.2
  xdotool key --clearmodifiers Return || return 1
}

fail_with_context() {
  echo "=== driver.log ==="; cat "$DRIVER_LOG" 2>/dev/null
  echo "=== status-server.log ==="; tail -100 "$STATUS_LOG" 2>/dev/null
  echo "=== runtime.log tail ==="; tail -140 "$LOG_FILE" 2>/dev/null
  echo "=== cockpit snapshot ==="; cat "$SNAPSHOT_FILE" 2>/dev/null
  echo "=== daemon snapshot ==="; snapshot_session
  if [[ -n "$WINDOW_ID" ]]; then
    import -window "$WINDOW_ID" "$OUT_DIR/failure.png" 2>/dev/null || true
    echo "failure screenshot: $OUT_DIR/failure.png"
  fi
}

seed_fake_codex
seed_restore_fixture
start_status_server || exit 1

cd "$APP_ROOT"
TAURI_DEV_CONFIG="{\"build\":{\"devUrl\":\"http://127.0.0.1:${PORT}\",\"beforeDevCommand\":\"npm run dev -- --host 127.0.0.1 --port ${PORT} --strictPort true\"}}"
setsid timeout "$APP_BUDGET" env \
  CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-1}" \
  CARGO_PROFILE_DEV_DEBUG="${CARGO_PROFILE_DEV_DEBUG:-0}" \
  CARGO_TARGET_DIR="$CARGO_TARGET_DIR" \
  PATH="$BIN_DIR:$PATH" \
  LIBGL_ALWAYS_SOFTWARE=1 \
  WEBKIT_DISABLE_COMPOSITING_MODE=1 \
  WEBKIT_DISABLE_DMABUF_RENDERER=1 \
  TERMINAL_WORKSPACE_TRACE_PTY=1 \
  TERMINAL_WORKSPACE_TRACE_PTY_FILE="$TRACE_FILE" \
  XDG_RUNTIME_DIR="$RUN_DIR" \
  XDG_DATA_HOME="$DATA_DIR" \
  XDG_CONFIG_HOME="$CONFIG_DIR" \
  VITE_AGENT_STATUS_SUMMARY_ENDPOINT="$STATUS_ENDPOINT" \
  VITE_COCKPIT_SNAPSHOT=1 \
  VITE_TERMINAL_RENDERER_MODE=canvas2d \
  VITE_WORKSPACE_MODE=canvas \
  npm run tauri -- dev --config "$TAURI_DEV_CONFIG" >"$LOG_FILE" 2>&1 </dev/null &
APP_RUN_PID=$!

VERIFY_STATUS=0
wait_for_window || VERIFY_STATUS=$?
if (( VERIFY_STATUS == 0 )); then wait_for_daemon || VERIFY_STATUS=$?; fi
if (( VERIFY_STATUS == 0 )); then wait_for_session_text "previous visible codex transcript" || VERIFY_STATUS=$?; fi
if (( VERIFY_STATUS == 0 )); then wait_for_session_text "FAKE_CODEX_ARGS=resume $PROVIDER_SESSION_ID" || VERIFY_STATUS=$?; fi
if (( VERIFY_STATUS == 0 )); then wait_for_session_text "FAKE_CODEX_PWD=$WORKSPACE" || VERIFY_STATUS=$?; fi
if (( VERIFY_STATUS == 0 )); then wait_for_session_text "FAKE_CODEX_PANE=$SESSION_ID" || VERIFY_STATUS=$?; fi
if (( VERIFY_STATUS == 0 )); then capture_window "01-restored-agent-map.png" || VERIFY_STATUS=$?; fi
if (( VERIFY_STATUS == 0 )); then assert_image_signal "01-restored-agent-map.png" "restored-agent-map" || VERIFY_STATUS=$?; fi
if (( VERIFY_STATUS == 0 )); then type_into_restored_terminal || VERIFY_STATUS=$?; fi
if (( VERIFY_STATUS == 0 )); then wait_for_session_text "$INPUT_MARKER" 80 || VERIFY_STATUS=$?; fi
if (( VERIFY_STATUS == 0 )); then capture_window "02-restored-agent-after-input.png" || VERIFY_STATUS=$?; fi
if (( VERIFY_STATUS == 0 )); then assert_image_signal "02-restored-agent-after-input.png" "restored-agent-after-input" || VERIFY_STATUS=$?; fi

if (( VERIFY_STATUS != 0 )); then
  fail_with_context
  exit "$VERIFY_STATUS"
fi

if [[ -s "$SNAPSHOT_FILE" ]]; then
  python3 - "$SNAPSHOT_FILE" "$PANE_ID" <<'PYEOF' || true
import json, sys
path, pane_id = sys.argv[1:3]
snap = json.load(open(path, encoding="utf-8"))
matches = [term for term in (snap.get("terminals") or []) if term.get("paneId") == pane_id]
if matches:
    print("AGENT_RESTORE_VISIBLE_SNAPSHOT_OK", json.dumps(matches[-1], sort_keys=True))
PYEOF
fi

echo "AGENT_RESTORE_VISIBLE_OK session=$SESSION_ID providerSession=$PROVIDER_SESSION_ID"
echo "=== screenshots ==="; ls -1 "$OUT_DIR"/*.png 2>/dev/null
