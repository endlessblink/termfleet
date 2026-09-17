import { expect, test } from "@playwright/test";
import {
  judgePaneGeometry,
  judgeKeyRoutes,
  judgePaneStream,
  judgePaneCapture,
  hasSwallowedKey,
} from "../scripts/lib/terminal-geometry-verdict.mjs";

/** A split pane that renders exactly right: canvas == grid == container. */
function healthySplit(overrides: Record<string, unknown> = {}) {
  const cellWidth = 8;
  const cellHeight = 16;
  const cols = 100;
  const rows = 30;
  const dpr = 1;
  return {
    kind: "geometry",
    id: "terminal-tab-pane",
    map: false,
    cols,
    rows,
    cellWidth,
    cellHeight,
    dpr,
    canvasCssWidth: cols * cellWidth,
    canvasCssHeight: rows * cellHeight,
    canvasDeviceWidth: Math.round(cols * cellWidth * dpr),
    canvasDeviceHeight: Math.round(rows * cellHeight * dpr),
    shellWidth: cols * cellWidth,
    shellHeight: rows * cellHeight,
    overlayDeviceWidth: cols * cellWidth,
    overlayDeviceHeight: rows * cellHeight,
    displayOffset: 0,
    hasHistory: true,
    altScreen: false,
    mouseReport: false,
    sgrMouse: false,
    alternateScroll: false,
    ...overrides,
  };
}

// The capture half: the log says what box the renderer believes it owns, the pixels say
// what actually reached the screen.
test("a capture judge flags a blank pane and an off-window rect", () => {
  const sample = { ...healthySplit(), rectX: 40, rectY: 60, rectWidth: 800, rectHeight: 480 };

  // Painting normally: nothing to report.
  expect(judgePaneCapture(sample, () => 0.4).violations).toEqual([]);
  // Blank while the renderer claims 100x30 of content: a screen-level defect.
  expect(
    judgePaneCapture(sample, () => 0.0001).violations.map((v: { code: string }) => v.code),
  ).toEqual(["PANE_BLANK_ON_SCREEN"]);
  // A canvas that starts outside the window can never be seen.
  expect(
    judgePaneCapture({ ...sample, rectX: -50 }, () => 0.4).violations.map(
      (v: { code: string }) => v.code,
    ),
  ).toContain("PANE_RECT_OFFSCREEN");
  // An unusable box is reported instead of being measured.
  expect(
    judgePaneCapture({ ...sample, rectWidth: 0 }, () => 0.4).violations.map(
      (v: { code: string }) => v.code,
    ),
  ).toEqual(["PANE_RECT_INVALID"]);
  // A sampler failure is surfaced, not swallowed into a pass.
  expect(judgePaneCapture(sample, () => {
    throw new Error("no magick");
  }).error).toContain("no magick");
});

test("a correctly sized split pane reports no violations", () => {
  expect(judgePaneGeometry(healthySplit())).toEqual([]);
});

// A pane sampled before its first frame sizes its canvas from the initial props while the
// buffer is still empty. That is "not painted yet", not a mismatch — flagging it would
// make every pane report a false defect for its first seconds.
test("a pane with no grid yet is not judged", () => {
  expect(judgePaneGeometry(healthySplit({ cols: 0, rows: 0 }))).toEqual([]);
});

// A map card is deliberately frozen at 1:1 and clipped, so a canvas wider than its
// shell is expected there — but never in a split pane.
test("clipping is only a defect outside map projection", () => {
  const clipped = healthySplit({ canvasCssWidth: 1000, shellWidth: 900 });
  expect(judgePaneGeometry(clipped).map((v: { code: string }) => v.code))
    .toContain("CLIPPED_OUTSIDE_MAP");
  expect(judgePaneGeometry({ ...clipped, map: true }).map((v: { code: string }) => v.code))
    .not.toContain("CLIPPED_OUTSIDE_MAP");
});

test("a blank stripe wider than one cell is flagged, small padding is not", () => {
  const stripe = judgePaneGeometry(healthySplit({ shellWidth: 800 + 40 }));
  expect(stripe.map((v: { code: string }) => v.code)).toContain("GUTTER_WIDER_THAN_CELL");
  // Sub-cell padding is what a real terminal leaves; it must not be a defect.
  expect(judgePaneGeometry(healthySplit({ shellWidth: 800 + 3 }))).toEqual([]);
});

test("canvas and backing store must agree with the grid", () => {
  // Beyond the sub-pixel tolerance.
  expect(
    judgePaneGeometry(healthySplit({ canvasCssWidth: 812 })).map((v: { code: string }) => v.code),
  ).toContain("CANVAS_GRID_MISMATCH");
  expect(
    judgePaneGeometry(
      healthySplit({ canvasDeviceWidth: 640, canvasDeviceHeight: 360 }),
    ).map((v: { code: string }) => v.code),
  ).toContain("BACKING_STORE_MISMATCH");
});

test("scrolled with no history is incoherent", () => {
  expect(
    judgePaneGeometry(healthySplit({ hasHistory: false, displayOffset: 12 }))
      .map((v: { code: string }) => v.code),
  ).toContain("SCROLL_STATE_INCOHERENT");
});

// The exact "PageUp does nothing" signature: the key was claimed for history while the
// grid held none, so it never reached the application that owns the content.
test("a navigation key claimed for absent history is the swallowed-key bug", () => {
  const swallowed = judgeKeyRoutes([
    { id: "p1", key: "PageUp", action: "history", hasHistory: false, map: true },
  ]);
  expect(swallowed.map((v: { code: string }) => v.code)).toEqual(["KEY_SWALLOWED"]);
  expect(hasSwallowedKey(swallowed)).toBe(true);

  // Handed to the app, or history that exists, are both fine.
  expect(judgeKeyRoutes([{ id: "p1", key: "PageUp", action: null, hasHistory: false }])).toEqual([]);
  expect(judgeKeyRoutes([{ id: "p1", key: "PageUp", action: "history", hasHistory: true }])).toEqual([]);
});

// OpenCode asked the terminal to draw explicit-width text with OSC 66. The grid consumes
// it, so it is reported as a warning (the emission is the app's and means capability
// detection guessed wrong) rather than a permanent hard failure.
test("OSC 66 output is a warning and plain output is silent", () => {
  const dirty = judgePaneStream("pane-1", "hello \u001b]66;w=1; \u001b\\ world");
  expect(dirty.counts.osc66).toBe(1);
  expect(dirty.violations).toEqual([]);
  expect(dirty.warnings.map((w: { code: string }) => w.code)).toEqual(["OSC66_EMITTED"]);

  const clean = judgePaneStream("pane-2", "plain \u001b[?2026h output \u001b[?2026l");
  expect(clean.violations).toEqual([]);
  expect(clean.warnings).toEqual([]);
  expect(clean.counts.osc66).toBeUndefined();
});
