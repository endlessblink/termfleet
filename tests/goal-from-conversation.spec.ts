import { expect, test } from "@playwright/test";
import { goalFromLongText, parseCodexOpeningRequest, parseCodexRollout } from "../src/lib/sessionTranscript";
// @ts-expect-error — plain ESM helper shared with the status hooks
import { durableGoalForPrompt, goalFromLongText as hookGoalFromLongText } from "../scripts/lib/agent-status-goal.mjs";

// Live case 2026-09-24: a Codex pane opened with a long, detailed request, then the
// operator asked follow-ups. The Goal row showed the 4th follow-up ("why repo? we were
// talking about the wider pc") because every goal over 220 characters was discarded
// and current Codex records no longer carry `user_message` events.
const LONG_OPENING =
  "there is a total mess and dupliation across my content across my system. scan data drive, samsung docker and home and media drives and suggest a clear minimalistic, space saving and clear for human use structure";

function rollout(records: unknown[]) {
  return records.map((record) => JSON.stringify(record)).join("\n");
}
const userMessage = (text: string) => ({
  type: "response_item",
  timestamp: "2026-09-23T18:08:00.000Z",
  payload: { type: "message", role: "user", content: [{ type: "input_text", text }] },
});
const agentMessage = (text: string) => ({
  type: "response_item",
  timestamp: "2026-09-23T18:09:00.000Z",
  payload: { type: "message", role: "assistant", content: [{ type: "output_text", text }] },
});

test("a long opening request keeps its first sentence instead of being dropped", () => {
  expect(goalFromLongText(LONG_OPENING)).toBe(
    "there is a total mess and dupliation across my content across my system.",
  );
  expect(hookGoalFromLongText(LONG_OPENING)).toBe(goalFromLongText(LONG_OPENING));
  expect(goalFromLongText("fix the login bug")).toBe("fix the login bug");
});

test("the status hook keeps the long opening request as the goal through follow-ups", () => {
  const first = durableGoalForPrompt({ prompt: LONG_OPENING, sessionId: "s1" });
  expect(first.mainTask).toBe("there is a total mess and dupliation across my content across my system.");
  const later = durableGoalForPrompt({
    prompt: "why repo? we were talking about the wider pc",
    previousGoal: first.mainTask,
    previousSource: first.mainTaskSource,
    previousSessionId: "s1",
    sessionId: "s1",
  });
  expect(later.mainTask).toBe(first.mainTask);
});

test("current Codex records: opening, latest request and agent words come from response items", () => {
  const text = rollout([
    userMessage("# AGENTS.md instructions for /home/demo/project\n<INSTRUCTIONS>be careful</INSTRUCTIONS>"),
    userMessage(LONG_OPENING),
    agentMessage("I scanned the drives and found three duplicate photo folders. Next I will propose a layout."),
    userMessage("give me a proper breakdown in a table"),
    userMessage("why repo? we were talking about the wider pc"),
  ]);
  expect(parseCodexOpeningRequest(text)).toBe(LONG_OPENING);
  const facts = parseCodexRollout(text);
  expect(facts.operatorRequest).toBe("why repo? we were talking about the wider pc");
  expect(facts.agentSaid).toContain("I scanned the drives");
});
