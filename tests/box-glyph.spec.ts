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
    const { isPowerlineGlyph } = await import("/src/lib/powerlineGlyph.ts");
    const { GlyphAtlas, measureCell } = await import("/src/lib/fontAtlas.ts");
    const { renderSnapshot, sizeCanvasToGrid, DEFAULT_THEME } = await import(
      "/src/lib/gridRenderer.ts"
    );

    const dpr = 2;
    const metrics = measureCell('"Geist Mono", monospace', 14, dpr, 1.2);
    const cellW = metrics.cellWidth * dpr;
    const cellH = metrics.cellHeight * dpr;

    const cell = (c: string) => ({ c, fg: "#ffffff", bg: "#000000" });
    // 6 cells: ─ (horiz) │ (vert) █ (full block) ░ (light shade), / (Powerline)
    const snapshot = {
      cols: 6,
      rows: 1,
      cursor: { col: 0, line: 0 },
      altScreen: false,
      cursorVisible: false,
      cells: [[cell("─"), cell("│"), cell("█"), cell("░"), cell("\ue0b0"), cell("\ue0b2")]],
    };

    const atlas = new GlyphAtlas(metrics);
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    const ctx = sizeCanvasToGrid(canvas, atlas, 6, 1, dpr);
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
    // Powerline filled separators draw geometrically, not as font fallback tofu.
    const powerRight = lum(cellW * 4.25, cellH * 0.5);
    const powerLeft = lum(cellW * 5.75, cellH * 0.5);

    return {
      atlasEmpty: atlas.size, // box glyphs must NOT populate the font atlas
      isBox2500: isBoxGlyph(0x2500),
      isBoxLetter: isBoxGlyph(0x41),
      isPowerlineE0B0: isPowerlineGlyph(0xe0b0),
      isPowerlineLetter: isPowerlineGlyph(0x41),
      hMid,
      hTop,
      vMid,
      vLeft,
      blockCorner,
      shade,
      powerRight,
      powerLeft,
    };
  });

  expect(out.isBox2500).toBe(true);
  expect(out.isBoxLetter).toBe(false);
  expect(out.isPowerlineE0B0).toBe(true);
  expect(out.isPowerlineLetter).toBe(false);
  // Geometric box/Powerline glyphs bypass the atlas entirely.
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
  // Powerline filled triangles are bright at their center-facing side.
  expect(out.powerRight).toBeGreaterThan(150);
  expect(out.powerLeft).toBeGreaterThan(150);
});

test("quadrant and partial-eighth blocks render geometrically (htop/btop meters)", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });

  const out = await page.evaluate(async () => {
    const { GlyphAtlas, measureCell } = await import("/src/lib/fontAtlas.ts");
    const { renderSnapshot, sizeCanvasToGrid, DEFAULT_THEME } = await import(
      "/src/lib/gridRenderer.ts"
    );

    const dpr = 2;
    const metrics = measureCell('"Geist Mono", monospace', 14, dpr, 1.2);
    const cellW = metrics.cellWidth * dpr;
    const cellH = metrics.cellHeight * dpr;
    const cell = (c: string) => ({ c, fg: "#ffffff", bg: "#000000" });
    // ▟ (U+259F all but upper-left), ▂ (U+2582 lower 2/8), ▏ (U+258F left 1/8)
    const snapshot = {
      cols: 3,
      rows: 1,
      cursor: { col: 0, line: 0 },
      altScreen: false,
      cursorVisible: false,
      cells: [[cell("▟"), cell("▂"), cell("▏")]],
    };
    const atlas = new GlyphAtlas(metrics);
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    const ctx = sizeCanvasToGrid(canvas, atlas, 3, 1, dpr);
    renderSnapshot(ctx, atlas, snapshot, dpr, DEFAULT_THEME);
    const lum = (x: number, y: number) => {
      const d = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
      return (d[0] + d[1] + d[2]) / 3;
    };
    return {
      atlasEmpty: atlas.size,
      // ▟: upper-left quarter dark, lower-right quarter bright.
      quadUpperLeft: lum(cellW * 0.25, cellH * 0.25),
      quadLowerRight: lum(cellW * 0.75, cellH * 0.75),
      // ▂ (cell 1): bottom bright, top dark.
      eighthBottom: lum(cellW * 1.5, cellH * 0.95),
      eighthTop: lum(cellW * 1.5, cellH * 0.2),
      // ▏ (cell 2): left edge bright, right side dark.
      leftEdge: lum(cellW * 2.02, cellH * 0.5),
      rightSide: lum(cellW * 2.7, cellH * 0.5),
    };
  });

  // All drawn geometrically — atlas must stay empty.
  expect(out.atlasEmpty).toBe(0);
  expect(out.quadUpperLeft).toBeLessThan(60);
  expect(out.quadLowerRight).toBeGreaterThan(150);
  expect(out.eighthBottom).toBeGreaterThan(150);
  expect(out.eighthTop).toBeLessThan(60);
  expect(out.leftEdge).toBeGreaterThan(150);
  expect(out.rightSide).toBeLessThan(60);
});
