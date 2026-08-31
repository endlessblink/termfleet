#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { setTimeout as wait } from "node:timers/promises";

const snapshotPath =
  process.env.TERMFLEET_COCKPIT_SNAPSHOT_PATH ||
  `${process.env.HOME}/.local/share/terminal-workspace/agent-status/termfleet-cockpit-snapshot.json`;
const waitMs = Number(process.argv.find((arg) => arg.startsWith("--wait-ms="))?.split("=")[1] ?? 10_000);
const sampleMs = Number(process.argv.find((arg) => arg.startsWith("--sample-ms="))?.split("=")[1] ?? 500);
const minHoldMs = Number(process.argv.find((arg) => arg.startsWith("--min-hold-ms="))?.split("=")[1] ?? 5_000);
const forbidden = /(?:Goal not captured|Context not captured|Status unavailable|Activity not captured|Task not captured|No task declared|Supervised agent run|Memory Writing Agent|UserPromptSubmit hook|installed dock|live gate|visual gate|regression matrix)/i;
const purposeWords = /\b(?:so|so that|to|for|because|helps?|lets?|enables?|allows?)\b/i;
const goalProcessWords = /\b(?:test suite|regression|review(?:er)? gate|installed release|screenshot|telemetry|proof|verification gate)\b/i;
const taskProcessWords = /\b(?:test(?:s|ing)?|verify(?:ing)?|build(?:ing)?|release|gate|review(?:ing)?|check(?:ing)?|debug(?:ging)?|inspect(?:ing)?|relaunch|restart|implement(?:ing)?)\b/i;
const nowProcessWords = /\b(?:challenge loop|making every terminal show|inspect every failed pane|remove shared goal|run the complete matrix|wait for user approval|running the complete matrix|review(?:ing)? all panes)\b/i;
const paneOwnedGoalSources = new Set(["status-summary", "sidecar-todo", "task-tool", "user-prompt", "manual", "plan-binding", "plan-explanation", "goal-task", "opening-request", "project-fallback"]);
const nonTaskPlaceholder = /^(?:Supervised agent run|didnt help|ci failed)$/i;
const generatedPaneGoal = /^Keep this pane focused on .+ so it has a clear result to resume\.$/i;

function fail(reasons, rows = new Map()) {
  console.error(`COCKPIT_LIVE_FAIL failures=${reasons.length}`);
  for (const row of rows.values()) {
    console.error(`COCKPIT_LIVE_MATRIX group=${row.groupId} pane=${row.paneId} paneGoalSource=${row.contextSource} Task=${JSON.stringify(row.task)} Goal=${JSON.stringify(row.goal)} Now=${JSON.stringify(row.now)}`);
  }
  for (const reason of reasons) console.error(`  - ${reason}`);
  process.exit(1);
}

function readRows() {
  const failures = [];
  let payload;
  try {
    payload = JSON.parse(readFileSync(snapshotPath, "utf8"));
  } catch (error) {
    return { rows: new Map(), failures: [`snapshot-unreadable=${error.message}`] };
  }
  const rows = (Array.isArray(payload.terminals) ? payload.terminals : [])
    .filter((entry) => entry && entry.paneId)
    .filter((entry) => {
      const task = String(entry.task ?? "").replace(/\s+/g, " ").trim();
      const goal = String(entry.context ?? "").replace(/\s+/g, " ").trim();
      return !nonTaskPlaceholder.test(task) && !/^(?:Task not captured|Activity not captured|Goal not captured|Context not captured|Status unavailable|Waiting for a clear task|No task declared|No active work|Ready|Idle|Working|Unknown)$/i.test(task) && (Boolean(goal) || Boolean(task));
    })
    .map((entry) => ({
      paneId: String(entry.paneId),
      groupId: entry.groupId == null ? "" : String(entry.groupId),
      workspace: String(entry.workspace ?? ""),
      cwd: String(entry.cwd ?? entry.path ?? ""),
      task: String(entry.task ?? "").replace(/\s+/g, " ").trim(),
      goal: String(entry.context ?? "").replace(/\s+/g, " ").trim(),
      contextSource: String(entry.contextSource ?? "").trim(),
      goalCaptureSource: String(entry.statusSummaryGoalSource ?? "").trim(),
      now: String(entry.now ?? "").replace(/\s+/g, " ").trim(),
      updatedAt: Number(entry.updatedAt ?? 0),
    }));
  if (!rows.length) failures.push("no-rendered-terminals");
  for (const row of rows) {
    if (!row.groupId) failures.push(`missing-group-id pane=${row.paneId}`);
    if (!row.workspace || !row.cwd) failures.push(`missing-pane-identity pane=${row.paneId}`);
    if (!paneOwnedGoalSources.has(row.contextSource)) {
      failures.push(`goal-lacks-pane-owned-source pane=${row.paneId} source=${row.contextSource || "missing"}`);
    }
    if (!row.goalCaptureSource || !paneOwnedGoalSources.has(row.goalCaptureSource)) {
      failures.push(`goal-missing-capture-source pane=${row.paneId} source=${row.goalCaptureSource || "missing"}`);
    }
    if (!row.task) failures.push(`empty-task pane=${row.paneId}`);
    for (const [field, value] of [["Goal", row.goal], ["Now", row.now]]) {
      if (!value) failures.push(`empty-${field.toLowerCase()} pane=${row.paneId}`);
      if (forbidden.test(value)) failures.push(`forbidden-${field.toLowerCase()} pane=${row.paneId} value=${JSON.stringify(value)}`);
    }
    if (row.goal.toLocaleLowerCase() === row.task.toLocaleLowerCase()) {
      failures.push(`goal-repeats-task pane=${row.paneId}`);
    }
    if (row.goal.toLocaleLowerCase() === row.now.toLocaleLowerCase()) {
      failures.push(`goal-repeats-now pane=${row.paneId}`);
    }
    if (generatedPaneGoal.test(row.goal)) {
      failures.push(`goal-is-generated-task-wrapper pane=${row.paneId}`);
    }
    if (goalProcessWords.test(row.goal)) failures.push(`goal-contains-process-language pane=${row.paneId}`);
    if (row.task.split(/\s+/).length < 3) failures.push(`task-too-thin-for-context pane=${row.paneId}`);
    if (nowProcessWords.test(row.now)) failures.push(`now-is-review-process pane=${row.paneId}`);
  }
  const byGroup = new Map();
  for (const row of rows) {
    const siblings = byGroup.get(row.groupId) ?? [];
    siblings.push(row);
    byGroup.set(row.groupId, siblings);
  }
  for (const [groupId, siblings] of byGroup) {
    const goals = new Map();
    for (const row of siblings) {
      const key = row.goal.toLocaleLowerCase();
      const prior = goals.get(key);
      if (prior && prior !== row.paneId) failures.push(`duplicate-goal group=${groupId} panes=${prior},${row.paneId}`);
      goals.set(key, row.paneId);
    }
  }
  return { rows: new Map(rows.map((row) => [row.paneId, row])), failures };
}

const initial = readRows();
if (initial.failures.length) fail(initial.failures, initial.rows);
const first = initial.rows;
const lastChange = new Map([...first].map(([paneId]) => [paneId, Date.now()]));
let previousRows = first;
let allFailures = [];
let samples = 0;
for (let elapsed = 0; elapsed < waitMs; elapsed += sampleMs) {
  await wait(sampleMs);
  const sample = readRows();
  allFailures = allFailures.concat(sample.failures);
  const current = sample.rows;
  samples += 1;
  if (current.size !== first.size) allFailures.push(`pane-count-changed=${first.size}->${current.size}`);
  for (const [paneId, before] of current) {
    const previous = previousRows.get(paneId);
    if (!previous) { allFailures.push(`pane-disappeared=${paneId}`); continue; }
    if (!first.has(paneId)) { allFailures.push(`new-pane-during-monitor=${paneId}`); continue; }
    for (const field of ["task", "goal", "now"]) {
      if (before[field] !== previous[field]) {
        const now = Date.now();
        const heldFor = now - lastChange.get(paneId);
        if (heldFor < minHoldMs) allFailures.push(`${field}-changed-too-soon pane=${paneId} heldMs=${heldFor}`);
        lastChange.set(paneId, now);
      }
    }
  }
  previousRows = current;
}
  if (allFailures.length) fail([...new Set(allFailures)], previousRows);
console.log(`COCKPIT_LIVE_OK panes=${first.size} groups=${new Set([...first.values()].map((row) => row.groupId)).size} waitMs=${waitMs} sampleMs=${sampleMs} samples=${samples}`);
