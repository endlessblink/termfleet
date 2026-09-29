import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createStorageGovernor, setStorageFullHandler, writeIntervalMs } from "../src/lib/storageGovernor";

// TF-015 (2026-09-29): the cockpit rewrote ~1 MB of quest progress every second
// plus the workspace on every status change (~0.5 MB/s). WebKit's storage log
// grew to ~80 MB and the next launch never left the splash screen.

function harness() {
  let clock = 0;
  const timers: Array<{ at: number; fn: () => void; id: number }> = [];
  let nextId = 1;
  const store = new Map<string, string>();
  const writes: Array<{ key: string; bytes: number; at: number }> = [];
  let failNextWrite = false;
  const reports: unknown[] = [];
  const governor = createStorageGovernor({
    raw: {
      setItem: (key, value) => {
        if (failNextWrite) {
          failNextWrite = false;
          throw new Error("QuotaExceededError");
        }
        store.set(key, value);
        writes.push({ key, bytes: value.length, at: clock });
      },
      getItem: (key) => store.get(key) ?? null,
      removeItem: (key) => void store.delete(key),
    },
    now: () => clock,
    timer: {
      set: (fn, ms) => {
        const id = nextId++;
        timers.push({ at: clock + ms, fn, id });
        return id;
      },
      clear: (id) => {
        const index = timers.findIndex((t) => t.id === id);
        if (index >= 0) timers.splice(index, 1);
      },
    },
    report: (event) => reports.push(event),
  });
  const advance = (ms: number) => {
    const target = clock + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const due = timers[0];
      if (!due || due.at > target) break;
      timers.shift();
      clock = due.at;
      due.fn();
    }
    clock = target;
  };
  return { governor, store, writes, advance, reports, failNext: () => (failNextWrite = true) };
}

test("an unchanged value is never written again", () => {
  const h = harness();
  h.governor.setItem("k", "v1");
  h.advance(10_000);
  h.governor.setItem("k", "v1");
  h.governor.setItem("k", "v1");
  expect(h.writes).toHaveLength(1);
});

test("a burst of saves becomes one immediate and one trailing write with the newest value", () => {
  const h = harness();
  for (let i = 0; i < 100; i += 1) h.governor.setItem("k", `value-${i}`);
  expect(h.writes).toHaveLength(1);
  expect(h.store.get("k")).toBe("value-0");
  h.advance(writeIntervalMs("value-99".length));
  expect(h.writes).toHaveLength(2);
  expect(h.store.get("k")).toBe("value-99");
  expect(h.reports).toEqual([{ key: "k", bytes: 8, coalesced: 99 }]);
});

test("reads return the newest pending value", () => {
  const h = harness();
  h.governor.setItem("k", "a");
  h.governor.setItem("k", "b");
  expect(h.store.get("k")).toBe("a");
  expect(h.governor.getItem("k")).toBe("b");
});

test("large values get a longer interval (per-key byte budget)", () => {
  expect(writeIntervalMs(10)).toBe(2_000);
  expect(writeIntervalMs(500_000)).toBe(2_500_000);
  expect(writeIntervalMs(50_000_000)).toBe(60 * 60_000);
});

test("the quest-progress pattern stays within budget: 1 MB saved every second for 10 minutes", () => {
  const h = harness();
  const big = (n: number) => `${n}`.padEnd(1_000_000, "x");
  for (let second = 0; second < 600; second += 1) {
    h.governor.setItem("termfleet.gamification.v6", big(second));
    h.advance(1_000);
  }
  const totalMb = h.writes.reduce((sum, w) => sum + w.bytes, 0) / 1e6;
  // Unguarded: 600 MB. Guarded: the first write only within 10 minutes.
  expect(totalMb).toBeLessThanOrEqual(2);
  expect(h.governor.getItem("termfleet.gamification.v6")?.startsWith("599")).toBe(true);
});

test("the first write after a quiet period still throws synchronously (quota handling keeps working)", () => {
  const h = harness();
  h.failNext();
  expect(() => h.governor.setItem("k", "v")).toThrow("QuotaExceededError");
});

test("a failed deferred write does not throw into a timer", () => {
  const h = harness();
  h.governor.setItem("k", "a");
  h.governor.setItem("k", "b");
  h.failNext();
  expect(() => h.advance(5_000)).not.toThrow();
});

test("flushAll writes pending values now; removeItem cancels them", () => {
  const h = harness();
  h.governor.setItem("a", "1");
  h.governor.setItem("a", "2");
  h.governor.setItem("b", "1");
  h.governor.setItem("b", "2");
  h.governor.removeItem("b");
  h.governor.flushAll();
  expect(h.store.get("a")).toBe("2");
  expect(h.store.has("b")).toBe(false);
  expect(h.governor.pendingCount()).toBe(0);
});

test("the governor loads before any other app module, and close flushes it", () => {
  const main = readFileSync(path.join(process.cwd(), "src/main.tsx"), "utf8");
  const firstImport = main.split("\n").find((line) => line.startsWith("import "));
  expect(firstImport).toBe('import "./lib/storageGovernorInstall";');
  const workspace = readFileSync(path.join(process.cwd(), "src/stores/workspace.ts"), "utf8");
  const flush = workspace.slice(workspace.indexOf("async function flushWorkspacePersistence"));
  expect(flush.slice(0, flush.indexOf("await diskMirrorQueue"))).toContain("flushStorageWrites()");
  expect(flush.slice(0, flush.indexOf("await diskMirrorQueue"))).toContain("flushPendingDiskMirror()");
});

test("a deferred write that finds storage full frees space and retries once", () => {
  const h = harness();
  let freed = 0;
  setStorageFullHandler(() => {
    freed += 1;
  });
  try {
    h.governor.setItem("k", "a");
    h.governor.setItem("k", "b");
    h.failNext();
    h.advance(5_000);
    expect(freed).toBe(1);
    expect(h.store.get("k")).toBe("b");
  } finally {
    setStorageFullHandler(null);
  }
});

test("the browser preview keeps plain storage; only the desktop app is governed", () => {
  const source = readFileSync(path.join(process.cwd(), "src/lib/storageGovernor.ts"), "utf8");
  const install = source.slice(source.indexOf("export function installStorageGovernor"));
  expect(install).toContain('if (!("__TAURI_INTERNALS__" in window)) return;');
});

test("a long session stays within the daily log budget (2026-09-29: 96 MB in 5.5 h at the old budget)", () => {
  const h = harness();
  const workspace = (n: number) => `${n}`.padEnd(260_000, "w");
  const quest = (n: number) => `${n}`.padEnd(545_000, "q");
  // 24 hours: the workspace changes every second, the quest record every second.
  for (let second = 0; second < 24 * 3600; second += 1) {
    h.governor.setItem("terminal-workspace.v1", workspace(second));
    h.governor.setItem("termfleet.gamification.v6", quest(second));
    h.advance(1_000);
  }
  const totalMb = h.writes.reduce((sum, w) => sum + w.bytes, 0) / 1e6;
  // SQLite logs ~2x the value size; the launcher folds the log back each launch.
  expect(totalMb * 2).toBeLessThanOrEqual(80);
});
