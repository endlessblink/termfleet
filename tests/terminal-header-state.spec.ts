import { expect, test } from "@playwright/test";
import { buildTerminalHeaderState } from "../src/lib/terminalHeaderState";

const termfleetPath = "/media/endlessblink/data/my-projects/ai-development/devops/termfleet";

test("builds explicit per-pane header state with stable goal, activity, and full path", () => {
  const header = buildTerminalHeaderState({
    paneId: "pane-a",
    terminalId: "pty-a",
    runId: "run-a",
    project: { id: "g-termfleet", name: "termfleet", projectRoot: termfleetPath },
    liveCwd: termfleetPath,
    terminalStatus: "running",
    mainUserAsk: {
      text: "Make terminal task descriptions stable and readable",
      source: "terminal-prompt",
      updatedAt: 1000,
      runId: "run-a",
    },
    statusSummary: {
      task: "Explaining this codebase",
      userTask: "Explaining this codebase",
      path: "devops/termfleet",
      now: "Reading terminal output",
      status: "working",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: false,
    },
  });

  expect(header).toMatchObject({
    paneId: "pane-a",
    terminalId: "pty-a",
    runId: "run-a",
    workspace: "termfleet",
    userGoal: "Make terminal task descriptions stable and readable",
    currentActivity: "Reading terminal output",
    fullPath: termfleetPath,
    status: "working",
    sources: {
      workspace: "workspace",
      goal: "user-prompt",
      activity: "status-summary",
      path: "live-cwd",
    },
  });
  expect(header.debug.titleUsesDistinctActivity).toBe(true);
});

test("keeps panes isolated when a stored goal belongs to another run", () => {
  const header = buildTerminalHeaderState({
    paneId: "pane-b",
    terminalId: "pty-b",
    runId: "run-b",
    project: { id: "g-flow", name: "flow-state", projectRoot: "/repo/flow-state" },
    liveCwd: "/repo/flow-state",
    terminalStatus: "running",
    mainUserAsk: {
      text: "Fix terminal headers in termfleet",
      source: "status-sidecar",
      updatedAt: 1000,
      runId: "run-a",
    },
    statusSummary: {
      task: "Ready",
      path: "/repo/flow-state",
      now: "Awaiting command",
      status: "idle",
      provider: "shell",
      confidence: "low",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.paneId).toBe("pane-b");
  expect(header.workspace).toBe("flow-state");
  expect(header.userGoal).toBeNull();
  expect(header.goalLabel).toBe("Task not captured");
  expect(header.currentActivity).toBe("Idle");
  expect(header.fullPath).toBe("/repo/flow-state");
  expect(header.sources.goal).toBe("missing");
});

test("marks active terminals without structured task or activity as capture failures", () => {
  const header = buildTerminalHeaderState({
    paneId: "pane-missing",
    terminalId: "pty-missing",
    runId: "run-missing",
    project: { id: "g-termfleet", name: "termfleet", projectRoot: termfleetPath },
    liveCwd: termfleetPath,
    terminalStatus: "running",
    statusSummary: {
      task: "Ready",
      path: termfleetPath,
      now: "Awaiting command",
      status: "working",
      provider: "shell",
      confidence: "low",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.goalLabel).toBe("Task not captured");
  // A working pane says so. "Activity not captured" reads as breakage and tells
  // the operator nothing about a terminal that is visibly busy.
  expect(header.currentActivity).toBe("Working");
  expect(header.sources.goal).toBe("missing");
});

test("marks sidecar task rows as sidecar sourced instead of none", () => {
  const header = buildTerminalHeaderState({
    paneId: "pane-hermes",
    terminalId: "pty-hermes",
    runId: "run-hermes",
    project: { id: "g-hermes", name: "hermes", projectRoot: "/repo/hermes" },
    liveCwd: "/repo/hermes",
    terminalStatus: "running",
    neutralTitle: "Working",
    mainUserAsk: {
      text: "Included in debug-share bundles with the existing redaction path",
      source: "status-sidecar",
      updatedAt: 1000,
    },
    statusSummary: {
      task: "Included in debug-share bundles with the existing redaction path",
      path: "/repo/hermes",
      now: "npm test",
      status: "working",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.goalLabel).toBe("Included in debug-share bundles with the existing redaction path");
  expect(header.currentActivity).toBe("Checking debug-share bundle redaction path");
  expect(header.userGoal).toBe("Included in debug-share bundles with the existing redaction path");
  expect(header.sources.goal).toBe("sidecar-todo");
  expect(header.sources.goal).not.toBe("none");
});

test("keeps real task-list activity ahead of fallback status wording", () => {
  const header = buildTerminalHeaderState({
    paneId: "pane-c",
    terminalId: "pty-c",
    runId: "run-c",
    project: { id: "g-flow", name: "flow-state", projectRoot: "/repo/flow-state" },
    liveCwd: "/repo/flow-state",
    terminalStatus: "running",
    statusSummary: {
      task: "Verifying the KDE widget guard",
      path: "productivity/flow-state",
      now: "income-zen",
      status: "working",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: true,
      tasks: [{ id: "task-1", text: "Verifying the KDE widget guard", status: "in_progress" }],
    },
    summary: {
      task: "Needs attention",
      path: "/repo/flow-state",
      now: "Needs attention",
      status: "blocked",
      provider: "shell",
      confidence: "low",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.goalLabel).toBe("Verifying the KDE widget guard");
  // New contract: no "Activity not captured" (reads as breakage) — an uncaptured
  // step shows the honest status word; the "missing" source still marks the gap.
  expect(header.currentActivity).toBe("Awaiting next action");
  expect(header.sources.goal).toBe("sidecar-todo");
  expect(header.sources.activity).toBe("status-summary");
});

test("captured task with generic working activity becomes explicit capture failure", () => {
  const header = buildTerminalHeaderState({
    paneId: "pane-working",
    terminalId: "pty-working",
    runId: "run-working",
    project: { id: "g-termfleet", name: "termfleet", projectRoot: termfleetPath },
    liveCwd: termfleetPath,
    terminalStatus: "running",
    taskLineup: [{
      id: "task-echo",
      content: "Gate Now Active echo failures",
      status: "in_progress",
      source: "todo-write",
      updatedAt: 1000,
    }],
    statusSummary: {
      task: "Working",
      path: termfleetPath,
      now: "Working",
      status: "working",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: true,
    },
    neutralTitle: "Working",
  });

  expect(header.goalLabel).toBe("Gate Now Active echo failures");
  // New contract: honest status word instead of "Activity not captured".
  expect(header.currentActivity).toBe("Awaiting next action");
  expect(header.sources.activity).toBe("task-tool");
});
