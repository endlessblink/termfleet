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

test("a new session persists its first substantive request as the main goal", () => {
  const sidecar = buildCodexSidecar(
    {
      hook_event_name: "UserPromptSubmit",
      prompt: "Improve the live-events landing page and routes",
      cwd: "/repo",
      session_id: "s1",
    },
    null,
    1_000,
  );
  expect(sidecar?.mainTask).toBe("Improve the live-events landing page and routes");
  expect(sidecar?.mainTaskSource).toBe("opening-request");
  expect(sidecar?.userTask).toBe("Improve the live-events landing page and routes");
  expect(sidecar?.todos).toEqual([]);
  expect(sidecar?.now).toBe("Prompt submitted");
});

test("a complaint with an attachment marker is never persisted as the opening goal", () => {
  const sidecar = buildCodexSidecar(
    {
      hook_event_name: "UserPromptSubmit",
      prompt:
        "[[Image #1] for the millionth time it glitches. fix it, test it.",
      cwd: "/repo",
      session_id: "s1",
    },
    null,
    1_000,
  );
  expect(sidecar?.mainTask).toBeUndefined();
  expect(sidecar?.mainTaskSource).toBeUndefined();
  expect(sidecar?.userTask).toBe(
    "[[Image #1] for the millionth time it glitches. fix it, test it.",
  );
});

test("operator frustration is never persisted as a durable opening goal", () => {
  const sidecar = buildCodexSidecar(
    {
      hook_event_name: "UserPromptSubmit",
      prompt: "you are working for hours with nothing to show for it",
      cwd: "/repo/termfleet",
      session_id: "s1",
    },
    null,
    1_025,
  );
  expect(sidecar?.mainTask).toBeUndefined();
  expect(sidecar?.mainTaskSource).toBeUndefined();
});

test("goal-management wording is never persisted as the opening goal", () => {
  const sidecar = buildCodexSidecar(
    {
      hook_event_name: "UserPromptSubmit",
      prompt: "make this a goal",
      cwd: "/repo",
      session_id: "s1",
    },
    null,
    1_050,
  );
  expect(sidecar?.mainTask).toBeUndefined();
  expect(sidecar?.mainTaskSource).toBeUndefined();
});

test("an invalid persisted goal is cleared instead of surviving a follow-up", () => {
  const sidecar = buildCodexSidecar(
    {
      hook_event_name: "UserPromptSubmit",
      prompt: "the task description is still super broken",
      cwd: "/repo",
      session_id: "s1",
    },
    {
      sessionId: "s1",
      mainTask: "broken hard fail. check every pane's Task, Goal, and Now",
      mainTaskSource: "opening-request",
      userTask: "low quality",
      todos: [],
    },
    1_075,
  );
  expect(sidecar?.mainTask).toBeUndefined();
  expect(sidecar?.mainTaskSource).toBeUndefined();
});

test("tool events cannot resurrect a feedback message as the durable goal", () => {
  const sidecar = buildCodexSidecar(
    {
      hook_event_name: "PreToolUse",
      tool_name: "exec",
      cwd: "/repo/termfleet",
      session_id: "s1",
    },
    {
      sessionId: "s1",
      mainTask: "You're right to challenge that line. It is only a guard at the display boundary",
      mainTaskSource: "opening-request",
      userTask: "[Image #1] this is a fail on all three",
      todos: [],
    },
    1_085,
  );
  expect(sidecar?.mainTask).toBeUndefined();
  expect(sidecar?.mainTaskSource).toBeUndefined();
});

test("follow-ups keep the declared main task and real checklist", () => {
  const previous = {
    sessionId: "s1",
    mainTask: "Improving the live-events landing page and routes",
    mainTaskSource: "opening-request",
    userTask: "Make it clear where I am working",
    todos: [{ content: "Reviewing the landing page on mobile", status: "in_progress", activeForm: "" }],
  };
  const sidecar = buildCodexSidecar(
    {
      hook_event_name: "UserPromptSubmit",
      prompt: "you will inform me when you are done and give me a count",
      cwd: "/repo",
      session_id: "s1",
    },
    previous,
    1_100,
  );
  expect(sidecar?.mainTask).toBe(previous.mainTask);
  expect(sidecar?.mainTaskSource).toBe(previous.mainTaskSource);
  expect(sidecar?.userTask).toBe("you will inform me when you are done and give me a count");
  expect(sidecar?.todos).toEqual(previous.todos);
  expect(sidecar?.now).toBe("Reviewing the landing page on mobile");
});

test("resume-goal follow-ups recover a legacy opening request", () => {
  const sidecar = buildCodexSidecar(
    {
      hook_event_name: "UserPromptSubmit",
      prompt: "resume goal",
      cwd: "/repo",
      session_id: "s1",
    },
    {
      sessionId: "s1",
      mainTask: undefined,
      userTask: "Improve the live-events landing page and routes",
      todos: [{ content: "Verifying the rendered page", status: "in_progress" }],
    },
    1_150,
  );

  expect(sidecar?.mainTask).toBe("Improve the live-events landing page and routes");
  expect(sidecar?.userTask).toBe("resume goal");
});

test("a plan explanation cannot replace the durable user goal", () => {
  const mission = "Improving the live-events landing page and routes";
  const sidecar = buildCodexSidecar(
    {
      tool_name: "update_plan",
      tool_input: {
        explanation: mission,
        plan: [
          { step: "Changing the live-event routes", status: "completed" },
          { step: "Reviewing the landing page on mobile", status: "in_progress" },
        ],
      },
      cwd: "/repo",
    },
    {
      mainTask: "Make it clear where I am working",
      mainTaskSource: "opening-request",
      userTask: "Make it clear where I am working",
      todos: [],
    },
    1_200,
  );
  expect(sidecar?.mainTask).toBe("Make it clear where I am working");
  expect(sidecar?.mainTaskSource).toBe("opening-request");
  expect(sidecar?.now).toBe("Reviewing the landing page on mobile");
  expect(sidecar?.todos).toHaveLength(2);
});

test("a plan explanation cannot become the first durable user goal", () => {
  const sidecar = buildCodexSidecar(
    {
      tool_name: "update_plan",
      tool_input: {
        explanation: "Re-auditing the current implementation and live state before the final installed/rendered gate.",
        plan: [{ step: "Re-audit live pane records and capture sources", status: "in_progress" }],
      },
      cwd: "/repo",
    },
    { userTask: "[Image #1] this is a fail on all three", todos: [] },
    1_201,
  );

  expect(sidecar?.mainTask).toBeUndefined();
  expect(sidecar?.mainTaskSource).toBeUndefined();
  expect(sidecar?.now).toBe("Re-audit live pane records and capture sources");
});

test("turn completion cannot replace the declared main task", () => {
  const previous = {
    mainTask: "Improving the live-events landing page and routes",
    mainTaskSource: "opening-request",
    userTask: "you will inform me when you are done and give me a count",
    todos: [{ content: "Reviewing the landing page on mobile", status: "in_progress", activeForm: "" }],
  };
  const sidecar = buildCodexSidecar(
    {
      hook_event_name: "Stop",
      last_assistant_message: "The release candidate is ready. Next steps: check desktop and mobile.",
      cwd: "/repo",
    },
    previous,
    1_300,
  );
  expect(sidecar?.mainTask).toBe(previous.mainTask);
  expect(sidecar?.userTask).toBe(previous.userTask);
  expect(sidecar?.turn).toBe("idle");
  expect(sidecar?.now).toBe("The release candidate is ready");
});

test("a new session replaces the prior goal with its own opening request", () => {
  const sidecar = buildCodexSidecar(
    {
      hook_event_name: "UserPromptSubmit",
      prompt: "Fix the checkout page",
      cwd: "/repo",
      session_id: "s2",
    },
    {
      sessionId: "s1",
      mainTask: "Improve the landing page",
      mainTaskSource: "plan-explanation",
      userTask: "old follow-up",
      todos: [{ content: "Review mobile", status: "completed", activeForm: "" }],
    },
    1_400,
  );
  expect(sidecar?.mainTask).toBe("Fix the checkout page");
  expect(sidecar?.mainTaskSource).toBe("opening-request");
  expect(sidecar?.todos).toEqual([]);
});

test("an ordinary prompt never manufactures checklist work", () => {
  const sidecar = buildCodexSidecar(
    { hook_event_name: "UserPromptSubmit", prompt: "why did this fail?", cwd: "/repo", session_id: "s1" },
    {
      sessionId: "s1",
      mainTask: "Improving deployment reliability",
      mainTaskSource: "plan-explanation",
      todos: [{ content: "Verify production", status: "completed", activeForm: "" }],
    },
    1_500,
  );
  expect(sidecar?.todos).toEqual([{ content: "Verify production", status: "completed", activeForm: "" }]);
  expect(sidecar?.mainTask).toBeUndefined();
});

test("create_goal becomes the durable cockpit mission instead of a plan step", () => {
  const sidecar = buildCodexSidecar(
    {
      hook_event_name: "PostToolUse",
      tool_name: "create_goal",
      tool_input: { objective: "Keep every live terminal clear about its work" },
      cwd: "/repo/termfleet",
    },
    {
      todos: [{ content: "Waiting for user-facing approval", status: "in_progress", activeForm: "" }],
      userTask: "not appearing",
    },
    1_600,
  );
  expect(sidecar?.mainTask).toBe("Keep every live terminal clear about its work");
  expect(sidecar?.mainTaskSource).toBe("goal-task");
  expect(sidecar?.now).toBe("Waiting for user-facing approval");
});

test("exec_command maps to readable activity and ignores navigation", () => {
  expect(codexActivityFromTool("exec_command", { command: "cargo test --workspace" })).toBe("Running: cargo test --workspace");
  expect(codexActivityFromTool("exec_command", { command: "cd /some/very/long/path" })).toBe("");
  expect(codexActivityFromTool("exec_command", { command: "cd repo && npm run build" })).toBe("Running: npm run build");
});

test("inline command bodies never leak into activity", () => {
  const activity = codexActivityFromTool("exec_command", {
    command: `node -e "const cases = ['a','b']; console.log(cases)"`,
  });
  expect(activity).toBe("Running: node -e");
  expect(activity).not.toContain("const cases");
});

test("tool activity preserves the mission and task list", () => {
  const previous = {
    mainTask: "Preparing the release",
    mainTaskSource: "opening-request",
    userTask: "ship it",
    todos: [{ content: "Build the app", status: "in_progress", activeForm: "" }],
  };
  const sidecar = buildCodexSidecar(
    { hook_event_name: "PostToolUse", tool_name: "exec_command", tool_input: { command: "npm run build" }, cwd: "/repo" },
    previous,
    2_000,
  );
  expect(sidecar?.mainTask).toBe(previous.mainTask);
  expect(sidecar?.mainTaskSource).toBe(previous.mainTaskSource);
  expect(sidecar?.todos).toEqual(previous.todos);
  expect(sidecar?.now).toBe("Build the app");
});

test("non-narration events do not retain stale narration", () => {
  const previous = {
    mainTask: "Fix restart",
    userTask: "old prompt",
    narration: "Old answer",
    todos: [{ content: "Fix the runtime source gap", status: "in_progress", activeForm: "" }],
  };
  const prompt = buildCodexSidecar(
    { hook_event_name: "UserPromptSubmit", prompt: "new prompt", cwd: "/repo" }, previous, 3_100,
  );
  const plan = buildCodexSidecar(
    { tool_name: "update_plan", tool_input: { plan: [{ step: "Fix the runtime source gap", status: "in_progress" }] }, cwd: "/repo" }, previous, 3_200,
  );
  const tool = buildCodexSidecar(
    { hook_event_name: "PostToolUse", tool_name: "exec_command", tool_input: { command: "npm test" }, cwd: "/repo" }, previous, 3_300,
  );
  expect(prompt?.narration).toBeUndefined();
  expect(plan?.narration).toBeUndefined();
  expect(tool?.narration).toBeUndefined();
});

test("update_plan becomes the real task list", () => {
  const todos = todosFromUpdatePlan({
    plan: [
      { step: "Read the failing test", status: "completed" },
      { step: "Fix the reconnect race", status: "in_progress" },
      { step: "Add a regression test", status: "pending" },
    ],
  });
  expect(todos).toHaveLength(3);
  expect(todos[1]).toMatchObject({ content: "Fix the reconnect race", status: "in_progress" });
});

test("a plan cannot invent a product goal or preserve an old completion report", () => {
  const sidecar = buildCodexSidecar({
    cwd: "/repo/hermes",
    tool_name: "update_plan",
    tool_input: {
      plan: [
        { step: "Writing tests for the compact assistant controls", status: "in_progress" },
        { step: "Replacing the large panel with a strip and drawer", status: "pending" },
        { step: "Checking the packaged Personal Assistant screen", status: "pending" },
      ],
    },
  }, {
    mainTask: "An unrelated completion report from the previous task.",
    mainTaskSource: "plan-explanation",
  }, 20);

  expect(sidecar?.mainTask).toBeUndefined();
  expect(sidecar?.now).toBe("Writing tests for the compact assistant controls");
});

test("a project-specific plan cannot manufacture a Bina goal", () => {
  const sidecar = buildCodexSidecar({
    cwd: "/repo/bina-meatzevet-courses",
    tool_name: "update_plan",
    tool_input: {
      plan: [
        { step: "Finding every email signup and consent path", status: "in_progress" },
        { step: "Making email signup mandatory everywhere", status: "pending" },
        { step: "Testing every affected registration flow", status: "pending" },
        { step: "Publishing the mandatory signup rule", status: "pending" },
      ],
    },
  }, { userTask: "make it mandatory everywhere" }, 21);

  expect(sidecar?.mainTask).toBeUndefined();
  expect(sidecar?.now).toBe("Finding every email signup and consent path");
});

test("a deployment checklist stays activity when no durable goal was captured", () => {
  const sidecar = buildCodexSidecar({
    cwd: "/repo/bina-meatzevet-courses",
    tool_name: "update_plan",
    tool_input: {
      plan: [
        { step: "Writing safety tests for renewal failures", status: "completed" },
        { step: "Fixing callback order and parallel checkout safety", status: "completed" },
        { step: "Refunding Lee and granting Levana the rest of July", status: "completed" },
        { step: "Deploying the fix and checking production", status: "in_progress" },
      ],
    },
  }, { userTask: "fix it end to end and give Levana the rest of July free" }, 22);

  expect(sidecar?.mainTask).toBeUndefined();
  expect(sidecar?.now).toBe("Deploying the fix and checking production");
});

test("codexLastAgentMessage prefers the direct payload", () => {
  expect(codexLastAgentMessage({ last_assistant_message: "Done wiring it up." })).toBe("Done wiring it up.");
});

test("codexLastAgentMessage scans only the recent transcript tail", () => {
  const dir = mkdtempSync(join(tmpdir(), "termfleet-codex-hook-"));
  const transcript = join(dir, "rollout.jsonl");
  const old = JSON.stringify({ type: "agent_message", message: "Old transcript task" });
  const latest = JSON.stringify({ type: "agent_message", message: "Now I will bound the status hook transcript scan." });
  writeFileSync(transcript, `${old}\n${"x".repeat(300 * 1024)}\n${latest}\n`);
  expect(codexLastAgentMessage({ transcript_path: transcript })).toBe("Now I will bound the status hook transcript scan.");
});

test("empty events do not churn the sidecar", () => {
  expect(buildCodexSidecar({ hook_event_name: "UserPromptSubmit", prompt: "" }, null, 1)).toBeNull();
  expect(buildCodexSidecar({ hook_event_name: "PostToolUse", tool_name: "write_stdin", tool_input: {} }, null, 1)).toBeNull();
});

test("a typed permission notification marks waiting without changing the mission", () => {
  const sidecar = buildCodexSidecar(
    { hook_event_name: "Notification", notification_type: "permission_prompt" },
    { mainTask: "Fix restart", mainTaskSource: "opening-request", todos: [], userTask: "x" },
    1,
  );
  expect(sidecar?.turn).toBe("waiting");
  expect(sidecar?.mainTask).toBe("Fix restart");
  expect(sidecar?.mainTaskSource).toBe("opening-request");
});

test("request_user_input waits before the answer and resumes after it", () => {
  const previous = {
    mainTask: "Completing the assistant repair safely",
    mainTaskSource: "plan-explanation",
    todos: [{ content: "Confirming the assistant repair is safely completed", status: "completed", activeForm: "" }],
    userTask: "x",
  };
  const waiting = buildCodexSidecar({
    hook_event_name: "PreToolUse",
    tool_name: "request_user_input",
    tool_input: { questions: [{ question: "Which behavior?" }] },
  }, previous, 10);
  expect(waiting?.turn).toBe("waiting");

  const resumed = buildCodexSidecar({
    hook_event_name: "PostToolUse",
    tool_name: "request_user_input",
    tool_input: { questions: [{ question: "Which behavior?" }] },
  }, waiting, 11);
  expect(resumed?.turn).toBe("working");
  expect(resumed?.now).toBe("Applying your answer to the assistant repair");
});

test("a completed plan update drops a legacy plan explanation instead of treating it as a goal", () => {
  const previous = {
    mainTask: "Making the personal assistant fast and dependable",
    mainTaskSource: "plan-explanation",
    todos: [{ content: "Verifying the assistant repair", status: "in_progress" }],
  };
  const sidecar = buildCodexSidecar({
    tool_name: "update_plan",
    tool_input: {
      explanation: "The Personal Assistant repair is committed and present on the remote branch.",
      plan: [{ step: "Confirming the assistant repair is safely completed", status: "completed" }],
    },
  }, previous, 12);
  expect(sidecar?.mainTask).toBeUndefined();
  expect(sidecar?.mainTaskSource).toBeUndefined();
});

test("an untyped notification preserves the prior lifecycle", () => {
  const sidecar = buildCodexSidecar(
    { hook_event_name: "Notification" },
    { todos: [], userTask: "x", turn: "idle" },
    1,
  );
  expect(sidecar?.turn).toBe("idle");
});
