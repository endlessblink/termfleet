import { expect, test } from "@playwright/test";
import { cleanTranscriptForSummary } from "../src/lib/agentStatusSummary";

// TC-033 T2: the transcript fed to the status summarizer must strip prompt chrome
// and collapse repeated lines so duplicated paste / verification payload can't
// dominate the AI summary (screenshot 2).

test("collapses repeated pasted lines to one", () => {
  const out =
    Array(10).fill("verification payload. TermFleet headed bracketed paste").join("\n") + "\nhi";
  const cleaned = cleanTranscriptForSummary(out);
  const count = cleaned.split("\n").filter((line) => line.includes("verification payload")).length;
  expect(count).toBe(1);
});

test("drops prompt chrome and spinner lines", () => {
  const out = [
    "fix the header flicker",
    "gpt-5.5 default · ~",
    "Working (2m • esc to interrupt)",
    "› Use /skills to list available skills",
  ].join("\n");
  const cleaned = cleanTranscriptForSummary(out);
  expect(cleaned).toContain("fix the header flicker");
  expect(cleaned).not.toMatch(/esc to interrupt|Use \/skills|gpt-5\.5 default/i);
});

test("keeps within the char budget, preserving the tail", () => {
  const out = Array.from({ length: 500 }, (_, i) => `line ${i} unique content here`).join("\n");
  const cleaned = cleanTranscriptForSummary(out, 200);
  expect(cleaned.length).toBeLessThanOrEqual(200);
  expect(cleaned).toContain("line 499");
});
