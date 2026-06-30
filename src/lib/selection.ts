// TC-017f — mouse selection model (pure). Selection lives on the frontend: we
// track drag endpoints in cell coordinates, highlight via an overlay canvas,
// and extract text from the visible grid for clipboard copy. The Rust grid owns
// scrollback; JS only ever holds the visible screen.

import type { GridCell } from "./gridSnapshot";

export interface CellPoint {
  col: number;
  row: number;
}

export interface SelectionRange {
  start: CellPoint;
  end: CellPoint;
}

export const SELECTION_AUTO_SCROLL_ZONE_PX = 32;
export const SELECTION_AUTO_SCROLL_MAX_LINES = 8;

/** Order two drag endpoints into a row-major [start, end] range (inclusive). */
export function normalizeRange(anchor: CellPoint, focus: CellPoint): SelectionRange {
  const before =
    anchor.row < focus.row || (anchor.row === focus.row && anchor.col <= focus.col);
  return before ? { start: anchor, end: focus } : { start: focus, end: anchor };
}

export function hasSelectionExtent(range: SelectionRange | null): boolean {
  if (!range) return false;
  return range.start.row !== range.end.row || range.start.col !== range.end.col;
}

/** Per-row inclusive column span of the selection on `row`, or null if none. */
export function rowSpan(range: SelectionRange, row: number, cols: number): [number, number] | null {
  if (row < range.start.row || row > range.end.row) return null;
  const from = row === range.start.row ? range.start.col : 0;
  const to = row === range.end.row ? range.end.col : cols - 1;
  return [Math.max(0, Math.min(from, to)), Math.min(cols - 1, Math.max(from, to))];
}

export function visibleRowSpan(
  range: SelectionRange,
  visibleRow: number,
  displayOffset: number,
  cols: number,
): [number, number] | null {
  return rowSpan(range, visibleRow - displayOffset, cols);
}

export function isCellSelected(
  range: SelectionRange | null,
  col: number,
  row: number,
  cols: number,
): boolean {
  if (!range) return false;
  const span = rowSpan(range, row, cols);
  return span !== null && col >= span[0] && col <= span[1];
}

/**
 * Extract the selected text from the visible grid. Each line's trailing
 * whitespace is trimmed; lines are joined with "\n".
 */
export function selectionToText(cells: GridCell[][], range: SelectionRange): string {
  const cols = cells[0]?.length ?? 0;
  const lines: string[] = [];
  for (let row = range.start.row; row <= range.end.row; row += 1) {
    const line = cells[row];
    if (!line) continue;
    const span = rowSpan(range, row, cols);
    if (!span) continue;
    let text = "";
    for (let col = span[0]; col <= span[1]; col += 1) {
      text += line[col]?.c ?? " ";
    }
    lines.push(text.replace(/\s+$/u, ""));
  }
  return lines.join("\n");
}

/** Convert a pointer offset (CSS px, relative to the canvas) to a cell point. */
export function pointToCell(
  offsetX: number,
  offsetY: number,
  cellWidth: number,
  cellHeight: number,
  cols: number,
  rows: number,
): CellPoint {
  const col = Math.max(0, Math.min(cols - 1, Math.floor(offsetX / cellWidth)));
  const row = Math.max(0, Math.min(rows - 1, Math.floor(offsetY / cellHeight)));
  return { col, row };
}

export function visiblePointToAbsolute(point: CellPoint, displayOffset: number): CellPoint {
  return { col: point.col, row: point.row - displayOffset };
}

export function computeSelectionAutoScrollDelta(
  pointerY: number,
  viewportTop: number,
  viewportBottom: number,
  zonePx = SELECTION_AUTO_SCROLL_ZONE_PX,
  maxLines = SELECTION_AUTO_SCROLL_MAX_LINES,
): number {
  if (viewportBottom <= viewportTop || zonePx <= 0 || maxLines <= 0) return 0;
  if (pointerY < viewportTop + zonePx) {
    const distance = viewportTop + zonePx - pointerY;
    return Math.max(1, Math.min(maxLines, Math.ceil(distance / 12)));
  }
  if (pointerY > viewportBottom - zonePx) {
    const distance = pointerY - (viewportBottom - zonePx);
    return -Math.max(1, Math.min(maxLines, Math.ceil(distance / 12)));
  }
  return 0;
}
