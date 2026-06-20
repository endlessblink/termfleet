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
