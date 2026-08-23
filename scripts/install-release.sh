#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_ROOT="${TERMFLEET_INSTALL_ROOT:-${XDG_DATA_HOME:-$HOME/.local/share}/termfleet}"
BIN_DIR="${TERMFLEET_BIN_DIR:-${HOME}/.local/bin}"
LIBEXEC_DIR="${TERMFLEET_LIBEXEC_DIR:-$INSTALL_ROOT/libexec}"
APPLICATIONS_DIR="${TERMFLEET_APPLICATIONS_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/applications}"
ICON_DIR="${TERMFLEET_ICON_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor/scalable/apps}"
PLASMA_ICON_DIR="${TERMFLEET_PLASMA_ICON_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/plasma_icons}"
SOURCE_BINARY="$APP_ROOT/src-tauri/target/release/terminal-workspace"
DESKTOP_LAUNCHER_SOURCE="$APP_ROOT/scripts/termfleet-desktop-launcher.sh"
ICON_SOURCE="$APP_ROOT/public/brand/termfleet-vessel-master.svg"

cd "$APP_ROOT"
source_revision="$(git rev-parse --verify HEAD)"

BUILD_LOCK_FILE="${XDG_RUNTIME_DIR:-/tmp}/termfleet-build.lock"
exec 9>"$BUILD_LOCK_FILE"
if ! flock -n 9; then
  printf 'Another TermFleet build is already running; refusing concurrent release work.\n' >&2
  exit 1
fi

run_background_build() {
  if command -v ionice >/dev/null 2>&1; then
    ionice -c 3 nice -n "${TERMFLEET_BUILD_NICE:-10}" "$@"
  else
    nice -n "${TERMFLEET_BUILD_NICE:-10}" "$@"
  fi
}

printf 'Building TermFleet frontend...\n'
VITE_TERMFLEET_RELEASE_ID="${source_revision:0:12}" run_background_build npm run build

printf 'Building safe TermFleet desktop release...\n'
# The installed desktop entry runs the immutable binary directly. Building an AppImage
# here adds an unrelated linuxdeploy failure surface without producing an install input.
run_background_build env CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-1}" npm run tauri build -- --no-bundle

[[ -x "$SOURCE_BINARY" ]] || {
  printf 'Release build did not produce %s\n' "$SOURCE_BINARY" >&2
  exit 1
}

binary_sha="$(sha256sum "$SOURCE_BINARY" | awk '{print $1}')"
git_revision="$(git rev-parse --verify HEAD)"
release_id="${git_revision:0:12}-${binary_sha:0:12}"
releases_dir="$INSTALL_ROOT/releases"
release_dir="$releases_dir/$release_id"
staging_dir="$releases_dir/.staging-$release_id-$$"
old_current_target=""
old_command_target=""
plasma_pin_updated=0

mkdir -p "$releases_dir" "$BIN_DIR" "$LIBEXEC_DIR" "$APPLICATIONS_DIR" "$ICON_DIR"

cleanup() {
  if [[ -d "$staging_dir" ]]; then
    rm -r -- "$staging_dir"
  fi
}
trap cleanup EXIT

if [[ ! -d "$release_dir" ]]; then
  mkdir "$staging_dir"
  install -m 0755 "$SOURCE_BINARY" "$staging_dir/termfleet"
  {
    printf 'TERMFLEET_RELEASE_ID=%s\n' "$release_id"
    printf 'TERMFLEET_GIT_REVISION=%s\n' "$git_revision"
    printf 'TERMFLEET_BINARY_SHA256=%s\n' "$binary_sha"
    printf 'TERMFLEET_BUILT_AT=%s\n' "$(date --iso-8601=seconds)"
  } >"$staging_dir/manifest.env"
  mv -- "$staging_dir" "$release_dir"
fi

installed_sha="$(sha256sum "$release_dir/termfleet" | awk '{print $1}')"
[[ "$installed_sha" == "$binary_sha" ]] || {
  printf 'Existing release checksum mismatch: %s\n' "$release_dir" >&2
  exit 1
}
[[ -f "$release_dir/manifest.env" ]] || {
  printf 'Release manifest is missing: %s\n' "$release_dir" >&2
  exit 1
}
grep -qx "TERMFLEET_BINARY_SHA256=$binary_sha" "$release_dir/manifest.env" || {
  printf 'Release manifest checksum mismatch: %s\n' "$release_dir" >&2
  exit 1
}

if [[ -L "$INSTALL_ROOT/current" ]]; then
  current_target="$(readlink "$INSTALL_ROOT/current")"
  old_current_target="$current_target"
  ln -s "$current_target" "$INSTALL_ROOT/.previous-$release_id-$$"
  mv -Tf -- "$INSTALL_ROOT/.previous-$release_id-$$" "$INSTALL_ROOT/previous"
fi
if [[ -L "$BIN_DIR/termfleet" ]]; then
  old_command_target="$(readlink "$BIN_DIR/termfleet")"
fi

ln -s "releases/$release_id" "$INSTALL_ROOT/.current-$release_id-$$"
mv -Tf -- "$INSTALL_ROOT/.current-$release_id-$$" "$INSTALL_ROOT/current"

ln -s "$INSTALL_ROOT/current/termfleet" "$BIN_DIR/.termfleet-$release_id-$$"
mv -Tf -- "$BIN_DIR/.termfleet-$release_id-$$" "$BIN_DIR/termfleet"

install -m 0755 "$DESKTOP_LAUNCHER_SOURCE" "$LIBEXEC_DIR/termfleet-desktop-launcher"
install -m 0755 "$APP_ROOT/scripts/filter-termfleet-restore.py" "$LIBEXEC_DIR/filter-termfleet-restore.py"
install -m 0755 "$APP_ROOT/scripts/termfleet-pressure-watchdog.sh" "$LIBEXEC_DIR/termfleet-pressure-watchdog"
install -m 0755 "$APP_ROOT/scripts/termfleet-load-shed.sh" "$HOME/.local/bin/termfleet-load-shed"
install -m 0755 "$APP_ROOT/scripts/termfleet-incident-log.sh" "$LIBEXEC_DIR/termfleet-incident-log.sh"
ln -s "$LIBEXEC_DIR/termfleet-desktop-launcher" "$BIN_DIR/.termfleet-desktop-$release_id-$$"
mv -Tf -- "$BIN_DIR/.termfleet-desktop-$release_id-$$" "$BIN_DIR/termfleet-desktop"
install -m 0644 "$ICON_SOURCE" "$ICON_DIR/termfleet.svg"

desktop_tmp="$APPLICATIONS_DIR/.termfleet.desktop.$$"
{
  printf '[Desktop Entry]\n'
  printf 'Type=Application\n'
  printf 'Name=TermFleet\n'
  printf 'Comment=Keyboard-first terminal cockpit\n'
  printf 'Exec=%s --dock\n' "$BIN_DIR/termfleet-desktop"
  printf 'Icon=termfleet\n'
  printf 'Terminal=false\n'
  printf 'Categories=Development;\n'
  printf 'StartupNotify=true\n'
  printf 'StartupWMClass=Termfleet\n'
} >"$desktop_tmp"
mv -f -- "$desktop_tmp" "$APPLICATIONS_DIR/termfleet.desktop"
if [[ -d "$PLASMA_ICON_DIR" ]]; then
  shopt -s nullglob
  for pinned_entry in "$PLASMA_ICON_DIR"/*.desktop; do
    if grep -qx "Name=TermFleet" "$pinned_entry" &&
      ! cmp -s "$APPLICATIONS_DIR/termfleet.desktop" "$pinned_entry"; then
      install -m 0644 "$APPLICATIONS_DIR/termfleet.desktop" "$pinned_entry"
      plasma_pin_updated=1
    fi
  done
  shopt -u nullglob
fi
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$APPLICATIONS_DIR"
fi
if command -v kbuildsycoca6 >/dev/null 2>&1; then
  kbuildsycoca6 --noincremental >/dev/null 2>&1 || true
elif command -v kbuildsycoca5 >/dev/null 2>&1; then
  kbuildsycoca5 --noincremental >/dev/null 2>&1 || true
fi
if (( plasma_pin_updated == 1 )) && command -v qdbus6 >/dev/null 2>&1; then
  session_bus="/run/user/$UID/bus"
  if [[ -S "$session_bus" ]]; then
    DBUS_SESSION_BUS_ADDRESS="unix:path=$session_bus" \
      qdbus6 org.kde.plasmashell /PlasmaShell \
        org.kde.PlasmaShell.refreshCurrentShell >/dev/null 2>&1 || true
  fi
fi

if ! "$APP_ROOT/scripts/verify-installed-release.sh"; then
  if [[ -n "$old_current_target" ]]; then
    ln -s "$old_current_target" "$INSTALL_ROOT/.rollback-current-$release_id-$$"
    mv -Tf -- "$INSTALL_ROOT/.rollback-current-$release_id-$$" "$INSTALL_ROOT/current"
  else
    rm -f -- "$INSTALL_ROOT/current"
  fi
  if [[ -n "$old_command_target" ]]; then
    ln -s "$old_command_target" "$BIN_DIR/.rollback-termfleet-$release_id-$$"
    mv -Tf -- "$BIN_DIR/.rollback-termfleet-$release_id-$$" "$BIN_DIR/termfleet"
  else
    rm -f -- "$BIN_DIR/termfleet"
  fi
  printf 'TermFleet release verification failed; restored the last-known-good release.\n' >&2
  exit 1
fi

# A shell watchdog keeps executing the inode it started from. Refresh it after
# promotion so a release cannot leave the old watchdog logic running from a
# deleted support file while a new instance waits on the same lock.
if command -v systemctl >/dev/null 2>&1 && [[ -S "${XDG_RUNTIME_DIR:-/run/user/$UID}/bus" ]]; then
  XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$UID}" \
    DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=${XDG_RUNTIME_DIR:-/run/user/$UID}/bus}" \
    systemctl --user try-restart termfleet-pressure-watchdog.service >/dev/null 2>&1 || true
fi
printf 'TERMFLEET_RELEASE_PROMOTED id=%s binary=%s\n' "$release_id" "$BIN_DIR/termfleet"
