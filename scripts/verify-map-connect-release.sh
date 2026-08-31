#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BINARY="${TERMFLEET_RELEASE_BINARY:-$(readlink -f "$HOME/.local/share/termfleet/current/termfleet" 2>/dev/null || true)}"
if [[ -z "$BINARY" || ! -x "$BINARY" ]]; then
  BINARY="$(find "$HOME/.local/share/termfleet/releases" -maxdepth 2 -type f -name termfleet -perm -u+x -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -1 | cut -d' ' -f2-)"
fi
[[ -x "$BINARY" ]] || { echo "MAP_CONNECT_RELEASE_BINARY_MISSING" >&2; exit 1; }

echo "MAP_CONNECT_RELEASE_BINARY=$BINARY"
exec env MAP_CONNECT_BINARY="$BINARY" MAP_CONNECT_RUN_ID="release-$(date +%Y%m%d-%H%M%S)-$$" \
  bash "$APP_ROOT/scripts/verify-map-connect-live.sh" "$@"
