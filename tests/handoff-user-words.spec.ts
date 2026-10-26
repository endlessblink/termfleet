import { expect, test } from "@playwright/test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error plain .mjs helper
import { appendUserWords, claudeUserMessages, codexUserMessages, userMessagesFor, userMessagesForAny, WORDS_BEGIN } from "../scripts/lib/handoff-user-words.mjs";
// @ts-expect-error plain .mjs helper
import { threadChain } from "../scripts/termfleet-child.mjs";

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
  // Oct 7 capsule contract: structured metadata (tool results, isMeta, task-origin
  // queued commands) stays out, but literal user-role text that merely LOOKS like
  // harness markup is retained verbatim as unverified source, never re-classified
  // by its wording, and never treated as authorization.
  const got = claudeUserMessages(text);
  expect(got.map((m: { text: string }) => m.text)).toEqual(["fix the dropoff", "<system-reminder>noise</system-reminder>", "and also the 50% thing", "typed mid-turn"]);
  expect(got.map((m: { actor: string }) => m.actor)).toEqual(["provider-user-role", "provider-user-role", "provider-user-role", "human"]);
  for (const m of got) { expect(m.authorization).toBe("none"); expect(m.originVerified).toBe(false); }
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

test("a long session keeps every message, complete and chronological, with no middle omission", () => {
  // Oct 7 capsule contract replaced the old "opening + newest, middle not quoted"
  // truncation with a complete chronological corpus.
  const dir = mkdtempSync(join(tmpdir(), "tf-words-"));
  const file = join(dir, "HANDOFF.md");
  writeFileSync(file, "# handoff\n");
  const many = Array.from({ length: 60 }, (_, i) => ({ at: String(i), text: `message ${i} ${"x".repeat(1500)}` }));
  expect(appendUserWords(file, many)).toBe(60);
  const out = readFileSync(file, "utf8");
  expect(out.startsWith("# handoff\n")).toBe(true);
  let last = -1;
  for (const m of many) {
    const at = out.indexOf(`> ${m.text}\n`);
    expect(at, m.text.slice(0, 12)).toBeGreaterThan(last);
    last = at;
  }
  expect(out).not.toContain("older messages in between are not quoted");
});

test("Codex words come from the real user turns, verbatim and in order; nothing is reclassified by wording", () => {
  // Oct 7 capsule contract: user-role turns are retained verbatim as unverified
  // source records; look-alike harness text is not guessed away, and repeated
  // text without an explicit event id is not collapsed.
  const turn = (text: string) => JSON.stringify({ type: "response_item", timestamp: "t", payload: { type: "message", role: "user", content: [{ type: "input_text", text }] } });
  const rollout = [turn("# AGENTS.md instructions for x"), turn("<environment_context>"), turn("fix the gates"), turn("fix the gates"), turn("The following is the Codex agent history x")].join("\n");
  const got = codexUserMessages(rollout);
  expect(got.map((m: { text: string }) => m.text)).toEqual(["# AGENTS.md instructions for x", "<environment_context>", "fix the gates", "fix the gates", "The following is the Codex agent history x"]);
  expect(new Set(got.map((m: { id: string }) => m.id)).size).toBe(5);
  for (const m of got) { expect(m.actor).toBe("provider-user-role"); expect(m.authorization).toBe("none"); expect(m.originVerified).toBe(false); }
  const interrupted = claudeUserMessages(claudeLine("[Request interrupted by user for tool use]"));
  expect(interrupted.map((m: { text: string }) => m.text)).toEqual(["[Request interrupted by user for tool use]"]);
  expect(interrupted[0].authorization).toBe("none");
});

test("a stale chat id is skipped: the live id's record wins, and no record at all yields nothing", () => {
  const home = mkdtempSync(join(tmpdir(), "tf-home-"));
  const live = "aaaaaaaa-2222-3333-4444-555555555555";
  const stale = "bbbbbbbb-2222-3333-4444-555555555555";
  mkdirSync(join(home, ".claude", "projects", "-proj"), { recursive: true });
  writeFileSync(join(home, ".claude", "projects", "-proj", `${live}.jsonl`), claudeLine("typed one second before dropoff"));
  const got = userMessagesForAny({ provider: "claude", sessionIds: ["", stale, live], home });
  expect(got.map((m: { text: string }) => m.text)).toEqual(["typed one second before dropoff"]);
  expect(userMessagesForAny({ provider: "claude", sessionIds: ["", stale], home })).toEqual([]);
});

test("a Codex sub-agent thread resolves to the chat that started it, so its handover finds the right card", () => {
  const home = mkdtempSync(join(tmpdir(), "tf-home-"));
  const parent = "01a10000-0000-7000-8000-000000000001";
  const child = "01a10000-0000-7000-8000-000000000002";
  const dir = join(home, ".codex", "sessions", "2026", "10", "03");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `rollout-2026-10-03T21-00-00-${parent}.jsonl`), JSON.stringify({ type: "session_meta", payload: { id: parent } }));
  writeFileSync(join(dir, `rollout-2026-10-03T21-01-00-${child}.jsonl`), JSON.stringify({ type: "session_meta", payload: { id: child, parent_thread_id: parent } }));
  expect(threadChain(child, home)).toEqual([child, parent]);
  expect(threadChain(parent, home)).toEqual([parent]);
  expect(threadChain("", home)).toEqual([]);
});
