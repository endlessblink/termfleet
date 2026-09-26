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
