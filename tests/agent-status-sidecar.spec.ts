import { expect, test } from "@playwright/test";
import {
  activityFromTool,
  lastAssistantText,
  narrationToNow,
} from "../scripts/termfleet-claude-status-hook.mjs";
import { fnv } from "../scripts/lib/agent-status-paths.mjs";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// TC-033: the Claude TodoWrite hook writes the agent's real todos to a sidecar,
// and the sidecar status worker reads them back as a summary — free, accurate, no
// model/CLI calls. End-to-end via subprocesses with an isolated XDG_DATA_HOME.

const ROOT = process.cwd();
const HOOK = path.join(ROOT, "scripts", "termfleet-claude-status-hook.mjs");
const WORKER = path.join(ROOT, "scripts", "agent-status-summary-sidecar.mjs");
const OLLAMA_WORKER = path.join(
  ROOT,
  "scripts",
  "agent-status-summary-ollama.mjs",
);

function runNode(script: string, input: unknown, env: Record<string, string>) {
  return spawnSync("node", [script], {
    input: JSON.stringify(input),
    encoding: "utf8",
    // Default TERMFLEET_PANE_ID off so cwd-keyed tests stay hermetic even when the suite
    // runs inside a termfleet pane (which injects it); pane tests set it explicitly.
    env: { ...process.env, TERMFLEET_PANE_ID: "", ...env },
  });
}

test("hook writes a sidecar and the worker turns it into a live summary", async () => {
  const dataHome = mkdtempSync(path.join(os.tmpdir(), "tf-status-"));
  const cwd = "/tmp/tf-demo-project";
  const env = { XDG_DATA_HOME: dataHome };

  // 1. Hook receives a Claude PostToolUse(TodoWrite) payload.
  const hookResult = runNode(
    HOOK,
    {
      hook_event_name: "PostToolUse",
      tool_name: "TodoWrite",
      session_id: "sess-1",
      cwd,
      tool_input: {
        todos: [
          {
            content: "Build the sidecar parser",
            status: "in_progress",
            activeForm: "Building the sidecar parser",
          },
          {
            content: "Write the regression test",
            status: "pending",
            activeForm: "Writing the regression test",
          },
          {
            content: "Read the worker contract",
            status: "completed",
            activeForm: "Reading the worker contract",
          },
        ],
      },
    },
    env,
  );
  expect(hookResult.status).toBe(0);

  // 2. The sidecar worker reads it back for a request carrying the same cwd.
  const workerResult = runNode(
    WORKER,
    {
      projectId: cwd,
      workstream: { path: cwd, provider: "shell" },
      heuristicCandidate: {
        task: "Shell ready",
        path: cwd,
        now: "Awaiting command",
        status: "idle",
        provider: "shell",
        confidence: "low",
      },
    },
    env,
  );
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
  runNode(
    HOOK,
    {
      tool_name: "TaskCreate",
      cwd,
      session_id: "s",
      tool_input: {
        subject: "Wire the hook",
        description: "d",
        activeForm: "Wiring the hook",
      },
      tool_response: { task: { id: "1", subject: "Wire the hook" } },
    },
    env,
  );
  runNode(
    HOOK,
    {
      tool_name: "TaskCreate",
      cwd,
      session_id: "s",
      tool_input: {
        subject: "Read the worker contract",
        description: "d",
        activeForm: "Reading the contract",
      },
      tool_response: { task: { id: "2", subject: "Read the worker contract" } },
    },
    env,
  );
  // TaskUpdate: taskId + status in tool_input.
  runNode(
    HOOK,
    {
      tool_name: "TaskUpdate",
      cwd,
      session_id: "s",
      tool_input: { taskId: "1", status: "in_progress" },
      tool_response: { success: true, taskId: "1" },
    },
    env,
  );
  runNode(
    HOOK,
    {
      tool_name: "TaskUpdate",
      cwd,
      session_id: "s",
      tool_input: { taskId: "2", status: "completed" },
      tool_response: { success: true, taskId: "2" },
    },
    env,
  );

  const workerResult = runNode(
    WORKER,
    {
      projectId: cwd,
      workstream: { path: cwd, provider: "shell" },
      heuristicCandidate: {
        task: "Shell ready",
        path: cwd,
        now: "Awaiting command",
        status: "idle",
        provider: "shell",
        confidence: "low",
      },
    },
    env,
  );
  const summary = JSON.parse(workerResult.stdout.trim());

  expect(summary.tasksFromTodoWrite).toBe(true);
  // Title = the current task's human-readable active form (what's happening now).
  expect(summary.task).toBe("Wiring the hook");
  expect(summary.now).toBe("Wiring the hook"); // in-progress task's active form
  expect(summary.status).toBe("working");
  const texts = summary.tasks.map((t: { text: string }) => t.text);
  expect(texts).toContain("in-progress: Wire the hook");
  // A verb-first ("Read ...") item survives, marked done by status.
  expect(texts).toContain("done: Read the worker contract");
});

test("the ollama worker is sidecar-first: returns the real task list without a model call", async () => {
  // The live app runs the ollama worker; it must prefer the agent's own sidecar (real
  // TaskCreate/TaskUpdate list) over model-summarizing scrollback. A sidecar hit
  // short-circuits before any Ollama HTTP call, so this passes with Ollama offline.
  const dataHome = mkdtempSync(path.join(os.tmpdir(), "tf-status-"));
  const cwd = "/tmp/tf-ollama-sidecar";
  const env = {
    XDG_DATA_HOME: dataHome,
    TERMFLEET_OLLAMA_URL: "http://127.0.0.1:1",
  };
  runNode(
    HOOK,
    {
      tool_name: "TaskCreate",
      cwd,
      session_id: "s",
      tool_input: {
        subject: "Real captured task",
        activeForm: "Doing the real task",
      },
      tool_response: { task: { id: "1", subject: "Real captured task" } },
    },
    env,
  );
  runNode(
    HOOK,
    {
      tool_name: "TaskUpdate",
      cwd,
      session_id: "s",
      tool_input: { taskId: "1", status: "in_progress" },
      tool_response: { success: true, taskId: "1" },
    },
    env,
  );

  const result = runNode(
    OLLAMA_WORKER,
    {
      projectId: cwd,
      workstream: { path: cwd, provider: "shell" },
      heuristicCandidate: {
        task: "Shell ready",
        path: cwd,
        now: "Awaiting command",
        status: "idle",
        provider: "shell",
        confidence: "low",
      },
    },
    env,
  );
  expect(result.status).toBe(0);
  const summary = JSON.parse(result.stdout.trim());
  expect(summary.tasksFromTodoWrite).toBe(true);
  expect(summary.now).toBe("Doing the real task");
  expect(summary.tasks.map((t: { text: string }) => t.text)).toContain(
    "in-progress: Real captured task",
  );
});

test("recent-activity log: the worker returns the agent's actual recent actions", async () => {
  // The reliable 'what the AI is doing' feed — the agent's real actions, logged by the
  // hook (like Watchpost's changelog), not inferred. (TC-033)
  const dataHome = mkdtempSync(path.join(os.tmpdir(), "tf-status-"));
  const cwd = "/tmp/tf-recent";
  const env = { XDG_DATA_HOME: dataHome };
  runNode(
    HOOK,
    { tool_name: "Read", cwd, tool_input: { file_path: "/x/types.ts" } },
    env,
  );
  runNode(
    HOOK,
    { tool_name: "Edit", cwd, tool_input: { file_path: "/x/worker.mjs" } },
    env,
  );
  runNode(
    HOOK,
    { tool_name: "Bash", cwd, tool_input: { command: "npm test" } },
    env,
  );

  const result = runNode(
    WORKER,
    {
      projectId: cwd,
      workstream: { path: cwd, provider: "shell" },
      heuristicCandidate: {
        task: "Shell ready",
        path: cwd,
        now: "x",
        status: "idle",
        provider: "shell",
        confidence: "low",
      },
    },
    env,
  );
  const summary = JSON.parse(result.stdout.trim());
  const texts = (summary.recent ?? []).map(
    (entry: { text: string }) => entry.text,
  );
  expect(texts).toContain("Reading types.ts");
  expect(texts).toContain("Editing worker.mjs");
  expect(texts).toContain("Running: npm test");
  // Newest last, each with a timestamp.
  expect(summary.recent.every((entry: { at: number }) => entry.at > 0)).toBe(
    true,
  );
});

test("Stop event: the agent's own last words become the live now line + recent feed", async () => {
  // TC-033 'model writes the log → summary picks it up': at end of turn the hook reads the
  // final assistant text block from transcript_path and records it as the now/narration —
  // the agent's declared words, not an inference from tool calls.
  const dataHome = mkdtempSync(path.join(os.tmpdir(), "tf-status-"));
  const cwd = "/tmp/tf-narration";
  const env = { XDG_DATA_HOME: dataHome };
  // A minimal turn transcript: a tool-only assistant turn (no text), then the real
  // narration. The hook must skip the tool-only entry and land on the narration.
  const transcript = path.join(dataHome, "transcript.jsonl");
  writeFileSync(
    transcript,
    [
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "tool_use", id: "t1", name: "Read", input: {} }],
        },
      }),
      JSON.stringify({
        type: "user",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }],
        },
      }),
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            {
              type: "text",
              text: "**Wiring** the Stop hook so the title reads in my own words. Next I will verify.",
            },
          ],
        },
      }),
    ].join("\n"),
  );

  const hookResult = runNode(
    HOOK,
    {
      hook_event_name: "Stop",
      session_id: "s",
      cwd,
      transcript_path: transcript,
    },
    env,
  );
  expect(hookResult.status).toBe(0);

  const workerResult = runNode(
    WORKER,
    {
      projectId: cwd,
      workstream: { path: cwd, provider: "shell" },
      heuristicCandidate: {
        task: "Shell ready",
        path: cwd,
        now: "Awaiting command",
        status: "idle",
        provider: "shell",
        confidence: "low",
      },
    },
    env,
  );
  const summary = JSON.parse(workerResult.stdout.trim());
  // First sentence only, markdown stripped — plain language for the cockpit.
  expect(summary.now).toBe(
    "Wiring the Stop hook so the title reads in my own words.",
  );
  const recent = (summary.recent ?? []).map(
    (entry: { text: string }) => entry.text,
  );
  expect(recent).toContain(
    "Wiring the Stop hook so the title reads in my own words.",
  );
});

test("Stop event transcript scan is bounded to recent tail", () => {
  const dataHome = mkdtempSync(path.join(os.tmpdir(), "tf-status-tail-"));
  const transcript = path.join(dataHome, "transcript.jsonl");
  const oldAssistant = JSON.stringify({
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "Old assistant text that should not be scanned" }],
    },
  });
  const latestAssistant = JSON.stringify({
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "Now I will bound the Claude status transcript scan." }],
    },
  });
  writeFileSync(transcript, `${oldAssistant}\n${"x".repeat(300 * 1024)}\n${latestAssistant}\n`);

  expect(lastAssistantText(transcript)).toBe("Now I will bound the Claude status transcript scan.");
});

test("Stop event: a live task summary outranks narration for the title, narration still feeds recent", async () => {
  // A real plan (in-progress task) is a better title than end-of-turn narration, so the
  // task summary wins `now`; the narration still lands in the recent-activity feed.
  const dataHome = mkdtempSync(path.join(os.tmpdir(), "tf-status-"));
  const cwd = "/tmp/tf-narration-task";
  const env = { XDG_DATA_HOME: dataHome };
  runNode(
    HOOK,
    {
      tool_name: "TaskCreate",
      cwd,
      session_id: "s",
      tool_input: { subject: "Wire the hook", activeForm: "Wiring the hook" },
      tool_response: { task: { id: "1", subject: "Wire the hook" } },
    },
    env,
  );
  runNode(
    HOOK,
    {
      tool_name: "TaskUpdate",
      cwd,
      session_id: "s",
      tool_input: { taskId: "1", status: "in_progress" },
      tool_response: { taskId: "1" },
    },
    env,
  );

  const transcript = path.join(dataHome, "transcript.jsonl");
  writeFileSync(
    transcript,
    JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "Just finished the edit and ran the tests." },
        ],
      },
    }),
  );
  runNode(
    HOOK,
    {
      hook_event_name: "Stop",
      session_id: "s",
      cwd,
      transcript_path: transcript,
    },
    env,
  );

  const workerResult = runNode(
    WORKER,
    {
      projectId: cwd,
      workstream: { path: cwd, provider: "shell" },
      heuristicCandidate: {
        task: "Shell ready",
        path: cwd,
        now: "Awaiting command",
        status: "idle",
        provider: "shell",
        confidence: "low",
      },
    },
    env,
  );
  const summary = JSON.parse(workerResult.stdout.trim());
  expect(summary.now).toBe("Wiring the hook"); // in-progress task wins the now line
  expect(summary.tasksFromTodoWrite).toBe(true);
  const recent = (summary.recent ?? []).map(
    (entry: { text: string }) => entry.text,
  );
  expect(recent).toContain("Just finished the edit and ran the tests."); // narration still logged
});

test("narration: the agent's stated intent wins over a terse status wrap-up", () => {
  // The end-of-turn text often opens with a status fragment ("All 71 pass.") before the
  // real intent. The title must be the WORK ("Commit this fix"), not the status. (TC-033)
  expect(
    narrationToNow("All 71 pass. Let me commit this fix to the cockpit title."),
  ).toBe("Commit this fix to the cockpit title.");
  // First stated intent = the turn's goal, not a later sub-step.
  expect(
    narrationToNow(
      "I will wire the daemon reconnect so dropped PTYs come back. First let me read the code.",
    ),
  ).toBe("Wire the daemon reconnect so dropped PTYs come back.");
  // A descriptive work sentence is used when there's no explicit "let me …" intent.
  expect(
    narrationToNow(
      "The hook now captures the agent's own words and writes them to the sidecar.",
    ),
  ).toContain("captures the agent's own words");
});

test("narration: pure status / report wrap-ups yield nothing (title falls back to neutral)", () => {
  // Useless-as-a-title lines must produce "" so the header shows the clean neutral word
  // instead of "Done." / "Committed as abc123.". (TC-033)
  for (const junk of [
    "Done.",
    "All 71 pass.",
    "Perfect. Committed as f598b76.",
    "Pushed to origin/main.",
    "Great, that's it.",
  ]) {
    expect(narrationToNow(junk)).toBe("");
  }
});

test("activity line: trivial nav/inspection commands are filtered out", () => {
  // These keep the previous (meaningful) now line instead of showing "Running: cd ...".
  expect(activityFromTool("Bash", { command: "cd /media/foo/bar" })).toBe("");
  expect(activityFromTool("Bash", { command: "ls -la" })).toBe("");
  expect(activityFromTool("Bash", { command: "pwd" })).toBe("");
  expect(activityFromTool("Bash", { command: "clear" })).toBe("");
  // Leading nav is stripped; the meaningful command remains.
  expect(activityFromTool("Bash", { command: "cd /x/y && npm test" })).toBe(
    "Running: npm test",
  );
  // Real commands still show.
  expect(activityFromTool("Bash", { command: "npm run build" })).toBe(
    "Running: npm run build",
  );
});

test("activity line: prefers Claude's plain-language description over raw command (TC-035)", () => {
  // The cockpit is for non-developers — show the friendly description, never the code.
  expect(
    activityFromTool("Bash", {
      command: 'node -e "const cases = [ \\"Improve docs\\" ]; console.log(cases)"',
      description: "Verify the chrome-title fix",
    }),
  ).toBe("Verify the chrome-title fix");
  // No description: never leak inline code / heredoc bodies — only the command head shows.
  expect(
    activityFromTool("Bash", { command: 'node -e "const x = 1; doStuff(x)"' }),
  ).toBe("Running: node -e");
  expect(
    activityFromTool("Bash", { command: "cat <<EOF\nsecret body\nEOF" }),
  ).toBe("Running: cat");
});

test("all tasks complete: title is the last task, never the raw shell command", async () => {
  // After the agent finishes its list, the header must NOT fall back to the momentary
  // raw command (e.g. "Running: cd /long/path") as the title — that's the ugly summary
  // the user flagged. It should show the last task worked on. (TC-033)
  const dataHome = mkdtempSync(path.join(os.tmpdir(), "tf-status-"));
  const cwd = "/tmp/tf-all-done";
  const env = { XDG_DATA_HOME: dataHome };
  runNode(
    HOOK,
    {
      tool_name: "TaskCreate",
      cwd,
      session_id: "s",
      tool_input: {
        subject: "Build the parser",
        activeForm: "Building the parser",
      },
      tool_response: { task: { id: "1", subject: "Build the parser" } },
    },
    env,
  );
  runNode(
    HOOK,
    {
      tool_name: "TaskCreate",
      cwd,
      session_id: "s",
      tool_input: {
        subject: "Ship the feature",
        activeForm: "Shipping the feature",
      },
      tool_response: { task: { id: "2", subject: "Ship the feature" } },
    },
    env,
  );
  runNode(
    HOOK,
    {
      tool_name: "TaskUpdate",
      cwd,
      session_id: "s",
      tool_input: { taskId: "1", status: "completed" },
      tool_response: { taskId: "1" },
    },
    env,
  );
  runNode(
    HOOK,
    {
      tool_name: "TaskUpdate",
      cwd,
      session_id: "s",
      tool_input: { taskId: "2", status: "completed" },
      tool_response: { taskId: "2" },
    },
    env,
  );
  // A trailing raw command sets `now` to a cd line.
  runNode(
    HOOK,
    {
      tool_name: "Bash",
      cwd,
      tool_input: {
        command:
          "cd /media/endlessblink/data/my-projects/ai-development/devops/termfleet",
      },
    },
    env,
  );

  const result = runNode(
    WORKER,
    {
      projectId: cwd,
      workstream: { path: cwd, provider: "shell" },
      heuristicCandidate: {
        task: "Shell ready",
        path: cwd,
        now: "x",
        status: "idle",
        provider: "shell",
        confidence: "low",
      },
    },
    env,
  );
  const summary = JSON.parse(result.stdout.trim());
  expect(summary.task).toBe("Ship the feature"); // last completed task, not the cd command
  expect(summary.task).not.toContain("cd ");
  expect(summary.task).not.toContain("Running:");
});

test("TaskUpdate status deleted removes the task; later events keep it gone", async () => {
  const dataHome = mkdtempSync(path.join(os.tmpdir(), "tf-status-"));
  const cwd = "/tmp/tf-task-delete";
  const env = { XDG_DATA_HOME: dataHome };
  runNode(
    HOOK,
    {
      tool_name: "TaskCreate",
      cwd,
      session_id: "s",
      tool_input: { subject: "Keep me", activeForm: "Keeping" },
      tool_response: { task: { id: "1", subject: "Keep me" } },
    },
    env,
  );
  runNode(
    HOOK,
    {
      tool_name: "TaskCreate",
      cwd,
      session_id: "s",
      tool_input: { subject: "Delete me", activeForm: "Deleting" },
      tool_response: { task: { id: "2", subject: "Delete me" } },
    },
    env,
  );
  runNode(
    HOOK,
    {
      tool_name: "TaskUpdate",
      cwd,
      session_id: "s",
      tool_input: { taskId: "2", status: "deleted" },
      tool_response: { success: true, taskId: "2" },
    },
    env,
  );
  // A following non-task tool (live-now) must not resurrect the deleted task.
  runNode(
    HOOK,
    { tool_name: "Read", cwd, tool_input: { file_path: "/x/y.ts" } },
    env,
  );

  const result = runNode(
    WORKER,
    {
      projectId: cwd,
      workstream: { path: cwd, provider: "shell" },
      heuristicCandidate: {
        task: "Shell ready",
        path: cwd,
        now: "x",
        status: "idle",
        provider: "shell",
        confidence: "low",
      },
    },
    env,
  );
  const summary = JSON.parse(result.stdout.trim());
  const texts = summary.tasks.map((t: { text: string }) => t.text);
  expect(texts).toContain("Keep me");
  expect(texts.join(" ")).not.toContain("Delete me");
});

test("a non-task tool keeps the Task-tool list and only updates the now line", async () => {
  const dataHome = mkdtempSync(path.join(os.tmpdir(), "tf-status-"));
  const cwd = "/tmp/tf-task-livenow";
  const env = { XDG_DATA_HOME: dataHome };
  runNode(
    HOOK,
    {
      tool_name: "TaskCreate",
      cwd,
      session_id: "s",
      tool_input: { subject: "Ship it", activeForm: "Shipping it" },
      tool_response: { task: { id: "1", subject: "Ship it" } },
    },
    env,
  );
  runNode(
    HOOK,
    { tool_name: "Bash", cwd, tool_input: { command: "npm test" } },
    env,
  );
  const workerResult = runNode(
    WORKER,
    {
      projectId: cwd,
      workstream: { path: cwd, provider: "shell" },
      heuristicCandidate: {
        task: "Shell ready",
        path: cwd,
        now: "Awaiting command",
        status: "idle",
        provider: "shell",
        confidence: "low",
      },
    },
    env,
  );
  const summary = JSON.parse(workerResult.stdout.trim());
  expect(summary.now).toBe("Running: npm test");
  expect(summary.tasks.map((t: { text: string }) => t.text)).toContain(
    "Ship it",
  );
});

test("worktree cwd: hook keys the sidecar by the worktree path, not the main checkout", async () => {
  // Claude issue #64851: in a git worktree, payload.cwd is the MAIN checkout; the real
  // worktree path is in payload.worktree. The terminal's live cwd is the worktree, so
  // the sidecar must be keyed by it for the join to hit.
  const dataHome = mkdtempSync(path.join(os.tmpdir(), "tf-status-"));
  const mainCheckout = "/tmp/tf-main-repo";
  const worktree = "/tmp/tf-main-repo/.worktrees/feature";
  const env = { XDG_DATA_HOME: dataHome };
  runNode(
    HOOK,
    {
      tool_name: "TaskCreate",
      cwd: mainCheckout,
      worktree,
      session_id: "s",
      tool_input: {
        subject: "Do worktree work",
        activeForm: "Doing worktree work",
      },
      tool_response: { task: { id: "1", subject: "Do worktree work" } },
    },
    env,
  );
  // Worker looking up by the worktree path (what the live cwd resolves to) finds it.
  const hit = runNode(
    WORKER,
    {
      projectId: worktree,
      workstream: { path: worktree, provider: "shell" },
      heuristicCandidate: {
        task: "Shell ready",
        path: worktree,
        now: "Awaiting command",
        status: "idle",
        provider: "shell",
        confidence: "low",
      },
    },
    env,
  );
  expect(JSON.parse(hit.stdout.trim()).tasksFromTodoWrite).toBe(true);
  // Looking up by the MAIN checkout path does NOT (the bug would key it here).
  const miss = runNode(
    WORKER,
    {
      projectId: mainCheckout,
      workstream: { path: mainCheckout, provider: "shell" },
      heuristicCandidate: {
        task: "Shell ready",
        path: mainCheckout,
        now: "Awaiting command",
        status: "idle",
        provider: "shell",
        confidence: "low",
      },
    },
    env,
  );
  expect(JSON.parse(miss.stdout.trim()).tasksFromTodoWrite).toBeFalsy();
});

test("per-terminal status (TC-035): two panes in the SAME cwd keep independent task lists", async () => {
  // The core standalone-per-terminal guarantee: when termfleet injects a pane id into the
  // PTY (TERMFLEET_PANE_ID), the hook keys the sidecar by terminal, so two terminals open
  // in the same directory no longer share one title/task list.
  const dataHome = mkdtempSync(path.join(os.tmpdir(), "tf-status-"));
  const cwd = "/tmp/tf-shared-cwd";

  // Pane A creates its own task.
  runNode(
    HOOK,
    {
      tool_name: "TaskCreate",
      cwd,
      session_id: "sA",
      tool_input: {
        subject: "Wire the daemon",
        activeForm: "Wiring the daemon",
      },
      tool_response: { task: { id: "1", subject: "Wire the daemon" } },
    },
    { XDG_DATA_HOME: dataHome, TERMFLEET_PANE_ID: "pane-A" },
  );
  // Pane B, SAME cwd, creates a different task.
  runNode(
    HOOK,
    {
      tool_name: "TaskCreate",
      cwd,
      session_id: "sB",
      tool_input: {
        subject: "Fix the renderer",
        activeForm: "Fixing the renderer",
      },
      tool_response: { task: { id: "1", subject: "Fix the renderer" } },
    },
    { XDG_DATA_HOME: dataHome, TERMFLEET_PANE_ID: "pane-B" },
  );

  // Each request keyed by its own pane id sees only that terminal's task.
  const reqFor = (paneId: string) => ({
    paneId,
    projectId: cwd,
    workstream: { path: cwd, provider: "shell" },
    heuristicCandidate: {
      task: "Shell ready",
      path: cwd,
      now: "Awaiting command",
      status: "idle",
      provider: "shell",
      confidence: "low",
    },
  });
  const a = JSON.parse(
    runNode(WORKER, reqFor("pane-A"), {
      XDG_DATA_HOME: dataHome,
    }).stdout.trim(),
  );
  const b = JSON.parse(
    runNode(WORKER, reqFor("pane-B"), {
      XDG_DATA_HOME: dataHome,
    }).stdout.trim(),
  );

  // Pending task → now is its content (activeForm is only used once in_progress).
  expect(a.now).toBe("Wire the daemon");
  expect(b.now).toBe("Fix the renderer");
  // No cross-talk: neither pane sees the other's task.
  expect(a.tasks.map((t: { text: string }) => t.text).join(" ")).not.toContain(
    "renderer",
  );
  expect(b.tasks.map((t: { text: string }) => t.text).join(" ")).not.toContain(
    "daemon",
  );
});

test("per-terminal status (TC-035): request falls back to cwd when the pane sidecar is absent", async () => {
  // Backward compatibility: until the PTY injects a pane id, the hook writes a cwd-keyed
  // sidecar. A request that carries a paneId with no matching pane file must still find the
  // cwd sidecar (legacy/not-yet-injected sessions keep working).
  const dataHome = mkdtempSync(path.join(os.tmpdir(), "tf-status-"));
  const cwd = "/tmp/tf-fallback-cwd";
  // Hook runs WITHOUT a pane id → cwd-keyed file.
  runNode(
    HOOK,
    {
      tool_name: "TaskCreate",
      cwd,
      session_id: "s",
      tool_input: { subject: "Legacy task", activeForm: "Doing legacy work" },
      tool_response: { task: { id: "1", subject: "Legacy task" } },
    },
    { XDG_DATA_HOME: dataHome },
  );
  // Request carries a paneId that has no pane file → must fall back to the cwd sidecar.
  const summary = JSON.parse(
    runNode(
      WORKER,
      {
        paneId: "pane-with-no-file",
        projectId: cwd,
        workstream: { path: cwd, provider: "shell" },
        heuristicCandidate: {
          task: "Shell ready",
          path: cwd,
          now: "Awaiting command",
          status: "idle",
          provider: "shell",
          confidence: "low",
        },
      },
      { XDG_DATA_HOME: dataHome },
    ).stdout.trim(),
  );
  expect(summary.tasksFromTodoWrite).toBe(true);
  expect(summary.now).toBe("Legacy task"); // pending task → now is its content
});

test("concurrent hook writes never corrupt the file or wipe the task list (TC-035)", async () => {
  // Root cause of the vanishing task list: the hook does read-modify-write on every tool
  // call, and parallel tool calls spawn concurrent hooks. A non-atomic write let a reader
  // see a half-written file (invalid JSON → todos reset to []), and a stale-prev write
  // clobbered a sibling's just-written tasks. Atomic write (temp+rename) + the on-disk
  // todo guard must keep the task list intact under a burst of concurrent hooks.
  const dataHome = mkdtempSync(path.join(os.tmpdir(), "tf-status-"));
  const cwd = "/tmp/tf-concurrent";
  const env = {
    ...process.env,
    XDG_DATA_HOME: dataHome,
    TERMFLEET_PANE_ID: "",
  };

  // Establish a real task list first.
  runNode(
    HOOK,
    {
      tool_name: "TaskCreate",
      cwd,
      session_id: "s",
      tool_input: {
        subject: "Important task",
        activeForm: "Doing important work",
      },
      tool_response: { task: { id: "1", subject: "Important task" } },
    },
    { XDG_DATA_HOME: dataHome },
  );

  // Fire a burst of concurrent hooks: live-now tool calls (which carry NO todos) racing
  // each other and the file. Without the fix some writes corrupt the JSON / wipe todos.
  const spawnHook = (payload: unknown) =>
    new Promise<void>((resolve) => {
      const child = spawn("node", [HOOK], { env });
      child.stdin.end(JSON.stringify(payload));
      child.on("close", () => resolve());
      child.on("error", () => resolve());
    });
  const burst = Array.from({ length: 24 }, (_, i) =>
    spawnHook({
      tool_name: "Bash",
      cwd,
      tool_input: { command: `echo step-${i}` },
    }),
  );
  await Promise.all(burst);

  // The file must still be valid JSON and STILL carry the task (never wiped to []).
  const file = path.join(
    dataHome,
    "terminal-workspace",
    "agent-status",
    `${fnv(cwd)}.json`,
  );
  const sidecar = JSON.parse(readFileSync(file, "utf8")); // throws if a torn write corrupted it
  expect(sidecar.todos.map((t: { content: string }) => t.content)).toContain(
    "Important task",
  );
});

test("worker falls back to the heuristic when no sidecar exists for the cwd", async () => {
  const dataHome = mkdtempSync(path.join(os.tmpdir(), "tf-status-"));
  const result = runNode(
    WORKER,
    {
      projectId: "/tmp/no-sidecar-here",
      workstream: { path: "/tmp/no-sidecar-here", provider: "shell" },
      heuristicCandidate: {
        task: "Shell ready",
        path: "p",
        now: "Awaiting command",
        status: "idle",
        provider: "shell",
        confidence: "low",
      },
    },
    { XDG_DATA_HOME: dataHome },
  );
  expect(result.status).toBe(0);
  const summary = JSON.parse(result.stdout.trim());
  expect(summary.now).toBe("Awaiting command");
  expect(summary.confidence).toBe("low");
  // No real todo list → not flagged authoritative.
  expect(summary.tasksFromTodoWrite).toBeFalsy();
});

test("UserPromptSubmit writes the main user task and later tool activity preserves it", async () => {
  const dataHome = mkdtempSync(path.join(os.tmpdir(), "tf-status-"));
  const cwd = "/tmp/tf-codex-user-task";
  const env = { XDG_DATA_HOME: dataHome, TERMFLEET_PANE_ID: "pane-user-task" };

  const promptResult = runNode(
    HOOK,
    {
      hook_event_name: "UserPromptSubmit",
      cwd,
      session_id: "s",
      prompt: "Fix terminal headers so Task shows the user ask and activity shows current work",
    },
    env,
  );
  expect(promptResult.status).toBe(0);

  const toolResult = runNode(
    HOOK,
    {
      tool_name: "Read",
      cwd,
      session_id: "s",
      tool_input: { file_path: "/repo/termfleet/src/lib/terminalHeaderViewModel.ts" },
    },
    env,
  );
  expect(toolResult.status).toBe(0);

  const workerResult = runNode(
    WORKER,
    {
      paneId: "pane-user-task",
      projectId: cwd,
      workstream: { path: cwd, provider: "codex" },
      heuristicCandidate: {
        task: "Tracing header data flow",
        path: "termfleet",
        now: "Reading terminalHeaderViewModel.ts",
        status: "working",
        provider: "codex",
        confidence: "low",
      },
    },
    { XDG_DATA_HOME: dataHome },
  );
  expect(workerResult.status).toBe(0);
  const summary = JSON.parse(workerResult.stdout.trim());
  expect(summary.userTask).toBe(
    "Fix terminal headers so Task shows the user ask and activity shows current work",
  );
  expect(summary.task).toBe("Reading terminalHeaderViewModel.ts");
  expect(summary.now).toBe("Reading terminalHeaderViewModel.ts");
  expect(summary.tasksFromTodoWrite).toBe(false);
});

test("live-now: a tool call updates the activity and preserves the todo list", async () => {
  const dataHome = mkdtempSync(path.join(os.tmpdir(), "tf-status-"));
  const cwd = "/tmp/tf-demo-live";
  const env = { XDG_DATA_HOME: dataHome };

  // Todos established first.
  runNode(
    HOOK,
    {
      tool_name: "TodoWrite",
      cwd,
      session_id: "s",
      tool_input: {
        todos: [
          {
            content: "Ship the feature",
            status: "in_progress",
            activeForm: "Shipping the feature",
          },
        ],
      },
    },
    env,
  );
  // Then a Bash tool call updates "now" without TodoWrite.
  const hookResult = runNode(
    HOOK,
    {
      tool_name: "Bash",
      cwd,
      tool_input: { command: "npm run build && echo done" },
    },
    env,
  );
  expect(hookResult.status).toBe(0);

  const workerResult = runNode(
    WORKER,
    {
      projectId: cwd,
      workstream: { path: cwd, provider: "shell" },
      heuristicCandidate: {
        task: "Shell ready",
        path: cwd,
        now: "Awaiting command",
        status: "idle",
        provider: "shell",
        confidence: "low",
      },
    },
    env,
  );
  const summary = JSON.parse(workerResult.stdout.trim());
  expect(summary.now).toBe("Running: npm run build && echo done");
  // Todo list preserved across the non-TodoWrite call.
  expect(summary.tasks.map((t: { text: string }) => t.text)).toContain(
    "in-progress: Ship the feature",
  );
});
