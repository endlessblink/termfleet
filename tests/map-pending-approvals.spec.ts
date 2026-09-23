import { test, expect } from "@playwright/test";
import { getPendingApprovals } from "../src/lib/pendingApprovals";
import type { CanvasNode, Tab } from "../src/lib/types";

test.describe("Map sidebar pending approvals section", () => {
  const proceedScreen = [
    "Tool use",
    "",
    '  Web Search("codex cli enable feature")',
    "  Claude wants to search the web for: codex cli enable feature",
    "",
    "Do you want to proceed?",
    "❯ 1. Yes",
    "  2. No",
    "",
    "Esc to cancel · Tab to amend",
  ].join("\n");

  const planScreen = [
    "Plan:",
    "1. Fix database index",
    "",
    "Implement this plan?",
    "press enter to confirm",
  ].join("\n");

  const idleScreen = "user@devbox:~/project$ ";

  const nodes: CanvasNode[] = [
    {
      id: "node-proceed",
      type: "terminal",
      title: "Web Search Terminal",
      x: 100,
      y: 100,
      width: 700,
      height: 450,
      terminalTabId: "tab-proceed",
    },
    {
      id: "node-plan",
      type: "terminal",
      title: "Migration Planner",
      x: 900,
      y: 100,
      width: 700,
      height: 450,
      terminalTabId: "tab-plan",
    },
    {
      id: "node-idle",
      type: "terminal",
      title: "Shell Node",
      x: 100,
      y: 600,
      width: 700,
      height: 450,
      terminalTabId: "tab-idle",
    },
  ];

  const tabs: Tab[] = [
    {
      id: "tab-proceed",
      title: "Search Agent",
      emoji: "🔍",
      color: "#d4a44f",
      groupId: null,
      activePaneId: "p-proceed",
      terminals: [
        {
          id: "t-proceed",
          paneId: "p-proceed",
          cols: 80,
          rows: 24,
          terminalVisibleText: proceedScreen,
          agentProvider: "claude",
        },
      ],
      splitLayout: { id: "p-proceed", type: "terminal" },
    },
    {
      id: "tab-plan",
      title: "DB Migration",
      emoji: "🗄️",
      color: "#d4a44f",
      groupId: null,
      activePaneId: "p-plan",
      terminals: [
        {
          id: "t-plan",
          paneId: "p-plan",
          cols: 80,
          rows: 24,
          terminalVisibleText: planScreen,
          agentProvider: "codex",
        },
      ],
      splitLayout: { id: "p-plan", type: "terminal" },
    },
    {
      id: "tab-idle",
      title: "Bash Shell",
      emoji: "🐚",
      color: "#79818a",
      groupId: null,
      activePaneId: "p-idle",
      terminals: [
        {
          id: "t-idle",
          paneId: "p-idle",
          cols: 80,
          rows: 24,
          terminalVisibleText: idleScreen,
        },
      ],
      splitLayout: { id: "p-idle", type: "terminal" },
    },
  ];

  test("accurately identifies and orders pending terminals for the sidebar", () => {
    const approvals = getPendingApprovals(nodes, tabs);
    expect(approvals).toHaveLength(2);

    const proceedItem = approvals.find((a) => a.nodeId === "node-proceed");
    expect(proceedItem).toBeDefined();
    expect(proceedItem?.category).toBe("permission");
    expect(proceedItem?.categoryLabel).toBe("Tool Permission");
    expect(proceedItem?.detail).toContain("Claude wants to search the web");
    expect(proceedItem?.provider).toBe("claude");

    const planItem = approvals.find((a) => a.nodeId === "node-plan");
    expect(planItem).toBeDefined();
    expect(planItem?.category).toBe("plan");
    expect(planItem?.categoryLabel).toBe("Plan Approval");
    expect(planItem?.headline).toBe("Implement Plan");
    expect(planItem?.provider).toBe("codex");

    const idleItem = approvals.find((a) => a.nodeId === "node-idle");
    expect(idleItem).toBeUndefined();
  });

  test("empty approvals list when all terminals are idle", () => {
    const idleTabs: Tab[] = [
      {
        id: "tab-1",
        title: "Tab 1",
        emoji: "💻",
        color: "#79818a",
        groupId: null,
        activePaneId: "p-1",
        terminals: [{ id: "t-1", paneId: "p-1", cols: 80, rows: 24, terminalVisibleText: "user@host:~$ " }],
        splitLayout: { id: "p-1", type: "terminal" },
      },
    ];
    const idleNodes: CanvasNode[] = [
      { id: "n-1", type: "terminal", title: "Term 1", x: 0, y: 0, width: 600, height: 400, terminalTabId: "tab-1" },
    ];

    const approvals = getPendingApprovals(idleNodes, idleTabs);
    expect(approvals).toHaveLength(0);
  });
});
