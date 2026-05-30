import { expect, test } from "@playwright/test";

// TC-017g — box-drawing / block elements draw geometrically via fillRect so
// borders tile with no sub-pixel gaps. Proven by rendering glyphs and sampling
// pixels at positions that distinguish each shape.

test.use({
  viewport: { width: 1440, height: 920 },
  launchOptions: {
    executablePath: "/usr/bin/chromium",
    args: ["--disable-crash-reporter", "--disable-crashpad", "--disable-gpu"],
  },
});

test("box-drawing and block glyphs render geometrically", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });

  const out = await page.evaluate(async () => {
    const { isBoxGlyph } = await import("/src/lib/boxGlyph.ts");
    const { GlyphAtlas, measureCell } = await import("/src/lib/fontAtlas.ts");
    const { renderSnapshot, sizeCanvasToGrid, DEFAULT_THEME } = await import(
      "/src/lib/gridRenderer.ts"
    );

    const dpr = 2;
    const metrics = measureCell('"Geist Mono", monospace', 14, dpr, 1.2);
    const cellW = metrics.cellWidth * dpr;
    const cellH = metrics.cellHeight * dpr;

    const cell = (c: string) => ({ c, fg: "#ffffff", bg: "#000000" });
    // 4 cells: ─ (horiz) │ (vert) █ (full block) ░ (light shade)
    const snapshot = {
      cols: 4,
      rows: 1,
      cursor: { col: 0, line: 0 },
      altScreen: false,
      cursorVisible: false,
      cells: [[cell("─"), cell("│"), cell("█"), cell("░")]],
    };

    const atlas = new GlyphAtlas(metrics);
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    const ctx = sizeCanvasToGrid(canvas, atlas, 4, 1, dpr);
    renderSnapshot(ctx, atlas, snapshot, dpr, DEFAULT_THEME);

    const lum = (x: number, y: number) => {
      const d = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
      return (d[0] + d[1] + d[2]) / 3;
    };

    // Horizontal line cell (0): bright at vertical center, dark near top edge.
    const hMid = lum(cellW * 0.5, cellH * 0.5);
    const hTop = lum(cellW * 0.5, cellH * 0.08);
    // Vertical line cell (1): bright at horizontal center, dark near left edge.
    const vMid = lum(cellW * 1.5, cellH * 0.5);
    const vLeft = lum(cellW * 1.05, cellH * 0.5);
    // Full block cell (2): bright everywhere, including a corner.
    const blockCorner = lum(cellW * 2.1, cellH * 0.15);
    // Light shade cell (3): dim (alpha ~0.25 white on black), not full bright.
    const shade = lum(cellW * 3.5, cellH * 0.5);

    return {
      atlasEmpty: atlas.size, // box glyphs must NOT populate the font atlas
      isBox2500: isBoxGlyph(0x2500),
      isBoxLetter: isBoxGlyph(0x41),
      hMid,
      hTop,
      vMid,
      vLeft,
      blockCorner,
      shade,
    };
  });

  expect(out.isBox2500).toBe(true);
  expect(out.isBoxLetter).toBe(false);
  // Geometric box glyphs bypass the atlas entirely.
  expect(out.atlasEmpty).toBe(0);

  // Horizontal line: center bright, top dark.
  expect(out.hMid).toBeGreaterThan(150);
  expect(out.hTop).toBeLessThan(60);
  // Vertical line: center bright, left edge dark.
  expect(out.vMid).toBeGreaterThan(150);
  expect(out.vLeft).toBeLessThan(60);
  // Full block: bright in the corner (fills the whole cell).
  expect(out.blockCorner).toBeGreaterThan(150);
  // Light shade: dim, clearly between black and white.
  expect(out.shade).toBeGreaterThan(20);
  expect(out.shade).toBeLessThan(130);
});
