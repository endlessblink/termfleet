import { test, expect } from "@playwright/test";
// @ts-expect-error plain ES module
import { availableMemoryBytes, memoryGuard, botTerminalLimit, liveBotTerminals } from "../scripts/lib/spawn-guards.mjs";

// Agent-Manager 2026-10-24: one bot opened 13 terminals and crashed the machine.
const meminfo = (gb: number) => `MemTotal:       65000000 kB\nMemAvailable:   ${Math.round(gb * 1024 * 1024)} kB\n`;

test("a new terminal is refused when less than 4 GB of memory is free", () => {
  expect(availableMemoryBytes(meminfo(2))).toBe(2 * 1024 ** 3);
  expect(memoryGuard({ env: {}, readMeminfo: () => meminfo(8) }).ok).toBe(true);
  const low = memoryGuard({ env: {}, readMeminfo: () => meminfo(3.5) });
  expect(low.ok).toBe(false);
  expect(low.message).toContain("3.5 GB");
  expect(memoryGuard({ env: { TERMFLEET_MIN_FREE_GB: "2" }, readMeminfo: () => meminfo(3.5) }).ok).toBe(true);
  // Unreadable memory never blocks a start.
  expect(memoryGuard({ env: {}, readMeminfo: () => { throw new Error("no /proc"); } }).ok).toBe(true);
});

test("a bot runs at most 3 terminals unless configured otherwise", () => {
  expect(botTerminalLimit({ env: {}, bot: null })).toBe(3);
  expect(botTerminalLimit({ env: {}, bot: { maxTerminals: 5 } })).toBe(5);
  expect(botTerminalLimit({ env: { TERMFLEET_BOT_MAX_TERMINALS: "2" }, bot: { maxTerminals: 5 } })).toBe(2);
  const helpers = [{ paneId: "a" }, { paneId: "b" }, { paneId: "b" }, { paneId: "c", followed: true }, { paneId: "d", ended: 1 }, { paneId: "e" }];
  const panes = [{ id: "a", alive: true }, { id: "b", alive: true }, { id: "c", alive: true }, { id: "d", alive: true }, { id: "e", alive: false }];
  expect(liveBotTerminals(helpers, panes)).toEqual(["a", "b"]);
});
