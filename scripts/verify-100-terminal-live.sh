#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_ROOT="${TERMFLEET_100_SOAK_OUT:-/tmp/tw-100-terminal-soak}"
RUN_ID="${TERMFLEET_100_SOAK_RUN_ID:-$(date +%Y%m%d-%H%M%S)-$$}"
OUT_DIR="$OUT_ROOT/$RUN_ID"
RUN_DIR="$OUT_DIR/runtime"
DATA_DIR="$OUT_DIR/data"
TARGET_DIR="$OUT_DIR/target"
SOCKET="$RUN_DIR/terminal-workspace/daemon.sock"
APP_BIN="${TERMFLEET_100_SOAK_BINARY:-$TARGET_DIR/release/terminal-workspace}"
WINDOW_ID=""
APP_PID=""

mkdir -p "$OUT_DIR" "$RUN_DIR" "$DATA_DIR" "$TARGET_DIR"
chmod 700 "$RUN_DIR"
echo "TERMFLEET_100_SOAK_RUN_DIR=$OUT_DIR"

if [[ -z "${TERMFLEET_100_SOAK_INNER:-}" ]]; then
  if [[ ! -x "$APP_BIN" || "${TERMFLEET_100_SOAK_REBUILD:-1}" == "1" ]]; then
    cd "$APP_ROOT"
    env \
      VITE_TERMINAL_100_SOAK=1 \
      VITE_WORKSPACE_RESET_STATE=1 \
      VITE_WORKSPACE_MODE=canvas \
      VITE_TERMINAL_RENDERER_MODE=canvas2d \
      CARGO_TARGET_DIR="$TARGET_DIR" \
      CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-1}" \
      CARGO_PROFILE_RELEASE_DEBUG=0 \
      npm run tauri build -- --no-bundle >"$OUT_DIR/build.log" 2>&1
  fi
  exec xvfb-run -a -s "-screen 0 1600x1000x24" \
    env TERMFLEET_100_SOAK_INNER=1 TERMFLEET_100_SOAK_OUT="$OUT_ROOT" \
      TERMFLEET_100_SOAK_RUN_ID="$RUN_ID" bash "${BASH_SOURCE[0]}"
fi

cleanup() {
  if [[ -n "$APP_PID" ]]; then
    kill -- "-$APP_PID" >/dev/null 2>&1 || kill "$APP_PID" >/dev/null 2>&1 || true
    wait "$APP_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

setsid env \
  XDG_RUNTIME_DIR="$RUN_DIR" \
  XDG_DATA_HOME="$DATA_DIR" \
  "$APP_BIN" >"$OUT_DIR/app.log" 2>&1 &
APP_PID="$!"

count_sessions() {
  python3 - "$SOCKET" <<'PY'
import json, socket, sys
path = sys.argv[1]
try:
    client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    client.settimeout(2)
    client.connect(path)
    client.sendall(b'{"type":"listSessions"}\n')
    client.shutdown(socket.SHUT_WR)
    response = client.recv(1024 * 1024)
    payload = json.loads(response.decode("utf-8", "replace"))
    print(len(payload.get("sessions", [])))
except Exception:
    print(0)
PY
}

seed_sessions() {
  python3 - "$SOCKET" <<'PY'
import json, socket, sys
path = sys.argv[1]
def request(payload):
    client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    client.settimeout(4)
    client.connect(path)
    client.sendall((json.dumps(payload) + "\n").encode())
    client.shutdown(socket.SHUT_WR)
    response = client.recv(1024 * 1024)
    client.close()
    return json.loads(response.decode("utf-8", "replace"))
for index in range(100):
    request({
        "type": "ensureSession",
        "id": f"terminal-100-load-{index:03d}",
        "cwd": "/tmp",
        "command": "sleep 300",
        "cols": 100,
        "rows": 30,
    })
PY
}

probe_app_snapshot() {
  python3 - "$SOCKET" "$1" <<'PY'
import json, socket, sys, time
path, suffix = sys.argv[1], sys.argv[2]
marker = f"TERMFLEET_100_SOAK_VISIBLE_{suffix}"
def request(payload):
    client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    client.settimeout(4)
    client.connect(path)
    client.sendall((json.dumps(payload) + "\n").encode())
    client.shutdown(socket.SHUT_WR)
    response = client.recv(1024 * 1024)
    client.close()
    return json.loads(response.decode("utf-8", "replace"))
sessions = request({"type": "listSessions"}).get("sessions", [])
app = next((item for item in sessions if not str(item.get("id", "")).startswith("terminal-100-load-")), None)
if not app:
    raise SystemExit("app session not found")
started = time.monotonic()
request({
    "type": "writeSession",
    "id": app["id"],
    "data": f"printf '{marker}\\n'\n",
})
deadline = started + 3.0
while time.monotonic() < deadline:
    snapshot = request({"type": "snapshotSession", "id": app["id"]}).get("data", "")
    if marker in snapshot:
        print(round((time.monotonic() - started) * 1000))
        raise SystemExit(0)
    time.sleep(0.01)
raise SystemExit(f"snapshot marker missing: {marker}")
PY
}

find_app_window() {
  local best=""
  local best_area=0
  local candidate geometry width height area
  while read -r candidate; do
    [[ -n "$candidate" ]] || continue
    geometry="$(xdotool getwindowgeometry --shell "$candidate" 2>/dev/null || true)"
    width="$(printf '%s\n' "$geometry" | sed -n 's/^WIDTH=//p')"
    height="$(printf '%s\n' "$geometry" | sed -n 's/^HEIGHT=//p')"
    [[ "$width" =~ ^[0-9]+$ && "$height" =~ ^[0-9]+$ ]] || continue
    area=$((width * height))
    if (( area > best_area )); then
      best="$candidate"
      best_area="$area"
    fi
  done < <(xdotool search --name TermFleet 2>/dev/null || true)
  printf '%s' "$best"
}

for _ in $(seq 1 180); do
  WINDOW_ID="$(find_app_window)"
  [[ -n "$WINDOW_ID" && -S "$SOCKET" ]] && break
  sleep 1
done
if [[ -z "$WINDOW_ID" || ! -S "$SOCKET" ]]; then
  echo "TERMFLEET_100_SOAK_STARTUP_FAILED" >&2
  exit 1
fi

sleep 5
seed_sessions
echo "TERMFLEET_100_SOAK_SESSIONS_SEEDED"

for _ in $(seq 1 120); do
  SESSION_COUNT="$(count_sessions)"
  (( SESSION_COUNT >= 100 )) && break
  sleep 1
done
SESSION_COUNT="$(count_sessions)"
echo "TERMFLEET_100_SOAK_SESSION_COUNT=$SESSION_COUNT"
if (( SESSION_COUNT < 100 )); then
  echo "TERMFLEET_100_SOAK_SESSION_COUNT_FAILED count=$SESSION_COUNT" >&2
  exit 1
fi

latencies=""
for index in 1 2 3 4 5; do
  latency="$(probe_app_snapshot "$index")"
  latencies="${latencies}${latencies:+,}${latency}"
done

if ! command -v xwd >/dev/null || ! command -v magick >/dev/null; then
  echo "TERMFLEET_100_SOAK_MISSING_VISUAL_TOOLS" >&2
  exit 1
fi
visual_before="$OUT_DIR/visual-before.xwd"
visual_after="$OUT_DIR/visual-after.xwd"
if xwd -silent -id "$WINDOW_ID" -out "$visual_before" 2>"$OUT_DIR/visual-before.error"; then
  probe_app_snapshot "visual"
  sleep 0.2
  if xwd -silent -id "$WINDOW_ID" -out "$visual_after" 2>"$OUT_DIR/visual-after.error"; then
    visual_changed="$(magick compare -metric AE "$visual_before" "$visual_after" null: 2>&1 | sed -n 's/[^0-9]*\([0-9][0-9]*\).*/\1/p' | head -1 || true)"
    visual_changed="${visual_changed:-0}"
    echo "TERMFLEET_100_SOAK_VISUAL_CHANGED_PIXELS=$visual_changed"
    if (( visual_changed <= 100 )); then
      echo "TERMFLEET_100_SOAK_VISUAL_REPAINT_FAILED" >&2
      exit 1
    fi
  else
    echo "TERMFLEET_100_SOAK_VISUAL_CAPTURE_UNAVAILABLE phase=after" >&2
  fi
else
  echo "TERMFLEET_100_SOAK_VISUAL_CAPTURE_UNAVAILABLE phase=before" >&2
fi

python3 - "$SESSION_COUNT" "$latencies" <<'PY'
import math, sys
count = int(sys.argv[1])
values = sorted(float(value) for value in sys.argv[2].split(",") if value)
p95 = values[min(len(values) - 1, math.ceil(len(values) * .95) - 1)]
print(f"TERMFLEET_100_SOAK_OK sessions={count} pty_to_snapshot_p95_ms={p95:.1f} pty_to_snapshot_max_ms={max(values):.1f}")
if p95 > 150 or max(values) > 500:
    raise SystemExit("TERMFLEET_100_SOAK_PTY_TO_SNAPSHOT_BUDGET_FAILED")
PY
