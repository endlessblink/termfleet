import { expect, test } from "@playwright/test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error plain .mjs helper
import { appendUserWords, claudeUserMessages, codexUserMessages, userMessagesFor, WORDS_BEGIN } from "../scripts/lib/handoff-user-words.mjs";

const claudeLine = (content: unknown, extra = {}) => JSON.stringify({ type: "user", timestamp: "t", message: { content }, ...extra });

test("only what Noam typed is collected, verbatim; harness text and tool results are not", () => {
  const text = [
    claudeLine("fix the dropoff"),
    claudeLine([{ type: "tool_result", content: "x" }]),
    claudeLine("<system-reminder>noise</system-reminder>"),
    claudeLine("meta", { isMeta: true }),
    claudeLine("and also the 50% thing"),
    JSON.stringify({ type: "attachment", attachment: { type: "queued_command", prompt: "typed mid-turn", origin: { kind: "human" }, timestamp: "t2" } }),
    JSON.stringify({ type: "attachment", attachment: { type: "queued_command", prompt: "from a task", origin: { kind: "task-notification" } } }),
  ].join("\n");
  expect(claudeUserMessages(text).map((m: { text: string }) => m.text)).toEqual(["fix the dropoff", "and also the 50% thing", "typed mid-turn"]);
  const rollout = JSON.stringify({ timestamp: "t", type: "event_msg", payload: { type: "user_message", message: "codex words" } });
  expect(codexUserMessages(rollout).map((m: { text: string }) => m.text)).toEqual(["codex words"]);
});

test("the block is appended once and refreshed, never duplicated", () => {
  const dir = mkdtempSync(join(tmpdir(), "tf-words-"));
  const file = join(dir, "HANDOFF.md");
  writeFileSync(file, "# handoff\nbody\n");
  expect(appendUserWords(file, [{ at: "a", text: "one" }])).toBe(1);
  expect(appendUserWords(file, [{ at: "a", text: "one" }, { at: "b", text: "two\nlines" }])).toBe(2);
  const out = readFileSync(file, "utf8");
  expect(out.split(WORDS_BEGIN).length).toBe(2);
  expect(out).toContain("> two\n   > lines");
  expect(out.startsWith("# handoff\nbody\n")).toBe(true);
});

test("the caller's own Claude session record is found by id", () => {
  const home = mkdtempSync(join(tmpdir(), "tf-home-"));
  const id = "11111111-2222-3333-4444-555555555555";
  mkdirSync(join(home, ".claude", "projects", "-proj"), { recursive: true });
  writeFileSync(join(home, ".claude", "projects", "-proj", `${id}.jsonl`), claudeLine("hello"));
  expect(userMessagesFor({ provider: "claude", sessionId: id, home }).length).toBe(1);
  expect(userMessagesFor({ provider: "claude", sessionId: "../x", home })).toEqual([]);
});

test("a long session keeps the opening request and the newest messages, and says what it left out", () => {
  const dir = mkdtempSync(join(tmpdir(), "tf-words-"));
  const file = join(dir, "HANDOFF.md");
  writeFileSync(file, "# handoff\n");
  const many = Array.from({ length: 60 }, (_, i) => ({ at: String(i), text: `message ${i} ${"x".repeat(1500)}` }));
  appendUserWords(file, many);
  const out = readFileSync(file, "utf8");
  expect(out).toContain("message 0 ");
  expect(out).toContain("message 59 ");
  expect(out).not.toContain("message 5 x");
  expect(out).toContain("older messages in between are not quoted");
});
