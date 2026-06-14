#!/usr/bin/env bash
# Regression gate for noisy Rust dev launches. Any warning in the TermFleet
# Rust crate should fail here, so stale helpers do not linger until a user sees
# them in `tauri dev` output.
set -euo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_DIR="${TERMFLEET_RUST_WARNINGS_TARGET:-/tmp/tw-rust-warnings-target}"

cd "$APP_ROOT"
RUSTFLAGS="${RUSTFLAGS:-} -Dwarnings" \
  CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-1}" \
  CARGO_PROFILE_DEV_DEBUG="${CARGO_PROFILE_DEV_DEBUG:-0}" \
  CARGO_TARGET_DIR="$TARGET_DIR" \
  cargo check --manifest-path src-tauri/Cargo.toml

echo "TERMFLEET_RUST_WARNINGS_OK"
