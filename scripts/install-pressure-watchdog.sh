#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_ROOT="${XDG_DATA_HOME:-$HOME/.local/share}/termfleet"
LIBEXEC_DIR="$DATA_ROOT/libexec"
SYSTEMD_USER_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"

mkdir -p "$LIBEXEC_DIR" "$SYSTEMD_USER_DIR"
install -m 0755 "$APP_ROOT/scripts/termfleet-pressure-watchdog.sh" \
  "$LIBEXEC_DIR/termfleet-pressure-watchdog"
install -m 0755 "$APP_ROOT/scripts/termfleet-load-shed.sh" \
  "$HOME/.local/bin/termfleet-load-shed"
install -m 0755 "$APP_ROOT/scripts/termfleet-incident-log.sh" \
  "$LIBEXEC_DIR/termfleet-incident-log.sh"
install -m 0644 "$APP_ROOT/systemd/termfleet-pressure-watchdog.service" \
  "$SYSTEMD_USER_DIR/termfleet-pressure-watchdog.service"

if [[ -n "${DBUS_SESSION_BUS_ADDRESS:-}" || -S "${XDG_RUNTIME_DIR:-/run/user/$UID}/bus" ]]; then
  export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$UID}"
  export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}"
  systemctl --user daemon-reload
  systemctl --user enable --now termfleet-pressure-watchdog.service
  echo "TERMFLEET_PRESSURE_WATCHDOG_INSTALLED active"
else
  echo "TERMFLEET_PRESSURE_WATCHDOG_INSTALLED files-only (user bus unavailable)"
fi
