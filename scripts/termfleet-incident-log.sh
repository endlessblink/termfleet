#!/usr/bin/env bash

# Shared, append-only incident context for the watchdog and desktop launcher.
# JSONL is machine-readable; the Markdown stream is the handoff surface for
# people and agents inspecting a later failure.

INCIDENT_STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/termfleet"
INCIDENT_JSONL="$INCIDENT_STATE_DIR/incidents.jsonl"
INCIDENT_SUMMARY="$INCIDENT_STATE_DIR/incident-summary.md"
INCIDENT_LOCK="$INCIDENT_STATE_DIR/incidents.lock"

mkdir -p "$INCIDENT_STATE_DIR"

termfleet_incident_record() {
  local event="${1:-unknown}"
  local reason="${2:-none}"
  local details="${3:-}"
  local timestamp
  timestamp="$(date --iso-8601=seconds)"

  # Callers supply controlled values; strip line breaks and JSON delimiters so
  # one bad process detail can never corrupt the append-only stream.
  event="${event//$'\n'/ }"; event="${event//\"/ }"
  reason="${reason//$'\n'/ }"; reason="${reason//\"/ }"
  details="${details//$'\n'/ }"; details="${details//\"/ }"

  exec 8>>"$INCIDENT_LOCK"
  flock 8
  printf '{"schema":"termfleet.incident.v1","timestamp":"%s","event":"%s","reason":"%s","details":"%s"}\n' \
    "$timestamp" "$event" "$reason" "$details" >>"$INCIDENT_JSONL"
  if [[ ! -s "$INCIDENT_SUMMARY" ]]; then
    printf '# TermFleet incident history\n\nThis file is an automatic handoff from the desktop and pressure watchdog. Read the JSONL stream for exact event fields.\n\n' >"$INCIDENT_SUMMARY"
  fi
  printf -- '- %s — %s — %s%s\n' "$timestamp" "$event" "$reason" \
    "${details:+ — $details}" >>"$INCIDENT_SUMMARY"
  flock -u 8
  exec 8>&-
}

