#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raw = await readStdin();
let payload = {};
try { payload = raw ? JSON.parse(raw) : {}; } catch { process.exit(0); }
const event = payload.hook_event_name ?? payload.hookEventName ?? payload.event;
if (event !== "Stop") process.exit(0);

// Ordinary Stop is a project completion gate. Explicit update_goal completion
// remains protected separately by the global goal-approval hook.
const defaultProjectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectRoot = process.env.TERMFLEET_PROJECT_ROOT || defaultProjectRoot;
if (typeof payload.cwd === "string" && path.isAbsolute(payload.cwd)) {
  const cwd = path.resolve(payload.cwd);
  const relative = path.relative(projectRoot, cwd);
  const inside = relative === "" || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative));
  if (!inside) {
    const commonDir = spawnSync("git", ["-C", cwd, "rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8", timeout: 2000 });
    const linkedWorktree = commonDir.status === 0 && commonDir.stdout.trim() === path.join(projectRoot, ".git");
    if (!linkedWorktree) process.exit(0);
  }
}

const statusDir = process.env.TERMFLEET_AGENT_STATUS_DIR ??
  path.join(os.homedir(), ".local/share/terminal-workspace/agent-status");
const matrixPath = process.env.TERMFLEET_GOAL_MATRIX_ARTIFACT ??
  path.join(statusDir, "cockpit-goal-matrix.json");
const verifier = path.join(
  projectRoot,
  "scripts/verify-cockpit-goal-matrix.mjs",
);
const result = spawnSync(process.execPath, [verifier], {
  encoding: "utf8",
  env: { ...process.env, TERMFLEET_GOAL_MATRIX_ARTIFACT: matrixPath },
});
let failures = [];
try { failures = JSON.parse(readFileSync(matrixPath, "utf8")).failures ?? []; } catch { failures = [{ reason: "cockpit matrix unavailable" }]; }
if (result.status === 0 && failures.length === 0) process.exit(0);

process.stdout.write(JSON.stringify({
  decision: "block",
  reason: `COCKPIT GATE FAILED: ${failures.length} pane(s) still have missing, generic, stale, or unowned Task/Goal/Now data. Do not claim this fix is complete; inspect the all-pane matrix and correct the source capture first.`,
}));

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { data += chunk; });
    process.stdin.on("end", () => resolve(data));
  });
}
