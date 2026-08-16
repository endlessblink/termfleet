#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
command -v magick >/dev/null || { printf 'Missing gamification visual prerequisite: magick\n' >&2; exit 1; }
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
TERMFLEET_RESTART_SMOKE_BEAM=1 \
TERMFLEET_RESTART_SMOKE_ARTIFACT_DIR="$ARTIFACT_DIR" \
  "$APP_ROOT/scripts/verify-installed-restart-smoke.sh"

capture="$ARTIFACT_DIR/termfleet-installed-window-gamification.png"
[[ -s "$capture" ]] || { printf 'Gamification visual gate has no opened-panel screenshot.\n' >&2; exit 1; }
ocr_capture="$ARTIFACT_DIR/gamification-ocr.png"
magick "$capture" -crop 1400x420+0+0 -resize 200% -colorspace Gray -contrast-stretch 0x15 "$ocr_capture"
tesseract "$ocr_capture" stdout --psm 11 2>/dev/null | tr '[:upper:]' '[:lower:]' | tr '\n' ' ' >"$OCR_FILE"
ocr="$(<"$OCR_FILE")"
for retired in "your next move" "choose one mission" "recent receipts" "what you have achieved"; do
  [[ "$ocr" != *"$retired"* ]] || { printf 'Gamification visual gate found retired noisy UI: %s\n' "$retired" >&2; exit 1; }
done
for required in "workstream quest" "next milestone"; do
  [[ "$ocr" == *"$required"* ]] || { printf 'Gamification visual gate cannot find required UI: %s\n' "$required" >&2; exit 1; }
done
[[ "$ocr" =~ 0:00|0[[:space:]]*/[[:space:]]*10:00 ]] || { printf 'Gamification visual gate found inherited quest progress instead of a fresh 0:00 run.\n' >&2; exit 1; }
closed_capture="$ARTIFACT_DIR/termfleet-installed-window-gamification-closed.png"
[[ -s "$closed_capture" ]] || { printf 'Gamification visual gate has no close-interaction screenshot.\n' >&2; exit 1; }
reopened_capture="$ARTIFACT_DIR/termfleet-installed-window-gamification-reopened.png"
[[ -s "$reopened_capture" ]] || { printf 'Gamification visual gate has no close-and-reopen persistence screenshot.\n' >&2; exit 1; }
closed_ocr_capture="$ARTIFACT_DIR/gamification-closed-ocr.png"
magick "$closed_capture" -crop 1400x420+0+0 -resize 200% -colorspace Gray -contrast-stretch 0x15 "$closed_ocr_capture"
closed_ocr="$(tesseract "$closed_ocr_capture" stdout --psm 6 2>/dev/null | tr '[:upper:]' '[:lower:]' | tr '\n' ' ')"
[[ "$closed_ocr" != *"workstream quest"* ]] || { printf 'Gamification visual gate could not close the panel with Escape.\n' >&2; exit 1; }
beam_capture="$ARTIFACT_DIR/termfleet-installed-window-gamification-beam.png"
[[ -s "$beam_capture" ]] || { printf 'Gamification visual gate has no qualifying-terminal beam screenshot.\n' >&2; exit 1; }
printf 'TERMFLEET_GAMIFICATION_VISUAL_OK screenshot=%s beam=%s\n' "$capture" "$beam_capture"
