import { expect, test } from "@playwright/test";

// TC-017b — pixel-level proof for the Canvas2D grid renderer.
//
// The renderer (fontAtlas + gridRenderer) is pure frontend, so we exercise it
// directly in Chromium against the Vite dev server (which serves the TS modules
// as ESM) — no Tauri runtime needed. We render a hand-built snapshot and sample
// the backing-store pixels to assert correct colors, cell alignment, and HiDPI
// scaling.

test.use({
  viewport: { width: 1440, height: 920 },
  launchOptions: {
    executablePath: "/usr/bin/chromium",
    args: ["--disable-crash-reporter", "--disable-crashpad", "--disable-gpu"],
  },
});

test("canvas renderer paints colors, alignment, and HiDPI backing store", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });

  const result = await page.evaluate(async () => {
    const { GlyphAtlas, measureCell } = await import("/src/lib/fontAtlas.ts");
    const { renderSnapshot, sizeCanvasToGrid, DEFAULT_THEME } = await import(
      "/src/lib/gridRenderer.ts"
    );

    const dpr = 2; // force a HiDPI factor for a deterministic assertion
    const fontFamily = '"Geist Mono", monospace';
    const metrics = measureCell(fontFamily, 14, dpr, 1.2);
    const atlas = new GlyphAtlas(metrics);

    const cols = 4;
    const rows = 2;
    const blank = { c: " ", fg: "#d0d0d0", bg: "#000000" };
    // Row 0: a red "R" in cell 0, default cells after.
    // Row 1: a cell with a blue background in cell 2.
    const snapshot = {
      cols,
      rows,
      cursor: { col: 0, line: 0 },
      altScreen: false,
      cursorVisible: false,
      cells: [
        [
          { c: "R", fg: "#cd0000", bg: "#000000" },
          { ...blank },
          { ...blank },
          { ...blank },
        ],
        [
          { ...blank },
          { ...blank },
          { c: " ", fg: "#d0d0d0", bg: "#0000ee" },
          { ...blank },
        ],
      ],
    };

    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    const ctx = sizeCanvasToGrid(canvas, atlas, cols, rows, dpr);
    renderSnapshot(ctx, atlas, snapshot, dpr, DEFAULT_THEME);

    const cellW = metrics.cellWidth * dpr;
    const cellH = metrics.cellHeight * dpr;

    // Sample the center of the blue-background cell at (row 1, col 2).
    const bx = Math.round(2 * cellW + cellW / 2);
    const by = Math.round(1 * cellH + cellH / 2);
    const bluePixel = Array.from(ctx.getImageData(bx, by, 1, 1).data);

    // Count red-ish pixels inside cell (0,0) — the glyph "R" drawn in #cd0000.
    let redCount = 0;
    const r0 = ctx.getImageData(0, 0, Math.ceil(cellW), Math.ceil(cellH)).data;
    for (let i = 0; i < r0.length; i += 4) {
      if (r0[i] > 120 && r0[i + 1] < 80 && r0[i + 2] < 80 && r0[i + 3] > 100) {
        redCount += 1;
      }
    }

    // Ensure cell (1,1) — empty, default bg — has NO red glyph pixels (alignment:
    // the red "R" must stay inside cell (0,0)).
    let strayRed = 0;
    const ex = Math.round(1 * cellW);
    const ey = Math.round(1 * cellH);
    const r1 = ctx.getImageData(ex, ey, Math.ceil(cellW), Math.ceil(cellH)).data;
    for (let i = 0; i < r1.length; i += 4) {
      if (r1[i] > 120 && r1[i + 1] < 80 && r1[i + 2] < 80 && r1[i + 3] > 100) {
        strayRed += 1;
      }
    }

    return {
      backingWidth: canvas.width,
      backingHeight: canvas.height,
      cssWidth: canvas.style.width,
      cssHeight: canvas.style.height,
      expectedBackingWidth: Math.ceil(cols * metrics.cellWidth * dpr),
      expectedBackingHeight: Math.ceil(rows * metrics.cellHeight * dpr),
      expectedCssWidth: `${cols * metrics.cellWidth}px`,
      bluePixel,
      redCount,
      strayRed,
      atlasSize: atlas.size,
    };
  });

  // HiDPI: backing store is scaled by dpr, CSS box stays at logical size.
  expect(result.backingWidth).toBe(result.expectedBackingWidth);
  expect(result.backingHeight).toBe(result.expectedBackingHeight);
  expect(result.cssWidth).toBe(result.expectedCssWidth);

  // Background color correctness: blue cell reads ~#0000ee.
  expect(result.bluePixel[2]).toBeGreaterThan(180); // blue channel
  expect(result.bluePixel[0]).toBeLessThan(60); // red channel low
  expect(result.bluePixel[1]).toBeLessThan(60); // green channel low

  // Glyph correctness + alignment: the red "R" rasterized in cell (0,0) and did
  // NOT bleed into the adjacent empty cell.
  expect(result.redCount).toBeGreaterThan(10);
  expect(result.strayRed).toBe(0);

  // Atlas cached exactly one tile (the single non-blank glyph).
  expect(result.atlasSize).toBe(1);
});
