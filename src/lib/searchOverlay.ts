// Find-in-buffer overlay logic (pure). Match navigation and scroll-to-reveal
// math live here so they can be proven deterministically; the React wiring in
// TerminalCanvas drives the grid_search command and draws highlights.

export interface SearchMatch {
  /** grid line index: negative = scrollback history, 0..rows-1 = visible. */
  line: number;
  col: number;
  len: number;
}

/**
 * Index of the next match with wrap-around. `dir` is +1 (next) or -1 (previous).
 * Returns -1 when there are no matches.
 */
export function cycleMatchIndex(current: number, total: number, dir: 1 | -1): number {
  if (total <= 0) return -1;
  return (current + dir + total) % total;
}

/**
 * The display offset (lines scrolled into history) that brings buffer line
 * `matchLine` into the viewport, choosing the smallest offset that reveals it.
 * Clamped to >= 0 (cannot scroll past the live bottom).
 */
export function targetScrollOffset(matchLine: number, screenRows: number): number {
  // Visible buffer lines at offset `d` are [-d, screenRows-1-d]. The smallest
  // offset that reveals `matchLine` puts it at the top row: d = -matchLine.
  // Clamp to >= 0 (cannot scroll below the live bottom).
  void screenRows;
  return Math.max(0, -matchLine);
}

/**
 * grid_scroll delta (positive = into history) needed to reveal `matchLine`,
 * given the current display offset. Returns 0 when the match is already visible.
 */
export function scrollDeltaToReveal(
  matchLine: number,
  currentOffset: number,
  screenRows: number,
): number {
  const top = -currentOffset;
  const bottom = screenRows - 1 - currentOffset;
  if (matchLine >= top && matchLine <= bottom) return 0; // already visible
  return targetScrollOffset(matchLine, screenRows) - currentOffset;
}
