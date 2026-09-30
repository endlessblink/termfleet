import { expect, test } from "@playwright/test";
import { resolveMapCardTaskRow } from "../src/lib/terminalHeaderState";

// TF-065: the all-pane matrix (2026-09-28) showed map cards with a trusted
// opening-request Goal reading "Task not captured". The task line resolved to the
// opening request (identical to the Goal, so correctly suppressed as a duplicate),
// and the pane's real latest request was judged with the "current step" gate, which
// rejects ordinary requests the split view accepts.
const goal = "fix these issues and the fact that I cant login to my kde widget";

test("a real latest request fills the Task row when the task line only repeats the Goal", () => {
  expect(
    resolveMapCardTaskRow({
      goal,
      taskLine: goal,
      statusTask:
        "Check release-1.4.568.log and verify 1.4.568 is published with the synced Canvas order fix",
    }),
  ).toBe(
    "Check release-1.4.568.log and verify 1.4.568 is published with the synced Canvas order fix",
  );
});

test("a distinct task-line or checklist item still wins over the status request", () => {
  expect(
    resolveMapCardTaskRow({
      goal,
      lineupTask: "Fixing the widget login",
      taskLine: goal,
      statusTask: "Check the release log and verify it is published",
    }),
  ).toBe("Fixing the widget login");
});

test("commands, paths, placeholders, and Goal repeats never become the Task", () => {
  for (const statusTask of [
    "npm run build -- --watch",
    "cd src && ls -la",
    "/home/endlessblink/project/src/main.ts",
    "Implement {feature}",
    "Working",
    goal,
    "Fix these issues, and the fact that I cant login to my KDE widget!",
  ]) {
    expect(resolveMapCardTaskRow({ goal, taskLine: goal, statusTask }), statusTask).toBeUndefined();
  }
});

test("a checklist item that merely matches the Goal still beats the placeholder", () => {
  expect(resolveMapCardTaskRow({ goal, lineupTask: goal })).toBe(goal);
  // ...and beats a status line, so tool output never displaces a bound plan task.
  expect(
    resolveMapCardTaskRow({
      goal: "LLM task extraction lane",
      lineupTask: "LLM task extraction lane",
      statusTask: "Running 2 tests using 1 worker",
    }),
  ).toBe("LLM task extraction lane");
});
