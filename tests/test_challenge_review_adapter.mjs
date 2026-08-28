import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "termfleet-challenge-adapter-test-"));
const runDir = path.join(tempRoot, "run");
const inputDir = path.join(tempRoot, "input");
fs.mkdirSync(inputDir);
const snapshotInput = path.join(inputDir, "snapshot.json");
const sureInput = path.join(inputDir, "sure.json");
const proof = path.join(root, "package.json");
const visibleGoalMatrix = {
  status: "PASS",
  source: "verify:cockpit-goal-matrix",
  captured_at: "2026-08-25T00:00:00Z",
  pane_count: 1,
  failures: [],
  panes: [{ pane_id: "pane-adapter", goal: "Keep the adapter review isolated so the result remains trustworthy", goal_source: "sidecar-todo", quality: "PASS" }],
};
visibleGoalMatrix.artifact_sha256 = crypto.createHash("sha256")
  .update(stableStringify(visibleGoalMatrix))
  .digest("hex");

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

fs.writeFileSync(snapshotInput, JSON.stringify({
  scope: "challenge adapter",
  baseline: "local-test-baseline",
  current_state: "adapter under test",
  acceptance_criteria: ["adapter-proof"],
  acceptance_matrix: { item_ids: ["adapter-proof"] },
  evidence: ["package proof"],
  visible_goal_matrix: visibleGoalMatrix,
  root,
}));
fs.writeFileSync(sureInput, JSON.stringify({
  session_id: "adapter-test-session",
  captured_at: new Date().toISOString(),
  answers: {
    root_cause: "missing reviewer adapter",
    confidence: "HIGH",
    if_not_high: "none",
    fix: "isolated subprocess adapter",
    side_effects: "read-only reviewer boundary",
  },
  inspected: ["adapter source", "challenge runner", "fresh all-pane visible Goal matrix"],
  status: "HIGH / PASS",
}));

const init = spawnSync("python3", [
  path.join(root, ".claude/scripts/challenge_runner.py"), "normal-init",
  "--run-dir", runDir, "--snapshot", snapshotInput, "--sure", sureInput,
  "--context-id", "adapter-test-reviewer",
], { cwd: root, encoding: "utf8" });
assert.equal(init.status, 0, init.stderr || init.stdout);

const reviewer = path.join(tempRoot, "reviewer.mjs");
fs.writeFileSync(reviewer, `
import crypto from "node:crypto";
import fs from "node:fs";
const snapshot = JSON.parse(fs.readFileSync(process.env.TERMFLEET_CHALLENGE_SNAPSHOT, "utf8"));
const artifact = ${JSON.stringify(proof)};
let writeBlocked = false;
try { fs.writeFileSync("reviewer-write-probe", "must be blocked"); } catch { writeBlocked = true; }
if (!writeBlocked) process.exit(9);
const artifactSha256 = crypto.createHash("sha256").update(fs.readFileSync(artifact)).digest("hex");
console.log(JSON.stringify({
  verdict: "PASS",
  snapshot: snapshot.snapshot_sha256,
  findings: [],
  remaining_risks: "none",
  review_count: 1,
  reviewer: {context_id: "separate-reviewer-process", authority: "read-only", isolation_evidence: "temporary review cwd with no worktree write tools"},
  evidence: [{item_id: "adapter-proof", status: "PASS", producer_id: "adapter-test", authority: "test fixture", captured_at: "2026-08-23T00:00:00Z", bound_snapshot_sha256: snapshot.snapshot_sha256, artifact_path_or_id: artifact, artifact_sha256: artifactSha256, result: "proof artifact exists and is hashable"}]
}));
`);

const review = spawnSync("node", [path.join(root, "scripts/termfleet-challenge-review.mjs"), runDir], {
  cwd: root,
  encoding: "utf8",
  env: { ...process.env, TERMFLEET_CHALLENGE_REVIEWER_JSON: JSON.stringify(["node", reviewer]) },
});
assert.equal(review.status, 0, review.stderr || review.stdout);
const verify = spawnSync("python3", [
  path.join(root, ".claude/scripts/challenge_runner.py"), "normal-verify", "--run-dir", runDir,
], { cwd: root, encoding: "utf8" });
assert.equal(verify.status, 0, verify.stderr || verify.stdout);
assert.equal(JSON.parse(fs.readFileSync(path.join(runDir, "review-result-1.json"), "utf8")).verdict, "PASS");

const blockedRunDir = path.join(tempRoot, "blocked-run");
const blockedInit = spawnSync("python3", [
  path.join(root, ".claude/scripts/challenge_runner.py"), "normal-init",
  "--run-dir", blockedRunDir, "--snapshot", snapshotInput, "--sure", sureInput,
  "--context-id", "adapter-test-blocked-reviewer",
], { cwd: root, encoding: "utf8" });
assert.equal(blockedInit.status, 0, blockedInit.stderr || blockedInit.stdout);
const dishonestReviewer = path.join(tempRoot, "dishonest-reviewer.mjs");
fs.writeFileSync(dishonestReviewer, `console.log(JSON.stringify({snapshot: "wrong", review_count: 1}));\n`);
const blockedReview = spawnSync("node", [path.join(root, "scripts/termfleet-challenge-review.mjs"), blockedRunDir], {
  cwd: root,
  encoding: "utf8",
  env: { ...process.env, TERMFLEET_CHALLENGE_REVIEWER_JSON: JSON.stringify(["node", dishonestReviewer]) },
});
assert.equal(blockedReview.status, 2, "unbound reviewer output must fail closed");
assert.equal(fs.readFileSync(path.join(blockedRunDir, "normal-ledger.jsonl"), "utf8").trim().split("\n").length, 1);

const localRunDir = path.join(tempRoot, "local-run");
const localInit = spawnSync("python3", [
  path.join(root, ".claude/scripts/challenge_runner.py"), "normal-init",
  "--run-dir", localRunDir, "--snapshot", snapshotInput, "--sure", sureInput,
  "--context-id", "adapter-test-local-reviewer",
], { cwd: root, encoding: "utf8" });
assert.equal(localInit.status, 0, localInit.stderr || localInit.stdout);
const localReview = spawnSync("node", [path.join(root, "scripts/termfleet-challenge-review.mjs"), localRunDir], {
  cwd: root,
  encoding: "utf8",
  env: { ...process.env, TERMFLEET_CHALLENGE_REVIEWER_JSON: undefined },
});
assert.equal(localReview.status, 0, localReview.stderr || localReview.stdout);
assert.equal(JSON.parse(fs.readFileSync(path.join(localRunDir, "review-result-1.json"), "utf8")).verdict, "BLOCKED");
const localVerify = spawnSync("python3", [
  path.join(root, ".claude/scripts/challenge_runner.py"), "normal-verify", "--run-dir", localRunDir,
], { cwd: root, encoding: "utf8" });
assert.equal(localVerify.status, 0, localVerify.stderr || localVerify.stdout);
console.log("challenge review adapter passed");
