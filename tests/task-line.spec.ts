import { expect, test } from "@playwright/test";
import { resolvePaneTaskLine } from "../src/lib/taskLine";

const NOW = Date.parse("2026-07-22T12:00:00.000Z");

// R1: the invariant this whole module exists for.
test("never blank, even with nothing at all", () => {
  const line = resolvePaneTaskLine({ now: NOW });
  expect(line.text.length).toBeGreaterThan(0);
  expect(line.text).not.toMatch(/task not captured/i);
});

test("the agent's declared task wins", () => {
  const line = resolvePaneTaskLine({
    now: NOW,
    declaredTask: "Cleaning up messy terminal text",
    facts: { title: "Something else" },
  });
  expect(line.text).toBe("Cleaning up messy terminal text");
  expect(line.source).toBe("declared");
});

// R3: a finished turn demotes the declared task immediately.
test("a turn that ended demotes the declared task", () => {
  const line = resolvePaneTaskLine({
    now: NOW,
    declaredTask: "Cleaning up messy terminal text",
    facts: {
      lastTurnEndAt: NOW - 1000,
      operatorRequest: "sort the sidebar by name",
    },
  });
  expect(line.source).toBe("operator-request");
  expect(line.text).toBe("sort the sidebar by name");
});

// The operator's floor rule, verbatim: "in the least — write the main user goal".
test("falls to the operator's own request before any template", () => {
  const line = resolvePaneTaskLine({
    now: NOW,
    facts: {
      operatorRequest: "sort the sidebar by name",
      lastTool: { name: "Read", arg: "a.ts" },
    },
  });
  expect(line.source).toBe("operator-request");
});

test("templates the current tool when nothing was said", () => {
  const line = resolvePaneTaskLine({
    now: NOW,
    facts: { lastTool: { name: "Read", arg: "gridRenderer.ts" } },
  });
  expect(line.text).toBe("Reading gridRenderer.ts");
  expect(line.source).toBe("current-tool");
  expect(line.expiresAt).toBe(NOW + 30_000);
});

test("a shell shows what it is actually doing", () => {
  expect(
    resolvePaneTaskLine({
      now: NOW,
      runningCommand: "npm run build",
      folder: "termfleet",
    }),
  ).toMatchObject({
    text: "Running npm run build",
    source: "running-command",
  });
  expect(
    resolvePaneTaskLine({ now: NOW, folder: "termfleet", branch: "main" }),
  ).toMatchObject({
    text: "Sitting at a command prompt in termfleet on main",
    source: "shell-state",
  });
});

// R4 + R2: reject, never rewrite; and record that something was rejected.
test("jargon is skipped, not paraphrased", () => {
  const line = resolvePaneTaskLine({
    now: NOW,
    declaredTask: "/compact && git rebase -i HEAD~3",
    facts: { operatorRequest: "sort the sidebar by name" },
  });
  expect(line.source).toBe("operator-request");
  expect(line.rejected).toBe("/compact && git rebase -i HEAD~3");
});

// R2: nothing is ever invented — each rung's text is byte-identical to its source.
test("declared, title and request text are copied verbatim", () => {
  const declared = "Cleaning up messy terminal text";
  expect(resolvePaneTaskLine({ now: NOW, declaredTask: declared }).text).toBe(
    declared,
  );
  const title = "Investigate e2e redirect";
  expect(resolvePaneTaskLine({ now: NOW, facts: { title } }).text).toBe(title);
});
