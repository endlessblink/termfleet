import { test, expect } from "@playwright/test";
import { getPendingApproval, getPendingApprovals } from "../src/lib/pendingApprovals";
import type { CanvasNode, Tab } from "../src/lib/types";

test.describe("Pending approvals detection & categorization", () => {
  const baseNode: CanvasNode = {
    id: "node-1",
    type: "terminal",
    title: "Terminal 1",
    x: 0,
    y: 0,
    width: 600,
    height: 400,
    terminalTabId: "tab-1",
  };

  test("detects tool permission prompt with proceed question", () => {
    const screen = [
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

    const tab: Tab = {
      id: "tab-1",
      title: "Feature Dev",
      emoji: "🚀",
      color: "#d4a44f",
      groupId: null,
      activePaneId: "pane-1",
      terminals: [
        {
          id: "term-1",
          paneId: "pane-1",
          cols: 80,
          rows: 24,
          terminalVisibleText: screen,
          terminalVisibleTextUpdatedAt: Date.now(),
        },
      ],
      splitLayout: { id: "pane-1", type: "terminal" },
    };

    const approval = getPendingApproval(baseNode, tab);
    expect(approval).not.toBeNull();
    expect(approval?.category).toBe("permission");
    expect(approval?.categoryLabel).toBe("Tool Permission");
    expect(approval?.detail).toContain("Claude wants to search the web");
  });

  test("detects plan implementation prompt", () => {
    const screen = [
      "Plan generated:",
      "1. Refactor auth service",
      "2. Add regression test",
      "",
      "Implement this plan?",
      "press enter to confirm",
    ].join("\n");

    const tab: Tab = {
      id: "tab-1",
      title: "Plan Dev",
      emoji: "📋",
      color: "#d4a44f",
      groupId: null,
      activePaneId: "pane-1",
      terminals: [
        {
          id: "term-1",
          paneId: "pane-1",
          cols: 80,
          rows: 24,
          terminalVisibleText: screen,
          terminalVisibleTextUpdatedAt: Date.now(),
        },
      ],
      splitLayout: { id: "pane-1", type: "terminal" },
    };

    const approval = getPendingApproval(baseNode, tab);
    expect(approval).not.toBeNull();
    expect(approval?.category).toBe("plan");
    expect(approval?.categoryLabel).toBe("Plan Approval");
    expect(approval?.headline).toBe("Implement Plan");
  });

  test("detects decision / next step question", () => {
    const screen = [
      "Tests failed on 2 files.",
      "How do you want to proceed?",
      "1. Rerun failed tests",
      "2. Edit code",
      "enter to select",
    ].join("\n");

    const tab: Tab = {
      id: "tab-1",
      title: "Bugfix",
      emoji: "🐛",
      color: "#d4a44f",
      groupId: null,
      activePaneId: "pane-1",
      terminals: [
        {
          id: "term-1",
          paneId: "pane-1",
          cols: 80,
          rows: 24,
          terminalVisibleText: screen,
          terminalVisibleTextUpdatedAt: Date.now(),
        },
      ],
      splitLayout: { id: "pane-1", type: "terminal" },
    };

    const approval = getPendingApproval(baseNode, tab);
    expect(approval).not.toBeNull();
    expect(approval?.category).toBe("decision");
    expect(approval?.categoryLabel).toBe("Decision Required");
  });

  test("detects unanswered question prompt", () => {
    const screen = [
      "Question 1/1 (1 unanswered)",
      "Which database dialect should we migrate to?",
      "enter to submit answer",
    ].join("\n");

    const tab: Tab = {
      id: "tab-1",
      title: "Migration",
      emoji: "🗄️",
      color: "#d4a44f",
      groupId: null,
      activePaneId: "pane-1",
      terminals: [
        {
          id: "term-1",
          paneId: "pane-1",
          cols: 80,
          rows: 24,
          terminalVisibleText: screen,
          terminalVisibleTextUpdatedAt: Date.now(),
        },
      ],
      splitLayout: { id: "pane-1", type: "terminal" },
    };

    const approval = getPendingApproval(baseNode, tab);
    expect(approval).not.toBeNull();
    expect(approval?.category).toBe("question");
    expect(approval?.categoryLabel).toBe("Question");
  });

  test("detects waiting status summary from agent hooks", () => {
    const tab: Tab = {
      id: "tab-1",
      title: "Review",
      emoji: "🔍",
      color: "#d4a44f",
      groupId: null,
      activePaneId: "pane-1",
      terminals: [
        {
          id: "term-1",
          paneId: "pane-1",
          cols: 80,
          rows: 24,
          statusSummary: {
            task: "Reviewing approval request",
            now: "Waiting for operator selection",
            path: "/repo",
            status: "waiting",
          },
          statusSummaryUpdatedAt: Date.now(),
        },
      ],
      splitLayout: { id: "pane-1", type: "terminal" },
    };

    const approval = getPendingApproval(baseNode, tab);
    expect(approval).not.toBeNull();
    expect(approval?.headline).toBe("Tool Permission");
  });

  test("ignores actively running terminals", () => {
    const screen = "Working… (15s · esc to interrupt)\nRunning test suite";

    const tab: Tab = {
      id: "tab-1",
      title: "Building",
      emoji: "⚡",
      color: "#7fc681",
      groupId: null,
      activePaneId: "pane-1",
      terminals: [
        {
          id: "term-1",
          paneId: "pane-1",
          cols: 80,
          rows: 24,
          terminalVisibleText: screen,
          terminalVisibleTextUpdatedAt: Date.now(),
          statusSummary: {
            task: "Running tests",
            now: "Executing",
            path: "/repo",
            status: "working",
          },
        },
      ],
      splitLayout: { id: "pane-1", type: "terminal" },
    };

    const approval = getPendingApproval(baseNode, tab);
    expect(approval).toBeNull();
  });

  test("ignores idle terminals", () => {
    const screen = "user@host:~/proj$ ";

    const tab: Tab = {
      id: "tab-1",
      title: "Shell",
      emoji: "💻",
      color: "#79818a",
      groupId: null,
      activePaneId: "pane-1",
      terminals: [
        {
          id: "term-1",
          paneId: "pane-1",
          cols: 80,
          rows: 24,
          terminalVisibleText: screen,
          terminalVisibleTextUpdatedAt: Date.now(),
        },
      ],
      splitLayout: { id: "pane-1", type: "terminal" },
    };

    const approval = getPendingApproval(baseNode, tab);
    expect(approval).toBeNull();
  });

  test("getPendingApprovals filters and maps properly", () => {
    const screenWait = "Do you want to proceed?\n❯ 1. Yes\nEsc to cancel";
    const tabWait: Tab = {
      id: "tab-wait",
      title: "Waiting Tab",
      emoji: "⏳",
      color: "#d4a44f",
      groupId: null,
      activePaneId: "p-1",
      terminals: [
        {
          id: "t-1",
          paneId: "p-1",
          cols: 80,
          rows: 24,
          terminalVisibleText: screenWait,
        },
      ],
      splitLayout: { id: "p-1", type: "terminal" },
    };

    const tabIdle: Tab = {
      id: "tab-idle",
      title: "Idle Tab",
      emoji: "💤",
      color: "#79818a",
      groupId: null,
      activePaneId: "p-2",
      terminals: [
        {
          id: "t-2",
          paneId: "p-2",
          cols: 80,
          rows: 24,
          terminalVisibleText: "Done.\nuser@box:~$ ",
        },
      ],
      splitLayout: { id: "p-2", type: "terminal" },
    };

    const nodes: CanvasNode[] = [
      { id: "n-wait", type: "terminal", title: "Wait Node", x: 0, y: 0, width: 500, height: 300, terminalTabId: "tab-wait" },
      { id: "n-idle", type: "terminal", title: "Idle Node", x: 600, y: 0, width: 500, height: 300, terminalTabId: "tab-idle" },
      { id: "n-file", type: "file", title: "Notes.md", x: 0, y: 400, width: 300, height: 300 },
    ];

    const results = getPendingApprovals(nodes, [tabWait, tabIdle]);
    expect(results).toHaveLength(1);
    expect(results[0].nodeId).toBe("n-wait");
    expect(results[0].category).toBe("permission");
  });
});
