#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASELINES="$ROOT/docs/visual-baselines"

required=(
  tc-008-terminal-typed-command.png
  tc-009-terminal-split-right.png
  tc-010-map-linked-terminal.png
  tc-011-new-terminal-session.png
  tc-012-map-close-session.png
  tc-013-terminal-section-close-session.png
  tc-014-standalone-daemon-terminal-section.png
  tc-015-standalone-map-terminal.png
  tc-016-design-refinement.png
  tc-017-warp-inspired-command-surface.png
  tc-018-warp-command-palette-scopes.png
  tc-019-command-empty-and-status-chips.png
  tc-020-terminal-surface-fallback-frame.png
  tc-021-explorer-token-alignment.png
  tc-022-map-token-alignment.png
  tc-023-map-index-polish.png
  tc-024-motion-polish-command.png
  tc-025-terminal-theme-refinement.png
  tc-026-pane-chrome-refinement.png
  tc-027-command-palette-footer.png
  tc-028-status-telemetry-refinement.png
  tc-029-session-create-control.png
  tc-030-sidebar-action-reveal.png
  tc-031-rail-control-polish.png
  tc-032-launch-config-polish.png
  tc-033-explorer-footer-telemetry.png
  tc-034-pane-context-menu-polish.png
  tc-035-explorer-context-menu-polish.png
  tc-036-terminal-settings-menu-polish.png
  tc-037-sidebar-row-hover-tokenization.png
  tc-038-map-index-row-tokenization.png
  tc-039-map-control-tokenization.png
  tc-040-explorer-row-interaction-tokenization.png
  tc-041-command-chrome-tokenization.png
  tc-042-tokenized-terminal-theme.png
  tc-043-terminal-block-rail.png
  tc-044-universal-input-context.png
  tc-045-launch-config-palette.png
  tc-046-live-state-motion-polish.png
  tc-047-responsive-commandbar.png
  tc-048-new-terminal-launch-menu.png
  tc-049-new-terminal-keyboard-menu.png
  tc-050-warp-cohesive-redesign.png
  tc-051-canvas-classic-grid.png
)

for file in "${required[@]}"; do
  path="$BASELINES/$file"
  if [[ ! -s "$path" ]]; then
    echo "Missing or empty visual evidence: $path" >&2
    exit 1
  fi

  read -r width height mean < <(identify -format '%w %h %[mean]\n' "$path")
  min_width=1000
  if [[ "$file" == "tc-047-responsive-commandbar.png" ]]; then
    min_width=900
  fi

  if (( width < min_width || height < 700 )); then
    echo "Visual evidence is too small: $file ${width}x${height}" >&2
    exit 1
  fi

  if awk "BEGIN { exit !($mean > 1000) }"; then
    :
  else
    echo "Visual evidence appears blank or near-blank: $file mean=$mean" >&2
    exit 1
  fi
done

echo "Visual evidence checks passed."
