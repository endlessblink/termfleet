import { expect, test } from "@playwright/test";
import { mergeShellSummaryTaskLineup, normalizeTaskLineupItems } from "../src/lib/taskLineup";
import type { TaskLineupItem } from "../src/lib/types";

// TC-033 T1: the 650ms status-summary cycle must NOT clobber a live `todo-write`
// task list with `operator`-source items. The sidebar/map renderers only display
// `source === "todo-write"`, so an overwrite empties the visible TASKS panel.
// Decision: TodoWrite wins, never clobbered — operator summary items populate the
// lineup only when no todo-write items exist.

function todoWriteLineup(): TaskLineupItem[] {
  return normalizeTaskLineupItems(
    [
      { text: "Wire the daemon input worker", status: "in_progress" },
      { text: "Add reconnection guard", status: "pending" },
    ],
    "todo-write",
    1_000,
    "run-A"
  );
}

function operatorLineup(): TaskLineupItem[] {
  return normalizeTaskLineupItems(
    [{ text: "Building TypeScript bundle", status: "in_progress" }],
    "operator",
    2_000,
    "run-A"
  );
}

test("summary cycle does not clobber a populated todo-write lineup", () => {
  const existing = todoWriteLineup();
  const extracted = operatorLineup();

  const merged = mergeShellSummaryTaskLineup(existing, extracted, {
    closesRun: false,
    runId: "run-A",
    updatedAt: 2_000,
  });

  // The visible (todo-write) list survives the summary cycle.
  const visible = merged.filter((item) => item.source === "todo-write");
  expect(visible.length).toBe(2);
  // Operator items must NOT have replaced the todo-write list.
  expect(merged.some((item) => item.source === "operator")).toBe(false);
});

test("operator items populate only when no todo-write items exist", () => {
  const merged = mergeShellSummaryTaskLineup([], operatorLineup(), {
    closesRun: false,
    runId: "run-A",
    updatedAt: 2_000,
  });
  expect(merged.length).toBe(1);
  expect(merged[0].source).toBe("operator");
});

test("empty extraction keeps the existing lineup untouched", () => {
  const existing = todoWriteLineup();
  const merged = mergeShellSummaryTaskLineup(existing, [], {
    closesRun: false,
    runId: "run-A",
    updatedAt: 3_000,
  });
  expect(merged).toEqual(existing);
});

test("run close completes open operator items when no todo-write list exists", () => {
  const merged = mergeShellSummaryTaskLineup([], operatorLineup(), {
    closesRun: true,
    runId: "run-A",
    updatedAt: 4_000,
  });
  expect(merged.every((item) => item.status === "completed")).toBe(true);
});
