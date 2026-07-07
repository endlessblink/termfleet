#!/usr/bin/env node
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

assert.equal(
  packageJson.scripts["verify:task-identity"],
  "node scripts/verify-task-identity.mjs",
);

const headerSource = readFileSync(new URL("../src/lib/terminalHeaderViewModel.ts", import.meta.url), "utf8");
const taskLineupSource = readFileSync(new URL("../src/lib/taskLineup.ts", import.meta.url), "utf8");
const snapshotSource = readFileSync(new URL("./cockpit-snapshot.mjs", import.meta.url), "utf8");
const doctorSource = readFileSync(new URL("./termfleet-doctor.mjs", import.meta.url), "utf8");

assert.match(headerSource, /resolveTaskIdentity/);
assert.doesNotMatch(headerSource, /source:\s*taskDescriptionText \? taskText \? "task-list"/);
assert.doesNotMatch(headerSource, /readableUserTaskLabel/);
assert.doesNotMatch(headerSource, /publicStatusGoalFromSummary/);
assert.doesNotMatch(headerSource, /publicTaskGoalFromDeclaredTask/);
assert.doesNotMatch(headerSource, /statusTaskCandidate/);
assert.doesNotMatch(headerSource, /planBindingSource:\s*input\.contextPurposeSource \?\?/);
assert.match(taskLineupSource, /must not own the visible TASKS panel/);
assert.doesNotMatch(taskLineupSource, /falls back to the\s+AI\/heuristic-extracted items/);
assert.match(snapshotSource, /unsupported-task-source/);
assert.match(doctorSource, /Task identity sources/);

execFileSync("npx", ["playwright", "test", "tests/task-identity.spec.ts", "--reporter=line"], {
  stdio: "inherit",
});

console.log("verify:task-identity OK");
