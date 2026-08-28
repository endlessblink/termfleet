import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  createRuntimeRegistry,
  decideRecovery,
  loadRuntimeRegistry,
  transitionRuntimeRegistry,
  updateRuntimeRegistry,
} from "../scripts/termfleet-runtime-controller.mjs";

const common = {
  paneId: "pane-flow",
  expectedCwd: "/work/flow",
  provider: "codex",
  providerSessionId: "chat-flow",
};

test("an explicit user kill is never selected for automatic restore", () => {
  assert.equal(decideRecovery({ ...common, explicitlyKilled: true }), "manual-restore-only");
});

test("an untouched pane with no live owner restores its exact conversation", () => {
  assert.equal(decideRecovery({ ...common }), "restore-exact");
});

test("a live owner in the exact pane is not resumed a second time", () => {
  assert.equal(decideRecovery({
    ...common,
    liveProviderOwners: [{ sessionId: common.paneId, cwd: common.expectedCwd }],
  }), "already-running");
});

test("a conversation owned by another pane is attached without a second writer", () => {
  assert.equal(decideRecovery({
    ...common,
    liveProviderOwners: [{ sessionId: "pane-other", cwd: common.expectedCwd }],
  }), "already-owned-elsewhere");
});

test("ambiguous owners and writer locks fail closed", () => {
  assert.equal(decideRecovery({
    ...common,
    liveProviderOwners: [{ sessionId: "pane-a" }, { sessionId: "pane-b" }],
  }), "hold-duplicate-provider-owner");
  assert.equal(decideRecovery({ ...common, providerWriterLocked: true }), "hold-provider-writer-lock");
});

test("registry preserves kill intent and exact provider identity", () => {
  let registry = createRuntimeRegistry(1);
  registry = transitionRuntimeRegistry(registry, {
    kind: "observed",
    paneId: "pane-flow",
    provider: "codex",
    providerSessionId: "chat-flow",
    cwd: "/work/flow",
  }, 2);
  registry = transitionRuntimeRegistry(registry, { kind: "user-close", paneId: "pane-flow" }, 3);
  assert.equal(registry.panes["pane-flow"].lifecycle, "intentional-kill");
  assert.equal(registry.panes["pane-flow"].restoreEligible, false);
  assert.equal(registry.panes["pane-flow"].providerSessionId, "chat-flow");
  registry = transitionRuntimeRegistry(registry, { kind: "user-restore", paneId: "pane-flow" }, 4);
  assert.equal(registry.panes["pane-flow"].restoreEligible, true);
});

test("registry holds a second pane instead of duplicating one provider owner", () => {
  let registry = createRuntimeRegistry(1);
  registry = transitionRuntimeRegistry(registry, {
    kind: "live-owner",
    paneId: "pane-first",
    provider: "codex",
    providerSessionId: "chat-one",
    daemonSessionId: "daemon-one",
    cwd: "/work/termfleet",
  }, 2);
  registry = transitionRuntimeRegistry(registry, {
    kind: "restore-exact",
    paneId: "pane-second",
    provider: "codex",
    providerSessionId: "chat-one",
    daemonSessionId: "daemon-one",
    cwd: "/work/termfleet",
  }, 3);
  assert.equal(registry.panes["pane-first"].lifecycle, "alive");
  assert.equal(registry.panes["pane-second"].lifecycle, "held");
  assert.equal(registry.panes["pane-second"].restoreEligible, false);
  assert.equal(registry.panes["pane-second"].holdReason, "duplicate-runtime-owner");
});

test("an older racing close cannot overwrite a newer restore", () => {
  let registry = createRuntimeRegistry(1);
  registry = transitionRuntimeRegistry(registry, {
    kind: "user-restore",
    paneId: "pane-race",
    provider: "codex",
    providerSessionId: "chat-race",
    atMs: 20,
  }, 20);
  registry = transitionRuntimeRegistry(registry, {
    kind: "user-close",
    paneId: "pane-race",
    atMs: 10,
  }, 30);
  assert.equal(registry.panes["pane-race"].lifecycle, "recoverable");
  assert.equal(registry.panes["pane-race"].restoreEligible, true);
  assert.equal(registry.panes["pane-race"].updatedAt, 20);
});

test("concurrent updates serialize without losing pane decisions", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "termfleet-runtime-controller-"));
  const registryPath = path.join(root, "runtime-registry.json");
  try {
    await Promise.all([
      Promise.resolve().then(() => updateRuntimeRegistry(registryPath, { kind: "user-close", paneId: "pane-a" }, 10)),
      Promise.resolve().then(() => updateRuntimeRegistry(registryPath, { kind: "user-restore", paneId: "pane-b" }, 11)),
      Promise.resolve().then(() => updateRuntimeRegistry(registryPath, { kind: "provider-exit", paneId: "pane-c" }, 12)),
    ]);
    const registry = loadRuntimeRegistry(registryPath);
    assert.equal(Object.keys(registry.panes).length, 3);
    assert.equal(registry.panes["pane-a"].restoreEligible, false);
    assert.equal(registry.panes["pane-b"].restoreEligible, true);
    assert.equal(registry.panes["pane-c"].restoreEligible, true);
    assert.equal(registry.generation, 3);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("separate controller processes cannot overwrite each other", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "termfleet-runtime-controller-processes-"));
  const registryPath = path.join(root, "runtime-registry.json");
  const worker = fileURLToPath(new URL("./runtime-controller-worker.mjs", import.meta.url));
  try {
    const jobs = Array.from({ length: 10 }, (_, index) => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [worker, registryPath, `pane-${index}`, index % 2 ? "user-restore" : "user-close", String(index + 20)], {
        stdio: "ignore",
      });
      child.on("error", reject);
      child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`worker exited ${code}`)));
    }));
    await Promise.all(jobs);
    const registry = loadRuntimeRegistry(registryPath);
    assert.equal(Object.keys(registry.panes).length, 10);
    assert.equal(registry.generation, 10);
    assert.equal(registry.panes["pane-0"].restoreEligible, false);
    assert.equal(registry.panes["pane-1"].restoreEligible, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
