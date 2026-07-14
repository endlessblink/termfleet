#!/usr/bin/env bash
# Install (or remove) the TC-055 automatic maintenance job: a systemd --user timer
# that periodically (1) ensures the daemon's soft memory guardrail is applied and
# (2) reaps idle exited-agent leftover tool servers. Mirrors the agent-fleet-snapshot
# timer pattern (hand-written units in ~/.config/systemd/user + enable --now).
#
# Usage:
#   scripts/install-reaper-timer.sh              # install + enable + start now
#   scripts/install-reaper-timer.sh --uninstall  # disable + remove
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
NODE="$(command -v node || echo /usr/bin/node)"
RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"

SERVICE="$UNIT_DIR/termfleet-reaper.service"
TIMER="$UNIT_DIR/termfleet-reaper.timer"

if [[ "${1:-}" == "--uninstall" ]]; then
  systemctl --user disable --now termfleet-reaper.timer 2>/dev/null || true
  rm -f "$SERVICE" "$TIMER"
  systemctl --user daemon-reload
  echo "reaper timer uninstalled."
  exit 0
fi

mkdir -p "$UNIT_DIR"

cat >"$SERVICE" <<EOF
[Unit]
Description=termfleet: ensure daemon load guardrail + reap idle exited-agent leftovers (TC-055)

[Service]
Type=oneshot
WorkingDirectory=$REPO/scripts
# The reaper connects to the daemon Unix socket under XDG_RUNTIME_DIR; pin it so a
# stripped service environment can never silently miss the daemon (falls back to /tmp).
Environment=XDG_RUNTIME_DIR=$RUNTIME_DIR
# 1) apply the soft memory ceiling to whatever daemon is running (live, no restart).
ExecStart=$NODE $REPO/scripts/termfleet-guardrail-ensure.mjs
# 2) reap idle exited-agent leftover tool servers (never touches live agents).
ExecStart=$NODE $REPO/scripts/termfleet-reaper.mjs --apply
EOF

cat >"$TIMER" <<EOF
[Unit]
Description=termfleet: run the guardrail+reaper maintenance every 15 minutes (TC-055)

[Timer]
OnBootSec=3min
OnUnitActiveSec=15min
AccuracySec=30s
Unit=termfleet-reaper.service

[Install]
WantedBy=timers.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now termfleet-reaper.timer
echo "reaper timer installed and started."
echo "  units: $SERVICE"
echo "         $TIMER"
echo "  check: systemctl --user list-timers | grep termfleet-reaper"
echo "  logs:  journalctl --user -u termfleet-reaper.service"
