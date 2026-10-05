import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { checkBotTask } from "../scripts/lib/bot-workflow-preflight.mjs";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const checker = process.env.BOT_WORKFLOW_TEST_CHECKER || resolve(repository,
  "../../bots+automation/bots-directory/tools/check_bot_workflow.py");

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "bot-task-preflight-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cwd = join(root, "source"); mkdirSync(cwd);
  const wip = join(cwd, "worker-wip.txt"); writeFileSync(wip, "Keep this unrelated work.\n");
  const registry = join(root, "registry.json");
  const ref = { id: "fixture", aliases: ["alias"], lifecycle: "active", observed_at: new Date().toISOString().slice(0, 10),
    paths: [{ host: "local workstation", path: cwd, role: "source" }], evidence: ["Synthetic fixture"], next_check: "fixture" };
  const document = { version: 1, onboarding_policy: { active_requires_passed_gate: true }, bots: [], runtime_surfaces: [], workflow_references: [ref] };
  const save = () => writeFileSync(registry, JSON.stringify(document)); save();
  const env = { ...process.env, BOT_WORKFLOW_CHECKER: checker, BOT_REGISTRY_PATH: registry, XDG_DATA_HOME: join(root, "data"),
    CODEX_THREAD_ID: "", CODEX_SESSION_ID: "", CLAUDE_CODE_SESSION_ID: "", TERMFLEET_PANE_ID: "" };
  delete env.NODE_TEST_CONTEXT;
  return { root, cwd, wip, registry, document, save, env };
}

function cli(f, extra = []) {
  const child = spawn(process.execPath, [join(repository, "scripts/termfleet-child.mjs"), "spawn", "--provider", "shell",
    "--cwd", f.cwd, "--task", "Synthetic fixture task", "--no-start-app", "--timeout", "3", ...extra], { env: f.env });
  let stdout = "", stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  return { child, done: new Promise((accept, reject) => {
    child.on("error", reject); child.on("close", (code) => accept({ code, stdout, stderr }));
  }) };
}

function hashes(f) { return [f.registry, f.wip].map((p) => createHash("sha256").update(readFileSync(p)).digest("hex")); }

test("registered paths are automatic; symlink and nested directories use the same reference", (t) => {
  const f = fixture(t), nested = join(f.cwd, "src"), alias = join(f.root, "alias");
  mkdirSync(nested); symlinkSync(nested, alias);
  for (const cwd of [f.cwd, nested, alias]) assert.equal(checkBotTask({ cwd, env: f.env }).registry_reference, "fixture");
});

test("shared bot checkout refuses ambiguity and accepts an explicit ID", (t) => {
  const f = fixture(t); f.document.workflow_references.push({ ...f.document.workflow_references[0], id: "other" }); f.save();
  assert.throws(() => checkBotTask({ cwd: f.cwd, env: f.env }), /ambiguous checkout ownership/);
  assert.equal(checkBotTask({ cwd: f.cwd, bot: "fixture", env: f.env }).registry_reference, "fixture");
  assert.throws(() => checkBotTask({ cwd: f.cwd, bot: "alias", env: f.env }), /ambiguous workflow reference/);
});

test("unregistered marker is blocked while an unrelated project is allowed", (t) => {
  const f = fixture(t); f.document.workflow_references = []; f.save();
  assert.equal(checkBotTask({ cwd: f.cwd, env: f.env }), null);
  mkdirSync(join(f.cwd, ".watchpost")); writeFileSync(join(f.cwd, ".watchpost/bot.json"), "{}");
  assert.throws(() => checkBotTask({ cwd: f.cwd, env: f.env }), /missing workflow reference/);
});

test("missing local fleet installation does not block unrelated work", (t) => {
  const f = fixture(t); f.env.BOT_WORKFLOW_CHECKER = join(f.root, "missing.py");
  assert.equal(checkBotTask({ cwd: f.cwd, env: f.env }), null);
  assert.throws(() => checkBotTask({ cwd: f.cwd, bot: "fixture", env: f.env }), /checker\/index is missing/);
});

test("broken registry cannot deadlock unrelated work or bypass a marked bot", (t) => {
  const f = fixture(t); writeFileSync(f.registry, "invalid: [");
  assert.equal(checkBotTask({ cwd: f.cwd, env: f.env }), null);
  mkdirSync(join(f.cwd, ".watchpost")); writeFileSync(join(f.cwd, ".watchpost/bot.json"), "{}");
  assert.throws(() => checkBotTask({ cwd: f.cwd, env: f.env }), /Bot task not started/);
});

test("stale and mismatched explicit references fail with a repair action", (t) => {
  const f = fixture(t);
  f.document.workflow_references[0].observed_at = "2001-01-01"; f.save();
  assert.throws(() => checkBotTask({ cwd: f.cwd, env: f.env }), /stale.*Reconcile/);
  f.document.workflow_references[0].observed_at = new Date().toISOString().slice(0, 10);
  f.document.workflow_references[0].paths[0].path = f.root; f.save();
  const outside = join(f.root, "outside"); mkdirSync(outside);
  assert.throws(() => checkBotTask({ cwd: outside, bot: "missing", env: f.env }), /missing workflow reference/);
});

test("failed actual CLI preflight creates no request, prompt stash or handoff change", async (t) => {
  const f = fixture(t), before = hashes(f);
  const handoff = join(f.root, "HANDOFF.md"); writeFileSync(handoff, "Preserve caller work.\n");
  const result = await cli(f, ["--bot", "missing"]).done;
  assert.equal(result.code, 2); assert.match(result.stderr, /missing workflow reference/);
  assert.equal(existsSync(f.env.XDG_DATA_HOME), false);
  assert.deepEqual(hashes(f), before); assert.equal(readFileSync(handoff, "utf8"), "Preserve caller work.\n");
});

test("ambiguous actual CLI stops before listener or app start", async (t) => {
  const f = fixture(t); f.document.workflow_references.push({ ...f.document.workflow_references[0], id: "other" }); f.save();
  const result = await cli(f).done;
  assert.equal(result.code, 2); assert.match(result.stderr, /ambiguous checkout ownership/);
  assert.equal(existsSync(f.env.XDG_DATA_HOME), false);
});

test("actual CLI injects verified reference context before handing one request to a synthetic listener", async (t) => {
  const f = fixture(t), before = hashes(f);
  const dir = join(f.env.XDG_DATA_HOME, "terminal-workspace/child-requests"); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, ".listener"), String(Date.now()));
  const run = cli(f);
  t.after(() => { if (run.child.exitCode === null) run.child.kill(); });
  let request;
  for (let i = 0; i < 80 && !request; i++) {
    const name = readdirSync(dir).find((n) => n.endsWith(".request.json"));
    if (name) {
      request = JSON.parse(readFileSync(join(dir, name), "utf8"));
      rmSync(join(dir, name));
      writeFileSync(join(dir, `${request.requestId}.result.json`), JSON.stringify({ ok: true, fixture: true }));
    } else await new Promise((done) => setTimeout(done, 25));
  }
  const result = await run.done;
  assert.equal(result.code, 0, result.stderr);
  assert.equal(request.cwd, f.cwd); assert.match(request.task, /Bot registry reference: fixture/);
  assert.match(request.task, /grants no deployment or messaging permission/);
  assert.deepEqual(hashes(f), before);
});
