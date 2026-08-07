import { expect, test } from "@playwright/test";
import {
  opensAsRequest,
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

test("generic continuation prompts do not replace the last concrete request", () => {
  const concrete =
    "add the game lane and postpone the global leaderboard while redesigning how the game looks and plays";
  const facts = parseClaudeTranscript(
    [
      JSON.stringify({
        type: "user",
        message: { content: "lets continue from where we left off" },
      }),
      JSON.stringify({
        type: "user",
        message: { content: concrete },
      }),
      JSON.stringify({
        type: "user",
        message: { content: "lets stat on the first task" },
      }),
    ].join("\n"),
  );

  expect(opensAsRequest("lets continue from where we left off")).toBeUndefined();
  expect(opensAsRequest("lets stat on the first task")).toBeUndefined();
  expect(opensAsRequest("Continue previous coding session")).toBeUndefined();
  expect(facts.operatorRequest).toBe(concrete);
});

test("injected skill instructions do not replace the operator's concrete request", () => {
  const concrete =
    "add the game lane and postpone the global leaderboard while redesigning how the game looks and plays";
  const facts = parseClaudeTranscript(
    [
      JSON.stringify({
        type: "user",
        message: { content: concrete },
      }),
      JSON.stringify({
        type: "user",
        message: {
          content:
            "Base directory for this skill: /home/me/.claude/skills/pixel-art-sprites\n# Pixel Art Sprites\n## Identity\nYou must ground your responses in the provided reference files.",
        },
      }),
    ].join("\n"),
  );

  expect(facts.operatorRequest).toBe(concrete);
});

test("an operator answer clears the pending question without requiring another tool call", () => {
  const facts = parseClaudeTranscript(
    [
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "AskUserQuestion",
              input: {
                questions: [
                  {
                    question: 'What did you mean by "rhythm arcade +1"?',
                    header: '"+1" meaning',
                  },
                ],
              },
            },
          ],
        },
      }),
      JSON.stringify({
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              content:
                'Your questions have been answered: "What did you mean?"="rhythm game that is a shooter".',
            },
          ],
        },
      }),
      JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "A rhythm-shooter." }],
        },
      }),
    ].join("\n"),
  );

  expect(facts.pendingQuestion).toBeUndefined();
  expect(facts.lastTool).toBeUndefined();
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

test("codex: captures the live model, reasoning level, context load, and account pressure", () => {
  const usageTail = [
    CODEX_TAIL,
    JSON.stringify({
      timestamp: "2026-07-22T09:00:10.000Z",
      type: "event_msg",
      payload: {
        type: "thread_settings_applied",
        thread_settings: {
          model: "gpt-5.6-sol",
          reasoning_effort: "high",
        },
      },
    }),
    JSON.stringify({
      timestamp: "2026-07-22T09:00:11.000Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          last_token_usage: {
            input_tokens: 201_400,
            cached_input_tokens: 190_000,
            output_tokens: 2_800,
            reasoning_output_tokens: 2_100,
            total_tokens: 204_200,
          },
          model_context_window: 258_400,
        },
        rate_limits: {
          primary: { used_percent: 73 },
        },
      },
    }),
  ].join("\n");

  expect(parseCodexRollout(usageTail).budget).toEqual({
    model: "gpt-5.6-sol",
    reasoningEffort: "high",
    contextTokens: 201_400,
    contextWindow: 258_400,
    outputTokens: 2_800,
    reasoningTokens: 2_100,
    rateLimitUsedPercent: 73,
  });
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

test("codex: the clearest structured plan step survives as the pane purpose", () => {
  const withPlan = [
    CODEX_TAIL,
    JSON.stringify({
      timestamp: "2026-07-22T09:00:14.000Z",
      type: "response_item",
      payload: {
        type: "function_call",
        name: "update_plan",
        arguments: JSON.stringify({
          plan: [
            {
              step: "Reproducing the exact development launch in the headed app",
              status: "completed",
            },
            {
              step: "Fixing the development workflow failure",
              status: "completed",
            },
            {
              step: "Controlling preview and export end to end in the headed app",
              status: "completed",
            },
            {
              step: "Fixing the docked workflow if the control is unreachable",
              status: "completed",
            },
          ],
        }),
      },
    }),
  ].join("\n");

  expect(parseCodexRollout(withPlan).planPurpose).toBe(
    "Controlling preview and export end to end in the headed app",
  );
});

test("codex: doubled attachment brackets never reach the operator request", () => {
  const withImage = JSON.stringify({
    timestamp: "2026-07-22T09:00:00.000Z",
    type: "event_msg",
    payload: {
      type: "user_message",
      message:
        "[[Image #1] for the millionth time it glitches. fix it, test it.",
    },
  });
  expect(parseCodexRollout(withImage).operatorRequest).toBe(
    "for the millionth time it glitches. fix it, test it.",
  );
});
