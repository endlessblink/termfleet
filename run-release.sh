#!/usr/bin/env bash
set -euo pipefail

SCRIPT_PATH="$(readlink -f "${BASH_SOURCE[0]}")"
APP_DIR="$(dirname "$SCRIPT_PATH")"

"$APP_DIR/scripts/install-release.sh"
exec "${TERMFLEET_BIN_DIR:-$HOME/.local/bin}/termfleet"
