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

test("shows the user goal as Task and the active plan item as Now Active", () => {
  const header = buildTerminalHeaderState({
    paneId: "pane-events",
    terminalId: "pty-events",
    runId: "run-events",
    project: { id: "g-courses", name: "bina-meatzevet-courses", projectRoot: "/repo/courses" },
    liveCwd: "/repo/courses",
    terminalStatus: "running",
    taskLineup: [{
      id: "task-cardcom",
      content: "Testing the revised Cardcom-only flow",
      status: "in_progress",
      source: "todo-write",
      updatedAt: 1000,
      runId: "run-events",
    }],
    mainUserAsk: {
      text: "[Image #1] also when editing the existing event I dont see שמור וצפה - [Image #2]",
      source: "status-sidecar",
      updatedAt: 1000,
      runId: "run-before-tests",
    },
    statusSummary: {
      task: "Testing the revised Cardcom-only flow",
      userTask: "[Image #1] also when editing the existing event I dont see שמור וצפה - [Image #2]",
      path: "/repo/courses",
      now: "Testing the revised Cardcom-only flow",
      status: "working",
      provider: "codex",
      confidence: "high",
      tasksFromTodoWrite: true,
    },
  });

  expect(header.goalLabel).toBe("when editing the existing event I dont see שמור וצפה");
  expect(header.currentActivity).toBe("Testing the revised Cardcom-only flow");
  expect(header.sources.goal).toBe("user-prompt");
});

test("makes the pane work area clear at a glance", () => {
  const header = buildTerminalHeaderState({
    paneId: "pane-live-events",
    terminalId: "pty-live-events",
    runId: "run-live-events",
    project: { id: "g-courses", name: "bina-meatzevet-courses", projectRoot: "/repo/courses" },
    liveCwd: "/repo/courses",
    terminalStatus: "running",
    taskLineup: [{
      id: "task-routes",
      content: "Changing the live-event routes",
      status: "in_progress",
      source: "todo-write",
      updatedAt: 1000,
      runId: "run-live-events",
    }],
    mainUserAsk: {
      text: "it must be clear to me the user in a glance",
      source: "status-sidecar",
      updatedAt: 1000,
      runId: "conversation-live-events",
    },
    statusSummary: {
      task: "Changing the live-event routes",
      userTask: "the rest is good",
      path: "/repo/courses",
      now: "Changing the live-event routes",
      status: "working",
      provider: "codex",
      confidence: "high",
      tasksFromTodoWrite: true,
    },
  });

  expect(header.goalLabel).toBe("Making pane work areas clear at a glance");
  expect(header.currentActivity).toBe("Changing the live-event routes");
});

test("keeps a pane-keyed user goal after reload before live sidecar status returns", () => {
  const header = buildTerminalHeaderState({
    paneId: "pane-events",
    terminalId: "pty-events",
    runId: "run-after-reload",
    project: { id: "g-courses", name: "bina-meatzevet-courses", projectRoot: "/repo/courses" },
    liveCwd: "/repo/courses",
    terminalStatus: "running",
    taskLineup: [{
      id: "task-design",
      content: "Redesigning it for clear admin decisions",
      status: "in_progress",
      source: "todo-write",
      updatedAt: 1000,
      runId: "run-after-reload",
    }],
    mainUserAsk: {
      text: "Review the refund settings so they are clearer for admins",
      source: "status-sidecar",
      updatedAt: 1000,
      runId: "run-before-reload",
    },
  });

  expect(header.goalLabel).toBe("Review the refund settings so they are clearer for admins");
  expect(header.currentActivity).toBe("Redesigning it for clear admin decisions");
});

test("keeps typed shell asks isolated when they belong to another run", () => {
  const header = buildTerminalHeaderState({
    paneId: "pane-b",
    terminalId: "pty-b",
    runId: "run-b",
    project: { id: "g-flow", name: "flow-state", projectRoot: "/repo/flow-state" },
    liveCwd: "/repo/flow-state",
    terminalStatus: "running",
    mainUserAsk: {
      text: "Fix terminal headers in termfleet",
      source: "terminal-prompt",
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

test("marks sidecar-captured user goals as user prompts instead of none", () => {
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
  expect(header.sources.goal).toBe("user-prompt");
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
