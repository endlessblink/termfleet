#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import crypto from "node:crypto";
import path from "node:path";

const statusDir = "/home/endlessblink/.local/share/terminal-workspace/agent-status";
const snapshotPath = path.join(statusDir, "cockpit-snapshot.json");
const tracePath = path.join(statusDir, "cockpit-header-trace.jsonl");
const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
const terminals = Array.isArray(snapshot.terminals) ? snapshot.terminals : [];
const traceRows = readFileSync(tracePath, "utf8")
  .split("\n")
  .filter(Boolean)
  .flatMap((line) => {
    try {
      const record = JSON.parse(line);
      return Array.isArray(record.terminals) ? record.terminals : [];
    } catch {
      return [];
    }
  });
const latestTraceByPane = new Map();
for (const entry of traceRows) {
  if (entry.paneId) latestTraceByPane.set(entry.paneId, entry);
}
const target = terminals
  .filter((entry) => String(entry.path ?? entry.cwd ?? "").includes("/devops/termfleet"))
  .map((entry) => latestTraceByPane.get(entry.paneId) ?? entry);
const forbiddenGoal = /^(?:Goal not captured|Context not captured|Status unavailable|Make every TermFleet terminal show its purpose and current activity clearly\.?|Make each TermFleet terminal clear enough to understand at a glance\.?)$/i;
const processGoal = /\b(?:installed dock|live gate|visual gate|focused (?:visual|header) tests?|checksum|awaiting user approval|memory writing agent|userpromptsubmit hook|regression matrix)\b/i;
const purposeOpening = /^(?:Make|Keep|Help|Give|Get|Finish|Ship|Ensure|Improve|Find|I['’]m\s+|We['’]re\s+)/i;
const purposeConnection = /\b(?:so|so that|to|for|without|after|before|with)\b/i;
const vagueGoal = /^(?:Keep|Make|Help|Improve)\s+(?:the|every|each)\s+(?:work|project|terminal|workspace|system)\s+(?:clear|reliable|better|working)(?:\s+and\s+\w+)*\.?$/i;
const failures = [];

for (const entry of target) {
  const goal = String(entry.context ?? "").replace(/\s+/g, " ").trim();
  const task = String(entry.task ?? "").replace(/\s+/g, " ").trim();
  const now = String(entry.now ?? "").replace(/\s+/g, " ").trim();
  const problems = [];
  if (!goal || forbiddenGoal.test(goal)) problems.push("missing-or-generic-goal");
  if (processGoal.test(goal)) problems.push("process-language-in-goal");
  if (goal && goal.split(/\s+/).length < 8) problems.push("goal-too-short-for-purpose");
  if (goal && !purposeOpening.test(goal)) problems.push("goal-does-not-state-an-outcome");
  if (goal && !purposeConnection.test(goal)) problems.push("goal-missing-why-or-benefit");
  if (goal && vagueGoal.test(goal)) problems.push("goal-is-vague");
  if (goal && task && goal.toLocaleLowerCase() === task.toLocaleLowerCase()) problems.push("goal-repeats-task");
  if (goal && now && goal.toLocaleLowerCase() === now.toLocaleLowerCase()) problems.push("goal-repeats-now");
  if (problems.length) failures.push({ paneId: entry.paneId, task, goal, now, problems });
}

if (!target.length) {
  writeMatrixArtifact([], [], "no TermFleet panes found");
  console.error("COCKPIT_GOAL_MATRIX_FAIL no TermFleet panes found");
  process.exit(1);
}
writeMatrixArtifact(target, failures);
if (failures.length) {
  console.error(JSON.stringify({ ok: false, panes: target.length, failures }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, panes: target.length }, null, 2));

function writeMatrixArtifact(entries, failedRows, failureReason = null) {
  const matrix = {
    schema_version: 1,
    status: failedRows.length || failureReason ? "FAIL" : "PASS",
    source: "verify:cockpit-goal-matrix",
    captured_at: new Date().toISOString(),
    pane_count: entries.length,
    failures: failureReason ? [{ reason: failureReason }] : failedRows,
    panes: entries.map((entry) => {
      const failure = failedRows.find((row) => row.paneId === entry.paneId);
      return {
        pane_id: entry.paneId,
        goal: String(entry.context ?? "").replace(/\s+/g, " ").trim(),
        goal_source: entry.contextSource ?? "missing",
        quality: failure ? "FAIL" : "PASS",
      };
    }),
  };
  const artifactSha256 = crypto.createHash("sha256").update(stableStringify(matrix)).digest("hex");
  const artifact = { ...matrix, artifact_sha256: artifactSha256 };
  const artifactPath = process.env.TERMFLEET_GOAL_MATRIX_ARTIFACT ?? "/home/endlessblink/.local/share/terminal-workspace/agent-status/cockpit-goal-matrix.json";
  artifact.artifact_path = artifactPath;
  writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o600 });
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
