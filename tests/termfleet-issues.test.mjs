import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const registry = JSON.parse(await readFile(path.join(root, "docs/issue-registry.json"), "utf8"));
const matrix = JSON.parse(await readFile(path.join(root, "docs/issue-error-matrix.json"), "utf8"));

test("issue registry has unique records linked to known failure surfaces", () => {
  const ids = registry.issues.map((issue) => issue.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const issue of registry.issues) {
    assert.ok(matrix.surfaces[issue.surface], `${issue.id} has an unknown surface`);
    assert.ok(issue.guard, `${issue.id} has no guard`);
    assert.ok(issue.nextAction, `${issue.id} has no next action`);
  }
});

test("desktop issues require installed and live evidence before resolution", () => {
  const issue = registry.issues.find((candidate) => candidate.surface === "desktop-runtime");
  assert.deepEqual(matrix.surfaces[issue.surface].requiredEvidence, [
    "source", "focused-test", "installed-release", "live-desktop",
  ]);
  assert.notEqual(issue.state, "resolved");
});

test("every seeded issue links back to the historical regression matrix", () => {
  for (const issue of registry.issues) assert.ok(issue.matrixRefs.length > 0, `${issue.id} has no matrix reference`);
});
