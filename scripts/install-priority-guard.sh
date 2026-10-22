#!/usr/bin/env bash
# Install the always-on priority guard as a user service. Does not touch any terminal.
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
unit_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
mkdir -p "$unit_dir" "$HOME/.local/share/termfleet"
# The service runs straight from the checkout's scripts (link), like the other TermFleet helpers.
ln -sfn "$repo_root/scripts" "$HOME/.local/share/termfleet/priority-guard"
install -m 0644 "$repo_root/systemd/termfleet-priority-guard.service" "$unit_dir/termfleet-priority-guard.service"
systemctl --user daemon-reload
systemctl --user enable termfleet-priority-guard.service >/dev/null
systemctl --user restart termfleet-priority-guard.service
echo "priority guard installed and running."
