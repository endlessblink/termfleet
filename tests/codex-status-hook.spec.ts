import { expect, test } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildCodexSidecar,
  codexActivityFromTool,
  codexLastAgentMessage,
  todosFromUpdatePlan,
} from "../scripts/termfleet-codex-status-hook.mjs";

test("user prompt becomes the Task row (the reliable Codex signal)", () => {
  const sidecar = buildCodexSidecar(
    { hook_event_name: "UserPromptSubmit", prompt: "go over everything and get it ready to merge", cwd: "/repo", session_id: "s1" },
    null,
    1000,
  );
  expect(sidecar?.source).toBe("codex-user-prompt");
  // The operator's real ask is kept verbatim; the header shows it as the Task row.
  expect(sidecar?.userTask).toBe("go over everything and get it ready to merge");
  // No fake placeholder task is injected — a manufactured "Answering latest prompt"
  // todo used to hide both the real ask and the live activity.
  expect(sidecar?.todos).toEqual([]);
  expect(sidecar?.now).toBe("Prompt submitted");
});

test("new prompt replaces completed todos with a fresh current task", () => {
  const sidecar = buildCodexSidecar(
    { hook_event_name: "UserPromptSubmit", prompt: "no you havent... how do we make you relable? answer", cwd: "/repo", session_id: "s1" },
    {
      now: "Old final answer text",
      todos: [
        { content: "Removing merge markers blocking the app", status: "completed", activeForm: "" },
        { content: "Looping visible verification until improved", status: "completed", activeForm: "" },
      ],
    },
    1100,
  );

  expect(sidecar?.userTask).toBe("no you havent... how do we make you relable? answer");
  expect(sidecar?.todos).toEqual([{
    content: "Answering reliability question",
    status: "in_progress",
    activeForm: "Answering reliability question",
  }]);
  expect(sidecar?.now).toBe("Answering reliability question");
  expect(sidecar?.now).not.toBe("Old final answer text");
});

test("cockpit failure prompts become specific task labels", () => {
  const labelFailure = buildCodexSidecar(
    { hook_event_name: "UserPromptSubmit", prompt: "[Image #1] these are fails", cwd: "/repo", session_id: "s1" },
    null,
    1200,
  );
  expect(labelFailure?.todos?.[0]).toMatchObject({
    content: "Fixing cockpit task labels",
    activeForm: "Fixing cockpit task labels",
  });

  const monitorRequest = buildCodexSidecar(
    {
      hook_event_name: "UserPromptSubmit",
      prompt: "you must be able to see all terminals with all their task and task descriptions at all time as logs you can monitor",
      cwd: "/repo",
      session_id: "s1",
    },
    null,
    1300,
  );
  expect(monitorRequest?.todos?.[0]).toMatchObject({
    content: "Capturing all terminal task and active labels",
    activeForm: "Capturing all terminal task and active labels",
  });

  const explicitAllHeaders = buildCodexSidecar(
    {
      hook_event_name: "UserPromptSubmit",
      prompt: "make sure that you capture all terminals task and active!!!!",
      cwd: "/repo",
      session_id: "s1",
    },
    null,
    1350,
  );
  expect(explicitAllHeaders?.todos?.[0]).toMatchObject({
    content: "Capturing all terminal task and active labels",
    activeForm: "Capturing all terminal task and active labels",
  });

  const termfleetCapture = buildCodexSidecar(
    {
      hook_event_name: "UserPromptSubmit",
      prompt: "for example can you caoture termfleet terminal?",
      cwd: "/repo",
      session_id: "s1",
    },
    null,
    1360,
  );
  expect(termfleetCapture?.todos?.[0]).toMatchObject({
    content: "Capturing the TermFleet terminal header",
    activeForm: "Capturing the TermFleet terminal header",
  });

  const brokenAgain = buildCodexSidecar(
    {
      hook_event_name: "UserPromptSubmit",
      prompt: "it is broken again right now",
      cwd: "/repo",
      session_id: "s1",
    },
    null,
    1370,
  );
  expect(brokenAgain?.todos?.[0]).toMatchObject({
    content: "Fixing broken cockpit header capture",
    activeForm: "Fixing broken cockpit header capture",
  });

  const monitorVisible = buildCodexSidecar(
    {
      hook_event_name: "UserPromptSubmit",
      prompt: "[Image #1] you must see this or you failed again to minitor",
      cwd: "/repo",
      session_id: "s1",
    },
    null,
    1380,
  );
  expect(monitorVisible?.todos?.[0]).toMatchObject({
    content: "Monitoring the visible TermFleet header",
    activeForm: "Monitoring the visible TermFleet header",
  });

  const resumeRequest = buildCodexSidecar(
    {
      hook_event_name: "UserPromptSubmit",
      prompt: "pick up the task and now active working tasks",
      cwd: "/repo/termfleet",
      session_id: "s1",
    },
    null,
    1400,
  );
  expect(resumeRequest?.todos?.[0]).toMatchObject({
    content: "Resuming active TermFleet work",
    activeForm: "Resuming active TermFleet work",
  });

  const qualityComplaint = buildCodexSidecar(
    {
      hook_event_name: "UserPromptSubmit",
      prompt: "both are low quality... why didnt you capture them and make sure that they work better?",
      cwd: "/repo/termfleet",
      session_id: "s1",
    },
    null,
    1500,
  );
  expect(qualityComplaint?.todos?.[0]).toMatchObject({
    content: "Improving cockpit header quality",
    activeForm: "Improving cockpit header quality",
  });
});

test("stop event uses the agent's own last message as the activity line", () => {
  const sidecar = buildCodexSidecar(
    {
      hook_event_name: "Stop",
      last_assistant_message: "Let me wire the daemon reconnect path so sessions survive a restart.",
      cwd: "/repo",
      session_id: "s1",
    },
    { userTask: "make restart reliable", todos: [] },
    2000,
  );
  expect(sidecar?.source).toBe("codex-narration");
  expect(sidecar?.narration).toContain("Wire the daemon reconnect path");
  // The earlier user ask is carried forward, not lost.
  expect(sidecar?.userTask).toBe("make restart reliable");
});

test("exec_command maps to a readable running-line, navigation is ignored", () => {
  expect(codexActivityFromTool("exec_command", { command: "cargo test --workspace" })).toBe(
    "Running: cargo test --workspace",
  );
  expect(codexActivityFromTool("exec_command", { command: "cd /some/very/long/path" })).toBe("");
  expect(codexActivityFromTool("exec_command", { command: "cd repo && npm run build" })).toBe(
    "Running: npm run build",
  );
});

test("inline code / heredoc bodies never leak into the activity line", () => {
  const activity = codexActivityFromTool("exec_command", {
    command: `node -e "const cases = ['a','b']; console.log(cases)"`,
  });
  expect(activity).toBe("Running: node -e");
  expect(activity).not.toContain("const cases");
});

test("a tool call preserves the existing task list and user ask", () => {
  const sidecar = buildCodexSidecar(
    { hook_event_name: "PostToolUse", tool_name: "exec_command", tool_input: { command: "npm run build" }, cwd: "/repo" },
    { userTask: "ship it", todos: [{ content: "Build the app", status: "in_progress", activeForm: "" }] },
    3000,
  );
  expect(sidecar?.source).toBe("codex-tool");
  expect(sidecar?.userTask).toBe("ship it");
  expect(sidecar?.todos).toHaveLength(1);
  // A live task list drives the now line over the raw command.
  expect(sidecar?.now).toBe("Build the app");
});

test("a tool call repairs a generic prior task from the stored user ask", () => {
  const sidecar = buildCodexSidecar(
    { hook_event_name: "PostToolUse", tool_name: "exec_command", tool_input: { command: "npm test" }, cwd: "/repo" },
    {
      userTask: "you must see what I am seeing",
      todos: [{ content: "Answering latest prompt", status: "in_progress", activeForm: "Answering latest prompt" }],
    },
    3050,
  );
  expect(sidecar?.source).toBe("codex-tool");
  expect(sidecar?.todos?.[0]).toMatchObject({
    content: "Monitoring the visible TermFleet header",
    status: "in_progress",
    activeForm: "Monitoring the visible TermFleet header",
  });
  expect(sidecar?.now).toBe("Monitoring the visible TermFleet header");
});

test("a tool call repairs all-terminal capture prompts from generic prior tasks", () => {
  const sidecar = buildCodexSidecar(
    { hook_event_name: "PostToolUse", tool_name: "exec_command", tool_input: { command: "npm test" }, cwd: "/repo" },
    {
      userTask: "make sure that you capture all terminals task and active!!!!",
      todos: [{ content: "Answering latest prompt", status: "in_progress", activeForm: "Answering latest prompt" }],
    },
    3060,
  );
  expect(sidecar?.todos?.[0]).toMatchObject({
    content: "Capturing all terminal task and active labels",
    activeForm: "Capturing all terminal task and active labels",
  });
  expect(sidecar?.now).toBe("Capturing all terminal task and active labels");
});

test("a tool call repairs repayment-step prompts from generic prior tasks", () => {
  const sidecar = buildCodexSidecar(
    { hook_event_name: "PostToolUse", tool_name: "exec_command", tool_input: { command: "npm test" }, cwd: "/repo" },
    {
      userTask: "implement this and then lets stop before the secondery repayment step",
      todos: [{ content: "Answering latest prompt", status: "in_progress", activeForm: "Answering latest prompt" }],
    },
    3070,
  );
  expect(sidecar?.todos?.[0]).toMatchObject({
    content: "Guarding the second repayment step",
    activeForm: "Guarding the second repayment step",
  });
  expect(sidecar?.now).toBe("Guarding the second repayment step");
});

test("a tool call repairs watchdog prompts from generic prior tasks", () => {
  const sidecar = buildCodexSidecar(
    { hook_event_name: "PostToolUse", tool_name: "exec_command", tool_input: { command: "npm test" }, cwd: "/repo" },
    {
      userTask: "should we add a watchdog to find regressions?",
      todos: [{ content: "Answering latest prompt", status: "in_progress", activeForm: "Answering latest prompt" }],
    },
    3080,
  );
  expect(sidecar?.todos?.[0]).toMatchObject({
    content: "Reviewing bot regression watchdog",
    activeForm: "Reviewing bot regression watchdog",
  });
  expect(sidecar?.now).toBe("Reviewing bot regression watchdog");
});

test("a tool call repairs production-mismatch prompts from generic prior tasks", () => {
  const sidecar = buildCodexSidecar(
    { hook_event_name: "PostToolUse", tool_name: "exec_command", tool_input: { command: "npm test" }, cwd: "/repo" },
    {
      userTask: "[Image #1] still looks the same... because this is not in production?",
      todos: [{ content: "Answering user question", status: "in_progress", activeForm: "Answering user question" }],
    },
    3090,
  );
  expect(sidecar?.todos?.[0]).toMatchObject({
    content: "Checking production deployment status",
    activeForm: "Checking production deployment status",
  });
  expect(sidecar?.now).toBe("Checking production deployment status");
});

test("a tool call repairs false-positive upgrade prompts from generic prior tasks", () => {
  const sidecar = buildCodexSidecar(
    { hook_event_name: "PostToolUse", tool_name: "exec_command", tool_input: { command: "npm test" }, cwd: "/repo" },
    {
      userTask: "lets maybe upgrade it to catch every false positive?",
      todos: [{ content: "Answering user question", status: "in_progress", activeForm: "Answering user question" }],
    },
    3100,
  );
  expect(sidecar?.todos?.[0]).toMatchObject({
    content: "Improving false-positive detection",
    activeForm: "Improving false-positive detection",
  });
  expect(sidecar?.now).toBe("Improving false-positive detection");
});

test("a tool call repairs $sure prompts from generic prior tasks", () => {
  const sidecar = buildCodexSidecar(
    { hook_event_name: "PostToolUse", tool_name: "exec_command", tool_input: { command: "npm test" }, cwd: "/repo" },
    {
      userTask: "$sure",
      todos: [{ content: "Answering latest prompt", status: "in_progress", activeForm: "Answering latest prompt" }],
    },
    3110,
  );
  expect(sidecar?.todos?.[0]).toMatchObject({
    content: "Running requested safety check",
    activeForm: "Running requested safety check",
  });
  expect(sidecar?.now).toBe("Running requested safety check");
});

test("non-narration events do not keep stale assistant narration alive", () => {
  const previous = {
    userTask: "old prompt",
    narration: "Old answer that should not remain the live title",
    todos: [{ content: "Fix the runtime source gap", status: "in_progress", activeForm: "" }],
  };

  const prompt = buildCodexSidecar(
    { hook_event_name: "UserPromptSubmit", prompt: "new prompt", cwd: "/repo" },
    previous,
    3100,
  );
  const plan = buildCodexSidecar(
    { tool_name: "update_plan", tool_input: { plan: [{ step: "Fix the runtime source gap", status: "in_progress" }] }, cwd: "/repo" },
    previous,
    3200,
  );
  const tool = buildCodexSidecar(
    { hook_event_name: "PostToolUse", tool_name: "exec_command", tool_input: { command: "npm test" }, cwd: "/repo" },
    previous,
    3300,
  );

  expect(prompt?.narration).toBeUndefined();
  expect(plan?.narration).toBeUndefined();
  expect(tool?.narration).toBeUndefined();
});

test("update_plan, when Codex emits it, becomes a real task list", () => {
  const todos = todosFromUpdatePlan({
    plan: [
      { step: "Read the failing test", status: "completed" },
      { step: "Fix the reconnect race", status: "in_progress" },
      { step: "Add a regression test", status: "pending" },
    ],
  });
  expect(todos).toHaveLength(3);
  expect(todos[1]).toMatchObject({ content: "Fix the reconnect race", status: "in_progress" });

  const sidecar = buildCodexSidecar(
    { tool_name: "update_plan", tool_input: { plan: [{ step: "Fix the reconnect race", status: "in_progress" }] }, cwd: "/repo" },
    { userTask: "fix restart" },
    4000,
  );
  expect(sidecar?.source).toBe("codex-plan");
  expect(sidecar?.now).toBe("Fix the reconnect race");
});

test("codexLastAgentMessage prefers the direct payload field", () => {
  expect(codexLastAgentMessage({ last_assistant_message: "Done wiring it up." })).toBe("Done wiring it up.");
});

test("codexLastAgentMessage scans only recent transcript tail", () => {
  const dir = mkdtempSync(join(tmpdir(), "termfleet-codex-hook-"));
  const transcript = join(dir, "rollout.jsonl");
  const old = JSON.stringify({ type: "agent_message", message: "Old transcript task that should not be scanned" });
  const latest = JSON.stringify({ type: "agent_message", message: "Now I will bound the status hook transcript scan." });
  writeFileSync(transcript, `${old}\n${"x".repeat(300 * 1024)}\n${latest}\n`);

  expect(codexLastAgentMessage({ transcript_path: transcript })).toBe(
    "Now I will bound the status hook transcript scan.",
  );
});

test("nothing worth writing returns null (no empty sidecar churn)", () => {
  expect(buildCodexSidecar({ hook_event_name: "UserPromptSubmit", prompt: "" }, null, 1)).toBeNull();
  expect(buildCodexSidecar({ hook_event_name: "PostToolUse", tool_name: "write_stdin", tool_input: {} }, null, 1)).toBeNull();
});

test("Stop always marks the turn idle, even with no fresh narration", () => {
  // The turn-end signal must fire regardless of narration, so a pane whose plan step
  // was never completed stops reading as Running the moment the turn finishes.
  const sidecar = buildCodexSidecar({ hook_event_name: "Stop" }, null, 1);
  expect(sidecar?.turn).toBe("idle");
});

test("Notification marks the turn waiting", () => {
  const sidecar = buildCodexSidecar({ hook_event_name: "Notification" }, { todos: [], userTask: "x" }, 1);
  expect(sidecar?.turn).toBe("waiting");
});
