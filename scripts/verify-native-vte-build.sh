#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

"$APP_ROOT/scripts/verify-native-terminal-deps.sh"

(
  cd "$APP_ROOT/src-tauri"
  cargo check --features native-vte
)
