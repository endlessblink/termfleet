#!/usr/bin/env bash
# Live proof that the map's "Connect terminal" button hands the keyboard to the
# terminal it is attached to.
#
# Isolation: private Xvfb display, private XDG_RUNTIME_DIR / XDG_DATA_HOME and
# therefore a private PTY daemon. It never touches the operator's real TermFleet
# daemon, real terminals, or real screen.
#
# The proof is not "a button exists" and not "a terminal mounted": the driver
# clicks the visible Connect control, types a unique marker, and the marker must
# come back out of the private daemon's own session scrollback (a real PTY write)
# AND be visible in the captured window.
set -uo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_ROOT="${MAP_CONNECT_OUT:-/tmp/tw-map-connect}"
RUN_ID="${MAP_CONNECT_RUN_ID:-$(date +%Y%m%d-%H%M%S)-$$}"
OUT_DIR="${MAP_CONNECT_RUN_DIR:-$OUT_ROOT/$RUN_ID}"
LOG_FILE="$OUT_DIR/runtime.log"
DRIVER_LOG="$OUT_DIR/driver.log"
RUN_DIR="$OUT_DIR/run"
DATA_DIR="$OUT_DIR/data"
SOCKET="$RUN_DIR/terminal-workspace/daemon.sock"
CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$APP_ROOT/src-tauri/target}"
PORT="${MAP_CONNECT_PORT:-$((19000 + RANDOM % 900))}"
APP_BUDGET="${APP_BUDGET:-300}"
MARKER="${MAP_CONNECT_MARKER:-tfconnect$RANDOM}"
APP_RUN_PID=""

mkdir -p "$OUT_DIR" "$RUN_DIR" "$DATA_DIR"
chmod 700 "$RUN_DIR"
echo "MAP_CONNECT_RUN_DIR=$OUT_DIR"
echo "MAP_CONNECT_MARKER=$MARKER"

if [[ -z "${MAP_CONNECT_INNER:-}" ]]; then
  exec xvfb-run -a -s "-screen 0 1800x1100x24" \
    env \
      MAP_CONNECT_INNER=1 \
      MAP_CONNECT_RUN_DIR="$OUT_DIR" \
      MAP_CONNECT_MARKER="$MARKER" \
      MAP_CONNECT_PORT="$PORT" \
      CARGO_TARGET_DIR="$CARGO_TARGET_DIR" \
      XDG_RUNTIME_DIR="$RUN_DIR" \
      XDG_DATA_HOME="$DATA_DIR" \
      bash "${BASH_SOURCE[0]}" "$@"
fi

private_daemon_pid() {
  python3 - "$SOCKET" <<'PYEOF' 2>/dev/null || true
import json, socket, sys
try:
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    s.settimeout(0.4)
    s.connect(sys.argv[1])
    s.sendall(b'{"type":"status"}')
    s.shutdown(socket.SHUT_WR)
    pid = json.loads(s.recv(4096).decode("utf-8", "replace")).get("pid")
    s.close()
    if pid:
        print(pid)
except Exception:
    pass
PYEOF
}

cleanup() {
  if [[ -n "$APP_RUN_PID" ]]; then
    kill -- "-$APP_RUN_PID" >/dev/null 2>&1 || true
    wait "$APP_RUN_PID" >/dev/null 2>&1 || true
    APP_RUN_PID=""
  fi
  local daemon_pid
  daemon_pid="$(private_daemon_pid)"
  [[ -n "$daemon_pid" ]] && kill "$daemon_pid" >/dev/null 2>&1 || true
}
trap cleanup EXIT

shot() { import -window "$1" "$OUT_DIR/$2" 2>>"$DRIVER_LOG" || true; }

drive() {
  local wid=""
  for ((i = 1; i <= APP_BUDGET * 2; i += 1)); do
    wid="$(xdotool search --name "TermFleet" 2>/dev/null | head -1)"
    [[ -n "$wid" ]] && break
    sleep 0.5
  done
  if [[ -z "$wid" ]]; then echo "MAP_CONNECT_WINDOW_MISSING" >>"$DRIVER_LOG"; return 1; fi
  echo "driver: window=$wid" >>"$DRIVER_LOG"

  xdotool windowsize "$wid" 1800 1100 2>>"$DRIVER_LOG" || true
  # Xvfb runs without a window manager, so _NET_ACTIVE_WINDOW is unavailable.
  # windowfocus sets the X input focus directly, which is what keystrokes follow.
  xdotool windowactivate --sync "$wid" 2>>"$DRIVER_LOG" || true
  xdotool windowfocus --sync "$wid" 2>>"$DRIVER_LOG" || true
  sleep 12
  shot "$wid" "01-map-boot.png"

  # The reset canvas seeds a "Workspace Map" note that overlaps the terminal
  # card's header (and therefore the Connect control). Dismiss it so the click
  # below lands on the real, visible button.
  if [[ -n "${MAP_CONNECT_DISMISS_XY:-}" ]]; then
    xdotool mousemove --window "$wid" ${MAP_CONNECT_DISMISS_XY/,/ } click --clearmodifiers 1
    sleep 1.5
    shot "$wid" "01b-note-dismissed.png"
  fi

  # A one-card map cannot expose a wrong-terminal handoff: the only input in the
  # DOM is the right one. Add a second terminal card so "Connect on card B" has a
  # card A to be wrongly handed to - which is the operator's real map shape.
  if [[ -n "${MAP_CONNECT_ADD_TERMINAL_XY:-}" ]]; then
    xdotool mousemove --window "$wid" ${MAP_CONNECT_ADD_TERMINAL_XY/,/ } click --clearmodifiers 1
    sleep 10
    xdotool mousemove --window "$wid" 40 1050 click --clearmodifiers 1
    sleep 1
    shot "$wid" "01c-second-terminal.png"
  fi

  # Coordinates come from MAP_CONNECT_BUTTON_XY (read off 01-map-boot.png by the
  # operator/agent on the first run) so the click is a real click on the visible
  # control rather than a synthetic DOM event.
  local bx="${MAP_CONNECT_BUTTON_X:-0}"
  local by="${MAP_CONNECT_BUTTON_Y:-0}"
  if (( bx == 0 || by == 0 )); then
    echo "MAP_CONNECT_NEED_BUTTON_COORDS see $OUT_DIR/01-map-boot.png" >>"$DRIVER_LOG"
    echo "MAP_CONNECT_NEED_BUTTON_COORDS see $OUT_DIR/01-map-boot.png"
    return 2
  fi

  # Park the pointer away from the card first, so nothing is focused by accident.
  xdotool mousemove --window "$wid" 40 1050 click --clearmodifiers 1
  sleep 1
  shot "$wid" "02-before-connect.png"

  xdotool mousemove --window "$wid" "$bx" "$by" 2>>"$DRIVER_LOG"
  sleep 0.4
  xdotool click --clearmodifiers 1 2>>"$DRIVER_LOG"
  echo "driver: clicked Connect at $bx,$by" >>"$DRIVER_LOG"
  # MAP_CONNECT_SETTLE_S=0 types while Connect still holds DOM focus. On the
  # operator's ~25-card map the focus handoff routinely loses that race, so this
  # is the deterministic stand-in for a loaded map: if keyboard ownership is
  # decided by "is a button focused", the keystrokes are refused and land nowhere.
  sleep "${MAP_CONNECT_SETTLE_S:-6}"
  shot "$wid" "03-after-connect.png"

  xdotool type --clearmodifiers --delay 40 "$MARKER"
  sleep 3
  shot "$wid" "04-after-typing.png"
  echo "driver: typed marker $MARKER" >>"$DRIVER_LOG"
  return 0
}

drive &
DRIVER_PID=$!

cd "$APP_ROOT"
TAURI_DEV_CONFIG="{\"build\":{\"devUrl\":\"http://127.0.0.1:${PORT}\",\"beforeDevCommand\":\"npm run dev -- --host 127.0.0.1 --port ${PORT} --strictPort true\"}}"
setsid timeout "$APP_BUDGET" env \
  CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-2}" \
  CARGO_PROFILE_DEV_DEBUG=0 \
  CARGO_TARGET_DIR="$CARGO_TARGET_DIR" \
  LIBGL_ALWAYS_SOFTWARE=1 \
  WEBKIT_DISABLE_COMPOSITING_MODE=1 \
  WEBKIT_DISABLE_DMABUF_RENDERER=1 \
  XDG_RUNTIME_DIR="$RUN_DIR" \
  XDG_DATA_HOME="$DATA_DIR" \
  TERMFLEET_MAP_CONNECT_TRACE=1 \
  VITE_TERMINAL_RENDERER_MODE=canvas2d \
  VITE_WORKSPACE_MODE=canvas \
  VITE_WORKSPACE_RESET_STATE=1 \
  npm run tauri -- dev --config "$TAURI_DEV_CONFIG" >"$LOG_FILE" 2>&1 </dev/null &
APP_RUN_PID=$!

wait "$DRIVER_PID"
DRIVER_STATUS=$?

# --- Proof 1: the marker really reached a PTY owned by the private daemon. ---
python3 - "$SOCKET" "$MARKER" "$OUT_DIR" <<'PYEOF' | tee "$OUT_DIR/pty-proof.txt"
import json, socket, sys, time

socket_path, marker, out_dir = sys.argv[1], sys.argv[2], sys.argv[3]


def request(payload):
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as stream:
        stream.settimeout(4)
        stream.connect(socket_path)
        stream.sendall(json.dumps(payload).encode())
        stream.shutdown(socket.SHUT_WR)
        return json.loads(stream.makefile("rb").read().decode() or "{}")


try:
    sessions = request({"type": "listSessions"}).get("sessions", [])
except Exception as error:  # daemon already gone
    print(f"MAP_CONNECT_PTY_UNREACHABLE {error}")
    raise SystemExit(3)

print(f"sessions={[s['id'] for s in sessions]}")
hits = []
for session in sessions:
    try:
        data = request({"type": "snapshotSession", "id": session["id"]}).get("data", "")
    except Exception:
        continue
    if marker in data:
        hits.append(session["id"])
    with open(f"{out_dir}/snapshot-{session['id']}.txt", "w", encoding="utf-8") as fh:
        fh.write(data)

if hits:
    print(f"MAP_CONNECT_PTY_WRITE_OK sessions={hits}")
else:
    print("MAP_CONNECT_PTY_WRITE_MISSING the marker never reached any PTY")
    raise SystemExit(1)
PYEOF
PTY_STATUS=${PIPESTATUS[0]}

echo "=== driver.log ==="; cat "$DRIVER_LOG" 2>/dev/null || true
echo "=== connect trace (from the app's console) ==="
grep -a "MAP_CONNECT_TRACE" "$LOG_FILE" 2>/dev/null | tail -60 || true
echo "=== screenshots ==="; ls -1 "$OUT_DIR"/*.png 2>/dev/null || true
echo "=== run output ==="; echo "$OUT_DIR"

if (( DRIVER_STATUS != 0 )); then exit "$DRIVER_STATUS"; fi
exit "$PTY_STATUS"
