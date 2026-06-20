import { expect, test } from "@playwright/test";
import { cleanTaskLineupContent, normalizeTaskLineupItems } from "../src/lib/taskLineup";

// TC-033 (faulty task list): the TASKS panel must not show runner/verify OUTCOMES
// or prompt chrome as if they were tasks. The operator contract for the task list
// rejects status-report lines while keeping real tasks that merely mention
// build/test/verify.

const OUTCOMES = [
  "Terminal summary visual checks failed",
  "Frontend build failed",
  "Frontend build passed",
  "3 passed",
  "15 passed (10.5s)",
  "Running 2 tests using 1 worker",
  "map terminal source checks passed",
];

const CHROME = [
  "gpt-5.5 default · ~",
  "Working (2m • esc to interrupt)",
  "tab to queue message            45% context left",
];

const REAL_TASKS = [
  "Fix the frontend build",
  "Add reconnection guard",
  "Wire the daemon input worker",
  "Render remaining lane tasks",
  "Investigate why the verify suite is flaky",
];

test("runner/verify outcome lines are not tasks", () => {
  for (const outcome of OUTCOMES) {
    expect(cleanTaskLineupContent(outcome), outcome).toBeUndefined();
  }
});

test("prompt chrome is not a task", () => {
  for (const chrome of CHROME) {
    expect(cleanTaskLineupContent(chrome), chrome).toBeUndefined();
  }
});

test("real tasks that mention build/test/verify are kept", () => {
  for (const task of REAL_TASKS) {
    expect(cleanTaskLineupContent(task), task).toBeTruthy();
  }
});

test("a list mixing tasks and outcomes keeps only the tasks", () => {
  const items = normalizeTaskLineupItems(
    [
      { text: "Add reconnection guard", status: "pending" },
      { text: "Frontend build failed", status: "pending" },
      { text: "3 passed", status: "pending" },
      { text: "Wire the daemon input worker", status: "in_progress" },
    ],
    "operator",
    1_000,
  );
  expect(items.map((item) => item.content).sort()).toEqual(
    ["Add reconnection guard", "Wire the daemon input worker"].sort(),
  );
});
