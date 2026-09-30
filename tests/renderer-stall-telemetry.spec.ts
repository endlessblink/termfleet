import { expect, test } from "@playwright/test";
import { createRendererStallRecorder } from "../src/lib/rendererStallTelemetry";

test("renderer stall recorder ignores short gaps and rate-limits records", () => {
  let now = 1000;
  const records: unknown[] = [];
  const record = createRendererStallRecorder((stall) => records.push(stall), () => now);

  expect(record("timer-gap", 249)).toBe(false);
  expect(record("timer-gap", 250)).toBe(true);
  now += 999;
  expect(record("long-task", 800)).toBe(false);
  now += 1;
  expect(record("long-task", 800)).toBe(true);
  expect(records).toEqual([
    { source: "timer-gap", durationMs: 250, observedAtMs: 1000 },
    { source: "long-task", durationMs: 800, observedAtMs: 2000 },
  ]);
});

test("renderer stall recorder caps records for the life of the window", () => {
  let now = 0;
  let count = 0;
  const record = createRendererStallRecorder(() => count++, () => now);

  for (let i = 0; i < 125; i += 1) {
    now += 1000;
    record("timer-gap", 300);
  }

  expect(count).toBe(120);
});
