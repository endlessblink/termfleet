// TC-017 — types for the headless-VT grid snapshot emitted by the Rust
// `grid_snapshot` command (see src-tauri/src/vt_grid.rs `GridSnapshot`).
// Serde serializes with camelCase; boolean style flags are omitted when false.

export interface GridCell {
  /** The cell's character (a single grapheme; " " when blank). */
  c: string;
  /** Resolved foreground as "#rrggbb". */
  fg: string;
  /** Resolved background as "#rrggbb". */
  bg: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  inverse?: boolean;
  /** Base cell of a double-width (CJK) glyph. */
  wide?: boolean;
}

export interface GridCursor {
  col: number;
  /** Visible-line index (0-based from the top of the viewport). */
  line: number;
}

export interface GridSnapshot {
  cols: number;
  rows: number;
  cursor: GridCursor;
  altScreen: boolean;
  cursorVisible: boolean;
  /** Row-major grid: `cells[row][col]`, length `rows` × `cols`. */
  cells: GridCell[][];
}

/** Parse and minimally validate a `grid_snapshot` JSON string. */
export function parseGridSnapshot(json: string): GridSnapshot {
  const value = JSON.parse(json) as GridSnapshot;
  if (
    typeof value.cols !== "number" ||
    typeof value.rows !== "number" ||
    !Array.isArray(value.cells)
  ) {
    throw new Error("invalid grid snapshot shape");
  }
  return value;
}
