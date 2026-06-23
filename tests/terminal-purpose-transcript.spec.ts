import { expect, test } from "@playwright/test";
import { normalizePersistedShellSummary, terminalPurposeFromContext } from "../src/lib/terminalHeaderDisplay";
import type { WorkstreamStatusSummary } from "../src/lib/types";

// TC-033 T5: the transcript-derived "terminal purpose" must not latch onto prompt
// chrome / slash-command placeholder hints (e.g. "› Use /skills to list available
// skills"), because applyTerminalPurpose overrides the header title with it —
// burying the real summarized task ("translate to hebrew").

const TRANSCRIPT = [
  "translate to hebrew",
  "What changed:",
  "- server-side quality gate now validates generated posts",
  "- editor button regression passed",
  "› Use /skills to list available skills",
  "gpt-5.5 default · ~",
].join("\n");

test("transcript purpose ignores slash-command prompt chrome", () => {
  const purpose = terminalPurposeFromContext({ terminalOutput: TRANSCRIPT, now: 1_000 });
  expect(purpose?.title ?? "").not.toMatch(/use \/skills|list available skills/i);
});

test("shell header keeps the summarized task instead of prompt chrome", () => {
  const purpose = terminalPurposeFromContext({ terminalOutput: TRANSCRIPT, now: 1_000 });
  const extracted: WorkstreamStatusSummary = {
    task: "translate to hebrew",
    path: "workspace path unknown",
    now: "server-side quality gate now validates generated posts",
    status: "working",
    provider: "shell",
    confidence: "low",
  };
  const summary = normalizePersistedShellSummary(extracted, "workspace path unknown", purpose);
  expect(summary.task).toBe("translate to hebrew");
  expect(summary.now).toBe("server-side quality gate now validates generated posts");
});

test("transcript purpose ignores gibberish input-box text", () => {
  const transcript = [
    "translate to hebrew",
    "Verified:",
    "- production route: 200 OK",
    "› sfgdsafgd ||> sfgdsafg ||> sfgdsaf",
    "gpt-5.5 default · ~",
  ].join("\n");
  const purpose = terminalPurposeFromContext({ terminalOutput: transcript, now: 1_000 });
  expect(purpose?.title ?? "").not.toMatch(/sfgdsaf/i);
});

test("an actionable typed prompt is still recognized as the purpose", () => {
  const purpose = terminalPurposeFromContext({
    terminalOutput: ["Working (2m • esc to interrupt)", "› fix the terminal summary header flicker"].join("\n"),
    now: 1_000,
  });
  expect(purpose?.title).toMatch(/terminal summary header/i);
});

test("a task-binding title still wins over transcript chrome", () => {
  const purpose = terminalPurposeFromContext({
    boundTaskTitle: "LLM task extraction lane",
    terminalOutput: TRANSCRIPT,
    now: 1_000,
  });
  expect(purpose?.title).toBe("LLM task extraction lane");
});

test("an unsubstituted @filename prompt placeholder is not surfaced as a title (TC-035)", () => {
  const purpose = terminalPurposeFromContext({
    terminalOutput: ["Working (3m • esc to interrupt)", "› Improve documentation in @filename"].join("\n"),
    now: 1_000,
  });
  // It's input-box chrome, not real work — must fall through to neutral, not become the title.
  expect(purpose?.title ?? "").not.toMatch(/@filename/i);
  expect(purpose?.title ?? "").not.toMatch(/Improve documentation/i);
});
