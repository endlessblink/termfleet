#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_ROOT="${TERMFLEET_INSTALL_ROOT:-${XDG_DATA_HOME:-$HOME/.local/share}/termfleet}"
COMMAND_PATH="${TERMFLEET_COMMAND_PATH:-${HOME}/.local/bin/termfleet}"
DESKTOP_LAUNCHER="${TERMFLEET_DESKTOP_LAUNCHER:-${HOME}/.local/bin/termfleet-desktop}"
DESKTOP_ENTRY="${TERMFLEET_DESKTOP_ENTRY:-${XDG_DATA_HOME:-$HOME/.local/share}/applications/termfleet.desktop}"
DESKTOP_ICON="${TERMFLEET_DESKTOP_ICON:-${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor/scalable/apps/termfleet.svg}"
PLASMA_ICON_DIR="${TERMFLEET_PLASMA_ICON_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/plasma_icons}"
EXPECTED_FRONTEND_ROOT="${TERMFLEET_EXPECTED_FRONTEND_ROOT:-$APP_ROOT}"
EXPECTED_FRONTEND_SHA="${TERMFLEET_EXPECTED_FRONTEND_SHA:-}"

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

[[ -L "$COMMAND_PATH" ]] || fail "$COMMAND_PATH must be an atomic release symlink"

resolved="$(readlink -f "$COMMAND_PATH")"
expected_prefix="$(readlink -m "$INSTALL_ROOT/releases")/"

[[ "$resolved" == "$expected_prefix"* ]] ||
  fail "$COMMAND_PATH resolves to development source: $resolved"
[[ -x "$resolved" ]] || fail "installed TermFleet release is not executable: $resolved"
[[ -f "$INSTALL_ROOT/current/manifest.env" ]] ||
  fail "installed release manifest is missing"

case "$resolved" in
  "$APP_ROOT"/*|*/run-dev.sh|*/run-release.sh|*/node_modules/*|*/target/*)
    fail "installed TermFleet command is not isolated from build/source paths: $resolved"
    ;;
esac

grep -Eq '^TERMFLEET_BINARY_SHA256=[0-9a-f]{64}$' "$INSTALL_ROOT/current/manifest.env" ||
  fail "installed release manifest has no binary checksum"

expected_sha="$(sed -n 's/^TERMFLEET_BINARY_SHA256=//p' "$INSTALL_ROOT/current/manifest.env")"
actual_sha="$(sha256sum "$resolved" | awk '{print $1}')"
[[ "$actual_sha" == "$expected_sha" ]] ||
  fail "installed release checksum does not match its manifest"

grep -Eq '^TERMFLEET_FRONTEND_SHA256=[0-9a-f]{64}$' "$INSTALL_ROOT/current/manifest.env" ||
  fail "installed release manifest has no frontend checksum"

installed_frontend_sha="$(sed -n 's/^TERMFLEET_FRONTEND_SHA256=//p' "$INSTALL_ROOT/current/manifest.env")"
expected_frontend_sha="$EXPECTED_FRONTEND_SHA"
if [[ -z "$expected_frontend_sha" ]]; then
  frontend_dist_dir="$EXPECTED_FRONTEND_ROOT/dist"
  [[ -d "$frontend_dist_dir" ]] ||
    fail "expected frontend dist is missing: $frontend_dist_dir"
  expected_frontend_sha="$(
    find "$frontend_dist_dir" -type f -print0 |
      sort -z |
      xargs -0 sha256sum |
      sha256sum |
      awk '{print $1}'
  )"
fi
[[ "$installed_frontend_sha" == "$expected_frontend_sha" ]] ||
  fail "installed frontend checksum does not match the current build"

[[ -L "$DESKTOP_LAUNCHER" ]] || fail "desktop launcher must be an installed symlink"
launcher_resolved="$(readlink -f "$DESKTOP_LAUNCHER")"
[[ "$launcher_resolved" == "$INSTALL_ROOT/libexec/termfleet-desktop-launcher" ]] ||
  fail "desktop launcher resolves outside the installed release support files: $launcher_resolved"
[[ -x "$launcher_resolved" ]] || fail "desktop launcher is not executable"
[[ -f "$DESKTOP_ENTRY" ]] || fail "TermFleet desktop entry is missing"
grep -qx "Exec=$DESKTOP_LAUNCHER --dock" "$DESKTOP_ENTRY" ||
  fail "TermFleet desktop entry does not launch the installed desktop command"
grep -qx "Icon=termfleet" "$DESKTOP_ENTRY" ||
  fail "TermFleet desktop entry does not use the branded icon"
grep -qx "StartupWMClass=Termfleet" "$DESKTOP_ENTRY" ||
  fail "TermFleet desktop entry window identity cannot match the packaged app"
[[ -s "$DESKTOP_ICON" ]] || fail "TermFleet branded desktop icon is missing"
if [[ -d "$PLASMA_ICON_DIR" ]]; then
  shopt -s nullglob
  for pinned_entry in "$PLASMA_ICON_DIR"/*.desktop; do
    if grep -qx "Name=TermFleet" "$pinned_entry" &&
      ! cmp -s "$DESKTOP_ENTRY" "$pinned_entry"; then
      fail "TermFleet pinned taskbar launcher is stale: $pinned_entry"
    fi
  done
  shopt -u nullglob
fi

printf 'TERMFLEET_INSTALLED_RELEASE_OK binary=%s sha256=%s\n' "$resolved" "$actual_sha"
