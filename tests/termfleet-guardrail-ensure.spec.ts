import { expect, test } from "@playwright/test";
import {
  needsGuardrail,
  safeMemoryHighBytes,
} from "../scripts/termfleet-guardrail-ensure.mjs";

const GIB = 1024 ** 3;

// A running daemon that predates the guardrail reports MemoryHigh=infinity (or
// nothing). Those need the soft ceiling applied live.
test("needsGuardrail is true when the daemon has no soft ceiling", () => {
  expect(needsGuardrail("infinity")).toBe(true);
  expect(needsGuardrail("")).toBe(true);
  expect(needsGuardrail(undefined)).toBe(true);
});

// The ceiling scales with the machine instead of being a fixed 12G.
test("the safe ceiling is half of installed RAM, floored at 8G", () => {
  expect(safeMemoryHighBytes(78 * GIB)).toBe(39 * GIB);
  expect(safeMemoryHighBytes(8 * GIB)).toBe(8 * GIB); // floor, not 4G
  expect(safeMemoryHighBytes(4 * GIB)).toBe(8 * GIB);
});

// Regression for the 2026-08-11 freeze. The old rule lowered anything above a
// fixed 12G, so on a 78G box it clamped a correct 39G ceiling down to 12G while
// the daemon cgroup legitimately held 32G — forcing continuous reclaim and
// pushing live agent sessions onto the swapfile. It also fought the memory-guard
// timer that re-raises the ceiling every 2 minutes, which is why a raised
// ceiling kept reverting on its own.
test("a ceiling at or under the machine's safe value is left alone", () => {
  const safe = safeMemoryHighBytes(78 * GIB);
  expect(needsGuardrail(String(safe), safe)).toBe(false);
  expect(needsGuardrail("39G", safe)).toBe(false);
  expect(needsGuardrail("20G", safe)).toBe(false);
  expect(needsGuardrail("12884901888", safe)).toBe(false); // 12G in bytes
  expect(needsGuardrail("8G", safe)).toBe(false); // deliberate tighter limit
});

test("only a ceiling above the machine's safe value is lowered", () => {
  const safe = safeMemoryHighBytes(78 * GIB);
  expect(needsGuardrail("64G", safe)).toBe(true);
  expect(needsGuardrail(String(70 * GIB), safe)).toBe(true);
});
