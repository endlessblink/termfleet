import { expect, test } from "@playwright/test";

// Launch audit 2026-09-30: map cards zoomed out below readable zoom showed
// scrambled text ("Tornacmada dinnstr...") because the preview resampled the grid
// and dropped every other character. The preview must crop, never resample.
test("map preview crops the newest rows and leftmost columns without dropping characters", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });

  const result = await page.evaluate(async () => {
    const { snapshotPreviewRows } = await import("/src/lib/snapshotPreviewRows.ts");
    const lines = Array.from({ length: 30 }, (_, i) => `line ${String(i).padStart(2, "0")} echo hello world from the terminal`);
    const cells = lines.map((text) =>
      Array.from({ length: 138 }, (_, col) => ({ c: text[col] ?? " ", fg: "#d0d0d0", bg: "#000000" })),
    );
    const rows = snapshotPreviewRows({
      cols: 138,
      rows: 30,
      cursor: { col: 0, line: 29 },
      cursorVisible: false,
      altScreen: false,
      cells,
    });
    return rows.map((row) => row.segments.map((segment) => segment.text).join("").trimEnd());
  });

  expect(result).toHaveLength(14);
  // Newest 14 of the 30 rows (16..29), each row's text copied one-to-one.
  expect(result[0]).toBe("line 16 echo hello world from the terminal");
  expect(result[13]).toBe("line 29 echo hello world from the terminal");
});
