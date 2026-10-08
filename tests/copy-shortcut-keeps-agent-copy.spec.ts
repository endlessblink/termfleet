import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { hasSelectionExtent } from "../src/lib/selection";

// TF-090: a click leaves a one-cell selection; copying it overwrote what an agent had
// just copied itself, so a paste gave one character.
test("a click-sized selection has no extent", () => {
  const point = { row: 4, col: 7 };
  expect(hasSelectionExtent({ start: point, end: point })).toBe(false);
  expect(hasSelectionExtent({ start: point, end: { row: 4, col: 8 } })).toBe(true);
  expect(hasSelectionExtent(null)).toBe(false);
});

test("the copy shortcut refuses a selection with no extent", () => {
  const source = readFileSync("src/components/TerminalCanvas.tsx", "utf8");
  const start = source.indexOf("const copySelection = () => {");
  const body = source.slice(start, source.indexOf('invoke<string>("grid_selection_text"', start));
  expect(start).toBeGreaterThan(-1);
  expect(body).toContain("!hasSelectionExtent(range)");
  expect(body).toContain("return;");
});
