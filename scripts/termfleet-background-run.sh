#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -eq 0 ]]; then
  echo "usage: $0 command [arg ...]" >&2
  exit 2
fi

CPU_WEIGHT="${TERMFLEET_BACKGROUND_CPU_WEIGHT:-50}"
IO_WEIGHT="${TERMFLEET_BACKGROUND_IO_WEIGHT:-25}"
UNIT="termfleet-background-$$-$(date +%s)"

exec systemd-run \
  --user \
  --scope \
  --collect \
  --unit="$UNIT" \
  -p CPUWeight="$CPU_WEIGHT" \
  -p IOWeight="$IO_WEIGHT" \
  -- "$@"
