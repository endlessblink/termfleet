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
  expect(
    agentReconnectCommand({ provider: "opencode", sessionId: "ses_4b6273738ffer1UqWIk6zevIQA" }),
  ).toBe("opencode --session ses_4b6273738ffer1UqWIk6zevIQA");
});

function dependencies(
  overrides: Partial<AgentReconnectDependencies> = {},
): AgentReconnectDependencies {
  return {
    readRunningIdentity: async () => null,
    readRecovery: async (paneId) => ({
      provider: "codex",
      sessionId: `019f-session-${paneId}`,
    }),
    sessionExists: async () => true,
    conversationOwner: async () => null,
    confirmExactConversation: async () => true,
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
      conversationOwner: async (provider, sessionId, paneId) =>
        paneId === "terminal-orphaned"
          ? {
              provider,
              sessionId,
              providerPid: 4242,
              daemonPaneId: paneId,
              daemonRootPid: 99,
            }
          : null,
    }),
  );

  // Nothing is ever typed into either pane: the held one is reported as such,
  // and the free one is left for the daemon to respawn into its own resume.
  expect(writes).toEqual([]);
  expect(result.ownedElsewhere).toEqual(["terminal-orphaned"]);
  expect(result.pendingColdRestore).toEqual(["terminal-free"]);
  expect(result.resumed).toEqual([]);
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
      pendingColdRestore: [],
      failed: [],
    }),
  ).toBe("1 still open elsewhere");
});

test("the ownership gate is consulted only after cheaper checks pass", async () => {
  const consulted: string[] = [];
  await reconnectStoppedAgents(
    ["terminal-running", "terminal-missing", "terminal-ok"],
    dependencies({
      readRunningIdentity: async (paneId) =>
        paneId === "terminal-running"
          ? { provider: "codex", sessionId: "019f-session-terminal-running" }
          : null,
      sessionExists: async (_p, _s, paneId) => paneId !== "terminal-missing",
      conversationOwner: async (_p, _s, paneId) => {
        consulted.push(paneId);
        return null;
      },
    }),
  );

  // A pane with a running agent, or no local transcript, is settled without
  // paying for the ownership lookup.
  expect(consulted).toEqual(["terminal-ok"]);
});

test("treats a degraded shell as resumable instead of already running", async () => {
  const writes: string[] = [];
  const result = await reconnectStoppedAgents(
    ["terminal-degraded"],
    dependencies({
      readRunningIdentity: async () => null,
    }),
  );

  expect(writes).toEqual([]);
  expect(result.alreadyRunning).toEqual([]);
  expect(result.pendingColdRestore).toEqual(["terminal-degraded"]);
});

test("queues each stopped pane once with its own saved conversation", async () => {
  const result = await reconnectStoppedAgents(
    ["terminal-a", "terminal-a", "terminal-b"],
    dependencies({
      readRecovery: async (paneId) =>
        paneId === "terminal-a"
          ? { provider: "codex", sessionId: "019fae67-safe-id" }
          : { provider: "claude", sessionId: "2492d5a8-safe-id" },
    }),
  );

  // A repeated pane id is settled once, so a pane can never be queued for two
  // resumes of the same conversation.
  expect(result.pendingColdRestore).toEqual(["terminal-a", "terminal-b"]);
  expect(result.resumed).toEqual([]);
  expect(result.alreadyRunning).toEqual([]);
  expect(result.failed).toEqual([]);
});

test("skips running agents and missing local conversations", async () => {
  const writes: string[] = [];
  const result = await reconnectStoppedAgents(
    ["terminal-running", "terminal-missing", "terminal-no-sidecar"],
    dependencies({
      readRunningIdentity: async (paneId) =>
        paneId === "terminal-running"
          ? { provider: "codex", sessionId: "019f-missing-session" }
          : null,
      readRecovery: async (paneId) =>
        paneId === "terminal-no-sidecar"
          ? null
          : { provider: "codex", sessionId: "019f-missing-session" },
      sessionExists: async (_provider, _sessionId, paneId) =>
        paneId !== "terminal-missing",
    }),
  );

  expect(writes).toEqual([]);
  expect(result.alreadyRunning).toEqual(["terminal-running"]);
  expect(result.missingRecovery).toEqual(["terminal-no-sidecar"]);
  expect(result.missingSession).toEqual(["terminal-missing"]);
});

test("does not count an existing exact process until it remains stably live", async () => {
  const result = await reconnectStoppedAgents(
    ["terminal-unstable"],
    dependencies({
      readRunningIdentity: async () => ({
        provider: "codex",
        sessionId: "019f-session-terminal-unstable",
      }),
      confirmExactConversation: async () => false,
    }),
  );

  expect(result.alreadyRunning).toEqual([]);
  expect(result.failed).toEqual([{
    paneId: "terminal-unstable",
    reason: "Existing exact conversation did not remain live",
  }]);
});

test("does not mistake another conversation in the pane for the saved one", async () => {
  const writes: string[] = [];
  const result = await reconnectStoppedAgents(
    ["terminal-mismatch"],
    dependencies({
      readRunningIdentity: async () => ({
        provider: "codex",
        sessionId: "019f-different-session",
      }),
      readRecovery: async () => ({
        provider: "codex",
        sessionId: "019f-saved-session",
      }),
    }),
  );

  expect(writes).toEqual([]);
  expect(result.alreadyRunning).toEqual([]);
  expect(result.failed).toEqual([
    {
      paneId: "terminal-mismatch",
      reason: "Pane is running a different agent conversation",
    },
  ]);
});

test("never reports a dormant conversation as reconnected", async () => {
  const result = await reconnectStoppedAgents(
    ["terminal-drops-back-to-shell"],
    dependencies({ confirmExactConversation: async () => false }),
  );

  expect(result.resumed).toEqual([]);
  expect(result.failed).toEqual([]);
  expect(result.pendingColdRestore).toEqual(["terminal-drops-back-to-shell"]);
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

test("isolates a pane lookup failure and continues settling the rest", async () => {
  const result = await reconnectStoppedAgents(
    ["terminal-fails", "terminal-works"],
    dependencies({
      readRecovery: async (paneId) => {
        if (paneId === "terminal-fails") throw new Error("sidecar unavailable");
        return { provider: "codex", sessionId: `019f-session-${paneId}` };
      },
    }),
  );

  expect(result.pendingColdRestore).toEqual(["terminal-works"]);
  expect(result.failed).toEqual([
    { paneId: "terminal-fails", reason: "sidecar unavailable" },
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
      pendingColdRestore: [],
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
      pendingColdRestore: ["e"],
      failed: [{ paneId: "d", reason: "write failed" }],
    }),
  ).toBe(
    "1 resumed · 1 missing path · 1 missing locally · 1 reconnect on relaunch · 1 failed",
  );
});
