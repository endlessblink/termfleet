import { expect, test } from "@playwright/test";

// TC-017f — selection model proof (pure functions). Scrollback + clipboard wiring
// is exercised in the integrated runtime; the text-extraction and hit-test math
// is proven deterministically here.

test.use({
  launchOptions: {
    executablePath: "/usr/bin/chromium",
    args: ["--disable-crash-reporter", "--disable-crashpad", "--disable-gpu"],
  },
});

test("selection range, hit-test, and text extraction", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });

  const out = await page.evaluate(async () => {
    const {
      computeSelectionAutoScrollDelta,
      normalizeRange,
      rowSpan,
      isCellSelected,
      selectionToText,
      pointToCell,
      visiblePointToAbsolute,
      visibleRowSpan,
    } = await import("/src/lib/selection.ts");

    const cell = (c: string) => ({ c, fg: "#d0d0d0", bg: "#000000" });
    const rowFrom = (s: string, cols: number) =>
      Array.from({ length: cols }, (_, i) => cell(s[i] ?? " "));
    const cols = 10;
    // "hello", "world  ..", "  bye"
    const cells = [rowFrom("hello", cols), rowFrom("world", cols), rowFrom("  bye", cols)];

    // Drag from (row2,col? ) upward to (row0,col0) — normalize reorders to row-major.
    const range = normalizeRange({ col: 3, row: 2 }, { col: 0, row: 0 });

    return {
      normalized: range,
      span0: rowSpan(range, 0, cols),
      span1: rowSpan(range, 1, cols),
      span2: rowSpan(range, 2, cols),
      selectedMid: isCellSelected(range, 9, 1, cols),
      notSelectedBelow: isCellSelected(range, 0, 5, cols),
      // Single-line partial selection: cols 0..4 of "world" → "world".
      singleLine: selectionToText(cells, normalizeRange({ col: 0, row: 1 }, { col: 4, row: 1 })),
      // Multi-line full selection trims trailing whitespace per line.
      multiLine: selectionToText(cells, normalizeRange({ col: 0, row: 0 }, { col: 4, row: 2 })),
      hit: pointToCell(25, 40, 8, 16, cols, 5),
      clampHigh: pointToCell(9999, 9999, 8, 16, cols, 5),
      absolutePoint: visiblePointToAbsolute({ col: 4, row: 2 }, 7),
      visibleScrolledSpan: visibleRowSpan(
        normalizeRange({ col: 1, row: -5 }, { col: 6, row: -3 }),
        3,
        8,
        cols
      ),
      scrollAbove: computeSelectionAutoScrollDelta(80, 100, 300),
      scrollInside: computeSelectionAutoScrollDelta(160, 100, 300),
      scrollBelow: computeSelectionAutoScrollDelta(340, 100, 300),
      scrollBelowClamped: computeSelectionAutoScrollDelta(1000, 100, 300),
    };
  });

  expect(out.normalized).toEqual({ start: { col: 0, row: 0 }, end: { col: 3, row: 2 } });
  // Row 0 from start.col(0)..cols-1; middle row full; last row 0..end.col(3).
  expect(out.span0).toEqual([0, 9]);
  expect(out.span1).toEqual([0, 9]);
  expect(out.span2).toEqual([0, 3]);
  expect(out.selectedMid).toBe(true);
  expect(out.notSelectedBelow).toBe(false);

  expect(out.singleLine).toBe("world");
  // Rows fully trimmed of trailing space; last row cols 0..4 (inclusive) = "  bye".
  expect(out.multiLine).toBe("hello\nworld\n  bye");

  expect(out.hit).toEqual({ col: 3, row: 2 }); // floor(25/8)=3, floor(40/16)=2
  expect(out.clampHigh).toEqual({ col: 9, row: 4 }); // clamped to cols-1, rows-1
  expect(out.absolutePoint).toEqual({ col: 4, row: -5 });
  expect(out.visibleScrolledSpan).toEqual([1, 9]);
  expect(out.scrollAbove).toBeGreaterThan(0);
  expect(out.scrollInside).toBe(0);
  expect(out.scrollBelow).toBeLessThan(0);
  expect(out.scrollBelowClamped).toBe(-8);
});
