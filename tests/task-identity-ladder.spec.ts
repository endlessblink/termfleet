import { expect, test } from "@playwright/test";
import { resolveTaskIdentity } from "../src/lib/taskIdentity";
import { resolvePaneTaskLine } from "../src/lib/taskLine";
import { buildTerminalHeaderState } from "../src/lib/terminalHeaderState";

const NOW = Date.parse("2026-07-22T12:00:00.000Z");

// TC-060 R1: with the ladder supplied, the placeholder is unreachable.
test("with no declared task, the ladder supplies the text instead of a placeholder", () => {
  const identity = resolveTaskIdentity({
    taskLine: resolvePaneTaskLine({
      now: NOW,
      facts: { operatorRequest: "sort the sidebar by name" },
    }),
  });
  expect(identity.text).toBe("sort the sidebar by name");
  expect(identity.source).toBe("task-line");
});

test("a shell pane is no longer starved of a description", () => {
  const identity = resolveTaskIdentity({
    taskLine: resolvePaneTaskLine({
      now: NOW,
      folder: "termfleet",
      branch: "main",
    }),
  });
  expect(identity.text).toBe(
    "Sitting at a command prompt in termfleet on main",
  );
  expect(identity.source).toBe("task-line");
});

test("the rendered header shows the ladder's line, not 'Task not captured'", () => {
  const header = buildTerminalHeaderState({
    paneId: "pane-1",
    terminalId: "pane-1",
    liveCwd: "/tmp/termfleet",
    taskLine: resolvePaneTaskLine({
      now: NOW,
      facts: { title: "Investigate e2e redirect to free content section" },
    }),
  });
  expect(header.goalLabel).toBe(
    "Investigate e2e redirect to free content section",
  );
  expect(header.goalLabel).not.toMatch(/task not captured/i);
});

test("without a ladder the old placeholder still stands (nothing silently invented)", () => {
  const header = buildTerminalHeaderState({
    paneId: "pane-2",
    terminalId: "pane-2",
    liveCwd: "/tmp/termfleet",
  });
  expect(header.goalLabel).toMatch(/task not captured|no active work/i);
});
