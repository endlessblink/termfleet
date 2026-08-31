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

test("keeps missing goal as state instead of rendering it as task content", () => {
  const header = buildTerminalHeaderState({
    paneId: "pane-missing-goal",
    terminalId: "pty-missing-goal",
    project: { id: "g-termfleet", name: "termfleet", projectRoot: termfleetPath },
    liveCwd: termfleetPath,
    terminalStatus: "running",
    taskLineup: [],
    statusSummary: {
      task: "Ready",
      path: termfleetPath,
      now: "Awaiting command",
      status: "idle",
      provider: "shell",
      confidence: "low",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.hasCapturedGoal).toBe(false);
  expect(header.hasCapturedContext).toBe(false);
  expect(header.sources.goal).toBe("none");
  expect(header.currentActivity).toBe("Idle — no work is running");
});

test("does not promote a status-sidecar request into the pane Goal", () => {
  const header = buildTerminalHeaderState({
    paneId: "pane-task-derived-goal",
    terminalId: "pty-task-derived-goal",
    project: { id: "g-flow", name: "flow-state", projectRoot: "/repo/flow-state" },
    liveCwd: "/repo/flow-state",
    terminalStatus: "running",
    statusSummary: {
      task: "Running test suite",
      userTask: "works. commit and push and create regression tests",
      path: "/repo/flow-state",
      now: "Idle",
      status: "idle",
      provider: "codex",
      confidence: "high",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.goalLabel).not.toBe("works. commit and push and create regression tests");
  expect(header.hasCapturedContext).toBe(false);
});

test("uses the view model Now value instead of the generic title", () => {
  const header = buildTerminalHeaderState({
    paneId: "pane-now-source",
    terminalId: "pty-now-source",
    project: { id: "g-termfleet", name: "termfleet", projectRoot: termfleetPath },
    liveCwd: termfleetPath,
    terminalStatus: "running",
    mainUserAsk: {
      text: "Keep every terminal status truthful and connected to its work",
      source: "status-sidecar",
      updatedAt: 1000,
    },
    taskLineup: [{
      id: "current-step",
      content: "Running the live map source checks",
      status: "in_progress",
      source: "todo-write",
      updatedAt: 1000,
    }],
    statusSummary: {
      task: "Running the live map source checks",
      userTask: "Keep every terminal status truthful and connected to its work",
      path: termfleetPath,
      now: "Running the live map source checks",
      status: "working",
      provider: "codex",
      confidence: "high",
      tasksFromTodoWrite: true,
    },
  });

  expect(header.currentActivity).toBe("Running the live map source checks");
  expect(header.currentActivity).not.toBe("Activity not captured");
});

test("uses the captured goal as project intent when no separate context exists", () => {
  const header = buildTerminalHeaderState({
    paneId: "pane-goal-fallback",
    terminalId: "pty-goal-fallback",
    runId: "run-goal-fallback",
    project: { id: "g-termfleet", name: "termfleet", projectRoot: termfleetPath },
    liveCwd: termfleetPath,
    terminalStatus: "running",
    mainUserAsk: {
      text: "Harden agent persistence and startup boundaries",
      source: "terminal-prompt",
      updatedAt: 1000,
      runId: "run-goal-fallback",
    },
    statusSummary: {
      task: "Hardening agent, persistence, resource, and startup boundaries",
      path: termfleetPath,
      now: "Working",
      status: "working",
      provider: "codex",
      confidence: "high",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.contextLabel).toBe("Harden agent persistence and startup boundaries");
  expect(header.sources.context).toBe("user-prompt");
  expect(header.contextLabel).not.toMatch(/not captured/i);
});

test("uses a goal-task sidecar value for Goal even when the active task is separate", () => {
  const header = buildTerminalHeaderState({
    paneId: "pane-jobrunner-goal",
    terminalId: "pty-jobrunner-goal",
    runId: "run-jobrunner-goal",
    project: { id: "g-jobrunner", name: "jobrunner", projectRoot: "/repo/jobrunner" },
    liveCwd: "/repo/jobrunner",
    terminalStatus: "running",
    taskLineup: [
      {
        id: "step",
        content: "Audit the current browser boundary and application contracts",
        status: "in_progress",
        source: "todo-write",
        updatedAt: 1000,
      },
    ],
    statusSummary: {
      task: "Audit the current browser boundary and application contracts",
      userTask: "Build and verify a reliable job-application system for Noam",
      path: "/repo/jobrunner",
      now: "Working",
      status: "working",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: true,
    },
  });

  expect(header.goalLabel).toBe("Audit the current browser boundary and application contracts");
  expect(header.contextLabel).toBe("Build and verify a reliable job-application system for Noam");
  expect(header.sources.context).not.toBe("missing");
});

test("keeps a pane Goal stable while transient task status changes", () => {
  const base = {
    paneId: "pane-stable-goal",
    terminalId: "terminal-stable-goal",
    project: { id: "g-termfleet", name: "termfleet", projectRoot: termfleetPath },
    liveCwd: termfleetPath,
    terminalStatus: "running" as const,
  };
  const first = buildTerminalHeaderState({
    ...base,
    mainUserAsk: {
      text: "Keep agent terminals connected after relaunch so work can resume safely",
      source: "status-sidecar",
      updatedAt: 1000,
    },
    statusSummary: {
      task: "Checking the relaunch behavior",
      path: termfleetPath,
      now: "Reading the current session",
      status: "working",
      provider: "codex",
      confidence: "high",
      tasksFromTodoWrite: false,
    },
  });
  const second = buildTerminalHeaderState({
    ...base,
    statusSummary: {
      task: "Running a different verification step",
      path: termfleetPath,
      now: "Waiting for the next command",
      status: "idle",
      provider: "codex",
      confidence: "high",
      tasksFromTodoWrite: false,
    },
  });

  expect(first.contextLabel).toBe(
    "Keep agent terminals connected after relaunch so work can resume safely",
  );
  expect(second.contextLabel).toBe(first.contextLabel);
});

test("accepts a quality-checked opening purpose as that pane's Goal", () => {
  const header = buildTerminalHeaderState({
    paneId: "pane-opening-purpose",
    terminalId: "terminal-opening-purpose",
    project: { id: "g-termfleet", name: "termfleet", projectRoot: termfleetPath },
    liveCwd: termfleetPath,
    terminalStatus: "running",
    statusSummary: {
      mainTask: "Keep every agent terminal connected after relaunch so work can be resumed safely",
      mainTaskSource: "opening-request",
      task: "Tracing the relaunch behavior",
      path: termfleetPath,
      now: "Reading the current session",
      status: "working",
      provider: "codex",
      confidence: "high",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.contextLabel).toBe(
    "Keep every agent terminal connected after relaunch so work can be resumed safely",
  );
  expect(header.hasCapturedContext).toBe(true);
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
  // TC-060 R1: never blank — the header falls back to a true state line.
  expect(header.goalLabel).not.toMatch(/task not captured/i);
  expect(header.goalLabel.length).toBeGreaterThan(0);
  expect(header.currentActivity).toBe("Idle");
  expect(header.fullPath).toBe("/repo/flow-state");
  // TC-060: no DECLARED task, but the row still carries a true fallback line.
  expect(header.sources.goal).toBe("task-line");
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

  // TC-060 R1: never blank — the header falls back to a true state line.
  expect(header.goalLabel).not.toMatch(/task not captured/i);
  expect(header.goalLabel.length).toBeGreaterThan(0);
  // A working pane says so. "Activity not captured" reads as breakage and tells
  // the operator nothing about a terminal that is visibly busy.
  expect(header.currentActivity).toBe("Working");
  // TC-060: no DECLARED task, but the row still carries a true fallback line.
  expect(header.sources.goal).toBe("task-line");
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

test("keeps a stored opening request visible through the full header pipeline", () => {
  const opening = "can we enhanc lean-ctx? I am using many codex and claude sessions at any given moment";
  const header = buildTerminalHeaderState({
    paneId: "pane-opening-request",
    terminalId: "pty-opening-request",
    project: {
      id: "g-cc-linux-enhancments",
      name: "cc-linux-enhancments",
      projectRoot: "/media/endlessblink/data/my-projects/ai-development/cc-linux-enhancments",
    },
    liveCwd: "/media/endlessblink/data/my-projects/ai-development/cc-linux-enhancments",
    terminalStatus: "running",
    mainUserAsk: {
      text: "/done",
      source: "status-sidecar",
      updatedAt: 1,
    },
    statusSummary: {
      task: "Ready",
      path: "/media/endlessblink/data/my-projects/ai-development/cc-linux-enhancments",
      now: "Awaiting command",
      status: "idle",
      provider: "codex",
      confidence: "high",
      tasksFromTodoWrite: false,
    },
    taskLine: {
      text: opening,
      source: "opening-request",
      capturedAt: 1,
      expiresAt: null,
    },
  });

  expect(header.goalLabel).toBe(opening);
  expect(header.hasCapturedGoal).toBe(true);
});

test("recovers an opening request from persisted status after a run rollover", () => {
  const opening = "Fix the cockpit labels and keep the real request visible";
  const header = buildTerminalHeaderState({
    paneId: "pane-status-opening",
    terminalId: "pty-status-opening",
    runId: "run-after-restart",
    project: { id: "g-termfleet", name: "termfleet", projectRoot: termfleetPath },
    liveCwd: termfleetPath,
    terminalStatus: "running",
    statusSummary: {
      task: "Ready",
      userTask: opening,
      mainTask: opening,
      mainTaskSource: "opening-request",
      path: termfleetPath,
      now: "Awaiting command",
      status: "idle",
      provider: "codex",
      confidence: "high",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.goalLabel).toBe(opening);
  expect(header.hasCapturedGoal).toBe(true);
  expect(header.sources.goal).toBe("user-prompt");
});

test("does not promote a screenshot path instruction into the Task row", () => {
  const header = buildTerminalHeaderState({
    paneId: "pane-screenshot-instruction",
    terminalId: "pty-screenshot-instruction",
    project: { id: "g", name: "rough-cut-mvp", projectRoot: "/repo/rough-cut-mvp" },
    liveCwd: "/repo/rough-cut-mvp",
    terminalStatus: "running",
    mainUserAsk: {
      text: "Inspect the local screenshot /tmp/rough-cut-proof-current-goal.png only. Return text only.",
      source: "status-sidecar",
      updatedAt: 1,
    },
    statusSummary: {
      task: "Ready",
      path: "/repo/rough-cut-mvp",
      now: "Awaiting command",
      status: "idle",
      provider: "codex",
      confidence: "high",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.hasCapturedGoal).toBe(false);
  expect(header.goalLabel).not.toContain("/tmp/");
});

test("a durable opening request carried by task-line also supplies Goal", () => {
  const opening = "Keep the assistant's answers clear and complete for people returning later";
  const header = buildTerminalHeaderState({
    paneId: "pane-task-line-goal",
    terminalId: "pty-task-line-goal",
    project: { id: "g", name: "hermes", projectRoot: "/repo/hermes" },
    liveCwd: "/repo/hermes",
    terminalStatus: "running",
    taskLine: {
      text: opening,
      source: "opening-request",
      capturedAt: 1,
      expiresAt: null,
    },
  });

  expect(header.goalLabel).toBe(opening);
  expect(header.contextLabel).toBe(opening);
  expect(header.sources.goal).toBe("task-line");
  expect(header.hasCapturedGoal).toBe(true);
});

test("captured task with generic working activity keeps an honest status title", () => {
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
  expect(header.currentActivity).toBe("Working");
  expect(header.sources.activity).toBe("task-tool");
});
