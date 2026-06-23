import { expect, test } from "@playwright/test";

// TC-017e — reflow sizing + map-mode CSS transform safety.
//
// (1) computeGridSize derives cols/rows from a pixel box and clamps to >=1.
// (2) Because the renderer targets a plain DOM canvas backing store, applying a
//     CSS transform (as the zoom/pan map does) does NOT alter the rendered
//     pixels and never touches GTK — the property native VTE could not provide.

test.use({
  viewport: { width: 1440, height: 920 },
  launchOptions: {
    executablePath: "/usr/bin/chromium",
    args: ["--disable-crash-reporter", "--disable-crashpad", "--disable-gpu"],
  },
});

test("reflow sizing and CSS-transform-independent rendering", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });

  const result = await page.evaluate(async () => {
    const { GlyphAtlas, measureCell } = await import("/src/lib/fontAtlas.ts");
    const { computeGridSize, renderSnapshot, sizeCanvasToGrid, DEFAULT_THEME } = await import(
      "/src/lib/gridRenderer.ts"
    );

    const dpr = 2;
    const metrics = measureCell('"Geist Mono", monospace', 14, dpr, 1.2);

    // (1) sizing math
    const fit = computeGridSize(
      80 * metrics.cellWidth + 5,
      24 * metrics.cellHeight + 3,
      metrics.cellWidth,
      metrics.cellHeight,
    );
    const collapsed = computeGridSize(0, 0, metrics.cellWidth, metrics.cellHeight);

    // (2) transform independence: render a red cell, snapshot pixels, apply a
    // CSS transform, and re-read the backing store — must be byte-identical.
    const atlas = new GlyphAtlas(metrics);
    const cols = 3;
    const rows = 1;
    const snapshot = {
      cols,
      rows,
      cursor: { col: 0, line: 0 },
      altScreen: false,
      cursorVisible: false,
      cells: [
        [
          { c: "X", fg: "#cd0000", bg: "#000000" },
          { c: " ", fg: "#d0d0d0", bg: "#000000" },
          { c: " ", fg: "#d0d0d0", bg: "#000000" },
        ],
      ],
    };
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    const ctx = sizeCanvasToGrid(canvas, atlas, cols, rows, dpr);
    renderSnapshot(ctx, atlas, snapshot, dpr, DEFAULT_THEME);

    const before = Array.from(
      ctx.getImageData(0, 0, canvas.width, canvas.height).data.slice(0, 4096),
    );
    const beforeBacking = { w: canvas.width, h: canvas.height };

    // Simulate map-mode placement.
    canvas.style.transform = "scale(2.4) translate(40px, 18px)";
    canvas.style.transformOrigin = "top left";

    const after = Array.from(
      ctx.getImageData(0, 0, canvas.width, canvas.height).data.slice(0, 4096),
    );
    const afterBacking = { w: canvas.width, h: canvas.height };

    let identical = before.length === after.length;
    for (let i = 0; identical && i < before.length; i += 1) {
      if (before[i] !== after[i]) identical = false;
    }

    return { fit, collapsed, identical, beforeBacking, afterBacking };
  });

  // Sizing: floor-fit and minimum clamp.
  expect(result.fit).toEqual({ cols: 80, rows: 24 });
  expect(result.collapsed).toEqual({ cols: 1, rows: 1 });

  // Transform did not change the backing store size or pixels.
  expect(result.afterBacking).toEqual(result.beforeBacking);
  expect(result.identical).toBe(true);
});

// TC-047 — an interactive TUI on the map (alt-screen / mouse-report) must ALWAYS
// freeze + clip, never reflow. Reflowing a full-screen TUI (even on grow) re-runs
// its wrap/redraw at a different width and fragments it into visual wreckage. A
// reflow-on-grow attempt regressed exactly this, so the rule is unconditional:
// interactive → freeze, plain/non-interactive → reflow.
test("interactive map nodes always freeze; plain terminals reflow", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });

  const r = await page.evaluate(async () => {
    const { mapNodeLayoutMode } = await import("/src/lib/gridRenderer.ts");
    return {
      plainReflows: mapNodeLayoutMode({ preservesProjectionSize: false }),
      interactiveFreezes: mapNodeLayoutMode({ preservesProjectionSize: true }),
    };
  });

  expect(r.plainReflows).toBe("reflow");
  expect(r.interactiveFreezes).toBe("freeze");
});
