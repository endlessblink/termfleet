#!/usr/bin/env bash
set -u

pid="${1:-}"
pgid="${2:-}"
reason="${3:-unknown}"
if [[ ! "$pid" =~ ^[0-9]+$ || "$pid" -le 1 || ! -d "/proc/$pid" ]]; then
  printf 'snapshot=skipped reason=invalid-or-exited-pid pid=%s\n' "$pid" >&2
  exit 2
fi
if [[ ! "$pgid" =~ ^[0-9]+$ ]]; then
  pgid=unknown
fi

# Keep capture off the potentially stalled ext4 journal. XDG_RUNTIME_DIR is
# user-session runtime storage (normally tmpfs), and survives desktop relaunch.
snapshot_root="${TERMFLEET_INCIDENT_SNAPSHOT_DIR:-${XDG_RUNTIME_DIR:-/tmp}/termfleet/incident-snapshots}"
umask 077
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
snapshot="$snapshot_root/desktop-${stamp}-${pid}"
if ! mkdir -p -- "$snapshot"; then
  printf 'snapshot=failed reason=mkdir path=%s\n' "$snapshot" >&2
  exit 1
fi
ln -s -- "$snapshot" "$snapshot_root/.latest-$$"
mv -Tf -- "$snapshot_root/.latest-$$" "$snapshot_root/latest"

{
  printf 'captured_at_utc=%s\n' "$stamp"
  printf 'reason=%s\n' "$reason"
  printf 'ui_pid=%s\nui_pgid=%s\n' "$pid" "$pgid"
  printf 'ui_exe=%s\n' "$(readlink "/proc/$pid/exe" 2>&1 || true)"
  printf 'ui_cwd=%s\n' "$(readlink "/proc/$pid/cwd" 2>&1 || true)"
} >"$snapshot/identity.txt"

for item in status cgroup wchan stack io; do
  if [[ -r "/proc/$pid/$item" ]]; then
    cat "/proc/$pid/$item" >"$snapshot/$item.txt" 2>"$snapshot/$item.err" || true
  else
    printf 'unreadable-or-exited\n' >"$snapshot/$item.txt"
  fi
done

{
  for file in /proc/pressure/io /proc/pressure/memory; do
    printf '[%s]\n' "$file"
    cat "$file" 2>&1 || true
  done
  printf '[process-cgroup-pressure-and-stats]\n'
  cgroup_path="$(awk -F: '$1 == "0" {print $3}' "/proc/$pid/cgroup" 2>/dev/null || true)"
  if [[ -n "$cgroup_path" ]]; then
    for file in "/sys/fs/cgroup$cgroup_path/io.pressure" "/sys/fs/cgroup$cgroup_path/io.stat"; do
      printf '[%s]\n' "$file"
      cat "$file" 2>&1 || true
    done
  else
    printf 'cgroup-v2-path-unavailable\n'
  fi
} >"$snapshot/pressure.txt"

watchdog_heartbeat="${XDG_RUNTIME_DIR:-/run/user/$UID}/termfleet/pressure-watchdog.heartbeat"
if [[ -r "$watchdog_heartbeat" ]]; then
  cat "$watchdog_heartbeat" >"$snapshot/watchdog-heartbeat.txt" 2>/dev/null || true
else
  printf 'unavailable\n' >"$snapshot/watchdog-heartbeat.txt"
fi

{
  printf '[home]\n'
  findmnt -T "${HOME:-/}" -o TARGET,SOURCE,FSTYPE,OPTIONS 2>&1 || true
  ui_cwd="$(readlink "/proc/$pid/cwd" 2>/dev/null || true)"
  if [[ -n "$ui_cwd" && -e "$ui_cwd" ]]; then
    printf '[ui-cwd]\n'
    findmnt -T "$ui_cwd" -o TARGET,SOURCE,FSTYPE,OPTIONS 2>&1 || true
  fi
} >"$snapshot/mounts.txt"

# Process names and wait channels only; avoid copying arbitrary command lines.
ps -eo pid,ppid,pgid,stat,wchan:32,pcpu,pmem,etimes,comm --sort=stat \
  >"$snapshot/processes.txt" 2>&1 || true

{
  count=0
  for fd in "/proc/$pid"/fd/*; do
    [[ -e "$fd" || -L "$fd" ]] || continue
    printf '%s -> %s\n' "${fd##*/}" "$(readlink "$fd" 2>&1 || true)"
    count=$((count + 1))
    (( count < 128 )) || { printf 'truncated_after=128\n'; break; }
  done
} >"$snapshot/fds.txt"

{
  for sample in 1 2 3; do
    printf '[sample=%s time=%s]\n' "$sample" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    if [[ -r "/proc/$pid/io" ]]; then
      cat "/proc/$pid/io" 2>&1 || true
    else
      printf 'process-exited\n'
      break
    fi
    (( sample < 3 )) && sleep 1
  done
} >"$snapshot/io-series.txt"

daemon_pids="$(pgrep -u "$UID" -f -- '[t]ermfleet.*--terminal-workspace-daemon$' 2>/dev/null || true)"
{
  if [[ -n "$daemon_pids" ]]; then
    printf 'daemon_pids=%s\n' "$(printf '%s' "$daemon_pids" | tr '\n' ',')"
    ps -p "$(printf '%s' "$daemon_pids" | paste -sd, -)" -o pid=,stat=,wchan:32=,comm= 2>&1 || true
  else
    printf 'daemon_pids=none-found\n'
  fi
  printf 'capture_does_not_signal_daemon=yes\n'
} >"$snapshot/daemon.txt"

printf '%s\n' "$snapshot"
