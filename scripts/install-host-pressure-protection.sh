#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "run as root: sudo $0" >&2
  exit 1
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
install -D -m 0644 "$repo_root/systemd/termfleet-host-pressure.service" \
  /etc/systemd/system/termfleet-host-pressure.service
install -D -m 0644 "$repo_root/systemd/user-1000.slice.d/pressure.conf" \
  /etc/systemd/system/user-1000.slice.d/pressure.conf

systemctl daemon-reload
systemctl enable --now termfleet-host-pressure.service
systemctl set-property user-1000.slice MemoryHigh=56G CPUQuota=1800%

echo "TERM FLEET HOST PRESSURE PROTECTION ACTIVE"
systemctl show user-1000.slice -p MemoryHigh --no-pager
systemctl show user-1000.slice -p CPUQuotaPerSecUSec --no-pager
cat /sys/module/zswap/parameters/enabled
cat /sys/module/zswap/parameters/max_pool_percent 2>/dev/null || true
