#!/usr/bin/env bash
# verify:clipboard-all-launchers — one gate for terminal copy/paste confidence
# across the supported TermFleet launch paths.
#
# The clipboard code lives in shared app/backend code, so the durable proof is:
#   1. shortcut/selection/frontend contracts pass,
#   2. backend OS clipboard read/write contracts pass,
#   3. every supported launcher reaches the same Tauri app/runtime,
#   4. optional headed proof exercises real bracketed paste in a desktop window.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "ok: $*"; }
run() {
  echo "+ $*"
  "$@"
}

grep_file() {
  local pattern="$1"
  local file="$2"
  local message="$3"
  grep -Eq -- "$pattern" "$file" || fail "$message"
}

verify_launcher_contracts() {
  grep_file 'CARGO_BUILD_JOBS=' run-dev.sh "run-dev.sh must keep the low-memory Rust build guard"
  grep_file 'CARGO_PROFILE_DEV_DEBUG=' run-dev.sh "run-dev.sh must keep the low-memory debug-info guard"
  grep_file 'FRESH_DAEMON=0' run-dev.sh "run-dev.sh must preserve daemon reuse by default"
  grep_file '--fresh-daemon' run-dev.sh "run-dev.sh must expose --fresh-daemon"
  grep_file 'TERMINAL_WORKSPACE_FRESH_DAEMON' run-dev.sh "run-dev.sh must honor TERMINAL_WORKSPACE_FRESH_DAEMON"
  grep_file 'npm run tauri:dev' run-dev.sh "run-dev.sh must launch the shared Tauri dev app"
  pass "run-dev.sh uses the shared clipboard/runtime path"

  if [[ -f run-native-vte-dev.sh ]]; then
    grep_file 'CARGO_BUILD_JOBS=' run-native-vte-dev.sh "run-native-vte-dev.sh must keep the low-memory Rust build guard"
    grep_file 'CARGO_PROFILE_DEV_DEBUG=' run-native-vte-dev.sh "run-native-vte-dev.sh must keep the low-memory debug-info guard"
    grep_file 'FRESH_DAEMON=0' run-native-vte-dev.sh "run-native-vte-dev.sh must preserve daemon reuse by default"
    grep_file '--fresh-daemon' run-native-vte-dev.sh "run-native-vte-dev.sh must expose --fresh-daemon"
    grep_file 'TERMINAL_WORKSPACE_FRESH_DAEMON' run-native-vte-dev.sh "run-native-vte-dev.sh must honor TERMINAL_WORKSPACE_FRESH_DAEMON"
    grep_file 'npm run tauri:dev' run-native-vte-dev.sh "run-native-vte-dev.sh must launch the shared Tauri dev app"
    pass "run-native-vte-dev.sh uses the shared clipboard/runtime path"
  fi

  if command -v termfleet >/dev/null 2>&1; then
    local target
    target="$(readlink -f "$(command -v termfleet)")"
    case "$target" in
      "$ROOT/run-dev.sh"|"$ROOT/run-native-vte-dev.sh")
        pass "termfleet command resolves to a supported launcher ($target)"
        ;;
      *)
        fail "termfleet command resolves to '$target', expected $ROOT/run-dev.sh or $ROOT/run-native-vte-dev.sh"
        ;;
    esac
  else
    echo "WARN: termfleet command not found on PATH; repo launchers still verified"
  fi
}

verify_shared_clipboard_contracts() {
  run npm run verify:keymap
  run npm run verify:selection
  run npm run verify:clipboard-paste
}

verify_optional_live_desktop() {
  case "${TERMFLEET_CLIPBOARD_LIVE:-0}" in
    1|true|yes)
      run env APP_BUDGET="${APP_BUDGET:-300}" npm run verify:bracketed-paste
      ;;
    *)
      echo "SKIP live headed bracketed-paste proof (set TERMFLEET_CLIPBOARD_LIVE=1 to run it)"
      ;;
  esac
}

verify_launcher_contracts
verify_shared_clipboard_contracts
verify_optional_live_desktop

echo "PASS: clipboard copy/paste verified across supported TermFleet launch paths"
