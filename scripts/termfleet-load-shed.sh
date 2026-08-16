#!/usr/bin/env bash
# Lower priority for disposable work during host I/O pressure.
# This script never kills, pauses, or moves a process between cgroups.

set -euo pipefail

state_dir="${XDG_STATE_HOME:-$HOME/.local/state}/termfleet"
state_file="$state_dir/load-shed.state"
mode="${1:-shed}"

proc_start() {
  awk '{print $22; exit}' "/proc/$1/stat" 2>/dev/null || true
}

is_disposable() {
  local command_line="$1"
  [[ "$command_line" != *"--terminal-workspace-daemon"* ]] || return 1
  [[ "$command_line" != *"/termfleet$"* ]] || return 1
  [[ "$command_line" =~ (vite[[:space:]]+build|[[:space:]]rustc[[:space:]]|cargo[[:space:]]+(build|test|check)|lifeboat_sandbox_replay\.py|playwright|chrome-headless|chromium.*--headless|flowstate-installed-verification-profile|/esbuild([[:space:]]|$)) ]]
}

shed() {
  local temporary="$state_file.tmp"
  mkdir -p "$state_dir"
  : >"$temporary"
  while IFS= read -r row; do
    local pid="${row%% *}" command_line="${row#* }"
    [[ "$pid" =~ ^[0-9]+$ ]] || continue
    [[ "$pid" != "$$" ]] || continue
    is_disposable "$command_line" || continue
    local start="$(proc_start "$pid")"
    [[ -n "$start" ]] || continue
    local nice_value
    nice_value="$(ps -p "$pid" -o ni= 2>/dev/null | tr -d ' ')"
    [[ "$nice_value" =~ ^-?[0-9]+$ ]] || continue
    printf '%s|%s|%s\n' "$pid" "$start" "$nice_value" >>"$temporary"
    renice 10 -p "$pid" >/dev/null 2>&1 || true
    ionice -c 3 -p "$pid" >/dev/null 2>&1 || true
    printf 'load-shed=applied pid=%s command=%s\n' "$pid" "$command_line"
  done < <(ps -eo pid=,args=)
  mv "$temporary" "$state_file"
}

restore() {
  [[ -r "$state_file" ]] || exit 0
  while IFS='|' read -r pid start nice_value; do
    [[ "$pid" =~ ^[0-9]+$ && "$start" =~ ^[0-9]+$ && "$nice_value" =~ ^-?[0-9]+$ ]] || continue
    [[ "$(proc_start "$pid")" == "$start" ]] || continue
    renice "$nice_value" -p "$pid" >/dev/null 2>&1 || true
    ionice -c 2 -n 4 -p "$pid" >/dev/null 2>&1 || true
    printf 'load-shed=restored pid=%s\n' "$pid"
  done <"$state_file"
  : >"$state_file"
}

case "$mode" in
  shed) shed ;;
  restore) restore ;;
  *) echo "usage: $0 [shed|restore]" >&2; exit 64 ;;
esac
