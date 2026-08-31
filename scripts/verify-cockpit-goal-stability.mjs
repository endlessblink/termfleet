#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { setTimeout as wait } from "node:timers/promises";
import os from "node:os";
import path from "node:path";

const statusDir = process.env.TERMFLEET_AGENT_STATUS_DIR
  ?? path.join(os.homedir(), ".local/share/terminal-workspace/agent-status");
const snapshotPath = path.join(statusDir, "cockpit-snapshot.json");
const tracePath = path.join(statusDir, "cockpit-header-trace.jsonl");
const waitMs = Number(process.argv.find((arg) => arg.startsWith("--wait-ms="))?.split("=")[1] ?? 10_000);
const sampleMs = Number(process.argv.find((arg) => arg.startsWith("--sample-ms="))?.split("=")[1] ?? 1_000);
const forbidden = /^(?:Goal not captured|Context not captured|Status unavailable|Activity not captured)$/i;
const processText = /\b(?:memory writing agent|userpromptsubmit hook|installed dock|live gate|visual gate|regression matrix|awaiting user approval)\b/i;

function readTarget() {
  const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
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
  const rows = (Array.isArray(snapshot.terminals) ? snapshot.terminals : [])
    .filter((entry) => String(entry.path ?? entry.cwd ?? "").includes("/devops/termfleet"))
    .map((entry) => latestTraceByPane.get(entry.paneId) ?? entry)
    .map((entry) => ({
      paneId: String(entry.paneId ?? ""),
      task: String(entry.task ?? "").replace(/\s+/g, " ").trim(),
      goal: String(entry.context ?? "").replace(/\s+/g, " ").trim(),
      now: String(entry.now ?? "").replace(/\s+/g, " ").trim(),
    }))
    .filter((entry) => entry.paneId);
  if (!rows.length) throw new Error("no TermFleet panes found");
  for (const row of rows) {
    if (!row.goal || forbidden.test(row.goal) || processText.test(row.goal)) {
      throw new Error(`invalid Goal pane=${row.paneId} value=${JSON.stringify(row.goal)}`);
    }
    if (row.goal.toLocaleLowerCase() === row.task.toLocaleLowerCase()) {
      throw new Error(`Goal repeats Task pane=${row.paneId}`);
    }
    if (row.goal.toLocaleLowerCase() === row.now.toLocaleLowerCase()) {
      throw new Error(`Goal repeats Now pane=${row.paneId}`);
    }
  }
  return new Map(rows.map((row) => [row.paneId, row]));
}

const first = readTarget();
const sampleCount = Math.max(1, Math.ceil(waitMs / sampleMs));
for (let sample = 1; sample <= sampleCount; sample += 1) {
  await wait(Math.min(sampleMs, Math.max(0, waitMs - (sample - 1) * sampleMs)));
  const current = readTarget();
  if (first.size !== current.size) throw new Error(`pane-count-changed=${first.size}->${current.size}`);
  for (const [paneId, before] of first) {
    const after = current.get(paneId);
    if (!after) throw new Error(`pane-disappeared=${paneId}`);
    for (const field of ["task", "goal", "now"]) {
      if (before[field] !== after[field]) {
        throw new Error(`${field}-changed pane=${paneId} sample=${sample} before=${JSON.stringify(before[field])} after=${JSON.stringify(after[field])}`);
      }
    }
  }
}
console.log(`COCKPIT_GOAL_STABLE_OK panes=${first.size} waitMs=${waitMs} sampleMs=${sampleMs} samples=${sampleCount}`);
