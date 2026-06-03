import { expect, test } from "@playwright/test";

test.use({
  viewport: { width: 900, height: 600 },
  launchOptions: {
    executablePath: "/usr/bin/chromium",
    args: ["--disable-crash-reporter", "--disable-crashpad", "--disable-gpu"],
  },
});

test("legacy duplicate prompt detector repairs only stale plain-shell prompt stacks", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });

  const result = await page.evaluate(async () => {
    const { needsLegacyPromptRepair } = await import("/src/lib/legacyPromptRepair.ts");

    const blank = { c: " ", fg: "#d0d0d0", bg: "#000000" };
    const row = (text: string, cols = 24) =>
      Array.from({ length: cols }, (_, index) => ({
        ...blank,
        c: text[index] ?? " ",
      }));
    const snapshot = (lines: string[], cursorLine: number, altScreen = false) => ({
      cols: 24,
      rows: lines.length,
      cursor: { col: lines[cursorLine]?.length ?? 0, line: cursorLine },
      altScreen,
      cursorVisible: true,
      cells: lines.map((line) => row(line)),
    });

    return {
      stalePromptStack: needsLegacyPromptRepair(
        snapshot(
          [
            "endlessblink@host:/tmp$",
            "",
            "",
            "endlessblink@host:/tmp$",
            "",
          ],
          3,
        ),
      ),
      adjacentPromptsAreNormalScrollback: needsLegacyPromptRepair(
        snapshot(
          [
            "endlessblink@host:/tmp$",
            "endlessblink@host:/tmp$",
            "",
          ],
          1,
        ),
      ),
      altScreenNeverRepairs: needsLegacyPromptRepair(
        snapshot(
          [
            "endlessblink@host:/tmp$",
            "",
            "",
            "endlessblink@host:/tmp$",
          ],
          3,
          true,
        ),
      ),
      cursorNotOnPrompt: needsLegacyPromptRepair(
        snapshot(
          [
            "endlessblink@host:/tmp$",
            "",
            "",
            "endlessblink@host:/tmp$",
          ],
          2,
        ),
      ),
    };
  });

  expect(result.stalePromptStack).toBe(true);
  expect(result.adjacentPromptsAreNormalScrollback).toBe(false);
  expect(result.altScreenNeverRepairs).toBe(false);
  expect(result.cursorNotOnPrompt).toBe(false);
});
