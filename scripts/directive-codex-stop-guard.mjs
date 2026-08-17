#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

let input = "";
for await (const chunk of process.stdin) input += chunk;

let payload = {};
try {
  payload = JSON.parse(input || "{}");
} catch {
  process.exit(0);
}

const projectRoot = resolve(
  payload.projectRoot || payload.cwd || payload.workspace?.cwd || process.cwd(),
);
const sessionId = String(payload.session_id || payload.sessionId || "").trim();
const configPath = join(projectRoot, ".directive-validation", "config.json");
let config = null;
try {
  config = JSON.parse(readFileSync(configPath, "utf8"));
} catch {
  config = null;
}

const runDir = sessionId
  ? config?.activeRuns?.[sessionId] ?? (!config?.activeRuns ? config?.activeRunDir : null)
  : config?.activeRunDir;
const trustedVerification = runDir ? join(runDir, "trusted-verification.json") : null;

if (config?.integration?.required && (!runDir || !existsSync(trustedVerification))) {
  process.stdout.write(`${JSON.stringify({
    decision: "block",
    reason: runDir
      ? "Trusted verification is incomplete; the validation run has not produced its verification artifact."
      : "Trusted verification is unavailable; no validation run is registered for this session.",
    systemMessage: "Directive validation is incomplete. Continue or restart the harness run and verify again before stopping.",
  })}\n`);
  process.exit(0);
}

const externalHook = "/media/endlessblink/data/my-projects/ai-development/devops/directive-validation-harness/scripts/directive-codex-stop-hook.mjs";
const result = spawnSync(process.execPath, [externalHook], {
  cwd: projectRoot,
  input,
  encoding: "utf8",
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exit(result.status ?? 0);
