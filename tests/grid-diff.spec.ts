import { expect, test } from "@playwright/test";

// TC-017c — binary dirty-diff decode + apply + partial-render proof.
//
// Builds wire buffers in JS that exactly match the Rust encoder, then exercises
// the decoder (gridDiff), the persistent buffer (gridBuffer), and partial
// rendering (gridRenderer) in Chromium. No Tauri runtime needed.

test.use({
  viewport: { width: 1440, height: 920 },
  launchOptions: {
    executablePath: "/usr/bin/chromium",
    args: ["--disable-crash-reporter", "--disable-crashpad", "--disable-gpu"],
  },
});

test("decode + apply + partial render of a binary diff", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });

  const result = await page.evaluate(async () => {
    const { decodeFrame } = await import("/src/lib/gridDiff.ts");
    const { GridBuffer } = await import("/src/lib/gridBuffer.ts");
    const { GlyphAtlas, measureCell } = await import("/src/lib/fontAtlas.ts");
    const { renderSnapshot, renderPartial, sizeCanvasToGrid, DEFAULT_THEME } = await import(
      "/src/lib/gridRenderer.ts"
    );

    const HEADER = 15;
    const CELL = 14;
    const cols = 4;
    const rows = 2;

    // Encode a frame matching src-tauri/src/vt_grid.rs (little-endian).
    // `dirty` = [{ index, cells: [{ch, fg, bg, style}] }].
    function encode(
      msgType: number,
      cursor: { col: number; line: number },
      mode: number,
      dirty: { index: number; cells: { ch: number; fg: number; bg: number; style: number }[] }[],
    ): ArrayBuffer {
      let size = HEADER;
      for (const row of dirty) size += 4 + row.cells.length * CELL;
      const view = new DataView(new ArrayBuffer(size));
      view.setUint8(0, msgType);
      view.setUint16(1, cols, true);
      view.setUint16(3, rows, true);
      view.setUint16(5, cursor.col, true);
      view.setUint16(7, cursor.line, true);
      view.setUint32(9, mode, true);
      view.setUint16(13, dirty.length, true);
      let off = HEADER;
      for (const row of dirty) {
        view.setUint16(off, row.index, true);
        view.setUint16(off + 2, row.cells.length, true);
        off += 4;
        for (const c of row.cells) {
          view.setUint32(off, c.ch, true);
          view.setUint32(off + 4, c.fg, true);
          view.setUint32(off + 8, c.bg, true);
          view.setUint16(off + 12, c.style, true);
          off += CELL;
        }
      }
      return view.buffer;
    }

    const FG = 0xd0d0d0ff;
    const BLACK = 0x000000ff;
    const RED = 0xcd0000ff;
    const BLUE = 0x0000eeff;
    const blank = { ch: 0, fg: FG, bg: BLACK, style: 0 };
    const rowOf = (cells: { ch: number; fg: number; bg: number; style: number }[]) => cells;

    // Full sync: row 0 = "R" (red fg) then blanks; row 1 all blank.
    const full = encode(2, { col: 1, line: 0 }, 0b10 /* cursor visible */, [
      { index: 0, cells: rowOf([{ ch: 82, fg: RED, bg: BLACK, style: 0 }, blank, blank, blank]) },
      { index: 1, cells: rowOf([blank, blank, blank, blank]) },
    ]);

    // Diff: only row 1 changes — cell (1,2) gets a blue background.
    const diff = encode(1, { col: 1, line: 0 }, 0b10, [
      { index: 1, cells: rowOf([blank, blank, { ch: 0, fg: FG, bg: BLUE, style: 0 }, blank]) },
    ]);

    const dpr = 2;
    const metrics = measureCell('"Geist Mono", monospace', 14, dpr, 1.2);
    const atlas = new GlyphAtlas(metrics);
    const buffer = new GridBuffer();
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    let ctx = sizeCanvasToGrid(canvas, atlas, cols, rows, dpr);

    // Apply full sync.
    const fullFrame = decodeFrame(full);
    const changedFull = buffer.apply(fullFrame);
    ctx = sizeCanvasToGrid(canvas, atlas, buffer.cols, buffer.rows, dpr);
    renderSnapshot(ctx, atlas, buffer.toSnapshot(), dpr, DEFAULT_THEME);

    const cellW = metrics.cellWidth * dpr;
    const cellH = metrics.cellHeight * dpr;

    // Sample blue cell BEFORE the diff — should still be black background.
    const bx = Math.round(2 * cellW + cellW / 2);
    const by = Math.round(1 * cellH + cellH / 2);
    const beforeBlue = Array.from(ctx.getImageData(bx, by, 1, 1).data);

    // Count red glyph pixels in cell (0,0) after full sync.
    let redCount = 0;
    const r0 = ctx.getImageData(0, 0, Math.ceil(cellW), Math.ceil(cellH)).data;
    for (let i = 0; i < r0.length; i += 4) {
      if (r0[i] > 120 && r0[i + 1] < 80 && r0[i + 2] < 80 && r0[i + 3] > 100) redCount += 1;
    }

    // Apply diff and render ONLY the changed rows.
    const diffFrame = decodeFrame(diff);
    const changed = buffer.apply(diffFrame);
    renderPartial(ctx, atlas, buffer.toSnapshot(), changed, dpr, DEFAULT_THEME);

    const afterBlue = Array.from(ctx.getImageData(bx, by, 1, 1).data);

    // The red "R" in row 0 must survive the partial render (row 0 not redrawn).
    let redAfter = 0;
    const r0b = ctx.getImageData(0, 0, Math.ceil(cellW), Math.ceil(cellH)).data;
    for (let i = 0; i < r0b.length; i += 4) {
      if (r0b[i] > 120 && r0b[i + 1] < 80 && r0b[i + 2] < 80 && r0b[i + 3] > 100) redAfter += 1;
    }

    return {
      fullIsFull: fullFrame.full,
      diffIsFull: diffFrame.full,
      fullChangedCount: changedFull.size,
      diffChangedRows: Array.from(changed).sort(),
      decodedRedChar: fullFrame.dirtyRows[0].cells[0].c,
      decodedRedFg: fullFrame.dirtyRows[0].cells[0].fg,
      beforeBlue,
      afterBlue,
      redCount,
      redAfter,
    };
  });

  // Decode correctness.
  expect(result.fullIsFull).toBe(true);
  expect(result.diffIsFull).toBe(false);
  expect(result.decodedRedChar).toBe("R");
  expect(result.decodedRedFg).toBe("#cd0000");

  // Full sync marks all rows dirty; diff touches only row 1.
  expect(result.fullChangedCount).toBe(2);
  expect(result.diffChangedRows).toEqual([1]);

  // Blue background appears only after the diff is applied.
  expect(result.beforeBlue[2]).toBeLessThan(60); // black before
  expect(result.afterBlue[2]).toBeGreaterThan(180); // blue after
  expect(result.afterBlue[0]).toBeLessThan(60);

  // Red glyph in row 0 survived the partial (row-1-only) render.
  expect(result.redCount).toBeGreaterThan(10);
  expect(result.redAfter).toBe(result.redCount);
});

test("full sync is authoritative and clears stale same-size buffer state", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });

  const result = await page.evaluate(async () => {
    const { decodeFrame } = await import("/src/lib/gridDiff.ts");
    const { GridBuffer } = await import("/src/lib/gridBuffer.ts");

    const HEADER = 15;
    const CELL = 14;
    const cols = 5;
    const rows = 3;
    const FG = 0xd0d0d0ff;
    const BLACK = 0x000000ff;
    const blank = { ch: 0, fg: FG, bg: BLACK, style: 0 };
    const cell = (ch: string) => ({ ch: ch.codePointAt(0) ?? 0, fg: FG, bg: BLACK, style: 0 });
    const textRow = (text: string, width = cols) => {
      const cells = Array.from(text).map(cell);
      while (cells.length < width) cells.push(blank);
      return cells.slice(0, width);
    };

    function encode(
      msgType: number,
      dirty: { index: number; cells: { ch: number; fg: number; bg: number; style: number }[] }[],
    ): ArrayBuffer {
      let size = HEADER;
      for (const row of dirty) size += 4 + row.cells.length * CELL;
      const view = new DataView(new ArrayBuffer(size));
      view.setUint8(0, msgType);
      view.setUint16(1, cols, true);
      view.setUint16(3, rows, true);
      view.setUint16(5, 0, true);
      view.setUint16(7, 0, true);
      view.setUint32(9, 0b10, true);
      view.setUint16(13, dirty.length, true);
      let off = HEADER;
      for (const row of dirty) {
        view.setUint16(off, row.index, true);
        view.setUint16(off + 2, row.cells.length, true);
        off += 4;
        for (const c of row.cells) {
          view.setUint32(off, c.ch, true);
          view.setUint32(off + 4, c.fg, true);
          view.setUint32(off + 8, c.bg, true);
          view.setUint16(off + 12, c.style, true);
          off += CELL;
        }
      }
      return view.buffer;
    }

    const buffer = new GridBuffer();
    buffer.apply(
      decodeFrame(
        encode(2, [
          { index: 0, cells: textRow("old-0") },
          { index: 1, cells: textRow("old-1") },
          { index: 2, cells: textRow("old-2") },
        ]),
      ),
    );

    // A same-size authoritative full sync must clear stale rows before applying
    // its payload. This protects reconnect/full-sync recovery from preserving
    // old terminal lines if the new frame is sparse or defensive-decoded.
    const changed = buffer.apply(
      decodeFrame(
        encode(2, [
          { index: 0, cells: textRow("new") },
          { index: 2, cells: [cell("x"), cell("y")] },
        ]),
      ),
    );
    const snapshot = buffer.toSnapshot();
    const rowText = snapshot.cells.map((row) => row.map((c) => c.c).join(""));

    return {
      changedRows: [...changed].sort(),
      rowText,
      rowLengths: snapshot.cells.map((row) => row.length),
    };
  });

  expect(result.changedRows).toEqual([0, 1, 2]);
  expect(result.rowText[0]).toBe("new  ");
  expect(result.rowText[1]).toBe("     ");
  expect(result.rowText[2]).toBe("xy   ");
  expect(result.rowLengths).toEqual([5, 5, 5]);
});

test("malformed binary frames fail explicitly before mutating the grid buffer", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });

  const result = await page.evaluate(async () => {
    const { decodeFrame } = await import("/src/lib/gridDiff.ts");
    const { GridBuffer } = await import("/src/lib/gridBuffer.ts");

    const HEADER = 15;
    const CELL = 14;
    const FG = 0xd0d0d0ff;
    const BLACK = 0x000000ff;
    const blank = { ch: 0, fg: FG, bg: BLACK, style: 0 };
    const cell = (ch: string) => ({ ch: ch.codePointAt(0) ?? 0, fg: FG, bg: BLACK, style: 0 });

    function encode(
      options: {
        msgType?: number;
        cols?: number;
        rows?: number;
        cursor?: { col: number; line: number };
        dirty?: { index: number; cells: { ch: number; fg: number; bg: number; style: number }[] }[];
      } = {},
    ): ArrayBuffer {
      const cols = options.cols ?? 4;
      const rows = options.rows ?? 2;
      const dirty = options.dirty ?? [];
      let size = HEADER;
      for (const row of dirty) size += 4 + row.cells.length * CELL;
      const view = new DataView(new ArrayBuffer(size));
      view.setUint8(0, options.msgType ?? 2);
      view.setUint16(1, cols, true);
      view.setUint16(3, rows, true);
      view.setUint16(5, options.cursor?.col ?? 0, true);
      view.setUint16(7, options.cursor?.line ?? 0, true);
      view.setUint32(9, 0b10, true);
      view.setUint16(13, dirty.length, true);
      let off = HEADER;
      for (const row of dirty) {
        view.setUint16(off, row.index, true);
        view.setUint16(off + 2, row.cells.length, true);
        off += 4;
        for (const c of row.cells) {
          view.setUint32(off, c.ch, true);
          view.setUint32(off + 4, c.fg, true);
          view.setUint32(off + 8, c.bg, true);
          view.setUint16(off + 12, c.style, true);
          off += CELL;
        }
      }
      return view.buffer;
    }

    const buffer = new GridBuffer();
    buffer.apply(
      decodeFrame(
        encode({
          dirty: [
            { index: 0, cells: [cell("s"), cell("a"), cell("f"), cell("e")] },
            { index: 1, cells: [blank, blank, blank, blank] },
          ],
        }),
      ),
    );

    const malformed = [
      new Uint8Array(HEADER - 1).buffer,
      encode({ msgType: 9 }),
      encode({ cols: 0 }),
      encode({ cursor: { col: 0, line: 2 } }),
      encode({ dirty: [{ index: 4, cells: [blank] }] }),
      encode({ dirty: [{ index: 0, cells: [blank, blank, blank, blank, blank] }] }),
      encode({ dirty: [{ index: 0, cells: [{ ch: 0x110000, fg: FG, bg: BLACK, style: 0 }] }] }),
      encode({ dirty: [{ index: 0, cells: [blank, blank] }] }).slice(0, HEADER + 4 + CELL),
      (() => {
        const clean = new Uint8Array(encode({ dirty: [] }));
        const extra = new Uint8Array(clean.length + 1);
        extra.set(clean);
        extra[clean.length] = 0xff;
        return extra.buffer;
      })(),
    ];

    const errors: string[] = [];
    for (const frame of malformed) {
      try {
        const decoded = decodeFrame(frame);
        buffer.apply(decoded);
        errors.push("accepted malformed frame");
      } catch (error) {
        errors.push(String(error));
      }
    }

    const snapshot = buffer.toSnapshot();
    return {
      errors,
      text: snapshot.cells.map((row) => row.map((c) => c.c).join("")),
      size: { cols: snapshot.cols, rows: snapshot.rows },
    };
  });

  expect(result.errors).toHaveLength(9);
  for (const error of result.errors) {
    expect(error).toContain("Malformed terminal grid diff");
  }
  expect(result.text).toEqual(["safe", "    "]);
  expect(result.size).toEqual({ cols: 4, rows: 2 });
});
