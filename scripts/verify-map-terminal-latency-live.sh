#!/usr/bin/env bash
# Live map-terminal latency verifier.
#
# This harness is intentionally isolated: it uses a private Xvfb display,
# XDG_RUNTIME_DIR, XDG_DATA_HOME, and daemon socket. It must never touch the
# user's real TermFleet daemon or kill user PTYs.
set -uo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_ROOT="${MAP_LATENCY_OUT:-/tmp/tw-map-terminal-latency}"
RUN_ID="${MAP_LATENCY_RUN_ID:-$(date +%Y%m%d-%H%M%S)-$$-$RANDOM}"
OUT_DIR="${MAP_LATENCY_RUN_DIR:-$OUT_ROOT/$RUN_ID}"
LOG_FILE="$OUT_DIR/runtime.log"
DRIVER_LOG="$OUT_DIR/driver.log"
RUN_DIR="$OUT_DIR/run"
DATA_DIR="$OUT_DIR/data"
TRACE_DIR="$OUT_DIR/traces"
CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$OUT_ROOT/target}"
if [[ "$CARGO_TARGET_DIR" != /* ]]; then
  CARGO_TARGET_DIR="$APP_ROOT/$CARGO_TARGET_DIR"
fi
SOCKET="$RUN_DIR/terminal-workspace/daemon.sock"
PORT="${MAP_LATENCY_PORT:-$((19000 + RANDOM % 1000))}"
APP_BUDGET="${APP_BUDGET:-150}"
PIXEL_P95_LIMIT_MS="${MAP_LATENCY_PIXEL_P95_LIMIT_MS:-150}"
APP_RUN_PID=""

mkdir -p "$OUT_DIR" "$RUN_DIR" "$DATA_DIR" "$TRACE_DIR" "$CARGO_TARGET_DIR"
chmod 700 "$RUN_DIR"
echo "MAP_TERMINAL_LATENCY_RUN_DIR=$OUT_DIR"

private_daemon_pid() {
  python3 - "$SOCKET" <<'PYEOF' 2>/dev/null || true
import json, socket, sys
sock_path = sys.argv[1]
try:
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    s.settimeout(0.4)
    s.connect(sock_path)
    s.sendall(b'{"type":"status"}')
    s.shutdown(socket.SHUT_WR)
    data = s.recv(4096)
    s.close()
    pid = json.loads(data.decode("utf-8", "replace")).get("pid")
    if pid:
        print(pid)
except Exception:
    pass
PYEOF
}

if [[ -z "${MAP_LATENCY_INNER:-}" ]]; then
  exec xvfb-run -a -s "-screen 0 1600x1000x24" \
    env \
      MAP_LATENCY_INNER=1 \
      MAP_LATENCY_OUT="$OUT_DIR" \
      MAP_LATENCY_RUN_DIR="$OUT_DIR" \
      CARGO_TARGET_DIR="$CARGO_TARGET_DIR" \
      TMPDIR="$TRACE_DIR" \
      XDG_RUNTIME_DIR="$RUN_DIR" \
      XDG_DATA_HOME="$DATA_DIR" \
      bash "${BASH_SOURCE[0]}" "$@"
fi

cleanup() {
  if [[ -n "$APP_RUN_PID" ]]; then
    kill -- "-$APP_RUN_PID" >/dev/null 2>&1 || true
    wait "$APP_RUN_PID" >/dev/null 2>&1 || true
    APP_RUN_PID=""
  fi
  local daemon_pid
  daemon_pid="$(private_daemon_pid)"
  if [[ -n "$daemon_pid" ]]; then
    kill "$daemon_pid" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT
cleanup

shot() { import -window "$1" "$OUT_DIR/$2" 2>>"$DRIVER_LOG" || true; }

capture_crop() {
  local wid="$1"
  local file="$2"
  # Capture the X11 window directly. ImageMagick's `import` holds the X server
  # while it converts/crops, which can delay the very paint this harness measures.
  # xwd releases the server as soon as the pixels are copied; crop/compare happens
  # afterward and is excluded from the latency timestamp below.
  xwd -silent -id "$wid" -out "$file" 2>>"$DRIVER_LOG"
}

changed_pixels() {
  local before="$1"
  local after="$2"
  magick compare -metric AE \
    "$before[900x520+360+250]" \
    "$after[900x520+360+250]" \
    null: 2>&1 | sed -n 's/[^0-9]*\([0-9][0-9]*\).*/\1/p' | head -1
}

percentile_ms() {
  python3 - "$1" <<'PYEOF'
import math, sys
values = [float(part) for part in sys.argv[1].split(",") if part]
if not values:
    print("0")
    raise SystemExit
values.sort()
idx = min(len(values) - 1, math.ceil(0.95 * len(values)) - 1)
print(f"{values[idx]:.1f}")
PYEOF
}

drive() {
  local wid=""
  local wait_limit=$((APP_BUDGET * 2))
  for ((i = 1; i <= wait_limit; i += 1)); do
    wid="$(xdotool search --name "TermFleet" 2>/dev/null | head -1)"
    [[ -n "$wid" ]] && break
    sleep 0.5
  done
  if [[ -z "$wid" ]]; then echo "MAP_LATENCY_WINDOW_MISSING" >>"$DRIVER_LOG"; return 1; fi
  echo "driver: window=$wid" >>"$DRIVER_LOG"

  xdotool windowsize "$wid" 1600 1000 2>>"$DRIVER_LOG" || true
  xdotool windowactivate "$wid" 2>>"$DRIVER_LOG" || true
  sleep 8
  shot "$wid" "01-map-boot.png"

  # The reset canvas opens with a terminal map node. Click the selected terminal
  # body and type without pressing Return; the token stays in the private shell.
  xdotool mousemove --window "$wid" 820 595 click --clearmodifiers 1
  sleep 0.8
  xdotool key --clearmodifiers ctrl+u
  sleep 0.2

  local token="tfmaplatency"
  local latencies=""
  local before after start captured_at diff elapsed char
  local index=0
  for ((index = 0; index < ${#token}; index += 1)); do
    char="${token:index:1}"
    before="$OUT_DIR/pixel-before-$index.xwd"
    after="$OUT_DIR/pixel-after-$index.xwd"
    capture_crop "$wid" "$before" || return 1
    start="$(date +%s%3N)"
    xdotool type --clearmodifiers --delay 0 "$char"
    diff=0
    elapsed=0
    while (( elapsed < 1500 )); do
      capture_crop "$wid" "$after" || return 1
      captured_at="$(date +%s%3N)"
      diff="$(changed_pixels "$before" "$after")"
      diff="${diff:-0}"
      elapsed=$((captured_at - start))
      if (( diff > 20 )); then
        latencies="${latencies}${latencies:+,}${elapsed}"
        echo "pixel_latency_ms[$index]=$elapsed changed_pixels=$diff" >>"$DRIVER_LOG"
        break
      fi
      sleep 0.01
    done
    if (( diff <= 20 )); then
      echo "MAP_TERMINAL_PIXEL_LATENCY_TIMEOUT index=$index char=$char elapsed_ms=$elapsed" >&2
      return 1
    fi
  done
  xdotool key --clearmodifiers ctrl+u
  sleep 0.5
  shot "$wid" "02-map-after-pixel-typing.png"

  local p95
  p95="$(percentile_ms "$latencies")"
  cat >"$OUT_DIR/pixel-latency-report.json" <<JSON
{"token":"$token","latenciesMs":[${latencies}],"p95Ms":$p95,"limitMs":$PIXEL_P95_LIMIT_MS}
JSON
  python3 - "$p95" "$PIXEL_P95_LIMIT_MS" <<'PYEOF'
import sys
p95 = float(sys.argv[1])
limit = float(sys.argv[2])
print(f"MAP_TERMINAL_PIXEL_LATENCY p95_ms={p95:.1f} limit_ms={limit:.1f}")
if p95 > limit:
    print(f"MAP_TERMINAL_PIXEL_LATENCY_BUDGET_FAILED p95={p95:.1f}ms>{limit:.1f}ms", file=sys.stderr)
    raise SystemExit(1)
PYEOF
}

drive &
DRIVER_PID=$!

cd "$APP_ROOT"
TAURI_DEV_CONFIG="{\"build\":{\"devUrl\":\"http://127.0.0.1:${PORT}\",\"beforeDevCommand\":\"npm run dev -- --host 127.0.0.1 --port ${PORT} --strictPort true\"}}"
setsid timeout "$APP_BUDGET" env \
  CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-1}" \
  CARGO_PROFILE_DEV_DEBUG="${CARGO_PROFILE_DEV_DEBUG:-0}" \
  CARGO_TARGET_DIR="$CARGO_TARGET_DIR" \
  LIBGL_ALWAYS_SOFTWARE=1 \
  WEBKIT_DISABLE_COMPOSITING_MODE=1 \
  WEBKIT_DISABLE_DMABUF_RENDERER=1 \
  TERMINAL_WORKSPACE_TRACE_LATENCY=1 \
  TMPDIR="$TRACE_DIR" \
  XDG_RUNTIME_DIR="$RUN_DIR" \
  XDG_DATA_HOME="$DATA_DIR" \
  VITE_TERMINAL_RENDERER_MODE=canvas2d \
  VITE_WORKSPACE_MODE=canvas \
  VITE_WORKSPACE_RESET_STATE=1 \
  npm run tauri -- dev --config "$TAURI_DEV_CONFIG" >"$LOG_FILE" 2>&1 </dev/null &
APP_RUN_PID=$!

wait "$DRIVER_PID"
DRIVER_STATUS=$?
sync
sleep 2

mapfile -t TRACE_FILES < <(
  find "$TRACE_DIR" -maxdepth 1 -type f -name 'terminal-workspace-latency-trace-*.jsonl' -print 2>/dev/null | sort
)

if (( ${#TRACE_FILES[@]} == 0 )); then
  echo "MAP_TERMINAL_LATENCY_TRACE_MISSING  no trace files were created by the private run" >&2
  echo "=== driver.log ==="; cat "$DRIVER_LOG" 2>/dev/null || true
  exit 1
fi

if (( DRIVER_STATUS != 0 )); then
  echo "=== driver.log ==="; cat "$DRIVER_LOG" 2>/dev/null || true
  exit "$DRIVER_STATUS"
fi

node scripts/verify-map-terminal-latency.mjs "${TRACE_FILES[@]}"
VERIFY_STATUS=$?
echo "=== pixel report ==="; cat "$OUT_DIR/pixel-latency-report.json" 2>/dev/null || true
echo "=== screenshots ==="; ls -1 "$OUT_DIR"/*.png 2>/dev/null || true
echo "=== run output ==="; echo "$OUT_DIR"
exit "$VERIFY_STATUS"
