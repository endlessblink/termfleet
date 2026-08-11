#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
install_root="${XDG_DATA_HOME:-$HOME/.local/share}/termfleet/io-governor"
unit_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"

mkdir -p "$install_root" "$unit_dir"
install -m 0755 "$repo_root/scripts/termfleet-io-governor.mjs" "$install_root/termfleet-io-governor.mjs"
install -m 0755 "$repo_root/scripts/termfleet-background-run.sh" "$install_root/termfleet-background-run"
install -m 0644 "$repo_root/systemd/termfleet-io-governor.service" "$unit_dir/termfleet-io-governor.service"

systemctl --user daemon-reload
systemctl --user enable --now termfleet-io-governor.service
echo "TERM FLEET IO GOVERNOR ACTIVE"
