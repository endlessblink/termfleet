import { expect, test } from "@playwright/test";
import { summarySourceLabel } from "../src/lib/terminalHeaderDisplay";

// TC-033 T2: surface whether a terminal summary came from the local status model
// or the deterministic heuristic fallback, so it stops silently degrading.

test("returns null when the source is unknown", () => {
  expect(summarySourceLabel(undefined)).toBeNull();
  expect(summarySourceLabel(null)).toBeNull();
});

test("labels a model-produced summary", () => {
  const result = summarySourceLabel("process");
  expect(result?.label).toMatch(/model/i);
});

test("labels a heuristic fallback and surfaces the error", () => {
  const result = summarySourceLabel("fallback", "ECONNREFUSED 127.0.0.1:37819");
  expect(result?.label).toMatch(/heuristic/i);
  expect(result?.detail).toMatch(/unavailable|offline/i);
  expect(result?.detail).toMatch(/ECONNREFUSED/);
});
