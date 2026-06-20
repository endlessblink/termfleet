import { expect, test } from "@playwright/test";
import { normalizeTaskLineupItems, visibleTaskLineup } from "../src/lib/taskLineup";
import type { TaskLineupItem } from "../src/lib/types";

// TC-033 (list empty): the panel must show the AI/heuristic-extracted tasks
// (operator/summary/structured-signal) when there is no authoritative todo-write
// list — otherwise it is always empty, because nothing emits the todo-write marker.
// When a real todo-write list exists, it still wins (T1 contract).

function items(source: TaskLineupItem["source"], runId?: string): TaskLineupItem[] {
  return normalizeTaskLineupItems(
    [
      { text: "Wire the daemon input worker", status: "in_progress" },
      { text: "Add reconnection guard", status: "pending" },
    ],
    source,
    1_000,
    runId,
  );
}

test("falls back to operator items when there are no todo-write items", () => {
  const visible = visibleTaskLineup(items("operator"), undefined);
  expect(visible.length).toBe(2);
  expect(visible.every((i) => i.source === "operator")).toBe(true);
});

test("todo-write items win when both exist", () => {
  const mixed = [...items("todo-write"), ...items("operator")];
  const visible = visibleTaskLineup(mixed, undefined);
  expect(visible.length).toBe(2);
  expect(visible.every((i) => i.source === "todo-write")).toBe(true);
});

test("empty/undefined lineup yields an empty list", () => {
  expect(visibleTaskLineup(undefined, undefined)).toEqual([]);
  expect(visibleTaskLineup([], undefined)).toEqual([]);
});

test("an all-completed list shows nothing (panel is empty when no live tasks)", () => {
  const allDone: TaskLineupItem[] = [
    { id: "a", content: "Wire the hook", status: "completed", source: "todo-write", updatedAt: 1_000 },
    { id: "b", content: "Verify it", status: "completed", source: "todo-write", updatedAt: 2_000 },
  ];
  expect(visibleTaskLineup(allDone, undefined)).toEqual([]);
});

test("a list with at least one live task shows the full list (completed for context)", () => {
  const mixed: TaskLineupItem[] = [
    { id: "a", content: "Wire the hook", status: "completed", source: "todo-write", updatedAt: 1_000 },
    { id: "b", content: "Verify it", status: "in_progress", source: "todo-write", updatedAt: 2_000 },
  ];
  expect(visibleTaskLineup(mixed, undefined).length).toBe(2);
});

test("drops stale/junk fallback items (e.g. a bare all-caps fragment)", () => {
  const junk: TaskLineupItem[] = [
    { id: "stale-term", content: "TERM", status: "pending", source: "summary", updatedAt: 1_000 },
  ];
  expect(visibleTaskLineup(junk, undefined)).toEqual([]);
});

test("respects run scoping on the fallback source", () => {
  const a = items("operator", "run-A");
  const b = items("operator", "run-B");
  const visible = visibleTaskLineup([...a, ...b], "run-B");
  expect(visible.length).toBe(2);
  expect(visible.every((i) => i.runId === "run-B")).toBe(true);
});
