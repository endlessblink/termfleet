import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const SOURCE = readFileSync(
  new URL("../src/components/TerminalCanvas.tsx", import.meta.url),
  "utf8",
);

test("terminal canvas uses the shared frame scheduler for primary paints", () => {
  expect(SOURCE).toContain('scheduleCanvasRender(sessionId, () => {');
  expect(SOURCE).not.toContain('requestAnimationFrame(() => {\n        if (disposed) return;');
});

test("terminal canvas replaces queued paints for the same pane", () => {
  expect(SOURCE).toContain("scheduleCanvasRender(sessionId, () => {");
  expect(SOURCE).not.toContain("scheduleCanvasRender(() => {");
});

test("active map full-screen updates keep the bounded render cadence", () => {
  const scheduleBlock = SOURCE.match(
    /const scheduleRender = \(\) => \{[\s\S]*?if \(renderScheduled\) return;/,
  )?.[0] ?? "";

  expect(scheduleBlock).toContain("if (mapProjection) {");
  expect(scheduleBlock).not.toContain("!pendingFullRender");
  expect(scheduleBlock).toContain(
    "mapTerminalFrameGapMs(mapProjection, runtimeActiveRef.current, interactiveRender)",
  );
});

// The map caps the canvas backing store at MAP_PROJECTION_MAX_DPR (1.25x) while the
// viewport CSS-scales it by the full zoom, so a zoomed node upscales its bitmap. With
// the default bilinear filter that smeared the glyphs into doubled, overlapping text.
// The map canvas must enlarge nearest-neighbour; the split pane stays smooth.
test("map terminal canvases enlarge with hard edges, split stays smooth", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });

  const modes = await page.evaluate(async () => {
    const { terminalCanvasImageRendering } = await import("/src/lib/mapRenderCadence.ts");
    return {
      map: terminalCanvasImageRendering(true),
      split: terminalCanvasImageRendering(false),
    };
  });

  expect(modes.map).toBe("pixelated");
  expect(modes.split).toBe("auto");
  // Both canvases must use the decision, not a hardcoded literal.
  expect(SOURCE).toContain("imageRendering: terminalCanvasImageRendering(mapProjection)");
  expect(SOURCE.match(/imageRendering:/g)).toHaveLength(2);
});
