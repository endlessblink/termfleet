#!/usr/bin/env node
// THE OPERATOR'S GATE (2026-07-04), executable. Reads the app's own rendered dump
// and fails unless EVERY pane follows the pattern:
//   Task row  = a real goal (no raw fragments, no "Task not captured" with data present)
//   Title     = a specific step/outcome (no bare status words, >=4 words, != Task row)
//   Path      = a real directory, not a file that leaked from a command
// Prints each failing pane with the reason. Exit 1 on any failure.
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const file = path.join(os.homedir(), ".local/share/terminal-workspace/agent-status/cockpit-snapshot.json");
const dump = JSON.parse(readFileSync(file, "utf8"));
const GENERIC = /^(?:working|idle|ready|awaiting next action|activity not captured|prompt submitted|terminal)$/i;
const failures = [];
for (const t of dump.terminals ?? []) {
  const where = `${t.workspace ?? "?"} (${String(t.terminalId ?? "").slice(9, 17)})`;
  const title = String(t.title ?? "").trim();
  const task = String(t.task ?? "").trim();
  const p = String(t.path ?? "");
  const hasAnyData = Boolean(
    t.terminalVisibleText || t.terminalOutput || t.statusSummaryNarration ||
    (task && task !== "Task not captured" && task.split(/\s+/).length >= 3),
  );
  if (!hasAnyData) continue; // truly-empty pane: nothing to say yet
  const problems = [];
  if (GENERIC.test(title)) problems.push(`generic title "${title}"`);
  else if (title.split(/\s+/).length < 4 && !/·|—/.test(title)) problems.push(`title too thin "${title}"`);
  if (task === "Task not captured") problems.push("no goal on the Task row");
  else if (task.split(/\s+/).length < 3) problems.push(`goal too thin "${task}"`);
  else if (/^(?:stop(?:ped)?|no |not |failed|error|waiting|blocked|done)\b/i.test(task)) problems.push(`task reads as status, not a goal "${task.slice(0, 40)}"`);
  if (/^the\s+\w+(?:\s+\w+)?\s+(?:was|were|has been|had been)\b/i.test(title)) problems.push(`passive title "${title.slice(0, 40)}"`);
  if (title.length > 64) problems.push(`title overflows the card (${title.length} chars)`);
  if (/;/.test(title)) problems.push("run-on title (semicolon)");
  if (title && task && title.toLowerCase() === task.toLowerCase()) problems.push("title repeats the Task row");
  if (/\.(?:tsx?|mjs|cjs|rs|md|json|sh|py)$/.test(p)) problems.push(`path is a file "${p}"`);
  if (problems.length) failures.push(`✗ ${where}: ${problems.join("; ")}`);
}
const total = (dump.terminals ?? []).length;
if (failures.length) {
  console.log(`GATE FAILED — ${failures.length} of ${total} panes below the bar:`);
  for (const f of failures) console.log("  " + f);
  process.exit(1);
}
console.log(`GATE PASSED — all ${total} panes follow the pattern.`);
