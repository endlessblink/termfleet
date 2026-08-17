#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SMOKE="$APP_ROOT/scripts/verify-installed-restart-smoke.sh"

for route in sidebar-x terminal-x slash-exit; do
  for repeat in 1 2; do
    TERMFLEET_RESTART_SMOKE_CLOSE_TERMINAL=1 \
      TERMFLEET_RESTART_SMOKE_CLOSE_RESTORE_LOOP=1 \
      TERMFLEET_RESTART_SMOKE_CLOSE_ROUTE="$route" \
      "$SMOKE"
  done
done

printf '%s\n' "TERMFLEET_INSTALLED_CLOSE_ROUTE_MATRIX_OK routes=sidebar-x,terminal-x,slash-exit repeats=2"
