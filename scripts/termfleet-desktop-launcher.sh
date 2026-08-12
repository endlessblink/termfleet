#!/usr/bin/env bash
set -euo pipefail

LOG_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/termfleet"
LOG_FILE="$LOG_DIR/desktop-launch.log"
TERMFLEET_CMD="${TERMFLEET_CMD:-$HOME/.local/bin/termfleet}"
TERMFLEET_INSTALL_ROOT="${TERMFLEET_INSTALL_ROOT:-${XDG_DATA_HOME:-$HOME/.local/share}/termfleet}"
TERMFLEET_TMPDIR="${TERMFLEET_TMPDIR:-/media/endlessblink/data/.dev-tmp/$USER}"
TERMFLEET_RESTORE="${TERMFLEET_RESTORE:-/media/endlessblink/data/my-projects/ai-development/cc-linux-enhancments/scripts/agent-fleet/restore.py}"

mkdir -p "$LOG_DIR" "$TERMFLEET_TMPDIR"
chmod 0700 "$TERMFLEET_TMPDIR"
export TMPDIR="$TERMFLEET_TMPDIR"
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-2}"

# Serialize dock launches. Without a lock, two clicks in the small window before
# the first cockpit appears can create two WebKit renderer trees and double the
# desktop's memory/I/O footprint. The lock is held through startup below.
LOCK_FILE="$LOG_DIR/desktop-launch.lock"
if [[ "${1:-}" != "--child" ]]; then
  exec 9>"$LOCK_FILE"
  if ! flock -n 9; then
    printf '[%s] launch lock busy; another dock launch is starting\n' "$(date --iso-8601=seconds)" >>"$LOG_FILE"
    exit 0
  fi
fi
# WebKitGTK's DMA-BUF/compositing path can leave the dock window as a uniform
# blank surface on Linux even while the Tauri process and window remain alive.
# Match the known-good live verifiers and prefer software rendering for the
# desktop acceptance surface.
export LIBGL_ALWAYS_SOFTWARE="${LIBGL_ALWAYS_SOFTWARE:-1}"
export WEBKIT_DISABLE_COMPOSITING_MODE="${WEBKIT_DISABLE_COMPOSITING_MODE:-1}"
export WEBKIT_DISABLE_DMABUF_RENDERER="${WEBKIT_DISABLE_DMABUF_RENDERER:-1}"
# Keep the runtime handoff trace enabled on the dock acceptance surface while
# the map Connect failure is being investigated; it writes only to temp files.
export TERMINAL_WORKSPACE_TRACE_LATENCY="${TERMINAL_WORKSPACE_TRACE_LATENCY:-1}"
export TERMINAL_WORKSPACE_TRACE_PTY="${TERMINAL_WORKSPACE_TRACE_PTY:-1}"
export TERMFLEET_DAEMON_MEMORY_HIGH="${TERMFLEET_DAEMON_MEMORY_HIGH:-12G}"
export TERMFLEET_DAEMON_TASKS_MAX="${TERMFLEET_DAEMON_TASKS_MAX:-10000}"
# Bound the WebKit-backed desktop group separately from the daemon. A renderer
# leak may kill the cockpit, but it must never consume the host or the PTYs.
export TERMFLEET_DESKTOP_MEMORY_HIGH="${TERMFLEET_DESKTOP_MEMORY_HIGH:-768M}"
export TERMFLEET_DESKTOP_MEMORY_MAX="${TERMFLEET_DESKTOP_MEMORY_MAX:-1G}"

resolved_cmd="$(readlink -f "$TERMFLEET_CMD" 2>/dev/null || true)"
release_prefix="$(readlink -m "$TERMFLEET_INSTALL_ROOT/releases")/"
if [[ ! -x "$resolved_cmd" || "$resolved_cmd" != "$release_prefix"* ]]; then
  printf '[%s] refusing non-release TermFleet command=%s resolved=%s\n' \
    "$(date --iso-8601=seconds)" "$TERMFLEET_CMD" "$resolved_cmd" >>"$LOG_FILE"
  exit 1
fi

# Only a *cockpit* process counts as "already running". The long-lived daemon shares the
# same binary and therefore the same process name, so a bare `pgrep -x termfleet` matches
# it too — and then, once the cockpit window dies while the daemon survives (which is what
# a memory-pressure kill does), this guard refuses to ever launch the UI again.
cockpit_running() {
  local pid
  for pid in $(pgrep -u "$UID" -x termfleet 2>/dev/null); do
    [[ "$(awk '{print $3}' "/proc/$pid/stat" 2>/dev/null)" == "Z" ]] && continue
    grep -qz -- '--terminal-workspace-daemon' "/proc/$pid/cmdline" 2>/dev/null && continue
    return 0
  done
  return 1
}

cockpit_pid() {
  local pid
  for pid in $(pgrep -u "$UID" -x termfleet 2>/dev/null); do
    [[ "$(awk '{print $3}' "/proc/$pid/stat" 2>/dev/null)" == "Z" ]] && continue
    grep -qz -- '--terminal-workspace-daemon' "/proc/$pid/cmdline" 2>/dev/null && continue
    printf '%s\n' "$pid"
    return 0
  done
  return 1
}

set_display_credentials() {
  export DISPLAY="${DISPLAY:-:0}"
  # The dock owns the production runtime, but an explicitly isolated smoke run
  # must keep its private runtime so the daemon, UI, and assertions share one
  # namespace. A plain inherited XDG_RUNTIME_DIR still follows the production
  # path, preventing accidental redirection by ordinary launches.
  if [[ "${TERMFLEET_PRESERVE_RUNTIME_DIR:-0}" != "1" ]]; then
    export XDG_RUNTIME_DIR="/run/user/${UID}"
  fi
  export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=${XDG_RUNTIME_DIR}/bus}"
  if [[ -z "${XAUTHORITY:-}" ]]; then
    local candidate
    for candidate in "/run/user/${UID}"/xauth_*; do
      if [[ -f "$candidate" ]]; then
        export XAUTHORITY="$candidate"
        break
      fi
    done
  fi
  export XAUTHORITY="${XAUTHORITY:-/run/user/${UID}/.Xauthority}"
}

if [[ "${1:-}" != "--child" ]]; then
  existing_pid="$(cockpit_pid || true)"
  if [[ -n "$existing_pid" ]]; then
    existing_exe="$(readlink -f "/proc/$existing_pid/exe" 2>/dev/null || true)"
    if [[ -n "$existing_exe" && "$existing_exe" != "$resolved_cmd" ]]; then
      printf '[%s] replacing stale TermFleet desktop pid=%s old=%s new=%s\n' \
        "$(date --iso-8601=seconds)" "$existing_pid" "$existing_exe" "$resolved_cmd" >>"$LOG_FILE"
      kill -TERM "$existing_pid" 2>/dev/null || true
      for _ in {1..100}; do
        if ! kill -0 "$existing_pid" 2>/dev/null; then
          break
        fi
        sleep 0.05
      done
    else
      printf '[%s] reusing existing TermFleet window\n' "$(date --iso-8601=seconds)" >>"$LOG_FILE"
      if command -v wmctrl >/dev/null 2>&1; then
        wmctrl -a TermFleet >/dev/null 2>&1 || true
      fi
      exit 0
    fi
  fi
fi

if [[ "${1:-}" == "--child" ]]; then
  export TERMFLEET_OLLAMA_URL="${TERMFLEET_OLLAMA_URL:-http://127.0.0.1:11434}"
  export TERMFLEET_CONTEXT_TITLE_TIMEOUT_MS="${TERMFLEET_CONTEXT_TITLE_TIMEOUT_MS:-25000}"
  export TERMFLEET_TASK_CONTEXT_MODEL="${TERMFLEET_TASK_CONTEXT_MODEL:-qwen2.5:7b}"
  export TERMFLEET_AGENT_STATUS_TIMEOUT_MS="${TERMFLEET_AGENT_STATUS_TIMEOUT_MS:-1000}"
  export TERMFLEET_AGENT_STATUS_DISABLE="${TERMFLEET_AGENT_STATUS_DISABLE:-1}"
  if [[ -f "$TERMFLEET_RESTORE" ]]; then
    /usr/bin/python3 "$TERMFLEET_RESTORE" \
      --termfleet-startup \
      --once termfleet \
      --ready-timeout 20 >>"$LOG_FILE" 2>&1 &
  fi
  set +e
  "$TERMFLEET_CMD"
  status=$?
  set -e
  printf '[%s] termfleet exited with status=%s\n' \
    "$(date --iso-8601=seconds)" "$status" >>"$LOG_FILE"
  exit "$status"
fi

printf '\n[%s] launching TermFleet desktop wrapper\n' \
  "$(date --iso-8601=seconds)" >>"$LOG_FILE"

# The systemd path must receive the same X11 credentials as the direct fallback.
# Without this, a user bus can be available while XAUTHORITY is empty, causing
# the child to exit cleanly before creating a window.
set_display_credentials

unit_name="termfleet-desktop-$(date +%s%N)"
if command -v systemd-run >/dev/null 2>&1; then
  # The desktop unit owns the UI and every WebKit child. Kill the whole unit
  # when the UI exits so a crashed/restarted window cannot leave WebKit workers
  # consuming memory after the main process is gone. The PTY daemon is launched
  # in its own unit and is therefore unaffected by this boundary.
  if systemd-run \
    --user \
    --collect \
    --same-dir \
    --unit="$unit_name" \
    -p KillMode=control-group \
    -p MemoryHigh="$TERMFLEET_DESKTOP_MEMORY_HIGH" \
    -p MemoryMax="$TERMFLEET_DESKTOP_MEMORY_MAX" \
     -p CPUWeight=1000 \
     -p IOWeight=1000 \
    --setenv="DISPLAY=${DISPLAY:-:0}" \
    --setenv="XAUTHORITY=${XAUTHORITY:-}" \
    --setenv="PATH=${PATH:-/usr/local/bin:/usr/bin:/bin}" \
    --setenv="TMPDIR=$TMPDIR" \
    --setenv="CARGO_BUILD_JOBS=$CARGO_BUILD_JOBS" \
    --setenv="LIBGL_ALWAYS_SOFTWARE=$LIBGL_ALWAYS_SOFTWARE" \
    --setenv="WEBKIT_DISABLE_COMPOSITING_MODE=$WEBKIT_DISABLE_COMPOSITING_MODE" \
    --setenv="WEBKIT_DISABLE_DMABUF_RENDERER=$WEBKIT_DISABLE_DMABUF_RENDERER" \
    --setenv="TERMFLEET_DAEMON_MEMORY_HIGH=$TERMFLEET_DAEMON_MEMORY_HIGH" \
    --setenv="TERMFLEET_DAEMON_TASKS_MAX=$TERMFLEET_DAEMON_TASKS_MAX" \
    --setenv="TERMFLEET_CMD=$TERMFLEET_CMD" \
    --setenv="TERMFLEET_INSTALL_ROOT=$TERMFLEET_INSTALL_ROOT" \
    --setenv="TERMFLEET_RESTORE=$TERMFLEET_RESTORE" \
    --setenv="TERMFLEET_OLLAMA_URL=${TERMFLEET_OLLAMA_URL:-http://127.0.0.1:11434}" \
    --setenv="TERMFLEET_CONTEXT_TITLE_TIMEOUT_MS=${TERMFLEET_CONTEXT_TITLE_TIMEOUT_MS:-25000}" \
    --setenv="TERMFLEET_TASK_CONTEXT_MODEL=${TERMFLEET_TASK_CONTEXT_MODEL:-qwen2.5:7b}" \
    --setenv="TERMFLEET_AGENT_STATUS_TIMEOUT_MS=${TERMFLEET_AGENT_STATUS_TIMEOUT_MS:-1000}" \
    --setenv="TERMFLEET_AGENT_STATUS_DISABLE=${TERMFLEET_AGENT_STATUS_DISABLE:-1}" \
    --setenv="TERMINAL_WORKSPACE_TRACE_LATENCY=${TERMINAL_WORKSPACE_TRACE_LATENCY:-}" \
    "$0" --child >>"$LOG_FILE" 2>&1; then
    desktop_cgroup="/sys/fs/cgroup/user.slice/user-${UID}.slice/user@${UID}.service/app.slice/${unit_name}"
    for _ in {1..50}; do
      if [[ -w "$desktop_cgroup/memory.high" && -w "$desktop_cgroup/memory.max" ]]; then
        printf '%s\n' "$TERMFLEET_DESKTOP_MEMORY_HIGH" >"$desktop_cgroup/memory.high"
        printf '%s\n' "$TERMFLEET_DESKTOP_MEMORY_MAX" >"$desktop_cgroup/memory.max"
        break
      fi
      sleep 0.02
    done
  else
    printf '[%s] systemd user bus unavailable; falling back to direct desktop child\n' \
      "$(date --iso-8601=seconds)" >>"$LOG_FILE"
    set_display_credentials
    nohup "$0" --child >>"$LOG_FILE" 2>&1 </dev/null &
  fi
else
  set_display_credentials
  nohup "$0" --child >>"$LOG_FILE" 2>&1 </dev/null &
fi

# Do not release the launch lock until the cockpit is observable by the guard.
# This closes the race between systemd-run/nohup returning and the child being
# registered in the process table.
for _ in {1..200}; do
  if cockpit_running; then
    break
  fi
  sleep 0.05
done
