import { expect, test } from "@playwright/test";
import { lastAssistantReply, paneChatFromSidecars } from "../src/lib/lastReply";

// A reply taller than the pane must still be copyable whole (2026-09-29: a
// handoff prompt below the fold of a fullscreen Claude pane could not be copied).
const handoff = "Paste this into the new instance:\n\n" + "line of the handoff\n".repeat(200);

test("Claude: the newest assistant text wins, tool results and partial lines are skipped", () => {
  const record = [
    '{"type":"assistant","message":{"content":[{"type":"text","text":"old ans',
    JSON.stringify({ type: "user", message: { content: "please write the handoff" } }),
    JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Working on it." }] } }),
    JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash" }] } }),
    JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", content: "ok" }] } }),
    JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: handoff }] } }),
    JSON.stringify({ type: "system", subtype: "turn_duration" }),
  ].join("\n");
  expect(lastAssistantReply("claude", record)).toBe(handoff.trim());
});

test("Codex: the newest assistant message wins", () => {
  const record = [
    JSON.stringify({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "go" }] } }),
    JSON.stringify({ type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Checking." }] } }),
    JSON.stringify({ type: "event_msg", payload: { type: "agent_message", message: handoff } }),
  ].join("\n");
  expect(lastAssistantReply("codex", record)).toBe(handoff.trim());
});

test("no reply yet gives nothing rather than something invented", () => {
  expect(lastAssistantReply("claude", JSON.stringify({ type: "user", message: { content: "hi" } }))).toBeUndefined();
  expect(lastAssistantReply(undefined, "")).toBeUndefined();
});

test("the pane's own newest chat is chosen, never another pane's", () => {
  const sidecars = [
    JSON.stringify({ paneId: "terminal-a", provider: "claude", sessionId: "old", updatedAt: 1 }),
    JSON.stringify({ paneId: "terminal-b", provider: "codex", sessionId: "other", updatedAt: 9 }),
    JSON.stringify({ paneId: "terminal-a", provider: "claude", sessionId: "new", updatedAt: 5 }),
    "{broken",
  ];
  expect(paneChatFromSidecars("terminal-a", sidecars)).toEqual({ provider: "claude", sessionId: "new" });
  expect(paneChatFromSidecars("terminal-z", sidecars)).toBeUndefined();
});
