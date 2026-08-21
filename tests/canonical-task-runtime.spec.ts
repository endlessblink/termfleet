import { test, expect } from "@playwright/test";
import { acceptanceProgress, classifyTaskRun, lifecycleProgress, taskRunLabel, type TaskRunRecord } from "../src/lib/canonicalTaskRuntime";

const base: TaskRunRecord = {
  runId: "run-1", taskId: "TASK-18", mode: "termfleet", agent: "codex", startedAt: 1_000,
  heartbeatAt: 99_000, activityAt: 98_000, terminalPaneId: "pane-1", state: "running", logTail: [],
};

test.describe("canonical task runtime truth", () => {
  test("does not turn workflow status into a live worker", () => {
    expect(classifyTaskRun(undefined, 100_000)).toBe("missing");
    expect(taskRunLabel("missing")).toBe("No linked run");
  });

  test("requires a fresh heartbeat and recent activity for progress", () => {
    expect(classifyTaskRun(base, 100_000)).toBe("running-and-progressing");
    expect(classifyTaskRun({ ...base, activityAt: 1_000 }, 100_000)).toBe("running-but-idle");
    expect(classifyTaskRun({ ...base, heartbeatAt: 1_000 }, 100_000)).toBe("stale-heartbeat");
    expect(classifyTaskRun({ ...base, state: "finished" }, 100_000)).toBe("completed");
  });

  test("renders lifecycle and evidence progress without fabricating percentages", () => {
    expect(lifecycleProgress("IN PROGRESS")).toEqual({ current: "IN PROGRESS", completed: ["TRIAGE", "PLANNED"], next: "REVIEW", blocked: false });
    expect(lifecycleProgress("BLOCKED").blocked).toBe(true);
    expect(acceptanceProgress([{ complete: true }, { complete: false }]).label).toBe("1 of 2 acceptance items complete");
    expect(acceptanceProgress([]).label).toBe("Acceptance progress not recorded");
  });
});
