import { expect, test } from "@playwright/test";
import { resolveTaskIdentity, TASK_NOT_CAPTURED } from "../src/lib/taskIdentity";
import { buildShellTerminalHeaderViewModel } from "../src/lib/terminalHeaderViewModel";
import { visibleTaskLineup } from "../src/lib/taskLineup";

test("task identity follows bounded source precedence", () => {
  const resolved = resolveTaskIdentity({
    activeRunId: "run-1",
    mainUserAsk: {
      text: "Manual operator task",
      source: "manual",
      updatedAt: 2,
      runId: "run-1",
    },
    taskLineup: [{
      id: "todo-1",
      content: "Task tool task",
      status: "in_progress",
      source: "todo-write",
      updatedAt: 1,
    }],
    planBindingTitle: "Plan binding task",
    planBindingSource: "task-binding",
    statusSummary: {
      task: "Model summary task",
      path: "/repo",
      now: "Model now",
      status: "working",
      provider: "codex",
      confidence: "high",
      tasksFromTodoWrite: true,
    },
    workstreamTitle: "Workstream task",
  });

  expect(resolved).toMatchObject({ text: "Manual operator task", source: "manual" });
});

test("meaningful user prompt owns Task ahead of the active plan item", () => {
  const resolved = resolveTaskIdentity({
    activeRunId: "run-1",
    mainUserAsk: {
      text: "User prompt task",
      source: "terminal-prompt",
      updatedAt: 2,
      runId: "run-1",
    },
    taskLineup: [{
      id: "todo-1",
      content: "Declared task tool item",
      status: "in_progress",
      source: "todo-write",
      updatedAt: 1,
    }],
    statusSummary: {
      task: "Sidecar task",
      path: "/repo",
      now: "Working",
      status: "working",
      provider: "codex",
      confidence: "high",
      tasksFromTodoWrite: true,
    },
  });

  expect(resolved).toMatchObject({ text: "User prompt task", source: "user-prompt" });
});

test("vague follow-up falls back to the active plan item", () => {
  const resolved = resolveTaskIdentity({
    activeRunId: "run-1",
    mainUserAsk: {
      text: "continue",
      source: "status-sidecar",
      updatedAt: 2,
      runId: "run-1",
    },
    taskLineup: [{
      id: "todo-1",
      content: "Declared task tool item",
      status: "in_progress",
      source: "todo-write",
      updatedAt: 1,
      runId: "run-1",
    }],
  });

  expect(resolved).toMatchObject({ text: "Declared task tool item", source: "task-tool" });
});

test("a scoped plan item supplies the work area for a local visual edit", () => {
  const resolved = resolveTaskIdentity({
    activeRunId: "run-live-page",
    mainUserAsk: {
      text: "leave the divider and remove this brown line",
      source: "status-sidecar",
      updatedAt: 2,
      runId: "run-live-page",
    },
    taskLineup: [{
      id: "todo-live-page",
      content: "Removing the live-page error overlay while preserving top-of-page loading",
      status: "in_progress",
      source: "todo-write",
      updatedAt: 1,
      runId: "run-live-page",
    }],
  });

  expect(resolved).toMatchObject({
    text: "Removing the live-page error overlay while preserving top-of-page loading",
    source: "task-tool",
  });
});

test("latest meaningful user goal owns Task while the plan item remains activity", () => {
  const resolved = resolveTaskIdentity({
    activeRunId: "run-events",
    mainUserAsk: {
      text: "[Image #1] also when editing the existing event I dont see שמור וצפה - [Image #2]",
      source: "status-sidecar",
      updatedAt: 2,
      runId: "run-before-tests",
    },
    taskLineup: [{
      id: "todo-cardcom",
      content: "Testing the revised Cardcom-only flow",
      status: "in_progress",
      source: "todo-write",
      updatedAt: 1,
      runId: "run-events",
    }],
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

  expect(resolved).toMatchObject({
    text: "also when editing the existing event I dont see שמור וצפה -",
    source: "user-prompt",
  });
});

test("model and terminal summaries do not own the header task", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g", name: "repo", projectRoot: "/repo" },
    liveCwd: "/repo",
    terminalStatus: "running",
    taskLineup: [],
    statusSummary: {
      task: "Summarize terminal scrollback with Ollama",
      path: "/repo",
      now: "Reading terminal output",
      status: "working",
      provider: "codex",
      confidence: "high",
      tasksFromTodoWrite: false,
      narration: "Model thinks this is the task",
    },
  });

  expect(header.taskDescription.text).toBe(TASK_NOT_CAPTURED);
  expect(header.taskDescription.source).toBe("missing");
  expect(header.debug.taskIdentitySource).toBe("missing");
});

test("sidecar todo is bounded, but model-only status summary is not", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g", name: "repo", projectRoot: "/repo" },
    liveCwd: "/repo",
    terminalStatus: "running",
    taskLineup: [],
    statusSummary: {
      task: "Writing the provenance resolver",
      userTask: "Make task identity provenance-safe",
      path: "/repo",
      now: "Editing taskIdentity.ts",
      status: "working",
      provider: "codex",
      confidence: "high",
      tasksFromTodoWrite: true,
    },
  });

  expect(header.taskDescription.text).toBe("Make task identity provenance-safe");
  expect(header.taskDescription.source).toBe("sidecar-todo");
});

test("a durable sidecar goal outranks the current checklist step", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "hermes", name: "hermes", projectRoot: "/repo/hermes" },
    liveCwd: "/repo/hermes",
    terminalStatus: "running",
    taskLineup: [{
      id: "compact-controls",
      content: "Writing tests for the compact assistant controls",
      status: "in_progress",
      source: "todo-write",
      updatedAt: 1,
    }],
    statusSummary: {
      task: "Replacing the crowded Hermes Personal Assistant panel with on-demand controls",
      userTask: "Replacing the crowded Hermes Personal Assistant panel with on-demand controls",
      path: "/repo/hermes",
      now: "Writing tests for the compact assistant controls",
      status: "working",
      provider: "codex",
      confidence: "high",
      tasksFromTodoWrite: true,
    },
  });

  expect(header.taskDescription.text).toBe("Replacing the crowded Hermes Personal Assistant panel with on-demand controls");
  expect(header.title.text).toBe("Writing tests for the compact assistant controls");
});

test("a compact-controls checklist recovers the missing product purpose", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "hermes", name: "hermes", projectRoot: "/repo/hermes" },
    liveCwd: "/repo/hermes",
    terminalStatus: "running",
    taskLineup: [
      { id: "tests", content: "Writing tests for the compact assistant controls", status: "completed", source: "todo-write", updatedAt: 1 },
      { id: "ui", content: "Replacing the large panel with a strip and drawer", status: "in_progress", source: "todo-write", updatedAt: 2 },
      { id: "screen", content: "Checking the packaged Personal Assistant screen", status: "pending", source: "todo-write", updatedAt: 3 },
    ],
    statusSummary: {
      task: "Replacing the large panel with a strip and drawer",
      userTask: "go",
      path: "/repo/hermes",
      now: "Replacing the large panel with a strip and drawer",
      status: "working",
      provider: "codex",
      confidence: "high",
      tasksFromTodoWrite: true,
    },
  });

  expect(header.taskDescription.text).toBe("Replacing the crowded Hermes Personal Assistant panel with on-demand controls");
  expect(header.title.text).toBe("Replacing the large panel with a strip and drawer");
});

test("an email-consent checklist explains why every Bina path is being audited", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "bina", name: "bina-meatzevet-courses", projectRoot: "/repo/bina-meatzevet-courses" },
    liveCwd: "/repo/bina-meatzevet-courses",
    terminalStatus: "running",
    taskLineup: [
      { id: "find", content: "Finding every email signup and consent path", status: "in_progress", source: "todo-write", updatedAt: 1 },
      { id: "require", content: "Making email signup mandatory everywhere", status: "pending", source: "todo-write", updatedAt: 2 },
      { id: "test", content: "Testing every affected registration flow", status: "pending", source: "todo-write", updatedAt: 3 },
      { id: "publish", content: "Publishing the mandatory signup rule", status: "pending", source: "todo-write", updatedAt: 4 },
    ],
    statusSummary: {
      task: "Finding every email signup and consent path",
      path: "/repo/bina-meatzevet-courses",
      now: "Finding every email signup and consent path",
      status: "working",
      provider: "codex",
      confidence: "high",
      tasksFromTodoWrite: true,
    },
  });

  expect(header.taskDescription.text).toBe("Making email signup mandatory across every Bina registration flow");
  expect(header.title.text).toBe("Finding every email signup and consent path");
});

test("a Bina billing checklist keeps the customer repair visible during deployment", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "bina", name: "bina-meatzevet-courses", projectRoot: "/repo/bina-meatzevet-courses" },
    liveCwd: "/repo/bina-meatzevet-courses",
    terminalStatus: "running",
    taskLineup: [
      { id: "tests", content: "Writing safety tests for renewal failures", status: "completed", source: "todo-write", updatedAt: 1 },
      { id: "checkout", content: "Fixing callback order and parallel checkout safety", status: "completed", source: "todo-write", updatedAt: 2 },
      { id: "customers", content: "Refunding Lee and granting Levana the rest of July", status: "completed", source: "todo-write", updatedAt: 3 },
      { id: "deploy", content: "Deploying the fix and checking production", status: "in_progress", source: "todo-write", updatedAt: 4 },
    ],
    statusSummary: {
      task: "Deploying the fix and checking production",
      path: "/repo/bina-meatzevet-courses",
      now: "Deploying the fix and checking production",
      status: "working",
      provider: "codex",
      confidence: "high",
      tasksFromTodoWrite: true,
    },
  });

  expect(header.taskDescription.text).toBe("Making renewals and checkout safe while refunding Lee and granting Levana free July access");
  expect(header.title.text).toBe("Deploying the fix and checking production");
});

test("a sidecar checklist is the concise fallback when no main goal was declared", () => {
  const resolved = resolveTaskIdentity({
    taskLineup: [{
      id: "todo-1",
      content: "Mapping what each bot and topic is meant to do",
      status: "in_progress",
      source: "todo-write",
      updatedAt: 1,
    }],
    statusSummary: {
      task: "Mapping what each bot and topic is meant to do",
      path: "/repo",
      now: "Mapping what each bot and topic is meant to do",
      status: "working",
      provider: "codex",
      confidence: "high",
      tasksFromTodoWrite: true,
    },
  });

  expect(resolved).toMatchObject({
    text: "Mapping what each bot and topic is meant to do",
    source: "task-tool",
  });
});

test("sidecar todo text is not semantically rewritten by the header", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g", name: "repo", projectRoot: "/repo" },
    liveCwd: "/repo",
    terminalStatus: "running",
    taskLineup: [],
    statusSummary: {
      task: "still looking unclear serach gpt image",
      userTask: "still looking unclear serach gpt image",
      path: "/repo",
      now: "Working",
      status: "working",
      provider: "codex",
      confidence: "high",
      tasksFromTodoWrite: true,
    },
  });

  expect(header.taskDescription.text).toBe("still looking unclear serach gpt image");
  expect(header.taskDescription.text).not.toBe("Improve GPT Image prompting for the Rough Cut icon");
  expect(header.taskDescription.source).toBe("sidecar-todo");
});

test("inferred terminal purpose is activity context, not plan-binding task identity", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g", name: "repo", projectRoot: "/repo" },
    liveCwd: "/repo",
    terminalStatus: "running",
    taskLineup: [],
    contextPurposeTitle: "Check Hermes desktop service status",
    contextPurposeSource: "inferred",
    statusSummary: {
      task: "Ready",
      path: "/repo",
      now: "systemctl --user status hermes.service",
      status: "working",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.taskDescription.text).toBe(TASK_NOT_CAPTURED);
  expect(header.taskDescription.source).toBe("missing");
});

test("status summary cannot rescue missing task identity", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g", name: "repo", projectRoot: "/repo" },
    liveCwd: "/repo",
    terminalStatus: "running",
    taskLineup: [],
    statusSummary: {
      task: "Fix the sandbox test blocker by running Vitest with a temporary config",
      path: "/repo",
      now: "Vitest completed successfully with the temporary config",
      status: "done",
      provider: "codex",
      confidence: "high",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.taskDescription.text).toBe(TASK_NOT_CAPTURED);
  expect(header.taskDescription.source).toBe("missing");
});

test("task sidebar ignores operator and summary fallback items", () => {
  expect(visibleTaskLineup([
    {
      id: "operator-1",
      content: "Model extracted task",
      status: "in_progress",
      source: "operator",
      updatedAt: 1,
    },
    {
      id: "summary-1",
      content: "Summary extracted task",
      status: "pending",
      source: "summary",
      updatedAt: 2,
    },
  ], undefined)).toEqual([]);
});

test("plan binding beats sidecar todo when no manual, task-tool, or prompt exists", () => {
  const resolved = resolveTaskIdentity({
    planBindingTitle: "Review the release checklist",
    planBindingSource: "task-binding",
    statusSummary: {
      task: "Sidecar todo",
      path: "/repo",
      now: "Working",
      status: "working",
      provider: "codex",
      confidence: "high",
      tasksFromTodoWrite: true,
    },
  });

  expect(resolved).toMatchObject({ text: "Review the release checklist", source: "plan-binding" });
});
