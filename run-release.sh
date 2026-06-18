#!/usr/bin/env bash
set -euo pipefail

SCRIPT_PATH="$(readlink -f "${BASH_SOURCE[0]}")"
APP_DIR="$(dirname "$SCRIPT_PATH")"

cd "$APP_DIR"

echo "Building latest Terminal Workspace release UI..."
npm run tauri build

# agent-fleet: re-open curated AI-agent sessions (paused) once per boot when
# termfleet starts. Backgrounded so it never blocks launch; guarded by --once
# (won't double-run with the login systemd service) + liveness dedup.
AGENT_FLEET_RESTORE="/media/endlessblink/data/my-projects/ai-development/cc-linux-enhancments/scripts/agent-fleet/restore.py"
if [ -f "$AGENT_FLEET_RESTORE" ]; then
  ( sleep 5; /usr/bin/python3 "$AGENT_FLEET_RESTORE" --once termfleet >/dev/null 2>&1 ) &
fi

exec "$APP_DIR/src-tauri/target/release/terminal-workspace"
