#!/usr/bin/env bash
# verify:clipboard-paste — guard the Ctrl+Shift+V text-paste path so it cannot
# silently break "again".
#
# Why this exists: navigator.clipboard.readText() is blocked in WebKitGTK, so text
# paste must read the OS clipboard from the Rust backend (clipboard_read_text), and
# that command MUST stay async or it deadlocks the GTK main thread
# (tauri-apps/plugins-workspace#2267). This checks both the source-contract
# invariants AND the real clipboard read on this machine.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "ok: $*"; }

# --- 1. Source-contract invariants (run everywhere, incl. headless CI) ---------
grep -q 'pub async fn clipboard_read_text' src-tauri/src/commands.rs \
  || fail "clipboard_read_text must be 'pub async fn' (sync deadlocks WebKitGTK — plugins-workspace#2267)"
pass "backend command is async"

grep -q 'commands::clipboard_read_text' src-tauri/src/lib.rs \
  || fail "clipboard_read_text is not registered in lib.rs invoke_handler"
pass "command registered in lib.rs"

grep -q 'invoke<string>("clipboard_read_text")' src/components/TerminalCanvas.tsx \
  || fail "Ctrl+Shift+V must read the clipboard via the backend command, not navigator.clipboard alone"
pass "frontend reads the clipboard via the backend command"

# The fallback chain the backend relies on must be present in source order.
grep -q '"wl-paste"' src-tauri/src/commands.rs && grep -q '"xclip"' src-tauri/src/commands.rs && grep -q '"xsel"' src-tauri/src/commands.rs \
  || fail "backend must try wl-paste -> xclip -> xsel"
pass "Wayland+X11 fallback chain present"

# --- 2. Live read (only where a clipboard tool + display exist) ----------------
tool=""
for t in wl-paste xclip xsel; do command -v "$t" >/dev/null 2>&1 && { tool="$t"; break; }; done
if [ -z "$tool" ] || { [ -z "${DISPLAY:-}" ] && [ -z "${WAYLAND_DISPLAY:-}" ]; }; then
  echo "SKIP live read: no clipboard tool / no display (source-contract checks passed)"
  exit 0
fi

set_clip() { case "$1" in
  wl-copy) printf '%s' "$2" | wl-copy ;;
  *)       printf '%s' "$2" | xclip -selection clipboard 2>/dev/null || printf '%s' "$2" | xsel --clipboard --input ;;
esac; }
read_clip() { # mirrors clipboard_read_text's order
  wl-paste --no-newline --type text/plain 2>/dev/null && return 0
  xclip -selection clipboard -o 2>/dev/null && return 0
  xsel --clipboard --output 2>/dev/null && return 0
  return 1
}

MARKER="termfleet-paste-guard-$$-abc123"
set_clip xclip "$MARKER"
got="$(read_clip || true)"
[ "$got" = "$MARKER" ] || fail "clipboard read returned '$got', expected '$MARKER'"
pass "live clipboard read returns the exact text ($tool)"

echo "PASS: clipboard text-paste path verified"
