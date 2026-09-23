#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import os from "node:os";

const statusDir = process.env.TERMFLEET_AGENT_STATUS_DIR
  ?? path.join(os.homedir(), ".local/share/terminal-workspace/agent-status");
// TermFleet writes the namespaced snapshot used by the dock UI; the generic file
// may belong to another app sharing the same agent-status directory.
const snapshotPath = process.env.TERMFLEET_COCKPIT_SNAPSHOT_PATH
  ?? path.join(statusDir, "termfleet-cockpit-snapshot.json");
const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
const terminals = Array.isArray(snapshot.terminals) ? snapshot.terminals : [];
const neutralTask = /^(?:Task not captured|Activity not captured|Goal not captured|Context not captured|Status unavailable|Waiting for a clear task|No task declared|No active work|Ready|Idle|Working|Unknown)$/i;
// The snapshot is the rendered cockpit surface after its own Goal gate. Audit
// every rendered record: filtering malformed records out makes the verifier
// capable of passing while the cockpit is visibly incomplete.
const target = terminals;
const forbiddenGoal = /^(?:Goal not captured|Context not captured|Status unavailable)$/i;
const forbiddenTask = /^(?:Task not captured|Activity not captured|No task declared|Status unavailable|Waiting for a clear task|No active work|Ready|Idle|Working|Unknown)$/i;
const paneOwnedGoalSources = new Set(["status-summary", "sidecar-todo", "task-tool", "user-prompt", "workstream", "manual", "plan-binding", "plan-explanation", "goal-task", "agent-goal", "opening-request", "project-fallback", "shell-role"]);
const generatedPaneGoal = /^Keep this pane focused on .+ so it has a clear result to resume\.$/i;
const processGoal = /\b(?:installed dock|live gate|visual gate|focused (?:visual|header) tests?|checksum|awaiting user approval|memory writing agent|userpromptsubmit hook|regression matrix)\b/i;
const projectPurposeGoal = /^(?:Make|Keep|Help|Ensure)\s+(?:[A-Z][\w-]*|this project|the project|every|each)\s+.*\b(?:so|so that)\s+(?:people|users|work)\s+can\s+resume\b/i;
const purposeOpening = /^(?:Make|Keep|Help|Give|Get|Finish|Ship|Ensure|Improve|Find|Complete|I['’]m\s+|We['’](?:re|ve)\s+|We\s+(?:finished|have|need|should)\b)/i;
const purposeConnection = /\b(?:so|so that|to|for|without|after|before|with)\b/i;
const vagueGoal = /^(?:Keep|Make|Help|Improve)\s+(?:the|every|each)\s+(?:work|project|terminal|workspace|system)\s+(?:clear|reliable|better|working)(?:\s+and\s+\w+)*\.?$/i;
const maxEvidenceAgeMs = Number(process.env.TERMFLEET_COCKPIT_EVIDENCE_MAX_AGE_MS ?? 120_000);
const evidenceNow = Date.now();
const failures = [];

for (const entry of target) {
  const record = entry && typeof entry === "object" ? entry : {};
  const paneId = String(record.paneId ?? record.id ?? "").trim();
  const goal = String(record.context ?? "").replace(/\s+/g, " ").trim();
  const task = String(record.task ?? "").replace(/\s+/g, " ").trim();
  const now = String(record.now ?? "").replace(/\s+/g, " ").trim();
  const problems = entry && typeof entry === "object" ? [] : ["malformed-terminal-record"];
  if (!paneId) problems.push("missing-pane-identity");
  if (!task || neutralTask.test(task) || forbiddenTask.test(task)) problems.push("missing-or-generic-task");
  if (!goal || forbiddenGoal.test(goal)) problems.push("missing-or-generic-goal");
  if (
    goal &&
    goal.split(/\s+/).filter(Boolean).length < 8 &&
    !["opening-request", "shell-role"].includes(String(record.contextSource ?? "").trim())
  ) problems.push("goal-too-short-for-about-what");
  if (
    String(record.contextSource ?? "").trim() === "shell-role" &&
    !/^Run commands directly in .+\.$/.test(goal)
  ) problems.push("invalid-shell-role-goal");
  if (!paneOwnedGoalSources.has(String(record.contextSource ?? "").trim())) problems.push("goal-lacks-pane-owned-source");
  if (!paneOwnedGoalSources.has(String(record.statusSummaryGoalSource ?? "").trim())) problems.push("goal-missing-capture-source");
  if (!now) problems.push("missing-now");
  if (String(record.statusSummaryConfidence ?? record.confidence ?? "").trim().toLowerCase() !== "high") {
    problems.push("sure-gate-requires-high-confidence");
  }
  const updatedAt = Number(record.updatedAt);
  if (!Number.isFinite(updatedAt) || updatedAt < evidenceNow - maxEvidenceAgeMs || updatedAt > evidenceNow + 5_000) {
    problems.push("stale-pane-evidence");
  }
  if (generatedPaneGoal.test(goal)) problems.push("goal-is-generated-task-wrapper");
  if (String(record.contextSource ?? "").trim() !== "project-fallback" && projectPurposeGoal.test(goal)) problems.push("project-wide-goal");
  if (processGoal.test(goal)) problems.push("process-language-in-goal");
  if (goal && task && goal.toLocaleLowerCase() === task.toLocaleLowerCase()) problems.push("goal-repeats-task");
  if (goal && now && goal.toLocaleLowerCase() === now.toLocaleLowerCase()) problems.push("goal-repeats-now");
  if (problems.length) failures.push({ paneId: paneId || "unknown-pane", task, goal, now, problems });
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
      const record = entry && typeof entry === "object" ? entry : {};
      const paneId = String(record.paneId ?? record.id ?? "").trim() || "unknown-pane";
      const failure = failedRows.find((row) => row.paneId === paneId);
      return {
        pane_id: paneId,
        goal: String(record.context ?? "").replace(/\s+/g, " ").trim(),
        goal_source: record.contextSource ?? "missing",
        confidence: record.statusSummaryConfidence ?? record.confidence ?? "missing",
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
