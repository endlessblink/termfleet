import { expect, test } from "@playwright/test";
import { createWorkLedger, siteFromStack } from "../src/lib/workAttribution";

test("work ledger totals callback time per site and resets each window", () => {
  let now = 0;
  const ledger = createWorkLedger(() => now);
  const slow = ledger.wrap("frame@a.js:1:1", () => {
    now += 30;
  });
  const fast = ledger.wrap("interval@b.js:2:2", () => {
    now += 2;
  });

  slow();
  slow();
  fast();
  now += 100;

  expect(ledger.flush()).toEqual({
    windowMs: 162,
    busyMs: 62,
    callbacks: 3,
    top: [
      { site: "frame@a.js:1:1", totalMs: 60, count: 2, maxMs: 30 },
      { site: "interval@b.js:2:2", totalMs: 2, count: 1, maxMs: 2 },
    ],
    mutations: [],
  });
  expect(ledger.flush()).toEqual({ windowMs: 0, busyMs: 0, callbacks: 0, top: [], mutations: [] });
});

test("nested wrapped callbacks are counted once, under the outer site", () => {
  let now = 0;
  const ledger = createWorkLedger(() => now);
  const inner = ledger.wrap("event:click@inner.js:1:1", () => {
    now += 5;
  });
  const outer = ledger.wrap("scheduler@outer.js:1:1", () => {
    now += 10;
    inner();
  });

  outer();

  const sample = ledger.flush();
  expect(sample.busyMs).toBe(15);
  expect(sample.top).toEqual([{ site: "scheduler@outer.js:1:1", totalMs: 15, count: 1, maxMs: 15 }]);
});

test("wrapped callbacks keep their return value, this, and thrown errors", () => {
  const ledger = createWorkLedger(() => 0);
  const target = { value: 7 };
  const read = ledger.wrap("frame@x.js:1:1", function (this: { value: number }, add: number) {
    return this.value + add;
  });
  expect(read.call(target, 3)).toBe(10);

  const boom = ledger.wrap("frame@x.js:2:2", () => {
    throw new Error("boom");
  });
  expect(() => boom()).toThrow("boom");
  expect(ledger.flush().callbacks).toBe(2);
});

test("site labels skip the ledger's own frames and keep only bundle positions", () => {
  const webkit = [
    "siteFor@tauri://localhost/assets/index-abc.js:10:5",
    "requestAnimationFrame@tauri://localhost/assets/index-abc.js:11:6",
    "draw@tauri://localhost/assets/index-abc.js:400:12",
    "tick@tauri://localhost/assets/index-abc.js:401:13",
    "loop@tauri://localhost/assets/index-abc.js:402:14",
    "outer@tauri://localhost/assets/index-abc.js:403:15",
  ].join("\n");
  expect(siteFromStack("frame", webkit)).toBe("frame@index-abc.js:400:12<index-abc.js:401:13<index-abc.js:402:14");

  const v8 = "Error\n    at siteFor (http://h/assets/a.js:1:1)\n    at patched (http://h/assets/a.js:2:2)\n    at caller (http://h/assets/a.js:9:9)";
  expect(siteFromStack("timeout", v8, 3, 1)).toBe("timeout@a.js:9:9");
  expect(siteFromStack("timeout", undefined)).toBe("timeout@?");
});

test("installing never throws, even when the runtime locks what it patches", async () => {
  // Regression: Tauri defines __TAURI_INTERNALS__.transformCallback as
  // non-writable; assigning it threw during module load and the cockpit never
  // left the loading screen (2026-09-28). Lock another hook the same way.
  const fakeWindow = {
    setTimeout: globalThis.setTimeout,
    setInterval: globalThis.setInterval,
    __TAURI_INTERNALS__: Object.defineProperty({}, "transformCallback", { value: () => 1 }),
  } as Record<string, unknown>;
  Object.defineProperty(fakeWindow, "requestAnimationFrame", { value: () => 0, enumerable: true });
  const previous = (globalThis as Record<string, unknown>).window;
  (globalThis as Record<string, unknown>).window = fakeWindow;
  try {
    const { installWorkAttribution } = await import("../src/lib/workAttribution");
    expect(() => installWorkAttribution()).not.toThrow();
    expect(fakeWindow.setTimeout).not.toBe(globalThis.setTimeout);
  } finally {
    (globalThis as Record<string, unknown>).window = previous;
  }
});

test("style change labels name the properties that changed, never their values", async () => {
  const { changedStyleProperties } = await import("../src/lib/workAttribution");
  expect(changedStyleProperties("width: 10px; color: red;", "width: 12px; color: red; opacity: 1")).toBe("opacity,width");
  expect(changedStyleProperties("transform: translate(1px, 2px)", "")).toBe("transform");
  expect(changedStyleProperties("a: 1", "a: 1")).toBe("");
});
