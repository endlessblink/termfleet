// TC-017c — persistent client-side grid. Holds the full visible screen and
// applies decoded binary diffs in place, so only changed rows touch the canvas
// (only the visible screen is held in JS — no scrollback growth).

import type { DecodedFrame } from "./gridDiff";
import type { GridCell, GridSnapshot } from "./gridSnapshot";

function blankCell(): GridCell {
  return { c: " ", fg: "#d0d0d0", bg: "#000000" };
}

function blankRow(cols: number): GridCell[] {
  return Array.from({ length: cols }, blankCell);
}

function normalizeRow(cells: GridCell[], cols: number): GridCell[] {
  if (cells.length === cols) return cells;
  if (cells.length > cols) return cells.slice(0, cols);
  return [...cells, ...blankRow(cols - cells.length)];
}

export class GridBuffer {
  cols = 0;
  rows = 0;
  displayOffset = 0;
  cursor = { col: 0, line: 0 };
  altScreen = false;
  cursorVisible = true;
  appCursor = false;
  appKeypad = false;
  bracketedPaste = false;
  mouseReport = false;
  alternateScroll = false;
  alternateScrollSet = false;
  sgrMouse = false;
  cells: GridCell[][] = [];

  private reset(cols: number, rows: number): void {
    this.cols = cols;
    this.rows = rows;
    this.cells = Array.from({ length: rows }, () => blankRow(cols));
  }

  /**
   * Apply a decoded frame. Returns the set of row indices that must be
   * re-rendered (changed rows plus the previous and current cursor rows, since
   * the cursor bar moves).
   */
  apply(frame: DecodedFrame): Set<number> {
    const dirty = new Set<number>();
    const prevCursorLine = this.cursor.line;
    const prevCursorCol = this.cursor.col;
    const prevCursorVisible = this.cursorVisible;

    if (frame.full || frame.cols !== this.cols || frame.rows !== this.rows) {
      this.reset(frame.cols, frame.rows);
      // A full sync carries every row; mark all dirty.
      for (let r = 0; r < this.rows; r += 1) dirty.add(r);
    }

    for (const row of frame.dirtyRows) {
      if (row.index < this.rows) {
        this.cells[row.index] = normalizeRow(row.cells, this.cols);
        dirty.add(row.index);
      }
    }

    this.cursor = frame.cursor;
    this.displayOffset = frame.displayOffset;
    this.altScreen = frame.altScreen;
    this.cursorVisible = frame.displayOffset === 0 && frame.cursorVisible;
    this.appCursor = frame.appCursor;
    this.appKeypad = frame.appKeypad;
    this.bracketedPaste = frame.bracketedPaste;
    this.mouseReport = frame.mouseReport;
    this.alternateScroll = frame.alternateScroll;
    this.alternateScrollSet = frame.alternateScrollSet;
    this.sgrMouse = frame.sgrMouse;

    // The cursor bar is painted by the renderer on top of its row, so any change
    // to the cursor — vertical move, horizontal move, or show/hide — must repaint
    // the previous and current cursor rows to erase the old bar. Tracking only the
    // line missed same-row horizontal moves (e.g. a prompt redraw advancing the
    // cursor without changing cell content), which left a trail of ghost bars.
    const cursorMoved =
      prevCursorLine !== this.cursor.line ||
      prevCursorCol !== this.cursor.col ||
      prevCursorVisible !== this.cursorVisible;
    if (cursorMoved) {
      if (prevCursorLine < this.rows) dirty.add(prevCursorLine);
      if (this.cursor.line < this.rows) dirty.add(this.cursor.line);
    }

    return dirty;
  }

  /** View the buffer as a `GridSnapshot` for the renderer. */
  toSnapshot(): GridSnapshot {
    return {
      cols: this.cols,
      rows: this.rows,
      displayOffset: this.displayOffset,
      cursor: this.cursor,
      altScreen: this.altScreen,
      cursorVisible: this.cursorVisible,
      cells: this.cells,
    };
  }
}
