import { expect, test } from "@playwright/test";
import { autoRecoveryDecision, shouldAutoRecoverAgent } from "../src/lib/terminalAutoRecovery";

test("recovers an agent that exited while a task was still active", () => {
  expect(shouldAutoRecoverAgent({
    provider: "codex",
    taskStatuses: ["in_progress"],
    terminalStatus: "working",
  })).toBe(true);
  expect(shouldAutoRecoverAgent({
    provider: "claude",
    taskStatuses: [],
    workstreamStatus: "running",
  })).toBe(true);
});

test("does not restart completed agents or ordinary shells", () => {
  expect(shouldAutoRecoverAgent({
    provider: "codex",
    taskStatuses: ["completed"],
    terminalStatus: "done",
    workstreamStatus: "done",
  })).toBe(false);
  expect(shouldAutoRecoverAgent({
    provider: "shell",
    taskStatuses: ["in_progress"],
    terminalStatus: "working",
  })).toBe(false);
});

test("does not restart an agent after an explicit manual stop", () => {
  expect(autoRecoveryDecision({
    provider: "codex",
    taskStatuses: ["in_progress"],
    terminalStatus: "working",
    manuallyStopped: true,
  })).toEqual({ recover: false, reason: "manual-stop" });
});
