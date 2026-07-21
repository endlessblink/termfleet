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

test("a new session does not promote its raw prompt to the main task", () => {
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
  expect(sidecar?.mainTask).toBeUndefined();
  expect(sidecar?.userTask).toBe("Improve the live-events landing page and routes");
  expect(sidecar?.todos).toEqual([]);
  expect(sidecar?.now).toBe("Prompt submitted");
});

test("follow-ups keep the declared main task and real checklist", () => {
  const previous = {
    sessionId: "s1",
    mainTask: "Improving the live-events landing page and routes",
    mainTaskSource: "plan-explanation",
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

test("a declared plan owns the main task and current step separately", () => {
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
    { userTask: "Make it clear where I am working", todos: [] },
    1_200,
  );
  expect(sidecar?.mainTask).toBe(mission);
  expect(sidecar?.mainTaskSource).toBe("plan-explanation");
  expect(sidecar?.now).toBe("Reviewing the landing page on mobile");
  expect(sidecar?.todos).toHaveLength(2);
});

test("turn completion cannot replace the declared main task", () => {
  const previous = {
    mainTask: "Improving the live-events landing page and routes",
    mainTaskSource: "plan-explanation",
    userTask: "you will inform me when you are done and give me a count",
    todos: [{ content: "Reviewing the landing page on mobile", status: "in_progress", activeForm: "" }],
  };
  const sidecar = buildCodexSidecar(
    {
      hook_event_name: "Stop",
      last_assistant_message: "Done. Next steps: check desktop and mobile.",
      cwd: "/repo",
    },
    previous,
    1_300,
  );
  expect(sidecar?.mainTask).toBe(previous.mainTask);
  expect(sidecar?.userTask).toBe(previous.userTask);
  expect(sidecar?.turn).toBe("idle");
});

test("a new session clears the prior pane mission until a goal is declared", () => {
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
  expect(sidecar?.mainTask).toBeUndefined();
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
  expect(sidecar?.mainTask).toBe("Improving deployment reliability");
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
    mainTaskSource: "plan-explanation",
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

test("a Personal Assistant layout plan captures the user-facing outcome", () => {
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

  expect(sidecar?.mainTask).toBe("Replacing the crowded Hermes Personal Assistant panel with on-demand controls");
  expect(sidecar?.now).toBe("Writing tests for the compact assistant controls");
});

test("an email-consent plan captures why every signup path is being searched", () => {
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

  expect(sidecar?.mainTask).toBe("Making email signup mandatory across every Bina registration flow");
  expect(sidecar?.now).toBe("Finding every email signup and consent path");
});

test("a billing deployment plan preserves the customer outcome", () => {
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

  expect(sidecar?.mainTask).toBe("Making renewals and checkout safe while refunding Lee and granting Levana free July access");
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
    { mainTask: "Fix restart", mainTaskSource: "plan-explanation", todos: [], userTask: "x" },
    1,
  );
  expect(sidecar?.turn).toBe("waiting");
  expect(sidecar?.mainTask).toBe("Fix restart");
  expect(sidecar?.mainTaskSource).toBe("plan-explanation");
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

test("a completed plan update cannot replace the durable goal with completion prose", () => {
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
  expect(sidecar?.mainTask).toBe(previous.mainTask);
  expect(sidecar?.mainTaskSource).toBe(previous.mainTaskSource);
});

test("an untyped notification preserves the prior lifecycle", () => {
  const sidecar = buildCodexSidecar(
    { hook_event_name: "Notification" },
    { todos: [], userTask: "x", turn: "idle" },
    1,
  );
  expect(sidecar?.turn).toBe("idle");
});
