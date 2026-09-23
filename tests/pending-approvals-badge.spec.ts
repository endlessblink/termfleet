// Pending-approval list regressions (TF-044). Kept apart from badge-liveness.spec
// because the approval list module ships with a separate, not-yet-committed change.
import { test, expect } from "@playwright/test";
import { getPendingApprovals } from "../src/lib/pendingApprovals";
import { nodeMatchesMapFilter } from "../src/lib/mapNodeFilters";
import { terminalScreenAttention } from "../src/lib/operatorQuestionState";
import type { CanvasNode, Tab } from "../src/lib/types";

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

test("approvals list only the pane that is actually waiting", () => {
  const items = getPendingApprovals([node("pane-idle"), node("pane-waiting")], [twoPaneTab()]);
  expect(items.map((item) => item.nodeId)).toEqual(["pane-waiting"]);
});

test("a stale saved 'waiting' flag does not list an approval once the pane moved on", () => {
  const tab = twoPaneTab();
  (tab.terminals[0] as { statusSummary: unknown }).statusSummary = { status: "working", updatedAt: 300 };
  expect(getPendingApprovals([node("pane-waiting")], [tab])).toEqual([]);
});

test("a Codex command-approval prompt is listed as a pending approval", () => {
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
  const [item] = getPendingApprovals([flowNode], [tab]);
  expect(item?.category).toBe("permission");
  expect(item?.headline).toBe("Command Approval");
  expect(item?.detail).toContain("kill 2184928");
});

