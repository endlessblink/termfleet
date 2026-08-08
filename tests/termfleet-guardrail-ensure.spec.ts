import { expect, test } from "@playwright/test";
import { needsGuardrail } from "../scripts/termfleet-guardrail-ensure.mjs";

// A running daemon that predates the guardrail reports MemoryHigh=infinity (or
// nothing). Those need the soft ceiling applied live. A finite value means it's
// already set (by us or a manual override) — leave it alone (idempotent).
test("needsGuardrail is true when the daemon has no soft ceiling", () => {
  expect(needsGuardrail("infinity")).toBe(true);
  expect(needsGuardrail("")).toBe(true);
  expect(needsGuardrail(undefined)).toBe(true);
});

test("needsGuardrail is false once a finite ceiling is already set", () => {
  expect(needsGuardrail("12884901888")).toBe(false); // 12G in bytes
  expect(needsGuardrail("8G")).toBe(false); // deliberate tighter limit
});

test("needsGuardrail lowers an unsafe finite ceiling", () => {
  expect(needsGuardrail("34359738368")).toBe(true); // 32G in bytes
  expect(needsGuardrail("40G")).toBe(true);
});
