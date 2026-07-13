import { expect, test } from "@playwright/test";
import { reapDecision } from "../scripts/termfleet-reaper.mjs";

const OPTS = { idleThresholdSeconds: 900 };

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
