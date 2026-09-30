import { expect, test } from "@playwright/test";
import { createTerminalInteractionLatencyBatcher } from "../src/lib/terminalInteractionLatency";

test("terminal interaction timings write one bounded content-free aggregate per 20 samples", () => {
  const writes: unknown[] = [];
  const batcher = createTerminalInteractionLatencyBatcher((aggregate) => writes.push(aggregate));

  for (let index = 1; index < 20; index += 1) {
    batcher.record({
      recentInputToDiffMs: index,
      canvasDrawMs: index / 10,
      recentInputToFrameCallbackMs: index + 1,
    });
  }
  expect(writes).toHaveLength(0);

  batcher.record({
    recentInputToDiffMs: 20,
    canvasDrawMs: 2,
    recentInputToFrameCallbackMs: 21,
  });
  expect(writes).toHaveLength(1);
  expect(writes[0]).toEqual({
    kind: "terminal-interaction-latency",
    count: 20,
    recentInputToDiffMs: { p50: 10, p95: 19, max: 20 },
    canvasDrawMs: { p50: 1, p95: 1.9, max: 2 },
    recentInputToFrameCallbackMs: { p50: 11, p95: 20, max: 21 },
  });
  expect(JSON.stringify(writes[0])).not.toMatch(/key|text|session|terminal output/i);

  batcher.record({
    recentInputToDiffMs: Number.NaN,
    canvasDrawMs: 1,
    recentInputToFrameCallbackMs: 1,
  });
  expect(writes).toHaveLength(1);
});
