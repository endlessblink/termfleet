import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

// Find-in-buffer overlay logic (pure functions): match navigation wrap-around
// and the scroll-to-reveal math that maps a match's buffer line to a grid_scroll
// delta. The actual matching is proven in Rust (search.rs); this proves the
// frontend navigation math deterministically.

test.use({
  launchOptions: {
    executablePath: "/usr/bin/chromium",
    args: ["--disable-crash-reporter", "--disable-crashpad", "--disable-gpu"],
  },
});

test("match cycling and scroll-to-reveal math", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });

  const out = await page.evaluate(async () => {
    const { cycleMatchIndex, targetScrollOffset, scrollDeltaToReveal } = await import(
      "/src/lib/searchOverlay.ts"
    );
    return {
      next: cycleMatchIndex(0, 3, 1),
      nextWrap: cycleMatchIndex(2, 3, 1),
      prev: cycleMatchIndex(0, 3, -1),
      empty: cycleMatchIndex(0, 0, 1),
      visibleOffset: targetScrollOffset(5, 24),
      historyOffset: targetScrollOffset(-10, 24),
      alreadyVisibleDelta: scrollDeltaToReveal(5, 0, 24),
      historyFromBottom: scrollDeltaToReveal(-100, 0, 24),
      historyFromMidScroll: scrollDeltaToReveal(-100, 50, 24),
    };
  });

  expect(out.next).toBe(1);
  expect(out.nextWrap).toBe(0); // wraps past the end
  expect(out.prev).toBe(2); // wraps past the start
  expect(out.empty).toBe(-1); // no matches
  expect(out.visibleOffset).toBe(0); // a visible line needs no scroll
  expect(out.historyOffset).toBe(10); // history line lifts to the top row
  expect(out.alreadyVisibleDelta).toBe(0);
  expect(out.historyFromBottom).toBe(100);
  expect(out.historyFromMidScroll).toBe(50); // 100 target - 50 current
});

test("canvas terminal wires buffer search through the current grid", () => {
  const canvas = readFileSync("src/components/TerminalCanvas.tsx", "utf8");
  const commands = readFileSync("src-tauri/src/commands.rs", "utf8");
  const tauri = readFileSync("src-tauri/src/lib.rs", "utf8");

  expect(canvas).toContain('invoke<SearchMatch[]>("grid_search"');
  expect(canvas).toContain('role="search"');
  expect(canvas).toContain('aria-label="Search terminal buffer"');
  expect(canvas).toContain('key === "f"');
  expect(canvas).toContain("scrollDeltaToReveal");
  expect(canvas).toContain("searchMatchesRef.current.entries()");
  expect(commands).toContain("pub fn grid_search");
  expect(tauri).toContain("commands::grid_search");
});
