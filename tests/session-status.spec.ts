import { test, expect } from "@playwright/test";
import { reconcileSessionStatus, sessionAttention, WORKING_STALE_MS } from "../src/lib/sessionStatus";

const NOW = 1_000_000;

test("a visible done-marker overrides a stale 'working' hook (the false-Running bug)", () => {
  // Codex/OMC left status on "working" after the turn ended, but the screen shows "Cooked for".
  const s = reconcileSessionStatus({ summaryStatus: "working", atRest: true, now: NOW, lastActivityAt: NOW });
  expect(s.attention).toBe("idle");
});

test("a 'working' hook that stopped updating goes Idle (finished turn, no end event)", () => {
  // #46: Claude finished, is at a rest prompt, no on-screen marker; hook status is stale.
  const stale = reconcileSessionStatus({
    summaryStatus: "working",
    activelyRunning: false,
    lastActivityAt: NOW - WORKING_STALE_MS - 1,
    now: NOW,
  });
  expect(stale.attention).toBe("idle");
  expect(stale.stale).toBe(true);
});

test("a FRESH idle hook (Stop just fired) is deterministically Idle", () => {
  // The reliable path: when the turn-end hook writes idle and it's fresh, we KNOW it's done.
  expect(reconcileSessionStatus({ summaryStatus: "idle", lastActivityAt: NOW, now: NOW }).attention).toBe("idle");
});

test("a FRESH waiting hook (Notification) is deterministically Waiting", () => {
  expect(reconcileSessionStatus({ summaryStatus: "waiting", lastActivityAt: NOW, now: NOW }).attention).toBe("waiting");
});

test("a fresh 'working' hook stays Running (actively working, streaming)", () => {
  const fresh = reconcileSessionStatus({
    summaryStatus: "working",
    activelyRunning: false,
    lastActivityAt: NOW - 2_000,
    now: NOW,
  });
  expect(fresh.attention).toBe("running");
});

test("a live on-screen generating marker is Running regardless of timestamps", () => {
  const s = reconcileSessionStatus({ summaryStatus: "idle", activelyRunning: true, now: NOW });
  expect(s.attention).toBe("running");
});

test("explicit waiting wins", () => {
  expect(reconcileSessionStatus({ summaryStatus: "waiting" }).attention).toBe("waiting");
  expect(reconcileSessionStatus({ summaryStatus: "blocked" }).attention).toBe("waiting");
});

test("an idle shell with no signals is Idle, not Running", () => {
  expect(reconcileSessionStatus({ summaryStatus: "idle" }).attention).toBe("idle");
  expect(reconcileSessionStatus({}).attention).toBe("idle");
});

test("sessionAttention gives identical results for identical inputs (no cross-view contradiction)", () => {
  const input = {
    visibleText: "some output\n* Cooked for 13s\n› ",
    durableActivityStatus: "running",
    summaryStatus: "working",
    lastActivityAt: NOW,
    now: NOW,
  };
  // Same inputs → same badge everywhere. Cooked marker wins → idle even with durable "running".
  expect(sessionAttention(input)).toBe("idle");
  expect(sessionAttention(input)).toBe(sessionAttention(input));
});

test("sessionAttention: a live thinking timer reads Running", () => {
  expect(
    sessionAttention({ visibleText: "Getting there… (4m 26s · thinking)", summaryStatus: "idle", now: NOW }),
  ).toBe("running");
});
