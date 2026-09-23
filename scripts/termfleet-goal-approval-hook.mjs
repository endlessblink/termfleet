#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raw = await readStdin();
let payload;
try {
  if (!raw) deny("approval hook input is unavailable");
  payload = JSON.parse(raw);
} catch {
  deny("approval hook input is not valid JSON");
}

const toolName = payload.tool_name ?? payload.toolName ?? payload.tool;
const status = payload.tool_input?.status ?? payload.input?.status;
if (!toolName) deny("approval hook did not receive a tool name");
if (toolName !== "update_goal") process.exit(0);
if (status === "blocked") process.exit(0);
if (status !== "complete") deny("goal completion status is missing or unsupported");

const defaultAppRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appRoot = process.env.TERMFLEET_APP_ROOT || defaultAppRoot;
const statusDir = process.env.TERMFLEET_AGENT_STATUS_DIR ??
  path.join(os.homedir(), ".local/share/terminal-workspace/agent-status");
const snapshotPath = process.env.TERMFLEET_COCKPIT_SNAPSHOT_PATH ??
  path.join(statusDir, "termfleet-cockpit-snapshot.json");
const matrixPath = process.env.TERMFLEET_GOAL_MATRIX_ARTIFACT ??
  path.join(statusDir, "cockpit-goal-matrix.json");
const verifier = path.join(
  appRoot,
  "scripts/verify-cockpit-goal-matrix.mjs",
);
const maxAgeMs = Number(process.env.TERMFLEET_COCKPIT_MAX_AGE_MS ?? 120_000);
const reasons = [];

let snapshot;
try {
  snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
  const updatedAt = Number(snapshot.updatedAt);
  const now = Date.now();
  if (!Number.isFinite(updatedAt) || now - updatedAt > maxAgeMs || updatedAt > now + 5_000) {
    reasons.push("cockpit snapshot is missing or stale");
  }
  if (!Array.isArray(snapshot.terminals) || snapshot.terminals.length === 0) {
    reasons.push("cockpit snapshot has no terminal panes");
  }
} catch {
  reasons.push("cockpit snapshot is unavailable");
}

const result = spawnSync(process.execPath, [verifier], {
  encoding: "utf8",
  env: { ...process.env, TERMFLEET_GOAL_MATRIX_ARTIFACT: matrixPath },
  stdio: ["ignore", "ignore", "ignore"],
});
try {
  const matrix = JSON.parse(readFileSync(matrixPath, "utf8"));
  if (result.status !== 0 || matrix.status !== "PASS" || matrix.scope !== "all-active-terminals") {
    const problemCodes = [...new Set(
      (matrix.failures ?? []).flatMap((failure) => failure.problems ?? []),
    )];
    const detail = problemCodes.length ? ` (${problemCodes.join(", ")})` : "";
    reasons.push(`${matrix.failures?.length ?? "one or more"} cockpit pane checks failed${detail}`);
  }
} catch {
  reasons.push("cockpit goal matrix is unavailable");
}

if (reasons.length === 0) process.exit(0);

process.stdout.write(`${JSON.stringify({
  decision: "block",
  permissionDecision: "deny",
  reason: `Goal completion denied: ${reasons.join("; ")}. Every TermFleet pane must have fresh, pane-owned Task, Goal, and Now evidence at HIGH confidence before approval.`,
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    additionalContext: `Goal completion denied: ${reasons.join("; ")}. Every TermFleet pane must have fresh, pane-owned Task, Goal, and Now evidence at HIGH confidence before approval.`,
  },
})}\n`);

function deny(reason) {
  process.stdout.write(JSON.stringify({
    decision: "block",
    permissionDecision: "deny",
    reason,
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext: reason,
    },
  }) + "\n");
  process.exit(0);
}

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { data += chunk; });
    process.stdin.on("end", () => resolve(data));
  });
}
