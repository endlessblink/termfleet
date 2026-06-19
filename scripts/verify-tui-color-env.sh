#!/usr/bin/env bash
# Local regression for TUIs losing color when NO_COLOR leaks into the session.
set -euo pipefail

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

fail() {
  printf 'TUI_COLOR_ENV_FAILED: %s\n' "$*" >&2
  exit 1
}

if env NO_COLOR=1 bash -lc 'source "$HOME/.bashrc"; test -z "${NO_COLOR+x}"'; then
  printf '%s\n' "TUI_COLOR_ENV_BASH_UNSETS_NO_COLOR"
else
  fail "bash startup should unset NO_COLOR"
fi

if [[ -f "$HOME/.zshrc" ]]; then
  grep -q 'unset NO_COLOR' "$HOME/.zshrc" \
    && printf '%s\n' "TUI_COLOR_ENV_ZSH_UNSETS_NO_COLOR" \
    || fail "zsh startup should unset NO_COLOR"
fi

if ! command -v script >/dev/null 2>&1; then
  fail "script(1) is required for PTY color verification"
fi

if ! command -v codex >/dev/null 2>&1; then
  printf '%s\n' "TUI_COLOR_ENV_CODEX_SKIPPED command-not-found"
  printf '%s\n' "TUI_COLOR_ENV_OK"
  exit 0
fi

OUT="$TMP_DIR/codex-help.typescript"
script -q -c 'timeout 5 env NO_COLOR=1 codex --help' "$OUT" >/dev/null

if grep -q "$(printf '\033\\[1m')" "$OUT"; then
  printf '%s\n' "TUI_COLOR_ENV_CODEX_ANSI_OK"
else
  fail "codex --help should emit ANSI styling even when parent NO_COLOR=1"
fi

printf '%s\n' "TUI_COLOR_ENV_OK"
