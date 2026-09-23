import { test, expect } from "@playwright/test";
import {
  AGENT_ABSENT_POLLS_BEFORE_IDLE,
  badgeLivenessOverride,
  keepNewerReportedStatus,
} from "../src/lib/badgeLiveness";
import { paneBadgeAttention } from "../src/lib/sessionStatus";
import { terminalScreenAttention } from "../src/lib/operatorQuestionState";
import { nodeMatchesMapFilter, tabForMapNode } from "../src/lib/mapNodeFilters";
import type { CanvasNode, Tab } from "../src/lib/types";

// The sidebar row, its filter counts and the approvals list must read the SAME pane
// as the map card — not whichever pane happens to be focused in that tab.
function twoPaneTab(): Tab {
  return {
    id: "tab-1",
    activePaneId: "pane-waiting",
    workstream: { status: "waiting", phase: "needs-input" },
    terminals: [
      { id: "pty-a", paneId: "pane-waiting", statusSummary: { status: "waiting", updatedAt: 100 } },
      { id: "pty-b", paneId: "pane-idle", statusSummary: { status: "idle", updatedAt: 100 } },
    ],
  } as unknown as Tab;
}
const node = (id: string, extra: Partial<CanvasNode> = {}) =>
  ({ id, type: "terminal", terminalTabId: "tab-1", ...extra }) as unknown as CanvasNode;

test("a map node reports its OWN pane, not the tab's focused pane", () => {
  const tab = twoPaneTab();
  expect(nodeMatchesMapFilter(node("pane-idle"), tab, "idle")).toBe(true);
  expect(nodeMatchesMapFilter(node("pane-idle"), tab, "waiting")).toBe(false);
  expect(nodeMatchesMapFilter(node("pane-waiting"), tab, "waiting")).toBe(true);
});

// Operator report 2026-09-23: flow-state sat on this Codex prompt while its row said Idle
// and Pending approval said "All clear".
const CODEX_APPROVAL_SCREEN = [
  "• Running kill 2184928 && sleep 2 && fuser -v /home/u/.local/bin/FlowState.AppImage 2>&1 || true",
  "",
  "Would you like to run the following command?",
  "",
  "Environment: local",
  "",
  "Reason: May I stop the single FlowState process holding the installed AppImage so the verified 1.4.548 binary can be installed?",
  "",
  "$ kill 2184928 && sleep 2 && fuser -v /home/u/.local/bin/FlowState.AppImage 2>&1 || true",
  "",
  "› 1. Yes, proceed (y)",
  "  2. Yes, and don't ask again for commands that start with `kill 2184928` (p)",
  "  3. No, and tell Codex what to do differently (esc)",
  "",
  "Press enter to confirm or esc to cancel",
].join("\n");

test("a Codex command-approval prompt reads Waiting on the map", () => {
  expect(terminalScreenAttention(CODEX_APPROVAL_SCREEN)).toBe("waiting");
  const tab = {
    id: "tab-flow",
    activePaneId: "pane-flow",
    terminals: [{
      id: "pty-flow",
      paneId: "pane-flow",
      // The hook record is stale/idle — exactly the live case.
      statusSummary: { status: "idle", updatedAt: 900 },
      terminalVisibleText: CODEX_APPROVAL_SCREEN,
      terminalVisibleTextUpdatedAt: 100,
    }],
  } as unknown as Tab;
  const flowNode = { id: "pane-flow", type: "terminal", terminalTabId: "tab-flow" } as unknown as CanvasNode;
  expect(nodeMatchesMapFilter(flowNode, tab, "waiting")).toBe(true);
});

test("once the Codex prompt is answered, the pane stops waiting", () => {
  const answered = `${CODEX_APPROVAL_SCREEN}\n\n• Ran kill 2184928\n• Working (4s • esc to interrupt)`;
  expect(terminalScreenAttention(answered)).toBe("running");
});

test("the agent's own log outranks lifecycle words left on screen from an earlier turn", () => {
  // Live case: Codex sat on an approval (log says waiting) while an old
  // "Worked for 2m" line on screen made the badge read Idle.
  expect(
    paneBadgeAttention({
      statusSummary: { status: "waiting", updatedAt: 100, statusFromAgentLog: true },
      terminalVisibleText: "Worked for 2m 40s · 11:47 AM",
      terminalVisibleTextUpdatedAt: 999,
    }),
  ).toBe("waiting");
  // An open question on screen still wins over a log that says working.
  expect(
    paneBadgeAttention({
      statusSummary: { status: "working", updatedAt: 100, statusFromAgentLog: true },
      terminalVisibleText: CODEX_APPROVAL_SCREEN,
      terminalVisibleTextUpdatedAt: 50,
    }),
  ).toBe("waiting");
});

test("log says waiting but the screen shows live work and no question → Running", () => {
  const afterApproval = [
    "✔ You approved codex to always run commands that start with scp -q src/config.js",
    "• Running scp -q src/config.js src/server.js root@host:/opt/bot/src/",
    "• Working (10m 33s • esc to interrupt)",
  ].join("\n");
  expect(
    paneBadgeAttention({
      statusSummary: { status: "waiting", updatedAt: 100, statusFromAgentLog: true },
      terminalVisibleText: afterApproval,
      terminalVisibleTextUpdatedAt: 200,
    }),
  ).toBe("running");
  // An old spinner captured BEFORE the log's report does not override it.
  expect(
    paneBadgeAttention({
      statusSummary: { status: "waiting", updatedAt: 300, statusFromAgentLog: true },
      terminalVisibleText: afterApproval,
      terminalVisibleTextUpdatedAt: 200,
    }),
  ).toBe("waiting");
});

test("a pane's own refresh never overwrites a status read from the agent's log", () => {
  const stored = { status: "waiting", updatedAt: 100, statusFromAgentLog: true };
  const hook = { status: "working", updatedAt: 500 };
  const kept = keepNewerReportedStatus(stored, hook);
  expect(kept.status).toBe("waiting");
  expect(kept.statusFromAgentLog).toBe(true);
});

test("a node without a recorded tab id still finds its tab through its pane", () => {
  expect(tabForMapNode(node("pane-idle", { terminalTabId: undefined }), [twoPaneTab()])?.id).toBe("tab-1");
});

// TF-044: the badge must match what the terminal is really doing, in every case where
// the agent fires no hook event.
const pollKey = "terminal-tab-pane";
const base = { pollKey, sidecarPaneId: pollKey, sidecarState: "fresh" as const };

test("agent crashed or exited mid-turn → Idle, after a confirming second poll", () => {
  const first = badgeLivenessOverride({ ...base, hookStatus: "working", agentAlive: false, absentStreak: 1 });
  expect(first).toBeNull();
  const confirmed = badgeLivenessOverride({
    ...base,
    hookStatus: "working",
    agentAlive: false,
    absentStreak: AGENT_ABSENT_POLLS_BEFORE_IDLE,
  });
  expect(confirmed).toBe("idle");
});

test("agent gone while a permission prompt was open → Idle, not Waiting for 12 hours", () => {
  expect(badgeLivenessOverride({ ...base, hookStatus: "waiting", agentAlive: false, absentStreak: 2 })).toBe("idle");
});

test("an alive agent with a 14-hour-old 'working' record is not forced to Running", () => {
  // Real case: Codex hooks were switched off mid-turn, so the end of turn was never
  // reported. Only the live spinner on screen may prove a long tool call.
  expect(
    badgeLivenessOverride({ ...base, sidecarState: "stale", hookStatus: "working", agentAlive: true, absentStreak: 0 }),
  ).toBeNull();
  expect(
    paneBadgeAttention({
      statusSummary: { status: "unavailable", updatedAt: 100 },
      terminalVisibleText: "• Working (45m 03s • esc to interrupt)",
      terminalVisibleTextUpdatedAt: 200,
    }),
  ).toBe("running");
});

test("process table unreadable, or record from another pane → never overrides", () => {
  expect(badgeLivenessOverride({ ...base, hookStatus: "working", agentAlive: null, absentStreak: 5 })).toBeNull();
  expect(
    badgeLivenessOverride({ ...base, sidecarPaneId: "terminal-other", hookStatus: "working", agentAlive: false, absentStreak: 5 }),
  ).toBeNull();
  expect(badgeLivenessOverride({ ...base, sidecarState: "missing", hookStatus: "working", agentAlive: false, absentStreak: 5 })).toBeNull();
});

test("a finished pane is left alone", () => {
  expect(badgeLivenessOverride({ ...base, hookStatus: "idle", agentAlive: false, absentStreak: 5 })).toBeNull();
  expect(badgeLivenessOverride({ ...base, hookStatus: "idle", agentAlive: true, absentStreak: 0 })).toBeNull();
});

test("an old record can never overwrite a newer status (no Running↔Idle fight)", () => {
  const stored = { status: "idle", updatedAt: 500 };
  const old = { status: "working", updatedAt: 100, task: "x" };
  expect(keepNewerReportedStatus(stored, old).status).toBe("idle");
  const newer = { status: "working", updatedAt: 900 };
  expect(keepNewerReportedStatus(stored, newer).status).toBe("working");
  // Repeated polls with the same inputs never oscillate.
  for (let i = 0; i < 5; i++) expect(keepNewerReportedStatus(stored, old).status).toBe("idle");
});

test("an on-screen interrupt beats a Running record even after the app re-writes the store", () => {
  const attention = paneBadgeAttention({
    statusSummary: { status: "working", updatedAt: 100 },
    // The app re-stamped its store copy later; that is not a new agent report.
    statusSummaryUpdatedAt: 900,
    terminalVisibleText: "⎿  Interrupted · What should Claude do instead?",
    terminalVisibleTextUpdatedAt: 200,
  });
  expect(attention).toBe("idle");
});

test("screen markers: any spinner footer is Running, Codex interrupt is Idle", () => {
  expect(terminalScreenAttention("✻ Pondering… (12s · ↑ 1.2k tokens · esc to interrupt)")).toBe("running");
  expect(terminalScreenAttention("• Working (3m 10s • esc to interrupt)")).toBe("running");
  expect(
    terminalScreenAttention("• Working (3s • esc to interrupt)\n■ Conversation interrupted - tell the model what to do differently"),
  ).toBe("idle");
});

test("approved permission: the prompt is gone and the spinner runs → Running, not Waiting", () => {
  const attention = paneBadgeAttention({
    statusSummary: { status: "waiting", updatedAt: 100 },
    terminalVisibleText: "✶ Running tests… (40s · esc to interrupt)",
    terminalVisibleTextUpdatedAt: 200,
  });
  expect(attention).toBe("running");
});
