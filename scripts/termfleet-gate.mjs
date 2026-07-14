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
const IMPLEMENTATION_DETAIL = [
  /(?:^|[\s"'([])\/(?:home|media|tmp|var|usr|opt|data)\//i,
  /\b(?:src|tests|docs|scripts)\/[\w./-]+\.(?:tsx?|jsx?|mjs|cjs|rs|md|json|sh|py)\b/i,
  /\b[\w.-]+\.(?:tsx?|jsx?|mjs|cjs|rs|md|json|sh|py)\b/i,
];
const hasImplementationDetail = (value) => IMPLEMENTATION_DETAIL.some((pattern) => pattern.test(value));
const lacksDecisionObject = (value) => {
  if (!/\b(?:approval|verdict|decision|response|reply|follow-up)\b/i.test(value)) return false;
  if (/\b(?:about|on|for|over|of)\s+(?:this|that|the\s+)?(?!(?:operator|user|human|reviewer|approval|verdict|decision|response|reply|follow-up)\b)[a-z0-9][a-z0-9'-]*(?:\s+[a-z0-9][a-z0-9'-]*){1,}/i.test(value)) return false;
  if (/\b(?:pane header|header wording|title wording|deployment plan|build result|test result|floor-check|quality gate|operator gate)\b/i.test(value)) return false;
  return true;
};
const genericResultLabel = (value) => (
  /^Verify\s+(?:Build(?: and tests)?|Tests?|Test process|Build process|Typecheck(?: and pytest)?|update project plan|Task)\s+result$/i.test(value) ||
  /^(?:Build(?: and tests)?|Tests?|Test process|Build process|Task|Verification check)\s+(?:completed|passed|successful|completed successfully)\b/i.test(value)
);
const rawPromptLabel = (value) => (
  /\[Image\s+#?\d+\]/i.test(value) ||
  /\bstill\s+looking\s+unclear\b/i.test(value) ||
  /\b(?:serach|ahve|doesnt|dont)\b/i.test(value) ||
  /\bwhat\s+this\s+is\b/i.test(value)
);
const narrativeTitle = (value) => (
  /^(?:what i did|what i fixed|the fix|root cause|use this as|strong evidence|you can test)\b/i.test(value) ||
  /\b(?:Noneoofhtheiabove|separatOptionally)\b/i.test(value) ||
  /^(?:this failure is clear|this is a failure|failed here|again fail|low quality)\b/i.test(value) ||
  /^(?:the bad part was|the mistake was|it wasn'?t followed because)\b/i.test(value) ||
  /\b(?:guidelines|documentation|docs|article|source|report|study|research)\s+(?:say|says|show|shows|recommend|recommends)\b/i.test(value)
);
const failures = [];
for (const t of dump.terminals ?? []) {
  const where = `${t.workspace ?? "?"} (${String(t.terminalId ?? "").slice(9, 17)})`;
  const title = String(t.title ?? "").trim();
  const task = String(t.task ?? "").trim();
  const p = String(t.path ?? "");
  const hasAnyData = Boolean(
    t.terminalVisibleText || t.terminalOutput ||
    (task && task !== "Task not captured" && task.split(/\s+/).length >= 3),
  );
  if (!hasAnyData) continue; // truly-empty pane: nothing to say yet
  const problems = [];
  if (GENERIC.test(title)) problems.push(`generic title "${title}"`);
  else if (title.split(/\s+/).length < 4 && !/·|—/.test(title)) problems.push(`title too thin "${title}"`);
  if (task === "Task not captured") problems.push("no goal on the Task row");
  else if (task.split(/\s+/).length < 3) problems.push(`goal too thin "${task}"`);
  else if (genericResultLabel(task)) problems.push(`generic result goal "${task.slice(0, 40)}"`);
  else if (rawPromptLabel(task)) problems.push(`raw prompt goal "${task.slice(0, 40)}"`);
  else if (lacksDecisionObject(task)) problems.push(`decision goal lacks object "${task.slice(0, 40)}"`);
  else if (/^(?:stop(?:ped)?|no |not |failed|error|waiting|blocked|done)\b/i.test(task)) problems.push(`task reads as status, not a goal "${task.slice(0, 40)}"`);
  if (/^the\s+\w+(?:\s+\w+)?\s+(?:was|were|has been|had been)\b/i.test(title)) problems.push(`passive title "${title.slice(0, 40)}"`);
  if (narrativeTitle(title)) problems.push(`narrative title "${title.slice(0, 54)}"`);
  if (/^(?:the bad part was|the mistake was|it wasn'?t followed because)\b/i.test(title)) problems.push(`critique-prose title "${title.slice(0, 54)}"`);
  if (genericResultLabel(title)) problems.push(`generic result title "${title.slice(0, 54)}"`);
  if (/\bcontinue (?:the )?(?:task|process)\b/i.test(title)) problems.push(`tautological title "${title.slice(0, 54)}"`);
  if (/\b(?:next step|address the issue|address this issue)\b/i.test(title)) problems.push(`vague next-step title "${title.slice(0, 54)}"`);
  if (title.length > 64) problems.push(`title overflows the card (${title.length} chars)`);
  if (hasImplementationDetail(title)) problems.push(`technical title "${title.slice(0, 54)}"`);
  if (lacksDecisionObject(title)) problems.push(`decision title lacks object "${title.slice(0, 54)}"`);
  if (/;/.test(title)) problems.push("run-on title (semicolon)");
  if (/^(?:stop|do not|don't|never)\b/i.test(title)) problems.push(`imperative-at-nobody title "${title.slice(0, 40)}" (blocked states read 'Blocked: … — …')`);
  if (/·\s*awaiting next task/i.test(title) && /—|\bready\b/i.test(title.replace(/·\s*awaiting next task/i, ""))) problems.push("double status in title");
  if (title && task && title.toLowerCase() === task.toLowerCase()) problems.push("title repeats the Task row");
  if (/\.(?:tsx?|mjs|cjs|rs|md|json|sh|py)$/.test(p)) problems.push(`path is a file "${p}"`);
  if (/designersai/i.test(`${t.workspace ?? ""} ${p}`) && t.projectEmoji && t.projectEmoji !== "🎨") {
    problems.push(`wrong project emoji "${t.projectEmoji}"`);
  }
  if (problems.length) failures.push(`✗ ${where}: ${problems.join("; ")}`);
}
const total = (dump.terminals ?? []).length;
if (failures.length) {
  console.log(`GATE FAILED — ${failures.length} of ${total} panes below the bar:`);
  for (const f of failures) console.log("  " + f);
  process.exit(1);
}
console.log(`GATE PASSED — all ${total} panes follow the pattern.`);
