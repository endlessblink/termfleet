import { expect, test } from "@playwright/test";
import { resolveMapCardTaskRow } from "../src/lib/terminalHeaderState";

// TF-089 (2026-10-08): a Claude chat with no task-list tool read Goal = opening ask,
// Task = "Task not captured". Every candidate repeated the Goal, and the pane's latest
// request and the agent's own narrated step were never tried.
const goal =
  "several terminals werent restored after the latest pc restart. content-creation and I thinkl another one";

test("the latest request fills the Task row when every other candidate repeats the Goal", () => {
  expect(
    resolveMapCardTaskRow({
      goal,
      taskLine: goal,
      statusTask: goal,
      latestRequest: "check whether more terminals were not restored either",
      narration: "Logging this in the issue tracker before I fix the cause.",
    }),
  ).toBe("check whether more terminals were not restored either");
});

test("the agent's narrated step fills the Task row when there is no distinct request", () => {
  expect(
    resolveMapCardTaskRow({
      goal,
      taskLine: goal,
      statusTask: goal,
      latestRequest: goal,
      narration: "Logging this in the issue tracker before I fix the cause.",
    }),
  ).toBe("Logging this in the issue tracker before I fix the cause.");
});

test("a declared checklist item still wins over both fallbacks", () => {
  expect(
    resolveMapCardTaskRow({
      goal,
      lineupTask: "Reopening the missing chats in their own folders",
      taskLine: goal,
      latestRequest: "check whether more terminals were not restored either",
      narration: "Logging this in the issue tracker before I fix the cause.",
    }),
  ).toBe("Reopening the missing chats in their own folders");
});

test("nothing known still yields no Task text, so the card keeps its honest placeholder", () => {
  expect(resolveMapCardTaskRow({ goal, taskLine: goal, statusTask: goal })).toBeUndefined();
});
