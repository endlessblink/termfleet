import { expect, test } from "@playwright/test";
import {
  idleSecondsFromSidecar,
  reapDecision,
  summarizeTree,
} from "../scripts/termfleet-reaper.mjs";

const OPTS = { idleThresholdSeconds: 900 };

// The exact bug found 2026-07-13: an agent running as the session's OWN root
// process was missed by a descendants-only scan. summarizeTree is fed the whole
// tree INCLUDING the root, so a root-level agent must count as live.
test("summarizeTree counts an agent at the session root as live", () => {
  expect(summarizeTree(["codex"]).hasLiveAgent).toBe(true);
  expect(summarizeTree(["claude", "node", "esbuild"]).hasLiveAgent).toBe(true);
});

test("summarizeTree flags no agent and counts leftover tools in a bare tree", () => {
  const s = summarizeTree(["bash", "esbuild", "vite", "node_repl"]);
  expect(s.hasLiveAgent).toBe(false);
  expect(s.toolProcCount).toBe(3);
});

test("idleSecondsFromSidecar uses updatedAt; missing/invalid sidecar is treated as very idle", () => {
  const now = 1_000_000_000_000;
  expect(idleSecondsFromSidecar({ updatedAt: now - 5000 }, now)).toBe(5);
  expect(idleSecondsFromSidecar(null, now)).toBe(Number.POSITIVE_INFINITY);
  expect(idleSecondsFromSidecar({ userTask: "x" }, now)).toBe(Number.POSITIVE_INFINITY);
});

// The safety gate. Today's outage came from a SHALLOW child scan that missed
// agents nested under a wrapper; `hasLiveAgent` here MUST be a deep-tree result.
test("never reaps a session with a live agent anywhere in its tree", () => {
  const d = reapDecision(
    { hasLiveAgent: true, idleSeconds: 100000, toolProcCount: 50 },
    OPTS,
  );
  expect(d.reap).toBe(false);
  expect(d.reason).toMatch(/live agent/i);
});

test("never reaps a session that was active within the idle window", () => {
  const d = reapDecision(
    { hasLiveAgent: false, idleSeconds: 120, toolProcCount: 30 },
    OPTS,
  );
  expect(d.reap).toBe(false);
  expect(d.reason).toMatch(/active|idle window/i);
});

test("does not reap an idle exited-agent session that holds nothing to reclaim", () => {
  const d = reapDecision(
    { hasLiveAgent: false, idleSeconds: 5000, toolProcCount: 0 },
    OPTS,
  );
  expect(d.reap).toBe(false);
  expect(d.reason).toMatch(/nothing|no leftover/i);
});

test("reaps an idle, exited-agent session that still holds leftover tool servers", () => {
  const d = reapDecision(
    { hasLiveAgent: false, idleSeconds: 5000, toolProcCount: 42 },
    OPTS,
  );
  expect(d.reap).toBe(true);
  expect(d.reason).toMatch(/42/);
});

test("idle threshold is inclusive (exactly at the window still reaps)", () => {
  const d = reapDecision(
    { hasLiveAgent: false, idleSeconds: 900, toolProcCount: 3 },
    { idleThresholdSeconds: 900 },
  );
  expect(d.reap).toBe(true);
});
