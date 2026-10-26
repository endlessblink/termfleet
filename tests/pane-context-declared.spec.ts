import { expect, test } from "@playwright/test";
import { plainActivity, presentPaneGoal, presentPaneNow, presentPaneTask } from "../src/lib/paneContextPresentation";
import type { WorkstreamStatusSummary } from "../src/lib/types";

const agent = (extra: Partial<WorkstreamStatusSummary>): WorkstreamStatusSummary => ({
  task: "x", path: "/p", now: "Working", status: "working", provider: "claude", ...extra,
});

test("TF-091: an agent card shows only a declared Goal and Task", () => {
  const guessed = agent({ mainTask: "the app was killed and I dont see it now how I activate it", mainTaskSource: "opening-request", userTask: "unclear what this task is" });
  expect(presentPaneGoal({ summary: guessed }).text).toBe("");
  expect(presentPaneTask(guessed, "Stopping work here; the new instance continues")).toBe("No task yet");
  const declared = agent({ statedGoal: "Make the Desk answer quickly", statedTask: "Updating the handoff" });
  expect(presentPaneGoal({ summary: declared }).text).toBe("Make the Desk answer quickly");
  expect(presentPaneTask(declared, "ignored")).toBe("Updating the handoff");
  // Shell panes keep their own ladder.
  expect(presentPaneTask({ ...declared, provider: undefined }, "Shell task")).toBe("Shell task");
});

test("TF-091: Now is the live action in plain words", () => {
  expect(plainActivity("Editing MagicCanvas.tsx")).toBe("Editing code");
  expect(plainActivity("Using mcp__lean-ctx__ctx_shell")).toBe("Running a command");
  const at = Date.now();
  expect(presentPaneNow({ attention: "working" as never, reportedNow: "Reading notes.md", reportedStatus: "working", reportedAt: at, screen: "Still waiting for the new session", screenAt: at, now: at })).toBe("Reading files");
  expect(presentPaneNow({ attention: "waiting" as never })).toBe("Waiting for you");
});
