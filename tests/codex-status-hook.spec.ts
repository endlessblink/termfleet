import { expect, test } from "@playwright/test";
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
  expect(sidecar?.userTask).toBe("go over everything and get it ready to merge");
  expect(sidecar?.todos).toEqual([]);
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

test("nothing worth writing returns null (no empty sidecar churn)", () => {
  expect(buildCodexSidecar({ hook_event_name: "UserPromptSubmit", prompt: "" }, null, 1)).toBeNull();
  expect(buildCodexSidecar({ hook_event_name: "PostToolUse", tool_name: "write_stdin", tool_input: {} }, null, 1)).toBeNull();
  expect(buildCodexSidecar({ hook_event_name: "Stop" }, null, 1)).toBeNull();
});
