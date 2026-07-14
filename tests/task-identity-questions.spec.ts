import { test, expect } from "@playwright/test";
import { resolveTaskIdentity, TASK_NOT_CAPTURED } from "../src/lib/taskIdentity";

test("a bare conversational question is not echoed as the Task", () => {
  const id = resolveTaskIdentity({
    mainUserAsk: { text: "what will this plugin cover?", source: "terminal-prompt" },
  });
  // The operator's raw question must not stand as the task ("this is just what I wrote").
  expect(id.text).not.toBe("what will this plugin cover?");
  expect(id.text).toBe(TASK_NOT_CAPTURED);
});

test("a bare question from the sidecar ask is also dropped", () => {
  const id = resolveTaskIdentity({
    mainUserAsk: { text: "how does this work?", source: "status-sidecar" },
  });
  expect(id.text).toBe(TASK_NOT_CAPTURED);
});

test("a real directive (not a question) still shows as the Task", () => {
  const id = resolveTaskIdentity({
    mainUserAsk: { text: "add rate limiting to the login endpoint", source: "terminal-prompt" },
  });
  expect(id.text).toBe("add rate limiting to the login endpoint");
  expect(id.source).toBe("user-prompt");
});

test("a directive that merely contains a question mark is kept", () => {
  const id = resolveTaskIdentity({
    mainUserAsk: { text: "fix the crash on save, and check the API too?", source: "terminal-prompt" },
  });
  // Not an interrogative opener, so it's a task, not a bare question.
  expect(id.text).toContain("fix the crash on save");
});
