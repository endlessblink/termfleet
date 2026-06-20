import { expect, test } from "@playwright/test";
import { preferRealTaskSummary } from "../src/lib/terminalHeaderDisplay";
import type { WorkstreamStatusSummary } from "../src/lib/types";

// TC-033 regression: the header title/now (split pane AND map node) must show the
// agent's REAL task (its TaskCreate/TaskUpdate list, captured into the sidecar →
// tasksFromTodoWrite) and NEVER the heuristic/purpose inference scraped from terminal
// output (the "Checking Agent Status Sidecar tests" garbage the user kept seeing).

// A heuristic/purpose-derived base summary, as produced from terminal output.
const heuristicBase = {
  task: "Checking Agent Status Sidecar tests",
  path: "termfleet",
  now: "running tests",
  status: "working" as const,
  confidence: "low" as const,
};

function statusSummary(over: Partial<WorkstreamStatusSummary>): WorkstreamStatusSummary {
  return {
    task: "Confirming the cockpit title works",
    path: "termfleet",
    now: "Confirming the cockpit title works",
    status: "working",
    ...over,
  };
}

test("real task list overrides the heuristic title and now", () => {
  const result = preferRealTaskSummary(
    heuristicBase,
    statusSummary({ tasksFromTodoWrite: true }),
  );
  expect(result.task).toBe("Confirming the cockpit title works");
  expect(result.now).toBe("Confirming the cockpit title works");
  // Non-title fields from the base are preserved.
  expect(result.path).toBe("termfleet");
});

test("without a real task list, the heuristic base is left untouched", () => {
  const result = preferRealTaskSummary(
    heuristicBase,
    statusSummary({ tasksFromTodoWrite: false }),
  );
  expect(result).toEqual(heuristicBase);
});

test("a missing/undefined status summary leaves the base untouched", () => {
  expect(preferRealTaskSummary(heuristicBase, undefined)).toEqual(heuristicBase);
  expect(preferRealTaskSummary(heuristicBase, null)).toEqual(heuristicBase);
});

test("real-task flag but empty task text falls back to the base (never blanks the title)", () => {
  const result = preferRealTaskSummary(
    heuristicBase,
    statusSummary({ tasksFromTodoWrite: true, task: "   ", now: "" }),
  );
  expect(result.task).toBe(heuristicBase.task);
  expect(result.now).toBe(heuristicBase.now);
});
