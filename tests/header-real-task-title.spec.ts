import { expect, test } from "@playwright/test";
import {
  looksLikeNarrativeProse,
  neutralHeaderTitle,
  preferRealTaskSummary,
} from "../src/lib/terminalHeaderDisplay";
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

function statusSummary(
  over: Partial<WorkstreamStatusSummary>,
): WorkstreamStatusSummary {
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

test("without a real task list, the heuristic base is left untouched (no neutral given)", () => {
  const result = preferRealTaskSummary(
    heuristicBase,
    statusSummary({ tasksFromTodoWrite: false }),
  );
  expect(result).toEqual(heuristicBase);
});

test("no real task + neutral title → clean status replaces the heuristic scrape", () => {
  const result = preferRealTaskSummary(
    heuristicBase,
    statusSummary({ tasksFromTodoWrite: false }),
    "Working",
  );
  // The scraped heuristic title is replaced by the clean neutral; activity stays.
  expect(result.task).toBe("Working");
  expect(result.now).toBe(heuristicBase.now);
});

test("no real task + narrative scrape → clean status replaces prose and dedupes now", () => {
  const prose =
    "The map card header was showing implementation/source labels like running activity and model summary.";
  const result = preferRealTaskSummary(
    {
      ...heuristicBase,
      task: prose,
      now: prose,
    },
    statusSummary({ tasksFromTodoWrite: false }),
    "Working",
  );

  expect(looksLikeNarrativeProse(prose)).toBe(true);
  expect(result.task).toBe("Working");
  expect(result.now).toBe("Working");
});

test("no task list but agent narrated → narration becomes the title, not 'Working'", () => {
  // TC-033: when there's no task list, the agent's own last words (Stop-hook capture)
  // are a reliable title — better than the bare "Working" neutral.
  const result = preferRealTaskSummary(
    heuristicBase,
    statusSummary({
      tasksFromTodoWrite: false,
      narration: "Wiring the Stop hook so the title reads in my own words.",
      now: "Reading terminalHeaderDisplay.ts",
    }),
    "Working",
  );
  expect(result.task).toBe(
    "Wiring the Stop hook so the title reads in my own words.",
  );
  // The live activity detail stays on the now line.
  expect(result.now).toBe("Reading terminalHeaderDisplay.ts");
});

test("narration title is preferred over the neutral but still yields to a real task list", () => {
  const result = preferRealTaskSummary(
    heuristicBase,
    statusSummary({
      tasksFromTodoWrite: true,
      task: "Confirming the cockpit title works",
      narration: "Some narration that must NOT win over the real task.",
    }),
    "Working",
  );
  expect(result.task).toBe("Confirming the cockpit title works");
});

test("neutralHeaderTitle maps run state to a clean word", () => {
  expect(neutralHeaderTitle("running")).toBe("Working");
  expect(neutralHeaderTitle("reconnected")).toBe("Working");
  expect(neutralHeaderTitle("failed")).toBe("Needs attention");
  expect(neutralHeaderTitle("exited")).toBe("Idle");
  expect(neutralHeaderTitle(undefined)).toBe("Ready");
});

test("a missing/undefined status summary leaves the base untouched", () => {
  expect(preferRealTaskSummary(heuristicBase, undefined)).toEqual(
    heuristicBase,
  );
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
