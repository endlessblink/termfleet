#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARTIFACT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/termfleet-gamification-live.XXXXXX")"
OCR_FILE="$ARTIFACT_DIR/gamification.txt"
cleanup() {
  if [[ "${TERMFLEET_KEEP_VISUAL_ARTIFACTS:-0}" == "1" ]]; then
    printf 'TERMFLEET_GAMIFICATION_ARTIFACTS=%s\n' "$ARTIFACT_DIR" >&2
  else
    rm -r -- "$ARTIFACT_DIR"
  fi
}
trap cleanup EXIT

TERMFLEET_REQUIRE_CLEAN_VISIBLE_DESKTOP=1 \
TERMFLEET_RESTART_SMOKE_GAMIFICATION=1 \
TERMFLEET_RESTART_SMOKE_ARTIFACT_DIR="$ARTIFACT_DIR" \
  "$APP_ROOT/scripts/verify-installed-restart-smoke.sh"

capture="$ARTIFACT_DIR/termfleet-installed-window-gamification.png"
[[ -s "$capture" ]] || { printf 'Gamification visual gate has no opened-panel screenshot.\n' >&2; exit 1; }
tesseract "$capture" stdout --psm 11 2>/dev/null | tr '\n' ' ' >"$OCR_FILE"
ocr="$(<"$OCR_FILE")"
for retired in "Your next move" "Choose one mission" "Recent receipts" "What you have achieved"; do
  [[ "$ocr" != *"$retired"* ]] || { printf 'Gamification visual gate found retired noisy UI: %s\n' "$retired" >&2; exit 1; }
done
for required in "Workstream quest" "Real terminal work only"; do
  [[ "$ocr" == *"$required"* ]] || { printf 'Gamification visual gate cannot find required UI: %s\n' "$required" >&2; exit 1; }
done
[[ "$ocr" =~ Rank[[:space:]]*1|Rank1 ]] || { printf 'Gamification visual gate found inherited progression instead of a fresh Rank 1 profile.\n' >&2; exit 1; }
closed_capture="$ARTIFACT_DIR/termfleet-installed-window-gamification-closed.png"
[[ -s "$closed_capture" ]] || { printf 'Gamification visual gate has no close-interaction screenshot.\n' >&2; exit 1; }
closed_ocr="$(tesseract "$closed_capture" stdout --psm 6 2>/dev/null | tr '\n' ' ')"
[[ "$closed_ocr" != *"Your next challenge"* ]] || { printf 'Gamification visual gate could not close the panel with Escape.\n' >&2; exit 1; }
printf 'TERMFLEET_GAMIFICATION_VISUAL_OK screenshot=%s\n' "$capture"
