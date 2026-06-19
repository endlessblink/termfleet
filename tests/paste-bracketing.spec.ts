import { expect, test } from "@playwright/test";
import { encodePaste, shouldBracketAgentPromptPaste } from "../src/lib/keymap";

// TC-033 T3: pasting multi-line / large text into an on-screen agent TUI must be
// force-wrapped in bracketed-paste markers even when the PTY hasn't reported
// bracketed mode, or the paste duplicates / garbles / auto-runs.

const AGENT_SCREEN = [
  "› ",
  "gpt-5.5 default · ~",
  "tab to queue message            45% context left",
].join("\n");

const PLAIN_SHELL = ["user@host:~/proj$ ", ""].join("\n");

test("multi-line paste into a visible agent prompt is bracketed", () => {
  expect(shouldBracketAgentPromptPaste("line one\nline two", AGENT_SCREEN)).toBe(true);
});

test("a long single-line paste into an agent prompt is bracketed", () => {
  expect(shouldBracketAgentPromptPaste("x".repeat(200), AGENT_SCREEN)).toBe(true);
});

test("a short single-line paste is left raw", () => {
  expect(shouldBracketAgentPromptPaste("ls -la", AGENT_SCREEN)).toBe(false);
});

test("multi-line paste into a plain shell (no agent) is not force-bracketed", () => {
  expect(shouldBracketAgentPromptPaste("line one\nline two", PLAIN_SHELL)).toBe(false);
});

test("encodePaste wraps with bracketed markers and normalizes newlines", () => {
  const encoded = encodePaste("a\nb", true);
  expect(encoded).toBe("\x1b[200~a\rb\x1b[201~");
  expect(encodePaste("a\nb", false)).toBe("a\rb");
});
