import { expect, test } from "@playwright/test";
import {
  parseClaudeTranscript,
  parseCodexRollout,
  parseTranscript,
} from "../src/lib/sessionTranscript";

// TC-060: Claude Code and Codex write these records themselves, with no hook
// involved — this is the source that covers hand-started and long-running panes,
// the exact class that used to render "Task not captured".

const CLAUDE_TAIL = [
  JSON.stringify({
    type: "ai-title",
    aiTitle: "Investigate e2e redirect",
    sessionId: "s1",
  }),
  JSON.stringify({
    type: "last-prompt",
    lastPrompt: "[Image #1] fix the redirect please",
    sessionId: "s1",
  }),
  JSON.stringify({
    type: "assistant",
    timestamp: "2026-07-22T10:00:00.000Z",
    message: {
      content: [
        {
          type: "tool_use",
          name: "Read",
          input: { file_path: "/a/b/gridRenderer.ts" },
        },
      ],
    },
  }),
  JSON.stringify({
    type: "user",
    timestamp: "2026-07-22T10:00:05.000Z",
    message: { content: [] },
  }),
].join("\n");

test("extracts the vendor title, the operator's own words, and the current tool", () => {
  const facts = parseClaudeTranscript(CLAUDE_TAIL);
  expect(facts.title).toBe("Investigate e2e redirect");
  expect(facts.operatorRequest).toBe("fix the redirect please");
  expect(facts.lastTool).toEqual({ name: "Read", arg: "gridRenderer.ts" });
  expect(facts.lastActivityAt).toBe(Date.parse("2026-07-22T10:00:05.000Z"));
});

test("a truncated first line never throws", () => {
  const facts = parseClaudeTranscript(`{"type":"ai-ti\n${CLAUDE_TAIL}`);
  expect(facts.title).toBe("Investigate e2e redirect");
});

test("a subagent's tool call is not the pane's activity", () => {
  const withSidechain = `${CLAUDE_TAIL}\n${JSON.stringify({
    type: "assistant",
    isSidechain: true,
    timestamp: "2026-07-22T10:00:09.000Z",
    message: {
      content: [{ type: "tool_use", name: "Grep", input: { pattern: "x" } }],
    },
  })}`;
  expect(parseClaudeTranscript(withSidechain).lastTool).toEqual({
    name: "Read",
    arg: "gridRenderer.ts",
  });
});

test("an unrecognised format yields no facts instead of throwing", () => {
  expect(parseClaudeTranscript("not json at all\n{}\n")).toEqual({});
});

const CODEX_TAIL = [
  JSON.stringify({
    timestamp: "2026-07-22T09:00:00.000Z",
    type: "event_msg",
    payload: { type: "user_message", message: "make the sidebar sort by name" },
  }),
  JSON.stringify({
    timestamp: "2026-07-22T09:00:01.000Z",
    type: "event_msg",
    payload: { type: "task_started", turn_id: "t1" },
  }),
  JSON.stringify({
    timestamp: "2026-07-22T09:00:02.000Z",
    type: "response_item",
    payload: { type: "function_call", name: "exec_command" },
  }),
  JSON.stringify({
    timestamp: "2026-07-22T09:00:09.000Z",
    type: "event_msg",
    payload: {
      type: "task_complete",
      turn_id: "t1",
      last_agent_message: "Done.",
    },
  }),
].join("\n");

test("codex: operator words, current tool, and a real turn end", () => {
  const facts = parseCodexRollout(CODEX_TAIL);
  expect(facts.operatorRequest).toBe("make the sidebar sort by name");
  expect(facts.lastTool).toEqual({ name: "exec_command", arg: undefined });
  expect(facts.lastTurnEndAt).toBe(Date.parse("2026-07-22T09:00:09.000Z"));
});

test("a turn end that precedes newer work is not treated as the latest state", () => {
  const resumed = `${CODEX_TAIL}\n${JSON.stringify({
    timestamp: "2026-07-22T09:00:20.000Z",
    type: "event_msg",
    payload: { type: "task_started", turn_id: "t2" },
  })}`;
  expect(parseCodexRollout(resumed).lastTurnEndAt).toBeUndefined();
});

test("parseTranscript dispatches on provider", () => {
  expect(parseTranscript("codex", CODEX_TAIL).operatorRequest).toBe(
    "make the sidebar sort by name",
  );
  expect(parseTranscript("mystery", CODEX_TAIL)).toEqual({});
});

test("codex: the agent's own first sentence is captured, JSON blobs are not", () => {
  const withProse = `${CODEX_TAIL}\n${JSON.stringify({
    timestamp: "2026-07-22T09:00:12.000Z",
    type: "event_msg",
    payload: {
      type: "agent_message",
      message: "I am checking the live persisted interview again. If it is still waiting, I will harden the next boundary.",
    },
  })}`;
  expect(parseCodexRollout(withProse).agentSaid).toBe("I am checking the live persisted interview again.");

  const withJson = `${CODEX_TAIL}\n${JSON.stringify({
    timestamp: "2026-07-22T09:00:13.000Z",
    type: "event_msg",
    payload: { type: "agent_message", message: '{"risk_level":"medium","outcome":"allow"}' },
  })}`;
  expect(parseCodexRollout(withJson).agentSaid).toBeUndefined();
});
