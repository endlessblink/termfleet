#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -z "${MAP_CONNECT_XVFB:-}" ]]; then
  exec xvfb-run -a -s "-screen 0 1600x1000x24" env MAP_CONNECT_XVFB=1 bash "${BASH_SOURCE[0]}" "$@"
fi

BINARY="${TERMFLEET_RELEASE_BINARY:-$(readlink -f "$HOME/.local/share/termfleet/current/termfleet" 2>/dev/null || true)}"
if [[ -z "$BINARY" || ! -x "$BINARY" ]]; then
  BINARY="$(find "$HOME/.local/share/termfleet/releases" -maxdepth 2 -type f -name termfleet -perm -u+x -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -1 | cut -d' ' -f2-)"
fi
[[ -x "$BINARY" ]] || { echo "MAP_CONNECT_RELEASE_BINARY_MISSING" >&2; exit 1; }

RUN_DIR="$(mktemp -d /tmp/termfleet-map-connect.XXXXXX)"
TRACE_FILE="$RUN_DIR/pty-trace.log"
APP_LOG="$RUN_DIR/app.log"
APP_PID=""
cleanup() {
  if [[ -n "$APP_PID" ]]; then
    kill -- "-$APP_PID" >/dev/null 2>&1 || true
    wait "$APP_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

mkdir -p "$RUN_DIR/xdg-runtime" "$RUN_DIR/xdg-data"
chmod 700 "$RUN_DIR/xdg-runtime"
: > "$TRACE_FILE"

setsid env \
  LIBGL_ALWAYS_SOFTWARE=1 \
  WEBKIT_DISABLE_COMPOSITING_MODE=1 \
  WEBKIT_DISABLE_DMABUF_RENDERER=1 \
  TERMINAL_WORKSPACE_TRACE_LATENCY=1 \
  TERMINAL_WORKSPACE_TRACE_PTY=1 \
  TERMINAL_WORKSPACE_TRACE_PTY_FILE="$TRACE_FILE" \
  TMPDIR="$RUN_DIR" \
  XDG_RUNTIME_DIR="$RUN_DIR/xdg-runtime" \
  XDG_DATA_HOME="$RUN_DIR/xdg-data" \
  VITE_TERMINAL_RENDERER_MODE=canvas2d \
  VITE_WORKSPACE_MODE=canvas \
  VITE_WORKSPACE_RESET_STATE=1 \
  "$BINARY" >"$APP_LOG" 2>&1 < /dev/null &
APP_PID=$!

WID=""
for _ in $(seq 1 120); do
  if [[ "${DISPLAY:-}" == ":0" ]]; then
    WID="$(wmctrl -l -p 2>/dev/null | awk -v pid="$APP_PID" '$3 == pid { print $1; exit }' || true)"
  else
    WID="$(xdotool search --pid "$APP_PID" 2>/dev/null | head -1 || true)"
  fi
  [[ -n "$WID" ]] && break
  sleep 0.5
done
[[ -n "$WID" ]] || { echo "MAP_CONNECT_RELEASE_WINDOW_MISSING" >&2; exit 1; }

xdotool windowsize "$WID" 1600 1000 || true
xdotool windowactivate "$WID" || true
sleep 8

# Open the map rail, then activate the visible Connect terminal action on the
# reset map node at the fixed verification geometry.
xdotool mousemove --window "$WID" 21 150 click --clearmodifiers 1
sleep 2
xdotool mousemove --window "$WID" 400 300 click --clearmodifiers 1
sleep 2
CONNECT_X=949
CONNECT_Y=632
if [[ "${DISPLAY:-}" == ":0" ]]; then
  timeout 5s import -window "$WID" "$RUN_DIR/map.png" >/dev/null 2>&1 || true
  CONNECT_COORDS="$(timeout 5s tesseract "$RUN_DIR/map.png" stdout --psm 11 tsv 2>/dev/null | awk -F '\t' 'NR > 1 && tolower($12) ~ /connect/ { print int($7 + ($9 / 2)), int($8 + ($10 / 2)); exit }')"
  if [[ -n "$CONNECT_COORDS" ]]; then
    read -r CONNECT_X CONNECT_Y <<< "$CONNECT_COORDS"
  else
    echo "MAP_CONNECT_RELEASE_BUTTON_NOT_FOUND" >&2
    exit 1
  fi
fi
xdotool mousemove --window "$WID" "$CONNECT_X" "$CONNECT_Y" click --clearmodifiers 1
sleep 4
# Re-enter the rendered terminal surface after the button click so this probe
# separates connection/mounting from the X11 focus policy of the harness.
xdotool mousemove --window "$WID" 760 500 click --clearmodifiers 1
sleep 0.5

TOKEN="MAP_CONNECT_CHECK_0811"
timeout 5s xdotool type --clearmodifiers --delay 10 "$TOKEN"
timeout 5s xdotool key --clearmodifiers Return

for _ in $(seq 1 30); do
  if rg -F "$TOKEN" "$TRACE_FILE" >/dev/null 2>&1; then
    echo "MAP_CONNECT_RELEASE_PTY_WRITE_OK binary=$BINARY token=$TOKEN"
    exit 0
  fi
  sleep 0.25
done

echo "MAP_CONNECT_RELEASE_PTY_WRITE_MISSING binary=$BINARY token=$TOKEN" >&2
echo "=== trace ===" >&2
tail -80 "$TRACE_FILE" >&2 || true
echo "=== app log ===" >&2
tail -40 "$APP_LOG" >&2 || true
echo "=== frontend traces ===" >&2
find "$RUN_DIR" -maxdepth 1 -type f -name 'terminal-workspace-latency-trace-*.jsonl' -print -exec tail -80 {} \; >&2 || true
exit 1
