#!/usr/bin/env bash
set -euo pipefail

STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/termfleet"
source "$(dirname "${BASH_SOURCE[0]}")/termfleet-incident-log.sh"
ALERT_LOG="$STATE_DIR/pressure-alerts.log"
PROMPT_FILE="$STATE_DIR/pressure-alert.prompt"
LOCK_FILE="$STATE_DIR/pressure-watchdog.lock"
INTERVAL_SECONDS="${TERMFLEET_PRESSURE_WATCHDOG_INTERVAL:-5}"
NOTIFY_DISPLAY="${DISPLAY:-:0}"
NOTIFY_BUS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=${XDG_RUNTIME_DIR:-/run/user/$UID}/bus}"
# Pressure evidence should alert and collect diagnostics, not silently kill the
# cockpit and every renderer in its process group. Deliberate recycling remains
# available as an explicit operator opt-in.
RECOVER="${TERMFLEET_PRESSURE_WATCHDOG_RECOVER:-0}"
DESKTOP_LAUNCHER="${TERMFLEET_DESKTOP_LAUNCHER:-$HOME/.local/bin/termfleet-desktop}"
ALERT_COOLDOWN_SECONDS="${TERMFLEET_PRESSURE_WATCHDOG_ALERT_COOLDOWN:-300}"
HOST_ALERT_COOLDOWN_SECONDS="${TERMFLEET_PRESSURE_WATCHDOG_HOST_ALERT_COOLDOWN:-1800}"
BLOCKED_CONFIRMATIONS="${TERMFLEET_PRESSURE_WATCHDOG_BLOCKED_CONFIRMATIONS:-3}"
HOST_PRESSURE_CONFIRMATIONS="${TERMFLEET_PRESSURE_WATCHDOG_HOST_PRESSURE_CONFIRMATIONS:-12}"
DESKTOP_BLOCKED_IO_THRESHOLD="${TERMFLEET_PRESSURE_WATCHDOG_DESKTOP_BLOCKED_IO_THRESHOLD:-20}"
AUDIT_SCRIPT="${TERMFLEET_PRESSURE_AUDIT_SCRIPT:-$HOME/.local/bin/termfleet-system-audit}"
AUDIT_TIMEOUT_SECONDS="${TERMFLEET_PRESSURE_AUDIT_TIMEOUT_SECONDS:-15}"
LOAD_SHED_SCRIPT="${TERMFLEET_LOAD_SHED_SCRIPT:-$HOME/.local/bin/termfleet-load-shed}"
LOAD_SHED_TIMEOUT_SECONDS="${TERMFLEET_LOAD_SHED_TIMEOUT_SECONDS:-10}"
RECOVERY_COOLDOWN_SECONDS="${TERMFLEET_PRESSURE_WATCHDOG_RECOVERY_COOLDOWN:-120}"
NOTIFY_REPLACE_ID="${TERMFLEET_PRESSURE_WATCHDOG_NOTIFY_ID:-4242}"
RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$UID}"
last_alert_epoch=0
last_host_alert_epoch=0
last_recovery_epoch=0
last_incident_reason=""
sample_counter=0
webkit_blocked_count=0
desktop_blocked_count=0
host_memory_pressure_count=0
host_io_pressure_count=0

is_production_desktop() {
  local pid="$1"
  [[ -r "/proc/$pid/environ" || -r "/proc/$pid/cgroup" ]] || return 0
  grep -qz -- "XDG_RUNTIME_DIR=/run/user/$UID" "/proc/$pid/environ" 2>/dev/null ||
    grep -q -- '/termfleet-desktop-' "/proc/$pid/cgroup" 2>/dev/null
}

mkdir -p "$STATE_DIR"
exec 9>"$LOCK_FILE"
flock -n 9 || exit 0

read_psi_avg10() {
  awk '/^some / { for (i = 1; i <= NF; i++) if ($i ~ /^avg10=/) { sub("avg10=", "", $i); print $i; exit } }' "$1" 2>/dev/null || printf '0\n'
}

run_incident_audit() {
  local timestamp="$1" audit_status=0
  if [[ ! -x "$AUDIT_SCRIPT" ]]; then
    printf '%s audit=unavailable path=%s\n' "$timestamp" "$AUDIT_SCRIPT" >>"$ALERT_LOG"
    return 0
  fi
  printf '%s audit=start path=%s\n' "$timestamp" "$AUDIT_SCRIPT" >>"$ALERT_LOG"
  if timeout "$AUDIT_TIMEOUT_SECONDS" "$AUDIT_SCRIPT" >>"$ALERT_LOG" 2>&1; then
    audit_status=0
  else
    audit_status=$?
  fi
  case "$audit_status" in
    0) printf '%s audit=complete status=PASS exit=0\n' "$timestamp" >>"$ALERT_LOG" ;;
    1) printf '%s audit=complete status=WARN exit=1\n' "$timestamp" >>"$ALERT_LOG" ;;
    2) printf '%s audit=complete status=FAIL exit=2\n' "$timestamp" >>"$ALERT_LOG" ;;
    124|125|126|127) printf '%s audit=failed_or_timed_out exit=%s\n' "$timestamp" "$audit_status" >>"$ALERT_LOG" ;;
    *) printf '%s audit=failed exit=%s\n' "$timestamp" "$audit_status" >>"$ALERT_LOG" ;;
  esac
}

run_load_shed() {
  local mode="$1" timestamp="$2"
  if [[ ! -x "$LOAD_SHED_SCRIPT" ]]; then
    printf '%s load-shed=unavailable mode=%s path=%s\n' "$timestamp" "$mode" "$LOAD_SHED_SCRIPT" >>"$ALERT_LOG"
    return 0
  fi
  printf '%s load-shed=start mode=%s\n' "$timestamp" "$mode" >>"$ALERT_LOG"
  timeout "$LOAD_SHED_TIMEOUT_SECONDS" "$LOAD_SHED_SCRIPT" "$mode" >>"$ALERT_LOG" 2>&1 || true
  printf '%s load-shed=complete mode=%s\n' "$timestamp" "$mode" >>"$ALERT_LOG"
}

while :; do
  desktop_info=""
  while read -r candidate_pid; do
    [[ -n "$candidate_pid" ]] || continue
    if grep -qz -- '--terminal-workspace-daemon' "/proc/$candidate_pid/cmdline" 2>/dev/null; then
      continue
    fi
    if is_production_desktop "$candidate_pid"; then
      desktop_info="$(ps -p "$candidate_pid" -o pid=,ppid=,pgid=,state=,rss= | awk '{ print $1 "|" $3 "|" $4 "|" $5; exit }')"
      break
    fi
  done < <(pgrep -u "$UID" -x termfleet 2>/dev/null || true)
  IFS='|' read -r desktop_pid desktop_pgid desktop_state desktop_rss <<<"$desktop_info"
  # Only inspect a WebKit renderer owned by the selected production desktop.
  # A host-wide first-match can mistake another WebKit app's blocked renderer
  # for TermFleet pressure and trigger an unrelated desktop recycle.
  webkit_info=""
  if [[ "$desktop_pgid" =~ ^[0-9]+$ ]]; then
    webkit_info="$(ps -eo pid=,ppid=,pgid=,state=,rss=,args= | awk -v pgid="$desktop_pgid" '$3 == pgid && $6 ~ /WebKitWebProcess/ { print $1 "|" $3 "|" $4 "|" $5; exit }')"
  fi
  IFS='|' read -r webkit_pid webkit_pgid webkit_state webkit_rss <<<"$webkit_info"
  memory_psi="$(read_psi_avg10 /proc/pressure/memory)"
  io_psi="$(read_psi_avg10 /proc/pressure/io)"
  memory_available_kb="$(awk '/^MemAvailable:/ { print $2; exit }' /proc/meminfo)"
  swap_total_kb="$(awk '/^SwapTotal:/ { print $2; exit }' /proc/meminfo)"
  swap_free_kb="$(awk '/^SwapFree:/ { print $2; exit }' /proc/meminfo)"
  swap_used_kb=$((swap_total_kb - swap_free_kb))
  sample_counter=$((sample_counter + 1))
  desktop_blocked_io_confirmed=0
  if awk -v value="$io_psi" -v threshold="$DESKTOP_BLOCKED_IO_THRESHOLD" 'BEGIN { exit !(value >= threshold) }'; then
    desktop_blocked_io_confirmed=1
  fi
  # Match only real TermFleet daemon commands whose final argument is the
  # daemon flag. A broad ps/awk substring match also counts the inspection
  # command itself, producing the false daemon_processes=2 alert.
  daemon_pids="$(pgrep -u "$UID" -f -- '[t]ermfleet.*--terminal-workspace-daemon$' || true)"
  daemon_count="$(printf '%s\n' "$daemon_pids" | awk 'NF { count++ } END { print count + 0 }')"
  socket_count="$(ss -xlpn 2>/dev/null | awk -v socket="$RUNTIME_DIR/terminal-workspace/daemon.sock" '$0 ~ socket && $0 ~ /LISTEN/ { count++ } END { print count + 0 }')"
  incident_details="pid=$desktop_pid pgid=$desktop_pgid state=$desktop_state rss_kb=$desktop_rss memory_psi_avg10=$memory_psi io_psi_avg10=$io_psi memory_available_kb=$memory_available_kb swap_used_kb=$swap_used_kb swap_total_kb=$swap_total_kb daemon_count=$daemon_count socket_count=$socket_count"

  reason=""
  detail=""
  if [[ "$webkit_state" == D* ]]; then
    ((webkit_blocked_count += 1))
  else
    webkit_blocked_count=0
  fi
  if [[ "$desktop_state" == D* ]]; then
    ((desktop_blocked_count += 1))
  else
    desktop_blocked_count=0
  fi
  if awk -v value="$memory_psi" 'BEGIN { exit !(value >= 5) }'; then
    ((host_memory_pressure_count += 1))
  else
    host_memory_pressure_count=0
  fi
  if awk -v value="$io_psi" 'BEGIN { exit !(value >= 10) }'; then
    ((host_io_pressure_count += 1))
  else
    host_io_pressure_count=0
  fi

  # Processes from private verifier runtimes share the daemon command name but
  # are not a split brain. The canonical socket listener count is authoritative.
  if (( socket_count > 1 )); then
    reason="daemon-split-brain"
    detail="daemon_processes=$daemon_count daemon_pids=$(printf '%s' "$daemon_pids" | tr '\n' ',') socket_listeners=$socket_count socket=$RUNTIME_DIR/terminal-workspace/daemon.sock"
  elif (( webkit_blocked_count >= BLOCKED_CONFIRMATIONS )); then
    reason="webkit-blocked"
    detail="pid=$webkit_pid rss_kb=$webkit_rss pgid=$webkit_pgid state=$webkit_state memory_psi_avg10=$memory_psi io_psi_avg10=$io_psi"
  elif (( desktop_blocked_count >= BLOCKED_CONFIRMATIONS )) && (( desktop_blocked_io_confirmed == 1 )); then
    reason="desktop-blocked"
    detail="pid=$desktop_pid rss_kb=$desktop_rss pgid=$desktop_pgid state=$desktop_state memory_psi_avg10=$memory_psi io_psi_avg10=$io_psi"
  # RSS alone is not pressure: WebKit routinely grows during normal cockpit
  # use. Only blocked processes or elevated host PSI can notify or recover.
  # memory-only readings are diagnostic, not pressure.
  elif (( host_memory_pressure_count >= HOST_PRESSURE_CONFIRMATIONS )); then
    reason="host-memory-pressure"
    detail="memory_psi_avg10=$memory_psi"
  elif (( host_io_pressure_count >= HOST_PRESSURE_CONFIRMATIONS )); then
    reason="host-io-pressure"
    detail="io_psi_avg10=$io_psi"
  fi

  if (( sample_counter >= 12 )); then
    termfleet_incident_record "pressure_sample" "${reason:-normal}" "$incident_details"
    sample_counter=0
  fi

  if [[ -n "$reason" && "$last_incident_reason" != "$reason" ]]; then
    termfleet_incident_record "pressure_started" "$reason" "$incident_details"
  elif [[ -z "$reason" && -n "$last_incident_reason" ]]; then
    termfleet_incident_record "pressure_cleared" "$last_incident_reason" "$incident_details"
  fi
  last_incident_reason="$reason"

  # Host-wide PSI is useful telemetry, but it does not prove TermFleet caused
  # the pressure. Keep it out of user actions so normal system I/O cannot
  # produce a misleading TermFleet notification or load-shed operation.
  if [[ -n "$reason" && "$reason" != host-* ]]; then
    # Alert once per incident; RSS and PSI details can change every poll and
    # must not turn one failure into a notification storm.
    signature="$reason"
    now_epoch="$(date +%s)"
    host_alert_allowed=1
    if [[ "$reason" == host-* ]] && (( now_epoch - last_host_alert_epoch < HOST_ALERT_COOLDOWN_SECONDS )); then
      host_alert_allowed=0
    fi
    recovery_allowed=1
    if (( now_epoch - last_recovery_epoch < RECOVERY_COOLDOWN_SECONDS )); then
      recovery_allowed=0
    fi
    if [[ "${last_signature:-}" != "$signature" ]] && (( now_epoch - last_alert_epoch >= ALERT_COOLDOWN_SECONDS )) && (( host_alert_allowed == 1 )); then
      timestamp="$(date --iso-8601=seconds)"
      prompt="TERM FLEET PRESSURE ALERT at $timestamp: $reason. $detail. Inspect the exact process tree before cleanup; keep the daemon alive."
      printf '%s\n' "$prompt" >"$PROMPT_FILE"
      printf '%s\n' "$prompt" >>"$ALERT_LOG"
      run_incident_audit "$timestamp"
      if [[ "$reason" == "host-io-pressure" ]]; then
        run_load_shed shed "$timestamp"
      fi
      recovery_text="host pressure detected; TermFleet desktop will not be recycled"
      if [[ "$reason" == webkit-blocked || "$reason" == desktop-blocked ]]; then
        recovery_text="renderer is blocked; desktop group will be recycled and relaunched"
      fi
      if command -v notify-send >/dev/null 2>&1 && [[ -S "${NOTIFY_BUS#unix:path=}" ]]; then
        DISPLAY="$NOTIFY_DISPLAY" DBUS_SESSION_BUS_ADDRESS="$NOTIFY_BUS" \
          notify-send --replace-id="$NOTIFY_REPLACE_ID" --urgency=critical "TermFleet pressure alert" "$reason: $detail; $recovery_text" \
          >>"$ALERT_LOG" 2>&1 || true
      fi
      recovery_pgid="$webkit_pgid"
      if [[ "$reason" == desktop-* ]]; then
        recovery_pgid="$desktop_pgid"
      fi
      if [[ "$RECOVER" == "1" && "$recovery_allowed" == "1" && ( "$reason" == webkit-blocked || "$reason" == desktop-blocked ) && "$recovery_pgid" =~ ^[0-9]+$ && "$recovery_pgid" -gt 1 ]]; then
        printf '%s recovery=desktop-group-%s daemon=preserved\n' "$timestamp" "$recovery_pgid" >>"$ALERT_LOG"
        termfleet_incident_record "desktop_recovery" "$reason" "recovery_pgid=$recovery_pgid daemon=preserved $incident_details"
        kill -- "-$recovery_pgid" 2>>"$ALERT_LOG" || true
        sleep 1
        "$DESKTOP_LAUNCHER" >>"$ALERT_LOG" 2>&1 &
        last_recovery_epoch="$now_epoch"
      fi
      last_signature="$signature"
      last_alert_epoch="$now_epoch"
      if [[ "$reason" == host-* ]]; then
        last_host_alert_epoch="$now_epoch"
      fi
    fi
  elif [[ -z "$reason" ]]; then
    if [[ -n "$last_incident_reason" && "$last_incident_reason" != host-* ]]; then
      run_load_shed restore "$(date --iso-8601=seconds)"
    fi
    last_signature=""
  fi

  sleep "$INTERVAL_SECONDS"
done
