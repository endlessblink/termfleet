#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import os from "node:os";

const statusDir = process.env.TERMFLEET_AGENT_STATUS_DIR
  ?? path.join(os.homedir(), ".local/share/terminal-workspace/agent-status");
const snapshotPath = path.join(statusDir, "cockpit-snapshot.json");
const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
const terminals = Array.isArray(snapshot.terminals) ? snapshot.terminals : [];
const neutralTask = /^(?:Task not captured|Activity not captured|Goal not captured|Context not captured|Status unavailable|Waiting for a clear task|No task declared|No active work|Ready|Idle|Working|Unknown)$/i;
const target = terminals
  .filter((entry) => entry && typeof entry.paneId === "string" && entry.paneId.trim())
  // The snapshot is the rendered cockpit surface after its own Goal gate. Do not
  // replace it with raw header-trace input, which can contain a rejected shared
  // workstream purpose and make the matrix pass or fail against invisible text.
  .filter((entry) => {
    const task = String(entry.task ?? "").replace(/\s+/g, " ").trim();
    const goal = String(entry.context ?? "").replace(/\s+/g, " ").trim();
    return !neutralTask.test(task) && (Boolean(goal) || Boolean(task));
  })
  .map((entry) => entry);
const forbiddenGoal = /^(?:Goal not captured|Context not captured|Status unavailable)$/i;
const paneOwnedGoalSources = new Set(["status-summary", "sidecar-todo", "task-tool", "user-prompt", "manual", "plan-binding", "plan-explanation", "goal-task", "opening-request", "project-fallback"]);
const generatedPaneGoal = /^Keep this pane focused on .+ so it has a clear result to resume\.$/i;
const processGoal = /\b(?:installed dock|live gate|visual gate|focused (?:visual|header) tests?|checksum|awaiting user approval|memory writing agent|userpromptsubmit hook|regression matrix)\b/i;
const projectPurposeGoal = /^(?:Make|Keep|Help|Ensure)\s+(?:[A-Z][\w-]*|this project|the project|every|each)\s+.*\b(?:so|so that)\s+(?:people|users|work)\s+can\s+resume\b/i;
const purposeOpening = /^(?:Make|Keep|Help|Give|Get|Finish|Ship|Ensure|Improve|Find|Complete|I['’]m\s+|We['’](?:re|ve)\s+|We\s+(?:finished|have|need|should)\b)/i;
const purposeConnection = /\b(?:so|so that|to|for|without|after|before|with)\b/i;
const vagueGoal = /^(?:Keep|Make|Help|Improve)\s+(?:the|every|each)\s+(?:work|project|terminal|workspace|system)\s+(?:clear|reliable|better|working)(?:\s+and\s+\w+)*\.?$/i;
const failures = [];

for (const entry of target) {
  const goal = String(entry.context ?? "").replace(/\s+/g, " ").trim();
  const task = String(entry.task ?? "").replace(/\s+/g, " ").trim();
  const now = String(entry.now ?? "").replace(/\s+/g, " ").trim();
  const problems = [];
  if (!goal || forbiddenGoal.test(goal)) problems.push("missing-or-generic-goal");
  if (goal && goal.split(/\s+/).filter(Boolean).length < 8) problems.push("goal-too-short-for-about-what");
  if (!paneOwnedGoalSources.has(String(entry.contextSource ?? "").trim())) problems.push("goal-lacks-pane-owned-source");
  if (!paneOwnedGoalSources.has(String(entry.statusSummaryGoalSource ?? "").trim())) problems.push("goal-missing-capture-source");
  if (generatedPaneGoal.test(goal)) problems.push("goal-is-generated-task-wrapper");
  if (String(entry.contextSource ?? "").trim() !== "project-fallback" && projectPurposeGoal.test(goal)) problems.push("project-wide-goal");
  if (processGoal.test(goal)) problems.push("process-language-in-goal");
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
    scope: "all-active-terminals",
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
  const artifactPath = process.env.TERMFLEET_GOAL_MATRIX_ARTIFACT ?? path.join(statusDir, "cockpit-goal-matrix.json");
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
