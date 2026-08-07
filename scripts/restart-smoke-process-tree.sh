#!/usr/bin/env bash

termfleet_smoke_runtime_pids() {
  local expected_runtime="$1"
  local proc runtime

  for proc in /proc/[0-9]*; do
    [[ -r "$proc/environ" ]] || continue
    runtime="$(
      { tr '\0' '\n' <"$proc/environ"; } 2>/dev/null |
        sed -n 's/^XDG_RUNTIME_DIR=//p'
    )"
    [[ "$runtime" == "$expected_runtime" ]] || continue
    printf '%s\n' "${proc##*/}"
  done
}

termfleet_smoke_terminate_processes() {
  local process_group_pid="$1"
  local runtime_dir="$2"
  local signal pid attempt

  if [[ "$process_group_pid" =~ ^[0-9]+$ ]] &&
    kill -0 -- "-$process_group_pid" 2>/dev/null; then
    kill -TERM -- "-$process_group_pid" 2>/dev/null || true
  fi

  for signal in TERM KILL; do
    for attempt in {1..20}; do
      mapfile -t runtime_pids < <(termfleet_smoke_runtime_pids "$runtime_dir")
      ((${#runtime_pids[@]} == 0)) && return 0
      for pid in "${runtime_pids[@]}"; do
        [[ "$pid" == "$$" ]] && continue
        kill "-$signal" "$pid" 2>/dev/null || true
      done
      sleep 0.05
    done
  done

  mapfile -t runtime_pids < <(termfleet_smoke_runtime_pids "$runtime_dir")
  ((${#runtime_pids[@]} == 0))
}
