#!/usr/bin/env bash
# Read-only, bounded host sampler for TermFleet interaction investigations.
# Records process state/ticks, top thread states, and host/cgroup PSI only.
set -euo pipefail

INTERVAL_SECONDS=5
RETENTION_MINUTES=2880
OUTPUT_DIR="${TERMFLEET_PERF_LOG_DIR:-${XDG_RUNTIME_DIR:-/tmp}/termfleet/performance}"
UI_PID=""
WEBKIT_PID=""
ONCE=0

usage() { printf 'Usage: %s [--once] [--pid PID] [--webkit-pid PID] [--interval SECONDS] [--retention-minutes MINUTES] [--output-dir DIR]\n' "$0"; }
while (($#)); do
  case "$1" in
    --once) ONCE=1; shift ;;
    --pid) UI_PID="${2:-}"; shift 2 ;;
    --webkit-pid) WEBKIT_PID="${2:-}"; shift 2 ;;
    --interval) INTERVAL_SECONDS="${2:-}"; shift 2 ;;
    --retention-minutes) RETENTION_MINUTES="${2:-}"; shift 2 ;;
    --output-dir) OUTPUT_DIR="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done
[[ "$INTERVAL_SECONDS" =~ ^[1-9][0-9]*$ && "$RETENTION_MINUTES" =~ ^[1-9][0-9]*$ ]] || { usage >&2; exit 2; }

discover_ui() {
  local candidate
  while read -r candidate; do
    [[ -r "/proc/$candidate/cmdline" ]] || continue
    grep -qz -- '--terminal-workspace-daemon' "/proc/$candidate/cmdline" && continue
    printf '%s\n' "$candidate"
    return 0
  done < <(pgrep -u "$UID" -x termfleet 2>/dev/null || true)
  return 1
}

discover_webkit() {
  local ui_pid="$1" pgid
  [[ "$ui_pid" =~ ^[0-9]+$ && -r "/proc/$ui_pid/stat" ]] || return 1
  pgid="$(ps -o pgid= -p "$ui_pid" | tr -d ' ' || true)"
  [[ "$pgid" =~ ^[0-9]+$ ]] || return 1
  ps -eo pid=,pgid=,args= | awk -v group="$pgid" '$2 == group && /WebKitWebProcess/ { print $1; exit }'
}

proc_state_ticks() {
  local pid="$1"
  [[ "$pid" =~ ^[0-9]+$ && -r "/proc/$pid/stat" ]] || { printf 'gone\t0\tunknown'; return; }
  local metrics state ticks wchan
  metrics="$(awk '{ sub(/^.*\) /, ""); print $1, $12 + $13 }' "/proc/$pid/stat" 2>/dev/null || true)"
  read -r state ticks <<<"$metrics"
  wchan="$(cat "/proc/$pid/wchan" 2>/dev/null || printf unknown)"
  printf '%s\t%s\t%s' "${state:-gone}" "${ticks:-0}" "${wchan:-unknown}"
}

psi_avg() {
  awk -v kind="$2" '$1 == kind { for (i=1; i<=NF; i++) if ($i ~ /^avg10=/) { sub("avg10=", "", $i); print $i; exit } }' "$1" 2>/dev/null || printf '0'
}

sample() {
  local ui="$UI_PID" webkit="$WEBKIT_PID" ui_metrics webkit_metrics ui_state ui_ticks ui_wchan webkit_state webkit_ticks webkit_wchan ui_threads webkit_threads
  [[ -n "$ui" ]] || ui="$(discover_ui || true)"
  [[ -n "$webkit" && -r "/proc/$webkit/stat" ]] || webkit="$(discover_webkit "$ui" 2>/dev/null || true)"
  ui_metrics="$(proc_state_ticks "$ui")"
  webkit_metrics="$(proc_state_ticks "$webkit")"
  IFS=$'\t' read -r ui_state ui_ticks ui_wchan <<<"$ui_metrics"
  IFS=$'\t' read -r webkit_state webkit_ticks webkit_wchan <<<"$webkit_metrics"
  ui_threads="$( { ps -L -p "$ui" -o tid=,stat=,pcpu=,wchan:20= --sort=-pcpu 2>/dev/null || true; } | awk 'NR<=3 {gsub(/[[:space:]]/,"",$4); printf "%s%s:%s:%s:%s", sep,$1,$2,$3,($4==""?"unknown":$4); sep=","} END {if(NR==0)printf "absent"}')"
  webkit_threads="$( { ps -L -p "$webkit" -o tid=,stat=,pcpu=,wchan:20= --sort=-pcpu 2>/dev/null || true; } | awk 'NR<=3 {gsub(/[[:space:]]/,"",$4); printf "%s%s:%s:%s:%s", sep,$1,$2,$3,($4==""?"unknown":$4); sep=","} END {if(NR==0)printf "absent"}')"
  local cg="" cgpath="" cpu_some=0 cpu_full=0 io_some=0 io_full=0
  if [[ "$ui" =~ ^[0-9]+$ && -r "/proc/$ui/cgroup" ]]; then
    cgpath="$(awk -F: '$1=="0" {print $3; exit}' "/proc/$ui/cgroup")"
    cg="/sys/fs/cgroup$cgpath"
    cpu_some="$(psi_avg "$cg/cpu.pressure" some)"; cpu_full="$(psi_avg "$cg/cpu.pressure" full)"
    io_some="$(psi_avg "$cg/io.pressure" some)"; io_full="$(psi_avg "$cg/io.pressure" full)"
  fi
  mkdir -p -- "$OUTPUT_DIR"
  local file="$OUTPUT_DIR/desktop-samples-$(date -u +%F).tsv"
  if [[ ! -e "$file" ]]; then
    printf 'timestamp\tui_pid\tui_state\tui_cpu_ticks\tui_wchan\twebkit_pid\twebkit_state\twebkit_cpu_ticks\twebkit_wchan\thost_cpu_some_avg10\thost_io_some_avg10\thost_io_full_avg10\tcgroup_cpu_some_avg10\tcgroup_cpu_full_avg10\tcgroup_io_some_avg10\tcgroup_io_full_avg10\tui_threads_top3\twebkit_threads_top3\n' >"$file"
  fi
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$(date --iso-8601=seconds)" "${ui:-0}" "$ui_state" "$ui_ticks" "$ui_wchan" "${webkit:-0}" "$webkit_state" "$webkit_ticks" "$webkit_wchan" \
    "$(psi_avg /proc/pressure/cpu some)" "$(psi_avg /proc/pressure/io some)" "$(psi_avg /proc/pressure/io full)" \
    "$cpu_some" "$cpu_full" "$io_some" "$io_full" "$ui_threads" "$webkit_threads" >>"$file"
  find "$OUTPUT_DIR" -maxdepth 1 -type f -name 'desktop-samples-*.tsv' -mmin "+$RETENTION_MINUTES" -delete 2>/dev/null || true
}

while :; do
  sample
  (( ONCE )) && exit 0
  sleep "$INTERVAL_SECONDS"
done
