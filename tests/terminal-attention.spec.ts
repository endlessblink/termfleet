// Badge label/color contract. The badge STATE itself is pure event status — covered by
// tests/session-status.spec.ts and tests/badge-regression.spec.ts. The scrollback marker
// helpers below are legacy parsers kept only for reference/tests; production badge code
// must NOT use them (enforced by badge-regression's source-contract test).
import { test, expect } from "@playwright/test";
import { badgeForAttention } from "../src/lib/terminalAttention";
import { terminalLooksActivelyWorking, terminalLooksAtRest } from "../src/lib/terminalHeaderDisplay";

test("badge labels are plain language for a non-technical viewer", () => {
  expect(badgeForAttention("waiting").label).toBe("Waiting for you");
  expect(badgeForAttention("running").label).toBe("Running");
  expect(badgeForAttention("idle").label).toBe("Idle");
});

test("each state carries a distinct color token", () => {
  const colors = new Set(["waiting", "running", "idle"].map((s) => badgeForAttention(s as never).color));
  expect(colors.size).toBe(3);
});

// --- legacy scrollback marker parsers (not used by the badge) -----------------------

test("OMC/Claude done footers are detected as at-rest, prose is not", () => {
  expect(terminalLooksAtRest("* Cooked for 13s\n› ")).toBe(true);
  expect(terminalLooksAtRest("* Churned for 5m 41s\n› start the LLM classifier")).toBe(true);
  expect(terminalLooksAtRest("- Worked for 46m 09s\n› Implement {feature}")).toBe(true);
  expect(terminalLooksAtRest("I worked for the client all day")).toBe(false);
  expect(terminalLooksAtRest("* Cooked for 13s\nWorking (4s · esc to interrupt)")).toBe(false);
});

test("live generating markers vs persistent mode labels", () => {
  expect(terminalLooksActivelyWorking("Working (32s · esc to interrupt)")).toBe(true);
  expect(terminalLooksActivelyWorking("Getting there… (4m 26s · thinking)")).toBe(true);
  expect(terminalLooksActivelyWorking("[OMC] | thinking | session:66m | ctx:28% | Opus 4.8")).toBe(false);
  expect(terminalLooksActivelyWorking("user@host:~/proj$ ")).toBe(false);
});
