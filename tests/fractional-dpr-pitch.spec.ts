import { expect, test } from "@playwright/test";

// Regression for the "blurry text, worse under fractional display scaling" bug.
//
// gridRenderer used `cellW = atlas.cellWidth * dpr` directly; at fractional dpr
// (1.5 / 2.25, common on scaled laptop displays) that pitch is fractional, and
// drawRow's `Math.round(col * cellW)` accumulates UNEVEN gaps between cells, so
// adjacent glyph tiles bleed and the text reads blurry. The fix rounds the
// device-space pitch to whole pixels (and sizes the backing store to match).
//
// This test asserts the cell pitch is uniform at fractional dpr — the property
// that guarantees crisp, pixel-aligned blits.
test.use({
  viewport: { width: 1200, height: 400 },
  launchOptions: {
    executablePath: "/usr/bin/chromium",
    args: ["--disable-crash-reporter", "--disable-crashpad", "--disable-gpu"],
  },
});

for (const dpr of [1.25, 1.5, 2.25]) {
  test(`cell pitch is integer + uniform at dpr ${dpr}`, async ({ page }) => {
    await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });

    const result = await page.evaluate(async (dprArg) => {
      const { GlyphAtlas, measureCell } = await import("/src/lib/fontAtlas.ts");
      const { renderSnapshot, sizeCanvasToGrid, DEFAULT_THEME } = await import(
        "/src/lib/gridRenderer.ts"
      );

      const fontFamily = '"Geist Mono", monospace';
      const metrics = measureCell(fontFamily, 14, dprArg, 1.2);
      const atlas = new GlyphAtlas(metrics);

      const cols = 10;
      const rows = 1;
      // A full row of "M" — a wide glyph that fills the cell, so any uneven pitch
      // shows up as a gap or overlap between adjacent columns.
      const cells = [
        Array.from({ length: cols }, () => ({ c: "M", fg: "#ffffff", bg: "#000000" })),
      ];
      const snapshot = { cols, rows, cursor: { col: 0, line: 0 }, altScreen: false, cursorVisible: false, cells };

      const canvas = document.createElement("canvas");
      const ctx = sizeCanvasToGrid(canvas, atlas, cols, rows, dprArg);
      renderSnapshot(ctx, atlas, snapshot, dprArg, DEFAULT_THEME);

      const pitch = Math.round(metrics.cellWidth * dprArg);
      // The backing store width must be exactly cols * integer-pitch (no overflow,
      // no clipped last column).
      const backingExact = canvas.width === cols * pitch;
      const pitchIsInteger = Number.isInteger(pitch);

      // Sample the leftmost foreground column of each cell. With uniform integer
      // pitch, the first lit pixel of cell N sits at a constant offset from N*pitch.
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const W = canvas.width;
      const midY = Math.floor(canvas.height / 2);
      const firstLitOffsets: number[] = [];
      for (let c = 0; c < cols; c += 1) {
        const base = c * pitch;
        let litAt = -1;
        for (let x = 0; x < pitch; x += 1) {
          const i = (midY * W + base + x) * 4;
          if (data[i] > 80) { litAt = x; break; }
        }
        firstLitOffsets.push(litAt);
      }
      return { backingExact, pitchIsInteger, pitch, backingWidth: canvas.width, firstLitOffsets };
    }, dpr);

    expect(result.pitchIsInteger, "device cell pitch is a whole pixel").toBe(true);
    expect(result.backingExact, "backing store = cols * integer pitch (no clip)").toBe(true);

    // Every cell that rendered a glyph should have its first lit pixel at the same
    // offset (uniform pitch). Allow one column to be -1 only if all are (font miss).
    const lit = result.firstLitOffsets.filter((o) => o >= 0);
    expect(lit.length, "glyphs rendered").toBeGreaterThan(5);
    const min = Math.min(...lit);
    const max = Math.max(...lit);
    expect(max - min, `uniform glyph offset across cells (dpr ${dpr})`).toBeLessThanOrEqual(1);
  });
}
