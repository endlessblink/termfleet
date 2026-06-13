#!/usr/bin/env bash
# Single reliability gate for the Canvas2D terminal stack.
#
# Default mode runs fast source/unit/browser checks. Set
# TERMFLEET_TERMINAL_RELIABILITY_LIVE=1 to also run private Xvfb/Tauri canaries
# for regular shell reattach, old-session repair, zellij map, bracketed paste,
# resize storms, shortcut routing, and daemon restart/restore.
set -euo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIVE="${TERMFLEET_TERMINAL_RELIABILITY_LIVE:-0}"
RUST_TARGET_DIR="${TERMFLEET_TERMINAL_RELIABILITY_TARGET:-/tmp/tw-terminal-reliability-target}"

run() {
  printf '\n==> %s\n' "$*"
  "$@"
}

run_npm() {
  printf '\n==> npm run %s\n' "$1"
  npm run "$1"
}

cd "$APP_ROOT"

run_npm verify:map-terminals
run_npm verify:canvas-all
run env CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-1}" CARGO_TARGET_DIR="$RUST_TARGET_DIR" \
  cargo test --manifest-path src-tauri/Cargo.toml vt_grid::tests -- --nocapture
run env CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-1}" CARGO_TARGET_DIR="$RUST_TARGET_DIR" \
  cargo test --manifest-path src-tauri/Cargo.toml pty::tests -- --nocapture
run_npm verify:daemon-survival
run_npm build

if [[ "$LIVE" == "1" ]]; then
  run env APP_BUDGET="${LEGACY_PROMPT_APP_BUDGET:-240}" npm run verify:legacy-prompt-live
  run env APP_BUDGET="${SCROLLBACK_REATTACH_APP_BUDGET:-240}" npm run verify:scrollback-reattach
  run env APP_BUDGET="${MAP_SHELL_ANCHOR_APP_BUDGET:-240}" npm run verify:map-shell-anchor
  run env APP_BUDGET="${ZELLIJ_MAP_APP_BUDGET:-360}" npm run verify:zellij-map
  run env APP_BUDGET="${BRACKETED_PASTE_APP_BUDGET:-300}" npm run verify:bracketed-paste
  run env APP_BUDGET="${RESIZE_STORM_APP_BUDGET:-360}" npm run verify:resize-storm
  run env APP_BUDGET="${ZELLIJ_SHORTCUTS_APP_BUDGET:-360}" npm run verify:zellij-shortcuts
  run env APP_BUDGET="${CANVAS_LIVE_APP_BUDGET:-360}" npm run verify:canvas-live
  run env APP_BUDGET="${STANDALONE_DAEMON_APP_BUDGET:-360}" npm run verify:standalone-daemon
  run_npm verify:restart-restore
else
  printf '\nSkipping live Xvfb/Tauri canaries. Re-run with TERMFLEET_TERMINAL_RELIABILITY_LIVE=1 for the full terminal reliability matrix.\n'
fi

printf '\nTERMFLEET_TERMINAL_RELIABILITY_OK live=%s\n' "$LIVE"
