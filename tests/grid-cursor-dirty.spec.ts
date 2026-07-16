import { expect, test } from "@playwright/test";
import { decodeFrame } from "../src/lib/gridDiff";
import { GridBuffer } from "../src/lib/gridBuffer";

// TC-033 E (regression guard): a cursor move with NO cell changes must re-dirty the
// cursor row so the renderer erases the old cursor bar. Tracking only the cursor LINE
// (not the column) left same-row horizontal moves with a trail of ghost bars. This
// locks the existing fix in gridBuffer.ts (prevCursorCol tracking).

const HEADER = 17;
const CELL = 34;
const cols = 4;
const rows = 2;
const blank = { ch: 0, fg: 0xd0d0d0ff, bg: 0x000000ff, style: 0 };

function encode(
  msgType: number,
  cursor: { col: number; line: number },
  mode: number,
  dirty: { index: number; cells: { ch: number; fg: number; bg: number; style: number }[] }[],
  displayOffset = 0,
): ArrayBuffer {
  let size = HEADER;
  for (const row of dirty) size += 4 + row.cells.length * CELL;
  const view = new DataView(new ArrayBuffer(size));
  view.setUint8(0, msgType);
  view.setUint16(1, cols, true);
  view.setUint16(3, rows, true);
  view.setUint16(5, displayOffset, true);
  view.setUint16(7, cursor.col, true);
  view.setUint16(9, cursor.line, true);
  view.setUint32(11, mode, true);
  view.setUint16(15, dirty.length, true);
  let off = HEADER;
  for (const row of dirty) {
    view.setUint16(off, row.index, true);
    view.setUint16(off + 2, row.cells.length, true);
    off += 4;
    for (const c of row.cells) {
      view.setUint32(off, c.ch, true);
      view.setUint32(off + 24, c.fg, true);
      view.setUint32(off + 28, c.bg, true);
      view.setUint16(off + 32, c.style, true);
      off += CELL;
    }
  }
  return view.buffer;
}

const CURSOR_VISIBLE = 0b10;

test("a same-row cursor move re-dirties the cursor row (no ghost-bar trail)", () => {
  const buffer = new GridBuffer();
  // Full sync: cursor at col 1, line 0, visible.
  buffer.apply(
    decodeFrame(
      encode(2, { col: 1, line: 0 }, CURSOR_VISIBLE, [
        { index: 0, cells: [blank, blank, blank, blank] },
        { index: 1, cells: [blank, blank, blank, blank] },
      ]),
    ),
  );

  // Diff with NO cell changes, cursor moves col 1 -> 3 on the SAME line.
  const dirty = buffer.apply(decodeFrame(encode(1, { col: 3, line: 0 }, CURSOR_VISIBLE, [])));

  expect(dirty.has(0)).toBe(true);
});

test("hiding the cursor re-dirties its row", () => {
  const buffer = new GridBuffer();
  buffer.apply(
    decodeFrame(
      encode(2, { col: 1, line: 0 }, CURSOR_VISIBLE, [
        { index: 0, cells: [blank, blank, blank, blank] },
        { index: 1, cells: [blank, blank, blank, blank] },
      ]),
    ),
  );
  // Cursor hidden (mode 0), same position, no cell changes.
  const dirty = buffer.apply(decodeFrame(encode(1, { col: 1, line: 0 }, 0, [])));
  expect(dirty.has(0)).toBe(true);
});

test("scrolling into history hides the cursor even if a frame reports it visible", () => {
  const buffer = new GridBuffer();
  buffer.apply(
    decodeFrame(
      encode(2, { col: 1, line: 0 }, CURSOR_VISIBLE, [
        { index: 0, cells: [blank, blank, blank, blank] },
        { index: 1, cells: [blank, blank, blank, blank] },
      ]),
    ),
  );

  const dirty = buffer.apply(decodeFrame(encode(1, { col: 1, line: 0 }, CURSOR_VISIBLE, [], 5)));

  expect(buffer.toSnapshot().cursorVisible).toBe(false);
  expect(dirty.has(0)).toBe(true);
});
