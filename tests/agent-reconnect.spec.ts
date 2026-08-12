import { expect, test } from "@playwright/test";
import {
  agentReconnectCommand,
  formatAgentReconnectResult,
  reconnectStoppedAgents,
  type AgentReconnectDependencies,
} from "../src/lib/agentReconnect";

test("builds a standalone reconnect command for each supported chat provider", () => {
  expect(
    agentReconnectCommand({ provider: "codex", sessionId: "019fae67-safe-id" }),
  ).toBe("codex resume 019fae67-safe-id");
  expect(
    agentReconnectCommand({ provider: "claude", sessionId: "2492d5a8-safe-id" }),
  ).toBe("claude --resume 2492d5a8-safe-id");
});

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

// Regression for the 2026-08-12 incident. Rebuilding TermFleet replaces the
// cockpit window, but the PTY daemon deliberately survives — so the original
// agent keeps running while its pane comes back as an empty shell. Clicking
// "Connect terminal" then typed a second `codex resume` for a conversation that
// still had a live owner: the provider answered "already has an active writer",
// and where the two writers overlapped the transcript gained a duplicated record
// (verified: ordinal 33955 written twice, 20s apart, in a 599MB rollout), which
// permanently breaks forking that conversation. The button must never type a
// resume into a terminal for a conversation someone else still owns.
test("never types a resume for a conversation a live agent still owns", async () => {
  const writes: string[] = [];
  const result = await reconnectStoppedAgents(
    ["terminal-orphaned", "terminal-free"],
    dependencies({
      conversationOwnedElsewhere: async (_provider, _sessionId, paneId) =>
        paneId === "terminal-orphaned",
      writeResumeCommand: async (paneId) => {
        writes.push(paneId);
      },
    }),
  );

  expect(writes).toEqual(["terminal-free"]);
  expect(result.ownedElsewhere).toEqual(["terminal-orphaned"]);
  expect(result.resumed).toEqual(["terminal-free"]);
  expect(result.failed).toEqual([]);
});

test("reports conversations held elsewhere so the click is not silent", () => {
  expect(
    formatAgentReconnectResult({
      resumed: [],
      alreadyRunning: [],
      missingRecovery: [],
      missingSession: [],
      ownedElsewhere: ["terminal-orphaned"],
      failed: [],
    }),
  ).toBe("1 still open elsewhere");
});

test("the ownership gate is consulted only after cheaper checks pass", async () => {
  const consulted: string[] = [];
  await reconnectStoppedAgents(
    ["terminal-running", "terminal-missing", "terminal-ok"],
    dependencies({
      readRunningProvider: async (paneId) =>
        paneId === "terminal-running" ? "codex" : null,
      sessionExists: async (_p, _s, paneId) => paneId !== "terminal-missing",
      conversationOwnedElsewhere: async (_p, _s, paneId) => {
        consulted.push(paneId);
        return false;
      },
    }),
  );

  // A pane with a running agent, or no local transcript, is settled without
  // paying for the ownership lookup.
  expect(consulted).toEqual(["terminal-ok"]);
});

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
      ownedElsewhere: [],
      failed: [],
    }),
  ).toBe("2 resumed · 1 already running");

  expect(
    formatAgentReconnectResult({
      resumed: ["a"],
      alreadyRunning: [],
      missingRecovery: ["b"],
      missingSession: ["c"],
      ownedElsewhere: [],
      failed: [{ paneId: "d", reason: "write failed" }],
    }),
  ).toBe("1 resumed · 1 missing path · 1 missing locally · 1 failed");
});
