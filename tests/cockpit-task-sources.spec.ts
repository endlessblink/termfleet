import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  COCKPIT_TASK_SOURCES,
  isCockpitTaskSource,
} from "../scripts/lib/cockpit-task-sources.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/** The members of a `export type NAME =` string-literal union in a source file. */
function unionMembers(source: string, typeName: string): string[] {
  const block = source.match(
    new RegExp(`export type ${typeName}\\s*=([\\s\\S]*?)(?:\\nexport |\\n\\n\\S)`),
  )?.[1];
  return block ? [...block.matchAll(/"([^"]+)"/g)].map((match) => match[1]) : [];
}

// The doctor failed a fresh, correct cockpit snapshot with
// `unsupported task source(s): plan-explanation` because it kept its own allowlist
// next to the snapshot producer's and the two drifted. The vocabulary now has one
// owner; this guard is why it stays that way.
test("the shared task-source set covers every source a pane header can report", () => {
  const members = unionMembers(read("src/lib/terminalHeaderState.ts"), "TerminalHeaderGoalSource");
  expect(members.length).toBeGreaterThan(0);
  for (const member of members) {
    expect(COCKPIT_TASK_SOURCES, `TerminalHeaderGoalSource member "${member}"`).toContain(member);
    expect(isCockpitTaskSource(member)).toBe(true);
  }
  // Agent lanes stamp this instead of a terminal goal source (SplitPane.tsx).
  expect(isCockpitTaskSource("agent-status")).toBe(true);
});

test("the shared set still rejects invented or retired task sources", () => {
  for (const source of ["status-summary", "model", "scrape", "project-fallback", ""]) {
    expect(isCockpitTaskSource(source), `"${source}" must stay rejected`).toBe(false);
  }
});

test("both verifiers read the shared set instead of a local allowlist", () => {
  const doctor = read("scripts/termfleet-doctor.mjs");
  const snapshot = read("scripts/cockpit-snapshot.mjs");
  expect(doctor).toContain('from "./lib/cockpit-task-sources.mjs"');
  expect(snapshot).toContain('from "./lib/cockpit-task-sources.mjs"');
  expect(doctor).toContain("isCockpitTaskSource(");
  // A re-declared literal is the exact regression that caused the false failure.
  expect(doctor).not.toMatch(/const allowed = new Set\(\[/);
  expect(snapshot).not.toMatch(/const supportedTaskSources = new Set\(\[/);
});
