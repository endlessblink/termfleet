#!/usr/bin/env bash
set -euo pipefail

LOG_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/termfleet"
launcher_dir="$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")"
incident_log_helper="$launcher_dir/termfleet-incident-log.sh"
if [[ -f "$incident_log_helper" ]]; then
  source "$incident_log_helper"
else
  termfleet_incident_record() { :; }
fi
LOG_FILE="$LOG_DIR/desktop-launch.log"
TERMFLEET_CMD="${TERMFLEET_CMD:-$HOME/.local/bin/termfleet}"
TERMFLEET_INSTALL_ROOT="${TERMFLEET_INSTALL_ROOT:-${XDG_DATA_HOME:-$HOME/.local/share}/termfleet}"
TERMFLEET_TMPDIR="${TERMFLEET_TMPDIR:-/media/endlessblink/data/.dev-tmp/$USER}"
TERMFLEET_COCKPIT_SNAPSHOT_PATH="${TERMFLEET_COCKPIT_SNAPSHOT_PATH:-${XDG_DATA_HOME:-$HOME/.local/share}/terminal-workspace/agent-status/termfleet-cockpit-snapshot.json}"

# The desktop wrapper has two legitimate callers: the dock and agents that
# need to relaunch the UI while preserving the canonical daemon.  A bare
# --child is retained for existing agent launchers and defaults to the shared
# production context; only an explicit isolated-smoke context may use a private
# runtime.
if [[ "${1:-}" == "--child" &&
  "${TERMFLEET_CHILD_CONTEXT:-shared-daemon-agent}" != "isolated-smoke" &&
  "${TERMFLEET_LAUNCH_PARENT:-0}" != "1" ]]; then
  # Legacy agents used to invoke the child directly, bypassing the single-window
  # check. Route those calls through the shared parent so they cannot create a
  # second UI that races the existing UI's workspace persistence.
  exec "$0" --agent
fi
case "${1:-}" in
  --dock) launch_context="dock" ;;
  --agent|--shared-daemon) launch_context="shared-daemon-agent" ;;
  --child) launch_context="${TERMFLEET_CHILD_CONTEXT:-shared-daemon-agent}" ;;
  *)
    printf '[%s] refusing unknown TermFleet desktop launch mode=%s\n' \
      "$(date --iso-8601=seconds)" "${1:-<none>}" >>"${XDG_STATE_HOME:-$HOME/.local/state}/termfleet/desktop-launch.log"
    exit 64
    ;;
esac
case "$launch_context" in
  dock|shared-daemon-agent|isolated-smoke) ;;
  *)
    printf '[%s] refusing unknown TermFleet child context=%s\n' \
      "$(date --iso-8601=seconds)" "$launch_context" >>"${XDG_STATE_HOME:-$HOME/.local/state}/termfleet/desktop-launch.log"
    exit 64
    ;;
esac
if [[ "$launch_context" == "isolated-smoke" && -n "${TERMFLEET_CHILD_ENV_FILE:-}" && -f "$TERMFLEET_CHILD_ENV_FILE" ]]; then
  set -a
  # The isolated verifier owns this file; the normal dock never supplies it.
  source "$TERMFLEET_CHILD_ENV_FILE"
  set +a
  if [[ -n "${TF_RESTORE_PATH:-}" && -f "$TF_RESTORE_PATH" ]]; then
    "$TF_RESTORE_PATH" --termfleet-startup --once termfleet --ready-timeout 20 >>"$LOG_FILE" 2>&1 &
  fi
fi
if [[ "$launch_context" == "shared-daemon-agent" ]]; then
  # Agent relaunches must attach to the same user daemon even when the caller
  # inherited a temporary test runtime or data directory.
  export XDG_RUNTIME_DIR="/run/user/${UID}"
  export XDG_DATA_HOME="${TERMFLEET_SHARED_DATA_HOME:-$HOME/.local/share}"
  export XDG_STATE_HOME="${TERMFLEET_SHARED_STATE_HOME:-$HOME/.local/state}"
  TERMFLEET_CMD="${TERMFLEET_SHARED_CMD:-$HOME/.local/bin/termfleet}"
  TERMFLEET_INSTALL_ROOT="$XDG_DATA_HOME/termfleet"
  LOG_DIR="$XDG_STATE_HOME/termfleet"
  LOG_FILE="$LOG_DIR/desktop-launch.log"
fi

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
if [[ "${1:-}" == "--child" ]]; then
  # Parent wrappers serialize normal launches, but two agents can still race
  # through separate wrappers before either cockpit is discoverable. Hold an
  # instance lock for the entire child lifetime so only one UI can ever attach
  # to the shared workspace at a time.
  INSTANCE_LOCK_FILE="$LOG_DIR/desktop-instance.lock"
  exec 8>"$INSTANCE_LOCK_FILE"
  if ! flock -n 8; then
    printf '[%s] desktop child already running; preserving the existing shared UI\n' \
      "$(date --iso-8601=seconds)" >>"$LOG_FILE"
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
# WebKit is a separate renderer process and can legitimately approach 1 GiB
# alongside the cockpit. Keep the desktop bounded, but leave enough headroom
# that normal renderer growth cannot terminate the UI while the daemon survives.
export TERMFLEET_DESKTOP_MEMORY_HIGH="${TERMFLEET_DESKTOP_MEMORY_HIGH:-3G}"
export TERMFLEET_DESKTOP_MEMORY_MAX="${TERMFLEET_DESKTOP_MEMORY_MAX:-4G}"

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
    if [[ -r "/proc/$pid/environ" || -r "/proc/$pid/cgroup" ]]; then
      grep -qz -- "XDG_RUNTIME_DIR=/run/user/$UID" "/proc/$pid/environ" 2>/dev/null ||
        grep -q -- '/termfleet-desktop-' "/proc/$pid/cgroup" 2>/dev/null || continue
    fi
    return 0
  done
  return 1
}

cockpit_pid() {
  local pid
  for pid in $(pgrep -u "$UID" -x termfleet 2>/dev/null); do
    [[ "$(awk '{print $3}' "/proc/$pid/stat" 2>/dev/null)" == "Z" ]] && continue
    grep -qz -- '--terminal-workspace-daemon' "/proc/$pid/cmdline" 2>/dev/null && continue
    if [[ -r "/proc/$pid/environ" || -r "/proc/$pid/cgroup" ]]; then
      grep -qz -- "XDG_RUNTIME_DIR=/run/user/$UID" "/proc/$pid/environ" 2>/dev/null ||
        grep -q -- '/termfleet-desktop-' "/proc/$pid/cgroup" 2>/dev/null || continue
    fi
    printf '%s\n' "$pid"
    return 0
  done
  return 1
}

cockpit_window_visible() {
  if command -v xdotool >/dev/null 2>&1 &&
    [[ -n "$(xdotool search --onlyvisible --name '^TermFleet$' 2>/dev/null | head -1)" ]]; then
    return 0
  fi
  command -v wmctrl >/dev/null 2>&1 &&
    wmctrl -l 2>/dev/null | grep -qE '[[:space:]]TermFleet$'
}

set_display_credentials() {
  export DISPLAY="${DISPLAY:-:0}"
  # The dock owns the production runtime, but an explicitly isolated smoke run
  # must keep its private runtime so the daemon, UI, and assertions share one
  # namespace. A plain inherited XDG_RUNTIME_DIR still follows the production
  # path, preventing accidental redirection by ordinary launches.
  if [[ "$launch_context" != "isolated-smoke" || "${TERMFLEET_PRESERVE_RUNTIME_DIR:-0}" != "1" ]]; then
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
    elif ! cockpit_window_visible; then
      printf '[%s] replacing stale invisible TermFleet desktop pid=%s\n' \
        "$(date --iso-8601=seconds)" "$existing_pid" >>"$LOG_FILE"
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
  termfleet_incident_record "desktop_launch" "launcher_child" "pid=$$ command=$TERMFLEET_CMD"
  export TERMFLEET_OLLAMA_URL="${TERMFLEET_OLLAMA_URL:-http://127.0.0.1:11434}"
  export TERMFLEET_CONTEXT_TITLE_TIMEOUT_MS="${TERMFLEET_CONTEXT_TITLE_TIMEOUT_MS:-25000}"
  export TERMFLEET_TASK_CONTEXT_MODEL="${TERMFLEET_TASK_CONTEXT_MODEL:-qwen2.5:7b}"
  export TERMFLEET_AGENT_STATUS_TIMEOUT_MS="${TERMFLEET_AGENT_STATUS_TIMEOUT_MS:-1000}"
  export TERMFLEET_AGENT_STATUS_DISABLE="${TERMFLEET_AGENT_STATUS_DISABLE:-1}"
  # Bring the independent PTY owner up before the cockpit. Exact agent recovery
  # is coordinated by the app from the durable saved pane graph; a global
  # folder-keyed manifest is never allowed to manufacture or resume panes.
  daemon_socket="${XDG_RUNTIME_DIR:-/run/user/${UID}}/terminal-workspace/daemon.sock"
  restore_before_app=0
  [[ -S "$daemon_socket" ]] && restore_before_app=1
  if [[ ! -S "$daemon_socket" && -n "${TERMFLEET_CMD:-}" ]] && command -v systemd-run >/dev/null 2>&1; then
    daemon_unit="termfleet-daemon-prestart-$$"
    if ! systemd-run --user --collect --same-dir --unit="$daemon_unit" \
      -p KillMode=mixed \
      --setenv="XDG_RUNTIME_DIR=${XDG_RUNTIME_DIR:-}" \
      --setenv="XDG_DATA_HOME=${XDG_DATA_HOME:-}" \
      --setenv="XDG_STATE_HOME=${XDG_STATE_HOME:-}" \
      --setenv="TMPDIR=${TMPDIR:-}" \
      --setenv="PATH=${PATH:-/usr/local/bin:/usr/bin:/bin}" \
      "$TERMFLEET_CMD" --terminal-workspace-daemon >/dev/null 2>&1; then
      printf '[%s] systemd daemon prestart failed; falling back to direct daemon\n' \
        "$(date --iso-8601=seconds)" >>"$LOG_FILE"
      nohup "$TERMFLEET_CMD" --terminal-workspace-daemon >>"$LOG_FILE" 2>&1 &
    fi
  fi
  daemon_deadline=$((SECONDS + 20))
  while (( SECONDS < daemon_deadline )) && [[ ! -S "$daemon_socket" ]]; do
    sleep 0.1
  done
  if [[ -S "$daemon_socket" ]]; then
    restore_before_app=1
  else
    printf '[%s] refusing to launch cockpit: daemon socket did not appear (%s)\n' \
      "$(date --iso-8601=seconds)" "$daemon_socket" >>"$LOG_FILE"
    termfleet_incident_record "desktop_launch" "daemon_startup_failed" "socket=$daemon_socket"
    exit 1
  fi
  set +e
  # Capture the cockpit's own stdout/stderr. Without this a crash or a WebKit
  # error left nothing behind but "exited with status=N", so every freeze report
  # had to be reconstructed after the fact from process ages.
  APP_LOG_FILE="$LOG_DIR/app-output.log"
  if [[ -f "$APP_LOG_FILE" ]] &&
    (( $(stat -c '%s' "$APP_LOG_FILE" 2>/dev/null || echo 0) > 8388608 )); then
    mv -f "$APP_LOG_FILE" "$APP_LOG_FILE.1" 2>/dev/null || true
  fi
  printf '[%s] ---- cockpit start (release=%s) ----\n' \
    "$(date --iso-8601=seconds)" "${resolved_cmd:-$TERMFLEET_CMD}" >>"$APP_LOG_FILE"
  "$TERMFLEET_CMD" >>"$APP_LOG_FILE" 2>&1 &
  app_pid=$!
  if (( restore_before_app == 0 )); then
    daemon_deadline=$((SECONDS + 20))
    while (( SECONDS < daemon_deadline )) && [[ ! -S "$daemon_socket" ]]; do
      if ! kill -0 "$app_pid" 2>/dev/null; then
        break
      fi
      sleep 0.1
    done
  fi
  wait "$app_pid"
  status=$?
  set -e
  printf '[%s] termfleet exited with status=%s\n' \
    "$(date --iso-8601=seconds)" "$status" >>"$LOG_FILE"
  termfleet_incident_record "desktop_exit" "process_exit" "pid=$app_pid status=$status daemon=preserved"
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
    --setenv="XDG_DATA_HOME=${XDG_DATA_HOME:-}" \
    --setenv="XDG_STATE_HOME=${XDG_STATE_HOME:-}" \
    --setenv="XDG_RUNTIME_DIR=${XDG_RUNTIME_DIR:-}" \
    --setenv="DBUS_SESSION_BUS_ADDRESS=${DBUS_SESSION_BUS_ADDRESS:-}" \
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
    --setenv="AGENT_FLEET_STATE_DIR=${AGENT_FLEET_STATE_DIR:-}" \
    --setenv="TERMFLEET_CHILD_ENV_FILE=${TERMFLEET_CHILD_ENV_FILE:-}" \
    --setenv="SMOKE_RESUME_MARKER=${SMOKE_RESUME_MARKER:-}" \
     --setenv="TERMFLEET_COCKPIT_SNAPSHOT_PATH=$TERMFLEET_COCKPIT_SNAPSHOT_PATH" \
    --setenv="TERMFLEET_OLLAMA_URL=${TERMFLEET_OLLAMA_URL:-http://127.0.0.1:11434}" \
    --setenv="TERMFLEET_CONTEXT_TITLE_TIMEOUT_MS=${TERMFLEET_CONTEXT_TITLE_TIMEOUT_MS:-25000}" \
    --setenv="TERMFLEET_TASK_CONTEXT_MODEL=${TERMFLEET_TASK_CONTEXT_MODEL:-qwen2.5:7b}" \
    --setenv="TERMFLEET_AGENT_STATUS_TIMEOUT_MS=${TERMFLEET_AGENT_STATUS_TIMEOUT_MS:-1000}" \
    --setenv="TERMFLEET_AGENT_STATUS_DISABLE=${TERMFLEET_AGENT_STATUS_DISABLE:-1}" \
     --setenv="TERMFLEET_CHILD_CONTEXT=$launch_context" \
     --setenv="TERMFLEET_LAUNCH_PARENT=1" \
     --setenv="TERMFLEET_UI_LAUNCH_CONTEXT=$launch_context" \
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
     TERMFLEET_CHILD_CONTEXT="$launch_context" TERMFLEET_LAUNCH_PARENT=1 TERMFLEET_UI_LAUNCH_CONTEXT="$launch_context" nohup "$0" --child >>"$LOG_FILE" 2>&1 </dev/null &
  fi
else
  set_display_credentials
  TERMFLEET_CHILD_CONTEXT="$launch_context" TERMFLEET_LAUNCH_PARENT=1 TERMFLEET_UI_LAUNCH_CONTEXT="$launch_context" nohup "$0" --child >>"$LOG_FILE" 2>&1 </dev/null &
fi

# Do not release the launch lock until the cockpit is observable by the guard.
# This closes the race between systemd-run/nohup returning and the child being
# registered in the process table.
for _ in {1..200}; do
  if cockpit_running && cockpit_window_visible; then
    break
  fi
  sleep 0.05
done
if ! cockpit_running || ! cockpit_window_visible; then
  printf '[%s] TermFleet desktop did not become visibly ready\n' "$(date --iso-8601=seconds)" >>"$LOG_FILE"
  exit 1
fi
