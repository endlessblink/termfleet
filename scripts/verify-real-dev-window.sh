#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${TERMFLEET_REAL_DEV_WINDOW_SCREENSHOT:-/tmp/termfleet-real-dev-window.png}"

find_app_pid() {
  ps -eo pid=,args= | while read -r pid args; do
    [[ "$args" == *"target/debug/terminal-workspace"* ]] || continue
    [[ "$args" != *"--terminal-workspace-daemon"* ]] || continue
    exe="$(readlink "/proc/$pid/exe" 2>/dev/null || true)"
    [[ "$exe" == "$ROOT_DIR/src-tauri/target/debug/terminal-workspace" ]] || continue
    echo "$pid"
  done | tail -1
}

find_daemon_pid() {
  ps -eo pid=,args= | while read -r pid args; do
    [[ "$args" == *"target/debug/terminal-workspace"* ]] || continue
    [[ "$args" == *"--terminal-workspace-daemon"* ]] || continue
    exe="$(readlink "/proc/$pid/exe" 2>/dev/null || true)"
    [[ "$exe" == "$ROOT_DIR/src-tauri/target/debug/terminal-workspace" ]] || continue
    echo "$pid"
  done | tail -1
}

app_pid="$(find_app_pid)"
daemon_pid="$(find_daemon_pid)"
if [[ -z "$app_pid" ]]; then
  echo "REAL_DEV_WINDOW_APP_MISSING" >&2
  exit 1
fi
if [[ -z "$daemon_pid" ]]; then
  echo "REAL_DEV_WINDOW_DAEMON_MISSING" >&2
  exit 1
fi

app_exe="$(readlink "/proc/$app_pid/exe")"
daemon_exe="$(readlink "/proc/$daemon_pid/exe")"
if [[ "$app_exe" == *" (deleted)"* || "$daemon_exe" == *" (deleted)"* ]]; then
  echo "REAL_DEV_WINDOW_STALE_BINARY app=$app_exe daemon=$daemon_exe" >&2
  exit 1
fi

served_magic="$(curl -fsS http://127.0.0.1:1420/src/components/MagicCanvas.tsx)"
if [[ "$served_magic" != *"buildShellTerminalHeaderViewModel"* ||
      "$served_magic" != *"data-header-workspace-source"* ]]; then
  echo "REAL_DEV_WINDOW_STALE_FRONTEND" >&2
  exit 1
fi

window_id="$(
  xdotool search --pid "$app_pid" 2>/dev/null |
    while read -r id; do
      geometry="$(xdotool getwindowgeometry "$id" 2>/dev/null || true)"
      width="$(sed -n 's/.*Geometry: \([0-9]\+\)x\([0-9]\+\).*/\1/p' <<<"$geometry")"
      height="$(sed -n 's/.*Geometry: \([0-9]\+\)x\([0-9]\+\).*/\2/p' <<<"$geometry")"
      if [[ "${width:-0}" -gt 400 && "${height:-0}" -gt 300 ]]; then
        echo "$id"
        break
      fi
    done
)"
if [[ -z "$window_id" ]]; then
  echo "REAL_DEV_WINDOW_VISIBLE_WINDOW_MISSING app_pid=$app_pid" >&2
  exit 1
fi

import -window "$window_id" "$OUT"
info="$(file "$OUT")"
if [[ "$info" != *"PNG image data"* ]]; then
  echo "REAL_DEV_WINDOW_SCREENSHOT_BAD $info" >&2
  exit 1
fi

echo "REAL_DEV_WINDOW_OK app_pid=$app_pid daemon_pid=$daemon_pid window=$window_id screenshot=$OUT"
