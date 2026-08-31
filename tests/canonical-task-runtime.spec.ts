import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { acceptanceProgress, boundedRunLog, classifyTaskRun, lifecycleProgress, linkedTaskRun, taskRunLabel, type TaskRunRecord } from "../src/lib/canonicalTaskRuntime";

const base: TaskRunRecord = {
  runId: "run-1", taskId: "TASK-18", mode: "termfleet", agent: "codex", startedAt: 1_000,
  heartbeatAt: 99_000, activityAt: 98_000, terminalPaneId: "pane-1", state: "running", logTail: [],
};

test.describe("canonical task runtime truth", () => {
  test("does not turn workflow status into a live worker", () => {
    expect(classifyTaskRun(undefined, 100_000)).toBe("no-worker");
    expect(taskRunLabel("no-worker")).toBe("No worker linked");
    expect(classifyTaskRun(undefined, 100_000, null)).toBe("claimed-not-running");
    expect(taskRunLabel("claimed-not-running")).toBe("Claimed · not running");
    expect(classifyTaskRun(undefined, 100_000, "missing-run")).toBe("disconnected");
  });

  test("requires a fresh heartbeat and recent activity for progress", () => {
    expect(classifyTaskRun(base, 100_000, base.runId)).toBe("running-and-progressing");
    expect(classifyTaskRun({ ...base, activityAt: 1_000 }, 100_000, base.runId)).toBe("running-but-idle");
    expect(classifyTaskRun({ ...base, heartbeatAt: 1_000 }, 100_000, base.runId)).toBe("stale-heartbeat");
    expect(classifyTaskRun({ ...base, state: "finished" }, 100_000, base.runId)).toBe("completed");
    expect(classifyTaskRun({ ...base, state: "failed" }, 100_000, base.runId)).toBe("failed");
    expect(classifyTaskRun({ ...base, state: "starting", heartbeatAt: 1_000 }, 100_000, base.runId)).toBe("failed-launch");
    expect(classifyTaskRun({ ...base, terminalPaneId: undefined, heartbeatAt: 1_000 }, 100_000, base.runId)).toBe("orphaned");
    expect(linkedTaskRun([{ ...base, runId: "old" }, base], base.runId)).toBe(base);
    expect(linkedTaskRun([base], "unknown")).toBeUndefined();
  });

  test("renders lifecycle and evidence progress without fabricating percentages", () => {
    expect(lifecycleProgress("IN PROGRESS")).toEqual({ current: "IN PROGRESS", completed: ["TRIAGE", "PLANNED"], next: "REVIEW", blocked: false });
    expect(lifecycleProgress("BLOCKED").blocked).toBe(true);
    expect(acceptanceProgress([{ complete: true }, { complete: false }]).label).toBe("1 of 2 acceptance items complete");
    expect(acceptanceProgress([]).label).toBe("Acceptance progress not recorded");
    expect(boundedRunLog(["token=shh", "x".repeat(500)]).length).toBe(2);
    expect(boundedRunLog(["token=shh"])[0]).toBe("token=[REDACTED]");
  });

  test("uses the desktop runtime registry instead of UI-only storage", () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), "src/lib/canonicalTaskRuntime.ts"), "utf8");
    expect(source).toContain('invoke<string>("task_run_registry_read")');
    expect(source).toContain('invoke("task_run_registry_write"');
    expect(source).toContain("export async function registerTaskRun");
    expect(source).toContain("export async function heartbeatTaskRun");
    const pollSource = fs.readFileSync(path.resolve(process.cwd(), "src/lib/statusPollLoop.ts"), "utf8");
    expect(pollSource).toContain("syncCanonicalRunHeartbeat");
    const boardSource = fs.readFileSync(path.resolve(process.cwd(), "src/components/CanonicalAgentBoard.tsx"), "utf8");
    expect(boardSource).toContain("claimCanonicalTask");
    expect(boardSource).toContain("Launch agent");
  });

  test("rate-limits persistent heartbeats so status polling does not write every tick", () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), "src/lib/canonicalTaskRuntime.ts"), "utf8");
    expect(source).toContain("lastHeartbeatWriteByRun");
    expect(source).toContain("HEARTBEAT_WRITE_MIN_INTERVAL_MS = 15_000");
    expect(source).toMatch(/if \(now - lastWrite < HEARTBEAT_WRITE_MIN_INTERVAL_MS\) return undefined;/);
  });
});
