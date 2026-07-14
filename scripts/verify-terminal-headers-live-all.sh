#!/usr/bin/env bash
# Live all-visible-terminal header verifier:
#   1. launch an isolated Tauri dev window with a verifier-only 2x2 split layout,
#   2. drive every visible real PTY with distinct output,
#   3. read the dev cockpit snapshot that every rendered header reports,
#   4. fail if any header/task/now/path is unsupported by that same terminal's data,
#   5. save a full-window screenshot, per-card crops, and a JSON report.
set -uo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${TERMINAL_HEADERS_LIVE_ALL_OUT:-/tmp/tw-terminal-headers-live-all}"
LOG_FILE="$OUT_DIR/runtime.log"
STATUS_LOG="$OUT_DIR/status-server.log"
DRIVER_LOG="$OUT_DIR/driver.log"
TRACE_FILE="$OUT_DIR/pty-trace.log"
REPORT_FILE="$OUT_DIR/report.json"
SNAPSHOT_COPY="$OUT_DIR/cockpit-snapshot.json"
RUN_DIR="$OUT_DIR/run"
DATA_DIR="$OUT_DIR/data"
FIXTURE_ROOT="$OUT_DIR/workspace"
LONG_PATH="$FIXTURE_ROOT/deep/workspace/path/for/header/verification"
CARGO_TARGET_DIR="$OUT_DIR/target"
PORT="${TERMINAL_HEADERS_LIVE_ALL_PORT:-$((19200 + RANDOM % 800))}"
STATUS_PORT="${TERMINAL_HEADERS_LIVE_ALL_STATUS_PORT:-$((38200 + RANDOM % 800))}"
STATUS_ENDPOINT="http://127.0.0.1:${STATUS_PORT}/status"
SNAPSHOT_FILE="$DATA_DIR/terminal-workspace/agent-status/cockpit-snapshot.json"
APP_BUDGET="${APP_BUDGET:-260}"
APP_RUN_PID=""
STATUS_PID=""

mkdir -p "$OUT_DIR" "$RUN_DIR" "$DATA_DIR" "$FIXTURE_ROOT" "$LONG_PATH"
chmod 700 "$RUN_DIR"

if [[ -z "${TERMINAL_HEADERS_LIVE_ALL_INNER:-}" ]]; then
  rm -f "$OUT_DIR"/*.png "$LOG_FILE" "$STATUS_LOG" "$DRIVER_LOG" "$TRACE_FILE" "$REPORT_FILE" "$SNAPSHOT_COPY"
  rm -rf "$RUN_DIR" "$DATA_DIR" "$FIXTURE_ROOT"
  mkdir -p "$RUN_DIR" "$DATA_DIR" "$FIXTURE_ROOT" "$LONG_PATH"
  chmod 700 "$RUN_DIR"
  : > "$TRACE_FILE"
  exec xvfb-run -a -s "-screen 0 1600x1000x24" \
    env \
      TERMINAL_HEADERS_LIVE_ALL_INNER=1 \
      TERMINAL_HEADERS_LIVE_ALL_OUT="$OUT_DIR" \
      XDG_RUNTIME_DIR="$RUN_DIR" \
      XDG_DATA_HOME="$DATA_DIR" \
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

shot() { import -window "$1" "$OUT_DIR/$2" 2>>"$DRIVER_LOG" || true; }

wait_for_trace() {
  local needle="$1"
  local limit="${2:-120}"
  for ((i = 0; i < limit; i += 1)); do
    if grep -Fq "$needle" "$TRACE_FILE" 2>/dev/null; then
      return 0
    fi
    sleep 0.25
  done
  echo "driver: trace marker not found: $needle" >>"$DRIVER_LOG"
  return 1
}

wait_for_snapshot_count() {
  local limit="${1:-120}"
  for ((i = 0; i < limit; i += 1)); do
    python3 - "$SNAPSHOT_FILE" <<'PYEOF' >/dev/null 2>&1 && return 0
import json, sys
snap = json.load(open(sys.argv[1], encoding="utf-8"))
terms = snap.get("terminals") if isinstance(snap, dict) else []
if len(terms) < 4:
    raise SystemExit(1)
for term in terms:
    if not str(term.get("terminalVisibleText") or term.get("terminalOutput") or "").strip():
        raise SystemExit(1)
PYEOF
    sleep 0.25
  done
  return 1
}

validate_snapshot() {
  python3 - "$SNAPSHOT_FILE" "$REPORT_FILE" "$FIXTURE_ROOT" "$LONG_PATH" <<'PYEOF'
import json, re, sys, time

snapshot_path, report_path, root, long_path = sys.argv[1:5]
snap = json.load(open(snapshot_path, encoding="utf-8"))
terminals = snap.get("terminals") if isinstance(snap, dict) else []

def clean(value):
    return re.sub(r"\s+", " ", str(value or "")).strip()

def text_blob(entry):
    parts = [
        entry.get("terminalVisibleText"),
        entry.get("terminalOutput"),
        entry.get("currentActivity"),
        entry.get("durableActivityTitle"),
        entry.get("statusSummaryTask"),
        entry.get("statusSummaryNow"),
        entry.get("statusSummaryPath"),
        entry.get("cwd"),
        entry.get("path"),
    ]
    parts.extend((item or {}).get("content") for item in entry.get("taskLineup") or [])
    return "\n".join(clean(part) for part in parts if clean(part))

def has_prompt(entry):
    blob = text_blob(entry).lower()
    return "enter to select" in blob and (
        "how do you want to proceed" in blob or
        "where to go" in blob or
        "next step" in blob
    )

def has_completed_run(entry):
    blob = text_blob(entry).lower()
    return "worked for" in blob or "completed" in blob or "done" in blob

def has_long_path(entry):
    return long_path in clean(entry.get("cwd")) or long_path in clean(entry.get("path")) or long_path in text_blob(entry)

def looks_ready_prompt(entry):
    text = str(entry.get("terminalVisibleText") or entry.get("terminalOutput") or "").replace("\r", "\n")
    lines = [line.rstrip() for line in text.split("\n") if line.strip()]
    if not lines:
        return False
    candidates = [
        lines[-1].strip(),
        "".join(lines[-2:]).strip(),
        "".join(lines[-3:]).strip(),
    ]
    return any(
        re.search(r"^[\w.@-]+@[\w.-]+:.*[$#>]\s*$", candidate) or
        re.search(r"^[\w./~+-]+[$#>]\s*$", candidate)
        for candidate in candidates
    )

def missing_task(task):
    return task in {"No task list", "Task not captured"}

def missing_activity(title, now):
    return title == "Activity not captured" or now == "Activity not captured"

def looks_low_quality_label(value, *, activity=False):
    text = clean(value)
    lower = text.lower()
    if not text:
        return "empty"
    if len(text) > (80 if activity else 96):
        return "too-long"
    if activity and re.match(r"^(working|thinking|awaiting terminal output|running terminal command|command is running)$", text, re.I):
        return "vague"
    if re.search(r"\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?[\w:-]+\b|\bnpx\s+[\w@./-]+", text, re.I):
        return "command"
    if re.match(r"^(?:\.\/|~\/|\/|cd\b|ls\b|pwd\b|cat\b|sed\b|awk\b|grep\b|rg\b|find\b|printf\b|echo\b|git\b|gh\b|node\b|python(?:3)?\b|uv\b|cargo\b|make\b|docker\b|ssh\b|curl\b|sudo\b|rm\b|mv\b|cp\b|touch\b|vim\b|tmux\b)", text, re.I):
        return "command"
    if re.search(r"(?:^|[\s\"'])/(?:home|media|tmp|var|usr|opt|data)/", text, re.I):
        return "path"
    if re.search(r"\b(?:src|tests|docs|scripts)/[\w./-]+\.(?:tsx?|jsx?|mjs|cjs|rs|md|json|sh)\b", text, re.I):
        return "path"
    if re.match(r"^[\w@./-]+@\d+\.\d+\.\d+\s+[\w:-]+(?:\s|$)", text, re.I):
        return "package-script"
    if re.search(r"\b(?:dont|doesnt|isnt|havent|ahve|brok(?:e|en)|querstions|apth|relatd|udpated|descriptuin)\b", lower):
        return "prompt-fragment"
    if re.match(r"^(?:what now|why|how is this|where is|can you|do you|ok so|so how|this is|it seems|we still|i am|i'm|you keep)\b", lower):
        return "prompt-fragment"
    if activity and re.match(r"^(?:thinking about|working on)\s+", lower):
        target = re.sub(r"^(?:thinking about|working on)\s+", "", lower)
        if re.match(r"^(?:what now|why|how is this|where is|can you|do you|ok so|so how|this is|it seems|we still)\b", target):
            return "raw-thinking-prompt"
    letters = re.sub(r"[^a-z]", "", lower)
    if len(letters) >= 8:
        vowels = len(re.findall(r"[aeiou]", letters))
        if vowels / max(1, len(letters)) < 0.18:
            return "gibberish"
    if re.search(r"\b(?:fgh|dfg|asdf|sdf|ghd|qwe|zx)\w*\b", lower):
        return "gibberish"
    return ""

failures = []
report = {
    "updatedAt": snap.get("updatedAt"),
    "ageSeconds": int((time.time() * 1000 - int(snap.get("updatedAt") or 0)) / 1000),
    "terminalCount": len(terminals),
    "terminals": [],
}

if len(terminals) < 4:
    failures.append(f"expected at least 4 rendered terminals, got {len(terminals)}")

for index, entry in enumerate(terminals):
    pane = clean(entry.get("paneId")) or f"index-{index}"
    title = clean(entry.get("title"))
    now = clean(entry.get("now"))
    task = clean(entry.get("task"))
    path = clean(entry.get("path") or entry.get("cwd"))
    visible = clean(entry.get("terminalVisibleText"))
    output = clean(entry.get("terminalOutput"))
    blob = text_blob(entry)
    row = {
        "paneId": pane,
        "terminalId": entry.get("terminalId"),
        "cwd": entry.get("cwd"),
        "path": path,
        "task": task,
        "taskSource": entry.get("taskSource"),
        "title": title,
        "titleSource": entry.get("titleSource"),
        "now": now,
        "nowSource": entry.get("nowSource"),
        "status": entry.get("status"),
        "visibleText": visible,
        "terminalOutput": output,
        "durableActivityTitle": entry.get("durableActivityTitle"),
        "currentActivity": entry.get("currentActivity"),
    }
    report["terminals"].append(row)

    if not visible:
        failures.append(f"{pane}: missing same-terminal visible grid text")
    if not path or path == "workspace path unknown":
        failures.append(f"{pane}: missing concrete path")
    if task and not missing_task(task):
        allowed_task_source = clean(entry.get("taskSource")) in {
            "task-tool", "sidecar", "user-prompt", "agent-status", "status-summary"
        }
        if not allowed_task_source and task not in blob:
            failures.append(f"{pane}: task {task!r} is not justified by source or terminal text")
    if task == "Task not captured":
        failures.append(f"{pane}: durable task was not captured")
    if missing_activity(title, now):
        failures.append(f"{pane}: current activity was not captured")
    if not missing_task(task):
        reason = looks_low_quality_label(task)
        if reason:
            failures.append(f"{pane}: low-quality task label ({reason}): {task!r}")
    for field_name, value in (("title", title), ("now", now)):
        if value and not missing_activity(value, value):
            reason = looks_low_quality_label(value, activity=True)
            if reason:
                failures.append(f"{pane}: low-quality {field_name} label ({reason}): {value!r}")

    combined_header = f"{title}\n{now}"
    if task and title and task.lower() == title.lower() and len(task) > 48:
        failures.append(f"{pane}: title duplicates long task: {title!r}")
    if re.search(r"\bnpm\s+(?:run\s+)?test\b", combined_header, re.I):
        failures.append(f"{pane}: stale command leaked into header: {combined_header!r}")
    if "income-zen" in combined_header or "arthouse" in combined_header:
        if "income-zen" not in blob and "arthouse" not in blob:
            failures.append(f"{pane}: foreign project label leaked into header: {combined_header!r}")
    if title == "Waiting for operator selection" or now == "Waiting for operator selection":
        if not has_prompt(entry):
            failures.append(f"{pane}: waiting-for-operator header without a same-terminal prompt")
    if title == "Idle" and has_prompt(entry):
        failures.append(f"{pane}: prompt terminal rendered as Idle")
    if title == "Working" and looks_ready_prompt(entry) and not has_prompt(entry):
        failures.append(f"{pane}: ready shell prompt rendered as Working")
    if has_completed_run(entry) and "npm test" in blob.lower() and "npm test" in combined_header.lower():
        failures.append(f"{pane}: completed npm-test transcript still rendered npm test in header")
    if missing_task(task) and not has_prompt(entry):
        cwd_base = clean(path).rstrip("/").split("/")[-1]
        if title == cwd_base and clean(entry.get("titleSource")) == "durable-command":
            failures.append(f"{pane}: cwd basename {title!r} rendered as activity title")

if not any(has_prompt(entry) for entry in terminals):
    failures.append("fixture did not render an operator-selection prompt terminal")
if not any(has_completed_run(entry) and "npm test" in text_blob(entry).lower() for entry in terminals):
    failures.append("fixture did not render a completed stale npm-test terminal")
if not any(has_long_path(entry) for entry in terminals):
    failures.append("fixture did not render the long-path terminal")

report["ok"] = not failures
report["failures"] = failures
with open(report_path, "w", encoding="utf-8") as handle:
    json.dump(report, handle, indent=2)

if failures:
    print("TERMINAL_HEADERS_LIVE_ALL_FAILED")
    for failure in failures:
        print(f"- {failure}")
    raise SystemExit(1)

print(f"TERMINAL_HEADERS_LIVE_ALL_OK terminals={len(terminals)} age={report['ageSeconds']}s report={report_path}")
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
  echo "TERMINAL_HEADERS_STATUS_SERVER_NOT_READY" >&2
  return 1
}

type_command() {
  local wid="$1"
  local x="$2"
  local y="$3"
  local command="$4"
  xdotool mousemove --window "$wid" "$x" "$y" click --clearmodifiers 1
  sleep 0.35
  xdotool type --clearmodifiers --delay 0 "$command"
  xdotool key --clearmodifiers Return
}

drive() {
  local wid=""
  local wait_limit=$((APP_BUDGET * 2))
  for ((i = 1; i <= wait_limit; i += 1)); do
    wid="$(wmctrl -l 2>/dev/null | awk '/TermFleet/ { print $1; exit }')"
    [[ -z "$wid" ]] && wid="$(xdotool search --name "TermFleet" 2>/dev/null | head -1)"
    [[ -n "$wid" ]] && break
    sleep 0.5
  done
  if [[ -z "$wid" ]]; then echo "driver: no window" >>"$DRIVER_LOG"; return 1; fi
  echo "driver: window=$wid" >>"$DRIVER_LOG"

  xdotool windowsize "$wid" 1600 1000 2>>"$DRIVER_LOG" || true
  xdotool windowactivate "$wid" 2>>"$DRIVER_LOG" || true
  sleep 8
  shot "$wid" "01-boot.png"

  local prompt_cmd stale_cmd idle_cmd long_cmd
  prompt_cmd="printf 'Where to go:\nNext step\nThe GI-lightmap pipeline is proven end-to-end. How do you want to proceed?\n1. Commit + pause here\n2. Push on to full shell now\n3. Commit, then continue\n4. Type something.\nEnter to select - Up/Down to navigate - Esc to cancel\n'; echo TF_HDR_PROMPT_DONE"
  stale_cmd="printf 'npm test\nWorked for 1m 24s\nRoot Cause\n'; echo TF_HDR_STALE_DONE"
  idle_cmd="printf 'Header verifier idle terminal\n'; echo TF_HDR_IDLE_DONE"
  long_cmd="pwd; printf 'Header verifier long path terminal\n'; echo TF_HDR_LONG_DONE"

  type_command "$wid" 470 315 "$prompt_cmd"
  wait_for_trace "TF_HDR_PROMPT_DONE" 100 || return 1
  type_command "$wid" 1190 315 "$stale_cmd"
  wait_for_trace "TF_HDR_STALE_DONE" 100 || return 1
  type_command "$wid" 470 745 "$idle_cmd"
  wait_for_trace "TF_HDR_IDLE_DONE" 100 || return 1
  type_command "$wid" 1190 745 "$long_cmd"
  wait_for_trace "TF_HDR_LONG_DONE" 100 || return 1

  sleep 3
  shot "$wid" "02-all-terminals.png"
  wait_for_snapshot_count 160 || return 1
  cp "$SNAPSHOT_FILE" "$SNAPSHOT_COPY" 2>/dev/null || true
  validate_snapshot || return 1

  # Fixed crops for the verifier fixture's 2x2 split panes. The JSON report is
  # the source of truth; crops are for fast visual inspection.
  magick "$OUT_DIR/02-all-terminals.png" -crop 720x385+330+155 "$OUT_DIR/card-01-prompt.png" 2>>"$DRIVER_LOG" || true
  magick "$OUT_DIR/02-all-terminals.png" -crop 720x385+885+155 "$OUT_DIR/card-02-stale.png" 2>>"$DRIVER_LOG" || true
  magick "$OUT_DIR/02-all-terminals.png" -crop 720x385+330+530 "$OUT_DIR/card-03-idle.png" 2>>"$DRIVER_LOG" || true
  magick "$OUT_DIR/02-all-terminals.png" -crop 720x385+885+530 "$OUT_DIR/card-04-long-path.png" 2>>"$DRIVER_LOG" || true
  echo "driver: done" >>"$DRIVER_LOG"
}

start_status_server || exit 1

cd "$APP_ROOT"
TAURI_DEV_CONFIG="{\"build\":{\"devUrl\":\"http://127.0.0.1:${PORT}\",\"beforeDevCommand\":\"npm run dev -- --host 127.0.0.1 --port ${PORT} --strictPort true\"}}"
setsid timeout "$APP_BUDGET" env \
  CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-1}" \
  CARGO_PROFILE_DEV_DEBUG="${CARGO_PROFILE_DEV_DEBUG:-0}" \
  CARGO_TARGET_DIR="$CARGO_TARGET_DIR" \
  LIBGL_ALWAYS_SOFTWARE=1 \
  WEBKIT_DISABLE_COMPOSITING_MODE=1 \
  WEBKIT_DISABLE_DMABUF_RENDERER=1 \
  TERMINAL_WORKSPACE_TRACE_PTY=1 \
  TERMINAL_WORKSPACE_TRACE_PTY_FILE="$TRACE_FILE" \
  XDG_RUNTIME_DIR="$RUN_DIR" \
  XDG_DATA_HOME="$DATA_DIR" \
  VITE_AGENT_STATUS_SUMMARY_ENDPOINT="$STATUS_ENDPOINT" \
  VITE_COCKPIT_SNAPSHOT=1 \
  VITE_TERMINAL_RENDERER_MODE=canvas2d \
  VITE_WORKSPACE_MODE=split \
  VITE_WORKSPACE_RESET_STATE=1 \
  VITE_TERMINAL_HEADER_VERIFIER_FIXTURE=1 \
  VITE_TERMINAL_HEADER_VERIFIER_ROOT="$FIXTURE_ROOT" \
  VITE_TERMINAL_HEADER_VERIFIER_LONG_PATH="$LONG_PATH" \
  npm run tauri -- dev --config "$TAURI_DEV_CONFIG" >"$LOG_FILE" 2>&1 </dev/null &
APP_RUN_PID=$!

VERIFY_STATUS=0
drive || VERIFY_STATUS=$?
sync
sleep 1

if (( VERIFY_STATUS != 0 )); then
  echo "=== driver.log ==="; cat "$DRIVER_LOG" 2>/dev/null
  echo "=== report ==="; cat "$REPORT_FILE" 2>/dev/null
  echo "=== snapshot ==="; cat "$SNAPSHOT_FILE" 2>/dev/null
  echo "=== status-server.log ==="; tail -80 "$STATUS_LOG" 2>/dev/null
  echo "=== runtime.log tail ==="; tail -120 "$LOG_FILE" 2>/dev/null
  echo "=== trace tail ==="; tail -120 "$TRACE_FILE" 2>/dev/null
  echo "=== screenshots ==="; ls -1 "$OUT_DIR"/*.png 2>/dev/null
  exit "$VERIFY_STATUS"
fi

echo "=== driver.log ==="; cat "$DRIVER_LOG" 2>/dev/null
echo "=== report ==="; cat "$REPORT_FILE" 2>/dev/null
echo "=== screenshots ==="; ls -1 "$OUT_DIR"/*.png 2>/dev/null
