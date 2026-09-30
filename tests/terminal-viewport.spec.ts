import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

test("terminal viewport shortcuts map to history navigation", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });

  const actions = await page.evaluate(async () => {
    const { terminalViewportAction } = await import("/src/lib/terminalViewport.ts");
    return {
      home: terminalViewportAction("Home", 24),
      end: terminalViewportAction("End", 24),
      pageUp: terminalViewportAction("PageUp", 24),
      pageDown: terminalViewportAction("PageDown", 24),
      enter: terminalViewportAction("Enter", 24),
    };
  });

  expect(actions.home).toEqual({ kind: "top" });
  expect(actions.end).toEqual({ kind: "bottom" });
  expect(actions.pageUp).toEqual({ kind: "delta", delta: 24 });
  expect(actions.pageDown).toEqual({ kind: "delta", delta: -24 });
  expect(actions.enter).toBeNull();
});

test("wheel delta units follow browser semantics and retain sub-row trackpad movement", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });

  const result = await page.evaluate(async () => {
    const { consumeTerminalWheelRows, terminalWheelRowDelta } = await import("/src/lib/terminalViewport.ts");
    const first = consumeTerminalWheelRows(terminalWheelRowDelta(8, 0, 16, 24), 0);
    const second = consumeTerminalWheelRows(terminalWheelRowDelta(8, 0, 16, 24), first.remainder);
    const third = consumeTerminalWheelRows(terminalWheelRowDelta(8, 0, 16, 24), second.remainder);
    return {
      pixelRows: [first.rows, second.rows, third.rows],
      lineRows: terminalWheelRowDelta(3, 1, 16, 24),
      pageRows: terminalWheelRowDelta(1, 2, 16, 24),
      directionReversal: consumeTerminalWheelRows(-0.5, 0.5),
    };
  });

  expect(result.pixelRows).toEqual([0, 1, 0]);
  expect(result.lineRows).toBe(3);
  expect(result.pageRows).toBe(24);
  expect(result.directionReversal).toEqual({ rows: 0, remainder: 0 });
});

test("app-owned wheel scrolling uses stable notches independent of terminal grid size", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });

  const result = await page.evaluate(async () => {
    const { consumeTerminalWheelRows, terminalWheelNotchDelta } = await import("/src/lib/terminalViewport.ts");
    const mouseWheel = terminalWheelNotchDelta(99, 0);
    const trackpadOne = consumeTerminalWheelRows(terminalWheelNotchDelta(8, 0), 0);
    const trackpadTwo = consumeTerminalWheelRows(terminalWheelNotchDelta(8, 0), trackpadOne.remainder);
    const trackpadThree = consumeTerminalWheelRows(terminalWheelNotchDelta(8, 0), trackpadTwo.remainder);
    const scrollOne = consumeTerminalWheelRows(terminalWheelNotchDelta(25, 0), 0);
    const scrollTwo = consumeTerminalWheelRows(terminalWheelNotchDelta(25, 0), scrollOne.remainder);
    const scrollThree = consumeTerminalWheelRows(terminalWheelNotchDelta(25, 0), scrollTwo.remainder);
    const scrollFour = consumeTerminalWheelRows(terminalWheelNotchDelta(25, 0), scrollThree.remainder);
    return {
      mouseWheel,
      lineWheel: terminalWheelNotchDelta(3, 1),
      pageWheel: terminalWheelNotchDelta(1, 2),
      trackpad: [trackpadOne.rows, trackpadTwo.rows, trackpadThree.rows],
      accumulatedTrackpad: [scrollOne.rows, scrollTwo.rows, scrollThree.rows, scrollFour.rows],
      reversal: consumeTerminalWheelRows(terminalWheelNotchDelta(-8, 0), terminalWheelNotchDelta(8, 0)),
    };
  });

  expect(result.mouseWheel).toBeCloseTo(1, 1);
  expect(result.lineWheel).toBe(1);
  expect(result.pageWheel).toBe(1);
  expect(result.trackpad).toEqual([0, 0, 0]);
  expect(result.accumulatedTrackpad).toEqual([0, 0, 0, 1]);
  expect(result.reversal).toEqual({ rows: 0, remainder: 0 });
  // The action must not depend on the terminal's row count, which may be zero.
  const source = readFileSync("src/components/TerminalCanvas.tsx", "utf8");
  expect(source).toMatch(/wheelAction\.kind === "history"[\s\S]{0,180}terminalWheelNotchDelta\(wheelDelta, event\.deltaMode\)/);
});

// An alt-screen TUI (OpenCode, vim, htop, less) has no grid scrollback, so a
// history action is a no-op that also swallows the key — the pane could not scroll
// at all. These keys must fall through to the app on the alternate screen, and keep
// TermFleet history on the primary screen where the scrollback really is.
test("alternate-screen navigation keys go to the app, not to a missing history", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });

  const actions = await page.evaluate(async () => {
    const { terminalViewportAction } = await import("/src/lib/terminalViewport.ts");
    const alt = { altScreen: true };
    const primary = { altScreen: false };
    return {
      altPageUp: terminalViewportAction("PageUp", 24, alt),
      altPageDown: terminalViewportAction("PageDown", 24, alt),
      altHome: terminalViewportAction("Home", 24, alt),
      altEnd: terminalViewportAction("End", 24, alt),
      primaryPageUp: terminalViewportAction("PageUp", 24, primary),
      primaryHome: terminalViewportAction("Home", 24, primary),
    };
  });

  expect(actions.altPageUp).toBeNull();
  expect(actions.altPageDown).toBeNull();
  expect(actions.altHome).toBeNull();
  expect(actions.altEnd).toBeNull();
  expect(actions.primaryPageUp).toEqual({ kind: "delta", delta: 24 });
  expect(actions.primaryHome).toEqual({ kind: "top" });
});

// OpenCode repaints in place on the PRIMARY screen and never emits a line feed, so
// the grid accumulates no scrollback at all. Claiming the key there swallowed it
// into an empty history — the pane could not scroll even though the app held the
// content. With no history to show, the key must fall through to the app.
test("navigation keys fall through when the grid has no history to show", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });

  const actions = await page.evaluate(async () => {
    const { terminalViewportAction } = await import("/src/lib/terminalViewport.ts");
    return {
      pageUpNoHistory: terminalViewportAction("PageUp", 24, { hasHistory: false }),
      homeNoHistory: terminalViewportAction("Home", 24, { hasHistory: false }),
      endNoHistory: terminalViewportAction("End", 24, { hasHistory: false }),
      pageUpWithHistory: terminalViewportAction("PageUp", 24, { hasHistory: true }),
      // An older frame that doesn't carry the flag keeps the previous behaviour.
      pageUpUnknown: terminalViewportAction("PageUp", 24, {}),
      // Claude Code fullscreen: its own transcript scroll owns PageUp/Home.
      pageUpFullscreenApp: terminalViewportAction("PageUp", 24, { hasHistory: true, mouseMotion: true }),
      homeFullscreenApp: terminalViewportAction("Home", 24, { hasHistory: true, mouseMotion: true }),
    };
  });

  expect(actions.pageUpNoHistory).toBeNull();
  expect(actions.homeNoHistory).toBeNull();
  expect(actions.endNoHistory).toBeNull();
  expect(actions.pageUpWithHistory).toEqual({ kind: "delta", delta: 24 });
  expect(actions.pageUpUnknown).toEqual({ kind: "delta", delta: 24 });
  expect(actions.pageUpFullscreenApp).toBeNull();
  expect(actions.homeFullscreenApp).toBeNull();
});

// TF-059: once the wheel/page keys belong to a fullscreen app, a view already
// parked in grid history must return to the live screen, or the app scrolls
// underneath a frozen view of stale frames.
test("app-owned scrolling leaves grid history first", () => {
  const source = readFileSync("src/components/TerminalCanvas.tsx", "utf8");
  const helper = source.match(/const leaveGridHistoryForApp = \(\) => \{[\s\S]*?\n  \};/)?.[0] ?? "";
  expect(helper).toContain("grid_scroll_to_bottom");
  const wheel = source.match(/const handleWheel = [\s\S]*?\n  \};/)?.[0] ?? "";
  expect(wheel).toMatch(/if \(wheelAction\.kind === "mouse-report"\) \{[\s\S]{0,120}leaveGridHistoryForApp\(\)/);
  // Locking the viewport is only for scrolls that stay in our history.
  expect(wheel.indexOf("userViewportLockedRef.current = true")).toBeGreaterThan(wheel.indexOf("app-pages"));
  expect(source).toMatch(/modesRef\.current\.mouseMotion &&[\s\S]{0,200}leaveGridHistoryForApp\(\)/);
  // Shift+wheel arrives as a horizontal scroll on GTK; its direction must count.
  expect(wheel).toContain("event.deltaY !== 0 ? event.deltaY : event.deltaX");
  expect(wheel).toContain("const up = wheelDelta < 0");
});

test("wheel scrolling during a held selection follows the refreshed viewport", () => {
  const source = readFileSync("src/components/TerminalCanvas.tsx", "utf8");
  const wheel = source.match(/const handleWheel = \(event: React\.WheelEvent\) => \{[\s\S]*?\n  \};/)?.[0] ?? "";
  const frameHandler = source.match(/channel\.onmessage = \(payload\) => \{[\s\S]*?\n    \};/)?.[0] ?? "";

  expect(wheel).toContain("const selecting = selectionPointerIdRef.current !== null");
  expect(wheel).toMatch(/selecting\s*\?\s*\{ kind: "history" as const \}/);
  expect(frameHandler).toMatch(/buffer\.apply\(frame\)[\s\S]*?if \(selectionPointerIdRef\.current !== null\) updateSelectionFocusFromLastPointer\(\)/);
  expect(wheel).not.toMatch(/grid_scroll[\s\S]{0,160}\.then\(/);
});

test("canvas terminal keeps keyboard-owned history separate from PTY input", () => {
  const source = readFileSync("src/components/TerminalCanvas.tsx", "utf8");
  const captureBlock = source.match(
    /const onCaptureKeyDown = \(event: KeyboardEvent\) => \{[\s\S]*?\n    \};/,
  )?.[0] ?? "";

  expect(captureBlock).toContain("const viewportAction = terminalViewportAction(");
  expect(captureBlock).toContain("userViewportLockedRef.current = true");
  expect(captureBlock).toContain('invoke("grid_scroll_to_bottom"');
  expect(captureBlock).not.toMatch(
    /terminalViewportAction\(event\.key[\s\S]*?keyEventToBytes\(event/,
  );
});
