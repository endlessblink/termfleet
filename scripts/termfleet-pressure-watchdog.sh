#!/usr/bin/env bash
set -euo pipefail

STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/termfleet"
ALERT_LOG="$STATE_DIR/pressure-alerts.log"
PROMPT_FILE="$STATE_DIR/pressure-alert.prompt"
LOCK_FILE="$STATE_DIR/pressure-watchdog.lock"
INTERVAL_SECONDS="${TERMFLEET_PRESSURE_WATCHDOG_INTERVAL:-5}"
MEMORY_LIMIT_KB="${TERMFLEET_PRESSURE_WATCHDOG_MEMORY_KB:-786432}"
NOTIFY_DISPLAY="${DISPLAY:-:0}"
NOTIFY_BUS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=${XDG_RUNTIME_DIR:-/run/user/$UID}/bus}"
RECOVER="${TERMFLEET_PRESSURE_WATCHDOG_RECOVER:-1}"
DESKTOP_LAUNCHER="${TERMFLEET_DESKTOP_LAUNCHER:-$HOME/.local/bin/termfleet-desktop}"
ALERT_COOLDOWN_SECONDS="${TERMFLEET_PRESSURE_WATCHDOG_ALERT_COOLDOWN:-300}"
HOST_ALERT_COOLDOWN_SECONDS="${TERMFLEET_PRESSURE_WATCHDOG_HOST_ALERT_COOLDOWN:-1800}"
BLOCKED_CONFIRMATIONS="${TERMFLEET_PRESSURE_WATCHDOG_BLOCKED_CONFIRMATIONS:-3}"
RECOVERY_COOLDOWN_SECONDS="${TERMFLEET_PRESSURE_WATCHDOG_RECOVERY_COOLDOWN:-120}"
NOTIFY_REPLACE_ID="${TERMFLEET_PRESSURE_WATCHDOG_NOTIFY_ID:-4242}"
RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$UID}"
last_alert_epoch=0
last_host_alert_epoch=0
last_recovery_epoch=0
webkit_blocked_count=0
desktop_blocked_count=0

mkdir -p "$STATE_DIR"
exec 9>"$LOCK_FILE"
flock -n 9 || exit 0

read_psi_avg10() {
  awk '/^some / { for (i = 1; i <= NF; i++) if ($i ~ /^avg10=/) { sub("avg10=", "", $i); print $i; exit } }' "$1" 2>/dev/null || printf '0\n'
}

while :; do
  webkit_info="$(ps -eo pid=,ppid=,pgid=,state=,rss=,args= | awk '$6 ~ /WebKitWebProcess/ { print $1 "|" $3 "|" $4 "|" $5; exit }')"
  IFS='|' read -r webkit_pid webkit_pgid webkit_state webkit_rss <<<"$webkit_info"
  desktop_info="$(ps -eo pid=,ppid=,pgid=,state=,rss=,args= | awk '$6 ~ /\/termfleet$/ && $0 !~ /--terminal-workspace-daemon/ { print $1 "|" $3 "|" $4 "|" $5; exit }')"
  IFS='|' read -r desktop_pid desktop_pgid desktop_state desktop_rss <<<"$desktop_info"
  memory_psi="$(read_psi_avg10 /proc/pressure/memory)"
  io_psi="$(read_psi_avg10 /proc/pressure/io)"
  # Match only real TermFleet daemon commands whose final argument is the
  # daemon flag. A broad ps/awk substring match also counts the inspection
  # command itself, producing the false daemon_processes=2 alert.
  daemon_pids="$(pgrep -u "$UID" -f -- '[t]ermfleet.*--terminal-workspace-daemon$' || true)"
  daemon_count="$(printf '%s\n' "$daemon_pids" | awk 'NF { count++ } END { print count + 0 }')"
  socket_count="$(ss -xlpn 2>/dev/null | awk -v socket="$RUNTIME_DIR/terminal-workspace/daemon.sock" '$0 ~ socket && $0 ~ /LISTEN/ { count++ } END { print count + 0 }')"

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

  if (( daemon_count > 1 || socket_count > 1 )); then
    reason="daemon-split-brain"
    detail="daemon_processes=$daemon_count daemon_pids=$(printf '%s' "$daemon_pids" | tr '\n' ',') socket_listeners=$socket_count socket=$RUNTIME_DIR/terminal-workspace/daemon.sock"
  elif (( webkit_blocked_count >= BLOCKED_CONFIRMATIONS )); then
    reason="webkit-blocked"
    detail="pid=$webkit_pid rss_kb=$webkit_rss pgid=$webkit_pgid state=$webkit_state memory_psi_avg10=$memory_psi io_psi_avg10=$io_psi"
  elif [[ -n "$webkit_rss" ]] && (( webkit_rss > MEMORY_LIMIT_KB )); then
    reason="webkit-memory"
    detail="pid=$webkit_pid rss_kb=$webkit_rss limit_kb=$MEMORY_LIMIT_KB pgid=$webkit_pgid state=$webkit_state memory_psi_avg10=$memory_psi io_psi_avg10=$io_psi"
  elif (( desktop_blocked_count >= BLOCKED_CONFIRMATIONS )); then
    reason="desktop-blocked"
    detail="pid=$desktop_pid rss_kb=$desktop_rss pgid=$desktop_pgid state=$desktop_state memory_psi_avg10=$memory_psi io_psi_avg10=$io_psi"
  elif [[ -n "$desktop_rss" ]] && (( desktop_rss > MEMORY_LIMIT_KB )); then
    reason="desktop-memory"
    detail="pid=$desktop_pid rss_kb=$desktop_rss limit_kb=$MEMORY_LIMIT_KB pgid=$desktop_pgid state=$desktop_state memory_psi_avg10=$memory_psi io_psi_avg10=$io_psi"
  elif awk -v value="$memory_psi" 'BEGIN { exit !(value >= 5) }'; then
    reason="host-memory-pressure"
    detail="memory_psi_avg10=$memory_psi"
  elif awk -v value="$io_psi" 'BEGIN { exit !(value >= 10) }'; then
    reason="host-io-pressure"
    detail="io_psi_avg10=$io_psi"
  fi

  if [[ -n "$reason" ]]; then
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
      recovery_text="host pressure detected; TermFleet desktop will not be recycled"
      if [[ "$reason" == webkit-* || "$reason" == desktop-* ]]; then
        recovery_text="renderer pressure detected; desktop group will be recycled and relaunched"
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
      if [[ "$RECOVER" == "1" && "$recovery_allowed" == "1" && ( "$reason" == webkit-* || "$reason" == desktop-* ) && "$recovery_pgid" =~ ^[0-9]+$ && "$recovery_pgid" -gt 1 ]]; then
        printf '%s recovery=desktop-group-%s daemon=preserved\n' "$timestamp" "$recovery_pgid" >>"$ALERT_LOG"
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
  else
    last_signature=""
  fi

  sleep "$INTERVAL_SECONDS"
done
