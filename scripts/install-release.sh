#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_ROOT="${TERMFLEET_INSTALL_ROOT:-${XDG_DATA_HOME:-$HOME/.local/share}/termfleet}"
BIN_DIR="${TERMFLEET_BIN_DIR:-${HOME}/.local/bin}"
LIBEXEC_DIR="${TERMFLEET_LIBEXEC_DIR:-$INSTALL_ROOT/libexec}"
APPLICATIONS_DIR="${TERMFLEET_APPLICATIONS_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/applications}"
ICON_DIR="${TERMFLEET_ICON_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor/scalable/apps}"
LOAD_SHED_PATH="${TERMFLEET_LOAD_SHED_PATH:-${HOME}/.local/bin/termfleet-load-shed}"
PLASMA_ICON_DIR="${TERMFLEET_PLASMA_ICON_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/plasma_icons}"
SYSTEMD_USER_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
SOURCE_BINARY="$APP_ROOT/src-tauri/target/release/terminal-workspace"
DESKTOP_LAUNCHER_SOURCE="$APP_ROOT/scripts/termfleet-desktop-launcher.sh"
ICON_SOURCE="$APP_ROOT/public/brand/termfleet-vessel-master.svg"
RESOURCE_TOOL="$APP_ROOT/scripts/release-resources.py"

cd "$APP_ROOT"

BUILD_LOCK_FILE="${TERMFLEET_BUILD_LOCK_FILE:-${XDG_RUNTIME_DIR:-/tmp}/termfleet-build.lock}"
exec 9>"$BUILD_LOCK_FILE"
if ! flock -n 9; then
  printf 'Another TermFleet build is already running; refusing concurrent release work.\n' >&2
  exit 1
fi

# The existing promotion is a file transaction, not a daemon/service rollback.
# Only the finite destinations below are checkpointed. Never source checkpoint data.
normalize_root() {
  [[ "$1" == /* ]] || { printf 'Install paths must be absolute: %s\n' "$1" >&2; return 1; }
  local normalized
  normalized="$(readlink -m -- "$1")"
  [[ "$normalized" != / ]] || { printf 'Refusing filesystem root as install destination.\n' >&2; return 1; }
  printf '%s\n' "$normalized"
}
INSTALL_ROOT="$(normalize_root "$INSTALL_ROOT")"
BIN_DIR="$(normalize_root "$BIN_DIR")"
LIBEXEC_DIR="$(normalize_root "$LIBEXEC_DIR")"
APPLICATIONS_DIR="$(normalize_root "$APPLICATIONS_DIR")"
ICON_DIR="$(normalize_root "$ICON_DIR")"
PLASMA_ICON_DIR="$(normalize_root "$PLASMA_ICON_DIR")"
SYSTEMD_USER_DIR="$(normalize_root "$SYSTEMD_USER_DIR")"
LOAD_SHED_PATH="$(normalize_root "$(dirname "$LOAD_SHED_PATH")")/$(basename "$LOAD_SHED_PATH")"
[[ "$LIBEXEC_DIR" == "$INSTALL_ROOT/libexec" ]] || {
  printf 'Release support must remain inside the installed libexec directory.\n' >&2; exit 1;
}
[[ "$(dirname "$LOAD_SHED_PATH")" == "$BIN_DIR" ||
   "$LOAD_SHED_PATH" == "${HOME}/.local/bin/termfleet-load-shed" ]] || {
  printf 'Load-shed destination is outside the approved binary directories.\n' >&2; exit 1;
}
release_targets=(
  "$INSTALL_ROOT/previous"
  "$LIBEXEC_DIR/termfleet-desktop-launcher" "$LIBEXEC_DIR/filter-termfleet-restore.py"
  "$LIBEXEC_DIR/termfleet-pressure-watchdog" "$LIBEXEC_DIR/termfleet-capture-desktop-incident.sh"
  "$LIBEXEC_DIR/termfleet-pane-screen-monitor" "$LIBEXEC_DIR/termfleet-pane-health-monitor"
  "$SYSTEMD_USER_DIR/termfleet-pane-screen-monitor.service" "$LOAD_SHED_PATH"
  "$LIBEXEC_DIR/termfleet-incident-log.sh" "$BIN_DIR/termfleet-desktop"
  "$ICON_DIR/termfleet.svg" "$APPLICATIONS_DIR/termfleet.desktop"
)
if [[ -d "$PLASMA_ICON_DIR" ]]; then
  shopt -s nullglob
  for pinned_entry in "$PLASMA_ICON_DIR"/*.desktop; do
    if grep -qx "Name=TermFleet" "$pinned_entry"; then release_targets+=("$pinned_entry"); fi
  done
  shopt -u nullglob
fi
# Restore support first and atomically switch the command pointers last.
release_targets+=("$INSTALL_ROOT/current" "$BIN_DIR/termfleet")
for target in "${release_targets[@]}"; do
  [[ ! -d "$target" || -L "$target" ]] || {
    printf 'Expected a file/symlink destination, found directory: %s\n' "$target" >&2; exit 1;
  }
done

state_fingerprint() {
  local path="$1"
  if [[ -L "$path" ]]; then
    printf 'symlink\n'; stat -c '%f %u %g %s %Y' -- "$path" || return 1
    readlink -z -- "$path" | sha256sum
  elif [[ -f "$path" && "$path" == "$APPLICATIONS_DIR/termfleet.desktop" ]]; then
    # The bridge rewrites only this file's Icon= line whenever the dock counts change
    # (dock-icon.mjs), so a count change mid-build is not "the prior release changed".
    printf 'file\n'; stat -c '%f %u %g' -- "$path" || return 1
    grep -v '^Icon=' -- "$path" | sha256sum
  elif [[ -f "$path" ]]; then
    printf 'file\n'; stat -c '%f %u %g %s %Y' -- "$path" || return 1
    sha256sum <"$path"
  elif [[ -e "$path" ]]; then
    printf 'Refusing unsupported checkpoint entry: %s\n' "$path" >&2; return 1
  else printf 'absent\n'; fi
}
set_fingerprint() {
  local directory="$1" index
  {
    for index in "${!release_targets[@]}"; do
      printf '%s\n' "$index"
      if [[ "$directory" == live ]]; then state_fingerprint "${release_targets[$index]}" || return 1
      else state_fingerprint "$directory/$index.data" || return 1; fi
    done
  } | sha256sum | awk '{print $1}'
}
capture_set() {
  local directory="$1" index target
  mkdir -m 0700 -- "$directory"
  for index in "${!release_targets[@]}"; do
    target="${release_targets[$index]}"
    if [[ -e "$target" || -L "$target" ]]; then cp -a -- "$target" "$directory/$index.data"; fi
  done
}
restore_set() {
  local directory="$1" index target temporary
  for index in "${!release_targets[@]}"; do
    target="${release_targets[$index]}"
    # An ancestor changed after binding the checkpoint: stop, retain evidence.
    [[ "$(readlink -m -- "$(dirname "$target")")" == "$(dirname "$target")" ]] || {
      printf 'Restore destination ancestor changed: %s\n' "$target" >&2; return 1;
    }
    temporary="${target}.rollback-$$"
    [[ ! -e "$temporary" && ! -L "$temporary" ]] || return 1
    if [[ -e "$directory/$index.data" || -L "$directory/$index.data" ]]; then
      cp -a -- "$directory/$index.data" "$temporary" || return 1
      mv -Tf -- "$temporary" "$target" || return 1
    else rm -f -- "$target" || return 1; fi
  done
}
checkpoint_fingerprint() {
  local directory="$1"
  {
    sha256sum <"$directory/format.txt" || return 1
    sha256sum <"$directory/targets.nul" || return 1
    sha256sum <"$directory/promoted-target.txt" || return 1
    sha256sum <"$directory/installer.sha256" || return 1
    sha256sum <"$directory/previous-binary.sha256" || return 1
    sha256sum <"$directory/previous-manifest.sha256" || return 1
    sha256sum <"$directory/previous-resources.sha256" || return 1
    sha256sum <"$directory/promoted-manifest.sha256" || return 1
    sha256sum <"$directory/promoted-resources.sha256" || return 1
    set_fingerprint "$directory/before" || return 1
    set_fingerprint "$directory/after" || return 1
  } | sha256sum | awk '{print $1}'
}
verify_configured_release() {
  TERMFLEET_ALLOW_LEGACY_RESOURCES="${1:-0}" \
  TERMFLEET_COMMAND_PATH="$BIN_DIR/termfleet" \
  TERMFLEET_DESKTOP_LAUNCHER="$BIN_DIR/termfleet-desktop" \
  TERMFLEET_DESKTOP_ENTRY="$APPLICATIONS_DIR/termfleet.desktop" \
  TERMFLEET_DESKTOP_ICON="$ICON_DIR/termfleet.svg" \
  "$APP_ROOT/scripts/verify-installed-release.sh"
}
resources_fingerprint() {
  local release="$1" allow_legacy="${2:-0}" expected
  [[ ! -L "$release/manifest.env" && -f "$release/manifest.env" ]] || return 1
  expected="$(python3 "$RESOURCE_TOOL" manifest-checksum "$release")" || return 1
  if [[ "$expected" == absent && "$allow_legacy" == 1 && ! -e "$release/resources.json" && ! -L "$release/resources.json" ]]; then
    printf 'legacy-no-resources\n'; return 0
  fi
  [[ "$expected" =~ ^[0-9a-f]{64}$ ]] || {
    printf 'Release has no unique resource checksum: %s\n' "$release" >&2; return 1;
  }
  python3 "$RESOURCE_TOOL" verify "$release" "$expected"
}
if [[ "${1:-}" == --rollback ]]; then
  [[ $# == 2 && "$2" =~ ^[0-9a-f]{64}$ ]] || {
    printf 'Usage: install-release.sh --rollback <retained checkpoint SHA256>\n' >&2; exit 64;
  }
  checkpoint="$(readlink -f -- "$INSTALL_ROOT/rollback-checkpoint")"
  [[ -d "$checkpoint" && "$checkpoint" == "$INSTALL_ROOT/rollback-checkpoints/"* ]] || {
    printf 'No confined rollback checkpoint.\n' >&2; exit 1;
  }
  # Reject redirection/blocking entry shapes before reading checkpoint bytes.
  for metadata in format.txt targets.nul promoted-target.txt installer.sha256 previous-binary.sha256 previous-manifest.sha256 previous-resources.sha256 promoted-manifest.sha256 promoted-resources.sha256; do
    [[ ! -L "$checkpoint/$metadata" && -f "$checkpoint/$metadata" ]] || {
      printf 'Rollback metadata must be a regular non-symlink file: %s\n' "$metadata" >&2; exit 1;
    }
  done
  for section in before after; do
    [[ ! -L "$checkpoint/$section" && -d "$checkpoint/$section" ]] || {
      printf 'Rollback snapshot must be a real directory: %s\n' "$section" >&2; exit 1;
    }
  done
  [[ "$(cat "$checkpoint/format.txt")" == TERMFLEET_FILE_ROLLBACK_V2 ]] || exit 1
  [[ "$(cat "$checkpoint/installer.sha256")" == "$(sha256sum <"${BASH_SOURCE[0]}")" ]] || exit 1
  actual_checkpoint_sha="$(checkpoint_fingerprint "$checkpoint")" || exit 1
  [[ "$actual_checkpoint_sha" == "$2" ]] || {
    printf 'Rollback checkpoint checksum mismatch.\n' >&2; exit 1;
  }
  cmp -s "$checkpoint/targets.nul" <(printf '%s\0' "${release_targets[@]}") || {
    printf 'Rollback configured destination scope differs from checkpoint.\n' >&2; exit 1;
  }
  [[ "$(set_fingerprint live)" == "$(set_fingerprint "$checkpoint/after")" ]] || {
    printf 'Installed files changed after promotion; refusing to overwrite newer state.\n' >&2; exit 1;
  }
  [[ "$(readlink "$INSTALL_ROOT/current")" == "$(cat "$checkpoint/promoted-target.txt")" ]] || exit 1
  promoted_release="$(readlink -f -- "$INSTALL_ROOT/current")"
  [[ ! -L "$promoted_release/manifest.env" && -f "$promoted_release/manifest.env" &&
     "$(sha256sum <"$promoted_release/manifest.env" | awk '{print $1}')" == "$(cat "$checkpoint/promoted-manifest.sha256")" &&
     "$(resources_fingerprint "$promoted_release")" == "$(cat "$checkpoint/promoted-resources.sha256")" ]] || {
    printf 'Promoted immutable resources or manifest changed; refusing rollback.\n' >&2; exit 1;
  }
  # The old immutable binary must still match its own archived manifest.
  current_index=$((${#release_targets[@]} - 2))
  old_current="$checkpoint/before/$current_index.data"
  [[ -L "$old_current" ]] || { printf 'No previous known-good release.\n' >&2; exit 1; }
  old_target="$(readlink "$old_current")"
  [[ "$old_target" == releases/* && "$old_target" != *..* && "$old_target" != */*/* ]] || exit 1
  old_release="$(readlink -f -- "$INSTALL_ROOT/$old_target")"
  [[ "$old_release" == "$INSTALL_ROOT/releases/"* && ! -L "$old_release/manifest.env" && ! -L "$old_release/termfleet" && -f "$old_release/manifest.env" && -x "$old_release/termfleet" ]] || exit 1
  old_binary_sha="$(sed -n 's/^TERMFLEET_BINARY_SHA256=//p' "$old_release/manifest.env")"
  old_frontend_sha="$(sed -n 's/^TERMFLEET_FRONTEND_SHA256=//p' "$old_release/manifest.env")"
  [[ "$old_binary_sha" =~ ^[0-9a-f]{64}$ && "$old_frontend_sha" =~ ^[0-9a-f]{64}$ &&
     "$(sha256sum <"$old_release/termfleet" | awk '{print $1}')" == "$old_binary_sha" &&
     "$old_binary_sha" == "$(cat "$checkpoint/previous-binary.sha256")" &&
     "$(sha256sum <"$old_release/manifest.env" | awk '{print $1}')" == "$(cat "$checkpoint/previous-manifest.sha256")" ]] || exit 1
  [[ "$(resources_fingerprint "$old_release" 1)" == "$(cat "$checkpoint/previous-resources.sha256")" ]] || {
    printf 'Previous immutable resources changed; refusing rollback.\n' >&2; exit 1;
  }
  restore_set "$checkpoint/before" || {
    printf 'Rollback outcome incomplete; retain checkpoint=%s for reconciliation.\n' "$checkpoint" >&2; exit 1;
  }
  TERMFLEET_EXPECTED_FRONTEND_SHA="$old_frontend_sha" verify_configured_release 1 || {
    printf 'Rollback files restored but installed verifier failed; retain checkpoint=%s; no retry or daemon change.\n' "$checkpoint" >&2; exit 1;
  }
  printf 'TERMFLEET_RELEASE_ROLLED_BACK checkpoint=%s sha256=%s daemon=unchanged services=unchanged\n' "$checkpoint" "$2"
  exit 0
fi
[[ $# == 0 ]] || { printf 'Unknown install arguments.\n' >&2; exit 64; }
# Require an eligible known-good prior file release before a normal promotion.
# No current link is a first install; it cannot promise a previous rollback target.
prior_fingerprint=""
if [[ -e "$INSTALL_ROOT/current" || -L "$INSTALL_ROOT/current" ]]; then
  [[ -L "$INSTALL_ROOT/current" ]] || {
    printf 'Prior current must be the installer-managed relative release symlink.\n' >&2; exit 1;
  }
  prior_target="$(readlink "$INSTALL_ROOT/current")"
  [[ "$prior_target" =~ ^releases/[A-Za-z0-9._-]+$ && "$prior_target" != *..* ]] || {
    printf 'Prior current uses an unsupported release target.\n' >&2; exit 1;
  }
  prior_release="$(readlink -f -- "$INSTALL_ROOT/$prior_target")"
  [[ ! -L "$INSTALL_ROOT/$prior_target" && "$prior_release" == "$INSTALL_ROOT/releases/"* &&
     ! -L "$prior_release/manifest.env" && -f "$prior_release/manifest.env" &&
     ! -L "$prior_release/termfleet" && -f "$prior_release/termfleet" && -x "$prior_release/termfleet" ]] || {
    printf 'Prior immutable release is missing or redirected.\n' >&2; exit 1;
  }
  prior_binary_sha="$(sed -n 's/^TERMFLEET_BINARY_SHA256=//p' "$prior_release/manifest.env")"
  prior_frontend_sha="$(sed -n 's/^TERMFLEET_FRONTEND_SHA256=//p' "$prior_release/manifest.env")"
  [[ "$prior_binary_sha" =~ ^[0-9a-f]{64}$ && "$prior_frontend_sha" =~ ^[0-9a-f]{64}$ &&
     "$(sha256sum <"$prior_release/termfleet" | awk '{print $1}')" == "$prior_binary_sha" ]] || {
    printf 'Prior immutable release does not match its archived checksums.\n' >&2; exit 1;
  }
  prior_resources_sha="$(resources_fingerprint "$prior_release" 1)" || exit 1
  TERMFLEET_EXPECTED_FRONTEND_SHA="$prior_frontend_sha" verify_configured_release 1 || {
    printf 'Prior installed release is not eligible for a verified rollback.\n' >&2; exit 1;
  }
  prior_fingerprint="$(set_fingerprint live)"
  prior_manifest_sha="$(sha256sum <"$prior_release/manifest.env" | awk '{print $1}')"
fi
# Validate all configured public file resources before any build or promotion.
resources_sha="$(python3 "$RESOURCE_TOOL" inventory "$APP_ROOT")"
source_revision="$(git rev-parse --verify HEAD)"

run_background_build() {
  if command -v ionice >/dev/null 2>&1; then
    ionice -c 3 nice -n "${TERMFLEET_BUILD_NICE:-10}" "$@"
  else
    nice -n "${TERMFLEET_BUILD_NICE:-10}" "$@"
  fi
}

printf 'Building TermFleet frontend...\n'
run_background_build env VITE_TERMFLEET_RELEASE_ID="${source_revision:0:12}" npm run build

# The bundled web assets can receive new hashed filenames on each frontend
# build. Tell Cargo their completed tree checksum so build.rs always reruns the
# embed step, even when the previous asset list has been replaced.
frontend_sha="$(find "$APP_ROOT/dist" -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum | awk '{print $1}')"

printf 'Building safe TermFleet desktop release...\n'
# The installed desktop entry runs the immutable binary directly. Building an AppImage
# here adds an unrelated linuxdeploy failure surface without producing an install input.
run_background_build env \
  VITE_TERMFLEET_RELEASE_ID="${source_revision:0:12}" \
  TERMFLEET_FRONTEND_SHA256="$frontend_sha" \
  CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-1}" \
  cargo build --manifest-path "$APP_ROOT/src-tauri/Cargo.toml" \
    --bin terminal-workspace --features tauri/custom-protocol --release

[[ -x "$SOURCE_BINARY" ]] || {
  printf 'Release build did not produce %s\n' "$SOURCE_BINARY" >&2
  exit 1
}

binary_sha="$(sha256sum "$SOURCE_BINARY" | awk '{print $1}')"
git_revision="$(git rev-parse --verify HEAD)"
release_id="${git_revision:0:12}-${binary_sha:0:12}"
release_id="${release_id}-${frontend_sha:0:12}"
release_id="${release_id}-${resources_sha:0:12}"
releases_dir="$INSTALL_ROOT/releases"
release_dir="$releases_dir/$release_id"
staging_dir="$releases_dir/.staging-$release_id-$$"
plasma_pin_updated=0
[[ ! -L "$releases_dir" && ! -L "$release_dir" ]] || {
  printf 'Immutable release storage is redirected.\n' >&2; exit 1;
}

mkdir -p "$releases_dir" "$BIN_DIR" "$LIBEXEC_DIR" "$APPLICATIONS_DIR" "$ICON_DIR" "$SYSTEMD_USER_DIR"

transaction_active=0
checkpoint=""
cleanup() {
  local status=$?
  trap - EXIT
  if (( transaction_active == 1 )); then
    if restore_set "$checkpoint/before"; then
      printf 'TermFleet release failed; restored pre-promotion file state; daemon/services unchanged. checkpoint=%s\n' "$checkpoint" >&2
    else
      printf 'TermFleet rollback incomplete; retain checkpoint=%s; reconcile before retry.\n' "$checkpoint" >&2
      status=1
    fi
  fi
  rm -rf -- "$staging_dir"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [[ ! -d "$release_dir" ]]; then
  mkdir "$staging_dir"
  install -m 0755 "$SOURCE_BINARY" "$staging_dir/termfleet"
  python3 "$RESOURCE_TOOL" stage "$APP_ROOT" "$staging_dir" "$resources_sha" >/dev/null
  {
    printf 'TERMFLEET_RELEASE_ID=%s\n' "$release_id"
    printf 'TERMFLEET_GIT_REVISION=%s\n' "$git_revision"
    printf 'TERMFLEET_BINARY_SHA256=%s\n' "$binary_sha"
    printf 'TERMFLEET_FRONTEND_SHA256=%s\n' "$frontend_sha"
    printf 'TERMFLEET_RESOURCES_SHA256=%s\n' "$resources_sha"
    printf 'TERMFLEET_BUILT_AT=%s\n' "$(date --iso-8601=seconds)"
  } >"$staging_dir/manifest.env"
  mv -- "$staging_dir" "$release_dir"
fi

[[ ! -L "$release_dir/termfleet" && -f "$release_dir/termfleet" &&
   ! -L "$release_dir/manifest.env" && -f "$release_dir/manifest.env" ]] || {
  printf 'Existing immutable release binary or manifest is redirected.\n' >&2; exit 1;
}
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
[[ "$(resources_fingerprint "$release_dir")" == "$resources_sha" ]] || {
  printf 'Existing immutable resource checksum mismatch.\n' >&2; exit 1;
}

mkdir -p -- "$INSTALL_ROOT/rollback-checkpoints"
checkpoint="$INSTALL_ROOT/rollback-checkpoints/$release_id-$$"
mkdir -m 0700 -- "$checkpoint"
printf 'TERMFLEET_FILE_ROLLBACK_V2\n' >"$checkpoint/format.txt"
printf '%s\0' "${release_targets[@]}" >"$checkpoint/targets.nul"
printf 'releases/%s\n' "$release_id" >"$checkpoint/promoted-target.txt"
sha256sum <"${BASH_SOURCE[0]}" >"$checkpoint/installer.sha256"
if [[ -n "$prior_fingerprint" ]]; then
  [[ "$(set_fingerprint live)" == "$prior_fingerprint" &&
     "$(sha256sum <"$prior_release/termfleet" | awk '{print $1}')" == "$prior_binary_sha" &&
     "$(sha256sum <"$prior_release/manifest.env" | awk '{print $1}')" == "$prior_manifest_sha" &&
     "$(resources_fingerprint "$prior_release" 1)" == "$prior_resources_sha" ]] || {
    printf 'Prior release changed during build; refusing promotion.\n' >&2; exit 1;
  }
fi
capture_set "$checkpoint/before"
printf 'absent\n' >"$checkpoint/previous-binary.sha256"
printf 'absent\n' >"$checkpoint/previous-manifest.sha256"
printf 'absent\n' >"$checkpoint/previous-resources.sha256"
sha256sum <"$release_dir/manifest.env" | awk '{print $1}' >"$checkpoint/promoted-manifest.sha256"
printf '%s\n' "$resources_sha" >"$checkpoint/promoted-resources.sha256"
if [[ -L "$INSTALL_ROOT/current" ]]; then
  previous_release="$(readlink -f "$INSTALL_ROOT/current")"
  [[ "$previous_release" == "$INSTALL_ROOT/releases/"* ]] || {
    printf 'Previous release resolves outside immutable release storage.\n' >&2; exit 1;
  }
  [[ ! -L "$previous_release/termfleet" && ! -L "$previous_release/manifest.env" && -f "$previous_release/termfleet" && -f "$previous_release/manifest.env" ]] || exit 1
  sha256sum <"$previous_release/termfleet" | awk '{print $1}' >"$checkpoint/previous-binary.sha256"
  sha256sum <"$previous_release/manifest.env" | awk '{print $1}' >"$checkpoint/previous-manifest.sha256"
  resources_fingerprint "$previous_release" 1 >"$checkpoint/previous-resources.sha256"
fi
transaction_active=1

if [[ -L "$INSTALL_ROOT/current" ]]; then
  current_target="$(readlink "$INSTALL_ROOT/current")"
  ln -s "$current_target" "$INSTALL_ROOT/.previous-$release_id-$$"
  mv -Tf -- "$INSTALL_ROOT/.previous-$release_id-$$" "$INSTALL_ROOT/previous"
fi
ln -s "releases/$release_id" "$INSTALL_ROOT/.current-$release_id-$$"
mv -Tf -- "$INSTALL_ROOT/.current-$release_id-$$" "$INSTALL_ROOT/current"

ln -s "$INSTALL_ROOT/current/termfleet" "$BIN_DIR/.termfleet-$release_id-$$"
mv -Tf -- "$BIN_DIR/.termfleet-$release_id-$$" "$BIN_DIR/termfleet"

install -m 0755 "$DESKTOP_LAUNCHER_SOURCE" "$LIBEXEC_DIR/termfleet-desktop-launcher"
install -m 0755 "$APP_ROOT/scripts/filter-termfleet-restore.py" "$LIBEXEC_DIR/filter-termfleet-restore.py"
install -m 0755 "$APP_ROOT/scripts/termfleet-pressure-watchdog.sh" "$LIBEXEC_DIR/termfleet-pressure-watchdog"
install -m 0755 "$APP_ROOT/scripts/termfleet-capture-desktop-incident.sh" "$LIBEXEC_DIR/termfleet-capture-desktop-incident.sh"
install -m 0755 "$APP_ROOT/scripts/monitor-cockpit-pane-screens.mjs" "$LIBEXEC_DIR/termfleet-pane-screen-monitor"
install -m 0755 "$APP_ROOT/scripts/monitor-cockpit-pane-health.mjs" "$LIBEXEC_DIR/termfleet-pane-health-monitor"
install -m 0644 "$APP_ROOT/systemd/termfleet-pane-screen-monitor.service" "$SYSTEMD_USER_DIR/termfleet-pane-screen-monitor.service"
install -m 0755 "$APP_ROOT/scripts/termfleet-load-shed.sh" "$LOAD_SHED_PATH"
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

verify_configured_release
capture_set "$checkpoint/after"
checkpoint_sha="$(checkpoint_fingerprint "$checkpoint")"
ln -s "rollback-checkpoints/$(basename "$checkpoint")" "$INSTALL_ROOT/.rollback-checkpoint-$release_id-$$"
mv -Tf -- "$INSTALL_ROOT/.rollback-checkpoint-$release_id-$$" "$INSTALL_ROOT/rollback-checkpoint"
transaction_active=0

if command -v systemctl >/dev/null 2>&1 && [[ -S "${XDG_RUNTIME_DIR:-/run/user/$UID}/bus" ]]; then
  XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$UID}" \
    DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=${XDG_RUNTIME_DIR:-/run/user/$UID}/bus}" \
    systemctl --user try-restart termfleet-pressure-watchdog.service >/dev/null 2>&1 || true
    systemctl --user daemon-reload >/dev/null 2>&1 || true
systemctl --user enable --now termfleet-pane-screen-monitor.service >/dev/null 2>&1 || true
systemctl --user try-restart termfleet-pane-screen-monitor.service >/dev/null 2>&1 || true
  fi
printf 'TERMFLEET_RELEASE_PROMOTED id=%s binary=%s rollbackCheckpointSha256=%s checkpoint=%s\n' "$release_id" "$BIN_DIR/termfleet" "$checkpoint_sha" "$checkpoint"
