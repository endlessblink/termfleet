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

test("task identity uses task-tool before user prompt and sidecar todo", () => {
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

  expect(resolved).toMatchObject({ text: "Declared task tool item", source: "task-tool" });
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
