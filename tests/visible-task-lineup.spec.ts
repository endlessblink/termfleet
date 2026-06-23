import { expect, test } from "@playwright/test";
import {
  mergeShellSummaryTaskLineup,
  normalizeTaskLineupItems,
  taskLineupFromExtractedItems,
  visibleTaskLineup,
} from "../src/lib/taskLineup";
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

// TC-035: the agent's real sidecar list (todo-write) is NOT tied to any one terminal
// command run. Its items get stamped with whatever run was active when the summary
// landed, but `activeRunId` rolls forward on every command (`${startedAt}:${command}`),
// so run-scoping would filter the real list to nothing. The authoritative list must
// always render, regardless of the current run id.
test("todo-write list is never run-scoped (real sidecar list always shows)", () => {
  const stamped = items("todo-write", "run-OLD");
  const visible = visibleTaskLineup(stamped, "run-NEW-rolled-forward");
  expect(visible.length).toBe(2);
  expect(visible.every((i) => i.source === "todo-write")).toBe(true);
});

// TC-035 (root cause of "No list"): a terminal-output run-close marker
// ("Worked for…", "Task complete") must NEVER force-complete the agent's REAL task
// list. `runClosed` is sticky, so once a Claude pane prints such a line the panel
// would otherwise stay permanently empty even while the agent has live tasks. This
// mirrors the exact Terminal.tsx shell-pane construction.
test("a terminal run-close does not empty the agent's real task list", () => {
  const sidecarTasks = [
    { id: "a", text: "done: Verify per-terminal task list", at: 0 },
    { id: "b", text: "in-progress: Fix empty TASKS panel", at: 0 },
    { id: "c", text: "Stop header flicker", at: 0 },
  ];
  const runId = "1782195534600:claude";
  const extracted = taskLineupFromExtractedItems(sidecarTasks, "todo-write", "pending", 1_000, runId);
  const merged = mergeShellSummaryTaskLineup(undefined, extracted, { closesRun: true, runId, updatedAt: 1_000 });
  const visible = visibleTaskLineup(merged, runId);
  expect(visible.length).toBe(3);
  expect(visible.some((i) => i.status === "in_progress")).toBe(true);
});
