// TC-017c — decoder for the binary dirty-diff wire format emitted by the Rust
// `grid_subscribe_diffs` channel. Mirrors src-tauri/src/vt_grid.rs exactly.
//
// Layout (little-endian), header 15 bytes:
//   [0] u8 msg type (1=diff, 2=full), [1..3] cols, [3..5] rows,
//   [5..7] cursor col, [7..9] cursor line, [9..13] mode flags, [13..15] dirty rows
// Per dirty row: u16 index, u16 cell count, then 14-byte cells:
//   [0..4] u32 char, [4..8] u32 fg RGBA, [8..12] u32 bg RGBA, [12..14] u16 style.

import type { GridCell } from "./gridSnapshot";

export const MSG_DIFF = 0x01;
export const MSG_FULL = 0x02;
export const HEADER_BYTES = 15;
export const CELL_BYTES = 14;

const MODE_ALT_SCREEN = 1 << 0;
const MODE_CURSOR_VISIBLE = 1 << 1;
const MODE_APP_CURSOR = 1 << 2;
const MODE_APP_KEYPAD = 1 << 3;
const MODE_BRACKETED_PASTE = 1 << 4;
const MODE_MOUSE_REPORT = 1 << 5;
const MODE_ALTERNATE_SCROLL = 1 << 6;
const MODE_SGR_MOUSE = 1 << 7;

const STYLE_BOLD = 1 << 0;
const STYLE_ITALIC = 1 << 1;
const STYLE_UNDERLINE = 1 << 2;
const STYLE_INVERSE = 1 << 3;
const STYLE_WIDE = 1 << 4;

export interface DecodedRow {
  index: number;
  cells: GridCell[];
}

export interface DecodedFrame {
  full: boolean;
  cols: number;
  rows: number;
  cursor: { col: number; line: number };
  altScreen: boolean;
  cursorVisible: boolean;
  appCursor: boolean;
  appKeypad: boolean;
  bracketedPaste: boolean;
  mouseReport: boolean;
  alternateScroll: boolean;
  sgrMouse: boolean;
  dirtyRows: DecodedRow[];
}

function rgbHex(rgba: number): string {
  const r = (rgba >>> 24) & 0xff;
  const g = (rgba >>> 16) & 0xff;
  const b = (rgba >>> 8) & 0xff;
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

export function decodeFrame(buffer: ArrayBuffer): DecodedFrame {
  const view = new DataView(buffer);
  const msgType = view.getUint8(0);
  const cols = view.getUint16(1, true);
  const rows = view.getUint16(3, true);
  const cursorCol = view.getUint16(5, true);
  const cursorLine = view.getUint16(7, true);
  const mode = view.getUint32(9, true);
  const dirtyCount = view.getUint16(13, true);

  let offset = HEADER_BYTES;
  const dirtyRows: DecodedRow[] = [];
  for (let r = 0; r < dirtyCount; r += 1) {
    const index = view.getUint16(offset, true);
    const cellCount = view.getUint16(offset + 2, true);
    offset += 4;
    const cells: GridCell[] = new Array(cellCount);
    for (let c = 0; c < cellCount; c += 1) {
      const ch = view.getUint32(offset, true);
      const fg = view.getUint32(offset + 4, true);
      const bg = view.getUint32(offset + 8, true);
      const style = view.getUint16(offset + 12, true);
      offset += CELL_BYTES;
      const cell: GridCell = {
        c: ch === 0 ? " " : String.fromCodePoint(ch),
        fg: rgbHex(fg),
        bg: rgbHex(bg),
      };
      if (style & STYLE_BOLD) cell.bold = true;
      if (style & STYLE_ITALIC) cell.italic = true;
      if (style & STYLE_UNDERLINE) cell.underline = true;
      if (style & STYLE_INVERSE) cell.inverse = true;
      if (style & STYLE_WIDE) cell.wide = true;
      cells[c] = cell;
    }
    dirtyRows.push({ index, cells });
  }

  return {
    full: msgType === MSG_FULL,
    cols,
    rows,
    cursor: { col: cursorCol, line: cursorLine },
    altScreen: Boolean(mode & MODE_ALT_SCREEN),
    cursorVisible: Boolean(mode & MODE_CURSOR_VISIBLE),
    appCursor: Boolean(mode & MODE_APP_CURSOR),
    appKeypad: Boolean(mode & MODE_APP_KEYPAD),
    bracketedPaste: Boolean(mode & MODE_BRACKETED_PASTE),
    mouseReport: Boolean(mode & MODE_MOUSE_REPORT),
    alternateScroll: Boolean(mode & MODE_ALTERNATE_SCROLL),
    sgrMouse: Boolean(mode & MODE_SGR_MOUSE),
    dirtyRows,
  };
}
