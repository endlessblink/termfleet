import { expect, test } from "@playwright/test";
import {
  formatAgentReconnectResult,
  reconnectStoppedAgents,
  type AgentReconnectDependencies,
} from "../src/lib/agentReconnect";

function dependencies(
  overrides: Partial<AgentReconnectDependencies> = {},
): AgentReconnectDependencies {
  return {
    readRunningProvider: async () => null,
    readRecovery: async (paneId) => ({
      provider: "codex",
      sessionId: `019f-session-${paneId}`,
    }),
    sessionExists: async () => true,
    writeResumeCommand: async () => undefined,
    ...overrides,
  };
}

test("reconnects each stopped pane once with its own saved conversation", async () => {
  const writes: Array<{ paneId: string; command: string }> = [];
  const result = await reconnectStoppedAgents(
    ["terminal-a", "terminal-a", "terminal-b"],
    dependencies({
      readRecovery: async (paneId) =>
        paneId === "terminal-a"
          ? { provider: "codex", sessionId: "019fae67-safe-id" }
          : { provider: "claude", sessionId: "2492d5a8-safe-id" },
      writeResumeCommand: async (paneId, command) => {
        writes.push({ paneId, command });
      },
    }),
  );

  expect(writes).toEqual([
    {
      paneId: "terminal-a",
      command: "exec codex resume 019fae67-safe-id\n",
    },
    {
      paneId: "terminal-b",
      command: "exec claude --resume 2492d5a8-safe-id\n",
    },
  ]);
  expect(result.resumed).toEqual(["terminal-a", "terminal-b"]);
  expect(result.alreadyRunning).toEqual([]);
  expect(result.failed).toEqual([]);
});

test("skips running agents and missing local conversations", async () => {
  const writes: string[] = [];
  const result = await reconnectStoppedAgents(
    ["terminal-running", "terminal-missing", "terminal-no-sidecar"],
    dependencies({
      readRunningProvider: async (paneId) =>
        paneId === "terminal-running" ? "codex" : null,
      readRecovery: async (paneId) =>
        paneId === "terminal-no-sidecar"
          ? null
          : { provider: "codex", sessionId: "019f-missing-session" },
      sessionExists: async (_provider, _sessionId, paneId) =>
        paneId !== "terminal-missing",
      writeResumeCommand: async (paneId) => {
        writes.push(paneId);
      },
    }),
  );

  expect(writes).toEqual([]);
  expect(result.alreadyRunning).toEqual(["terminal-running"]);
  expect(result.missingRecovery).toEqual(["terminal-no-sidecar"]);
  expect(result.missingSession).toEqual(["terminal-missing"]);
});

test("rejects unsafe provider session ids instead of writing shell input", async () => {
  const writes: string[] = [];
  const result = await reconnectStoppedAgents(
    ["terminal-unsafe"],
    dependencies({
      readRecovery: async () => ({
        provider: "codex",
        sessionId: "valid-looking; touch /tmp/unsafe",
      }),
      writeResumeCommand: async (paneId) => {
        writes.push(paneId);
      },
    }),
  );

  expect(writes).toEqual([]);
  expect(result.failed).toEqual([
    {
      paneId: "terminal-unsafe",
      reason: "Invalid saved conversation id",
    },
  ]);
});

test("isolates a pane write failure and continues reconnecting the rest", async () => {
  const result = await reconnectStoppedAgents(
    ["terminal-fails", "terminal-works"],
    dependencies({
      writeResumeCommand: async (paneId) => {
        if (paneId === "terminal-fails") throw new Error("write unavailable");
      },
    }),
  );

  expect(result.resumed).toEqual(["terminal-works"]);
  expect(result.failed).toEqual([
    { paneId: "terminal-fails", reason: "write unavailable" },
  ]);
});

test("summarizes complete and partial reconnect outcomes plainly", () => {
  expect(
    formatAgentReconnectResult({
      resumed: ["a", "b"],
      alreadyRunning: ["c"],
      missingRecovery: [],
      missingSession: [],
      failed: [],
    }),
  ).toBe("2 resumed · 1 already running");

  expect(
    formatAgentReconnectResult({
      resumed: ["a"],
      alreadyRunning: [],
      missingRecovery: ["b"],
      missingSession: ["c"],
      failed: [{ paneId: "d", reason: "write failed" }],
    }),
  ).toBe("1 resumed · 1 missing path · 1 missing locally · 1 failed");
});
