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
