#!/usr/bin/env bash
# Release-blocking verification for TermFleet.
#
# This is intentionally heavier than the fast build: process survival is a
# product invariant, so a release candidate must prove daemon-owned PTYs survive
# app restarts and remain diagnosable.
set -euo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

run_npm() {
  printf '\n==> npm run %s\n' "$1"
  npm run "$1"
}

cd "$APP_ROOT"

run_npm verify:terminal-reliability
run_npm verify:restart-restore
run_npm verify:daemon-latency

if [[ "${TERMFLEET_RELEASE_SKIP_GUI:-0}" == "1" ]]; then
  printf '\nSkipping GUI release smoke because TERMFLEET_RELEASE_SKIP_GUI=1.\n'
  printf 'TERM_FLEET_RELEASE_CHECK_OK gui=skipped\n'
  exit 0
fi

run_npm verify:standalone-daemon

printf '\nTERMFLEET_RELEASE_CHECK_OK gui=1\n'
