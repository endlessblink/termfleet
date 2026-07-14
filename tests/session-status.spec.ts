import { test, expect } from "@playwright/test";
import { reconcileSessionStatus, sessionAttention } from "../src/lib/sessionStatus";

test("the badge is the agent's reported status, nothing else", () => {
  expect(reconcileSessionStatus({ summaryStatus: "working" }).attention).toBe("running");
  expect(reconcileSessionStatus({ summaryStatus: "idle" }).attention).toBe("idle");
  expect(reconcileSessionStatus({ summaryStatus: "done" }).attention).toBe("idle");
  expect(reconcileSessionStatus({ summaryStatus: "waiting" }).attention).toBe("waiting");
  expect(reconcileSessionStatus({ summaryStatus: "blocked" }).attention).toBe("waiting");
  expect(reconcileSessionStatus({ summaryStatus: undefined }).attention).toBe("idle");
});

test("it is a PURE function of the status — same input always gives same output (cannot flash)", () => {
  // No clock/time input, so repeated calls can never oscillate.
  for (let i = 0; i < 5; i++) {
    expect(reconcileSessionStatus({ summaryStatus: "working" }).attention).toBe("running");
    expect(reconcileSessionStatus({ summaryStatus: "idle" }).attention).toBe("idle");
  }
});

test("sessionAttention maps the reported status the same way in every view", () => {
  expect(sessionAttention({ summaryStatus: "working" })).toBe("running");
  expect(sessionAttention({ summaryStatus: "waiting" })).toBe("waiting");
  expect(sessionAttention({ summaryStatus: "idle" })).toBe("idle");
});
