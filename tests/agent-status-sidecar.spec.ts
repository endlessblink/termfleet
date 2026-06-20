import { expect, test } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// TC-033: the Claude TodoWrite hook writes the agent's real todos to a sidecar,
// and the sidecar status worker reads them back as a summary — free, accurate, no
// model/CLI calls. End-to-end via subprocesses with an isolated XDG_DATA_HOME.

const ROOT = process.cwd();
const HOOK = path.join(ROOT, "scripts", "termfleet-claude-status-hook.mjs");
const WORKER = path.join(ROOT, "scripts", "agent-status-summary-sidecar.mjs");

function runNode(script: string, input: unknown, env: Record<string, string>) {
  return spawnSync("node", [script], {
    input: JSON.stringify(input),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

test("hook writes a sidecar and the worker turns it into a live summary", async () => {
  const dataHome = mkdtempSync(path.join(os.tmpdir(), "tf-status-"));
  const cwd = "/tmp/tf-demo-project";
  const env = { XDG_DATA_HOME: dataHome };

  // 1. Hook receives a Claude PostToolUse(TodoWrite) payload.
  const hookResult = runNode(HOOK, {
    hook_event_name: "PostToolUse",
    tool_name: "TodoWrite",
    session_id: "sess-1",
    cwd,
    tool_input: {
      todos: [
        { content: "Build the sidecar parser", status: "in_progress", activeForm: "Building the sidecar parser" },
        { content: "Write the regression test", status: "pending", activeForm: "Writing the regression test" },
        { content: "Read the worker contract", status: "completed", activeForm: "Reading the worker contract" },
      ],
    },
  }, env);
  expect(hookResult.status).toBe(0);

  // 2. The sidecar worker reads it back for a request carrying the same cwd.
  const workerResult = runNode(WORKER, {
    projectId: cwd,
    workstream: { path: cwd, provider: "shell" },
    heuristicCandidate: { task: "Shell ready", path: cwd, now: "Awaiting command", status: "idle", provider: "shell", confidence: "low" },
  }, env);
  expect(workerResult.status).toBe(0);
  const summary = JSON.parse(workerResult.stdout.trim());

  // `now` reflects the in-progress todo's active form.
  expect(summary.now).toBe("Building the sidecar parser");
  expect(summary.status).toBe("working");
  expect(summary.confidence).toBe("high");
  // The real todo list is present, status-encoded for termfleet's inferStatus.
  const texts = summary.tasks.map((t: { text: string }) => t.text);
  expect(texts).toContain("in-progress: Build the sidecar parser");
  expect(texts).toContain("Write the regression test");
  expect(texts).toContain("done: Read the worker contract");
  // The list came from a real Claude TodoWrite → flagged authoritative so the
  // consumer can render it as the `todo-write` source (not throwaway summary).
  expect(summary.tasksFromTodoWrite).toBe(true);
});

test("modern Task tools (TaskCreate/TaskUpdate) build a stateful task list", async () => {
  // Claude Code v2.1.142+ emits TaskCreate/TaskUpdate, NOT TodoWrite. The hook must
  // fold these (real captured payload shapes) into a stateful per-cwd list.
  const dataHome = mkdtempSync(path.join(os.tmpdir(), "tf-status-"));
  const cwd = "/tmp/tf-task-tools";
  const env = { XDG_DATA_HOME: dataHome };

  // TaskCreate: id is in tool_response.task.id; input has subject/activeForm (no id).
  runNode(HOOK, {
    tool_name: "TaskCreate", cwd, session_id: "s",
    tool_input: { subject: "Wire the hook", description: "d", activeForm: "Wiring the hook" },
    tool_response: { task: { id: "1", subject: "Wire the hook" } },
  }, env);
  runNode(HOOK, {
    tool_name: "TaskCreate", cwd, session_id: "s",
    tool_input: { subject: "Read the worker contract", description: "d", activeForm: "Reading the contract" },
    tool_response: { task: { id: "2", subject: "Read the worker contract" } },
  }, env);
  // TaskUpdate: taskId + status in tool_input.
  runNode(HOOK, {
    tool_name: "TaskUpdate", cwd, session_id: "s",
    tool_input: { taskId: "1", status: "in_progress" },
    tool_response: { success: true, taskId: "1" },
  }, env);
  runNode(HOOK, {
    tool_name: "TaskUpdate", cwd, session_id: "s",
    tool_input: { taskId: "2", status: "completed" },
    tool_response: { success: true, taskId: "2" },
  }, env);

  const workerResult = runNode(WORKER, {
    projectId: cwd, workstream: { path: cwd, provider: "shell" },
    heuristicCandidate: { task: "Shell ready", path: cwd, now: "Awaiting command", status: "idle", provider: "shell", confidence: "low" },
  }, env);
  const summary = JSON.parse(workerResult.stdout.trim());

  expect(summary.tasksFromTodoWrite).toBe(true);
  expect(summary.now).toBe("Wiring the hook"); // in-progress task's active form
  expect(summary.status).toBe("working");
  const texts = summary.tasks.map((t: { text: string }) => t.text);
  expect(texts).toContain("in-progress: Wire the hook");
  // A verb-first ("Read ...") item survives, marked done by status.
  expect(texts).toContain("done: Read the worker contract");
});

test("a non-task tool keeps the Task-tool list and only updates the now line", async () => {
  const dataHome = mkdtempSync(path.join(os.tmpdir(), "tf-status-"));
  const cwd = "/tmp/tf-task-livenow";
  const env = { XDG_DATA_HOME: dataHome };
  runNode(HOOK, {
    tool_name: "TaskCreate", cwd, session_id: "s",
    tool_input: { subject: "Ship it", activeForm: "Shipping it" },
    tool_response: { task: { id: "1", subject: "Ship it" } },
  }, env);
  runNode(HOOK, { tool_name: "Bash", cwd, tool_input: { command: "npm test" } }, env);
  const workerResult = runNode(WORKER, {
    projectId: cwd, workstream: { path: cwd, provider: "shell" },
    heuristicCandidate: { task: "Shell ready", path: cwd, now: "Awaiting command", status: "idle", provider: "shell", confidence: "low" },
  }, env);
  const summary = JSON.parse(workerResult.stdout.trim());
  expect(summary.now).toBe("Running: npm test");
  expect(summary.tasks.map((t: { text: string }) => t.text)).toContain("Ship it");
});

test("worktree cwd: hook keys the sidecar by the worktree path, not the main checkout", async () => {
  // Claude issue #64851: in a git worktree, payload.cwd is the MAIN checkout; the real
  // worktree path is in payload.worktree. The terminal's live cwd is the worktree, so
  // the sidecar must be keyed by it for the join to hit.
  const dataHome = mkdtempSync(path.join(os.tmpdir(), "tf-status-"));
  const mainCheckout = "/tmp/tf-main-repo";
  const worktree = "/tmp/tf-main-repo/.worktrees/feature";
  const env = { XDG_DATA_HOME: dataHome };
  runNode(HOOK, {
    tool_name: "TaskCreate", cwd: mainCheckout, worktree, session_id: "s",
    tool_input: { subject: "Do worktree work", activeForm: "Doing worktree work" },
    tool_response: { task: { id: "1", subject: "Do worktree work" } },
  }, env);
  // Worker looking up by the worktree path (what the live cwd resolves to) finds it.
  const hit = runNode(WORKER, {
    projectId: worktree, workstream: { path: worktree, provider: "shell" },
    heuristicCandidate: { task: "Shell ready", path: worktree, now: "Awaiting command", status: "idle", provider: "shell", confidence: "low" },
  }, env);
  expect(JSON.parse(hit.stdout.trim()).tasksFromTodoWrite).toBe(true);
  // Looking up by the MAIN checkout path does NOT (the bug would key it here).
  const miss = runNode(WORKER, {
    projectId: mainCheckout, workstream: { path: mainCheckout, provider: "shell" },
    heuristicCandidate: { task: "Shell ready", path: mainCheckout, now: "Awaiting command", status: "idle", provider: "shell", confidence: "low" },
  }, env);
  expect(JSON.parse(miss.stdout.trim()).tasksFromTodoWrite).toBeFalsy();
});

test("worker falls back to the heuristic when no sidecar exists for the cwd", async () => {
  const dataHome = mkdtempSync(path.join(os.tmpdir(), "tf-status-"));
  const result = runNode(WORKER, {
    projectId: "/tmp/no-sidecar-here",
    workstream: { path: "/tmp/no-sidecar-here", provider: "shell" },
    heuristicCandidate: { task: "Shell ready", path: "p", now: "Awaiting command", status: "idle", provider: "shell", confidence: "low" },
  }, { XDG_DATA_HOME: dataHome });
  expect(result.status).toBe(0);
  const summary = JSON.parse(result.stdout.trim());
  expect(summary.now).toBe("Awaiting command");
  expect(summary.confidence).toBe("low");
  // No real todo list → not flagged authoritative.
  expect(summary.tasksFromTodoWrite).toBeFalsy();
});

test("live-now: a tool call updates the activity and preserves the todo list", async () => {
  const dataHome = mkdtempSync(path.join(os.tmpdir(), "tf-status-"));
  const cwd = "/tmp/tf-demo-live";
  const env = { XDG_DATA_HOME: dataHome };

  // Todos established first.
  runNode(HOOK, {
    tool_name: "TodoWrite", cwd, session_id: "s",
    tool_input: { todos: [{ content: "Ship the feature", status: "in_progress", activeForm: "Shipping the feature" }] },
  }, env);
  // Then a Bash tool call updates "now" without TodoWrite.
  const hookResult = runNode(HOOK, { tool_name: "Bash", cwd, tool_input: { command: "npm run build && echo done" } }, env);
  expect(hookResult.status).toBe(0);

  const workerResult = runNode(WORKER, {
    projectId: cwd, workstream: { path: cwd, provider: "shell" },
    heuristicCandidate: { task: "Shell ready", path: cwd, now: "Awaiting command", status: "idle", provider: "shell", confidence: "low" },
  }, env);
  const summary = JSON.parse(workerResult.stdout.trim());
  expect(summary.now).toBe("Running: npm run build && echo done");
  // Todo list preserved across the non-TodoWrite call.
  expect(summary.tasks.map((t: { text: string }) => t.text)).toContain("in-progress: Ship the feature");
});
