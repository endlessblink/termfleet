import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { selectStatusPollTargets } from "../src/lib/statusPollTargets";
import {
  mirroredWorkstream,
  projectStatusPollResult,
  statusPollProjectionChanged,
  terminalMatchesPollTarget,
} from "../src/lib/statusPollProjection";
import type { Tab, TerminalState } from "../src/lib/types";

const STATUS_POLL_SOURCE = readFileSync(
  new URL("../src/lib/statusPollLoop.ts", import.meta.url),
  "utf8",
);

function terminal(
  id: string,
  overrides: Partial<TerminalState> = {},
): TerminalState {
  return {
    id,
    paneId: `pane-${id}`,
    cols: 80,
    rows: 24,
    status: "running",
    ...overrides,
  };
}

function tab(
  id: string,
  terminals: TerminalState[],
  overrides: Partial<Tab> = {},
): Tab {
  return {
    id,
    title: id,
    emoji: "",
    color: "#000",
    groupId: null,
    terminals,
    splitLayout: {
      id: `split-${id}`,
      type: "terminal",
      linkedTerminalPaneId: terminals[0]?.paneId,
    },
    activePaneId: terminals[0]?.paneId ?? "",
    ...overrides,
  };
}

test("status updates follow the stable pane when hydration replaces its terminal id", () => {
  const polled = terminal("old-terminal", { paneId: "pane-stable" });
  const hydrated = terminal("new-terminal", { paneId: "pane-stable" });

  expect(terminalMatchesPollTarget(hydrated, polled)).toBe(true);
  expect(
    terminalMatchesPollTarget(
      terminal("other-terminal", { paneId: "other-pane" }),
      polled,
    ),
  ).toBe(false);
});

test("status poll targets every pane so background badges update without a click", () => {
  const now = 1_700_000_000_000;
  const active = tab("active", [
    terminal("active-1"),
    terminal("active-2", { status: "exited" }),
  ]);
  const taskList = tab("task-list", [
    terminal("todo", {
      statusSummary: {
        task: "Fix crash",
        path: "termfleet",
        now: "Reviewing task list",
        status: "working",
        provider: "shell",
        confidence: "high",
        tasksFromTodoWrite: true,
      },
    }),
  ]);
  const recent = tab("recent", [
    terminal("recent", { activityUpdatedAt: now - 10_000 }),
  ]);
  const stale = Array.from({ length: 10 }, (_, index) =>
    tab(`stale-${index}`, [terminal(`stale-${index}`)]),
  );

  const targets = selectStatusPollTargets(
    [active, taskList, recent, ...stale],
    "active",
    now,
  );
  const ids = targets.map(({ terminal: candidate }) => candidate.id);

  expect(ids).toEqual([
    "active-1",
    "active-2",
    "todo",
    "recent",
    ...Array.from({ length: 10 }, (_, index) => `stale-${index}`),
  ]);
  expect(targets).toHaveLength(14);
});

test("background status polling uses the local provider record without the model", () => {
  expect(STATUS_POLL_SOURCE).not.toContain("transcriptReader: null");
  expect(STATUS_POLL_SOURCE).toContain("contextTaskSummarizer: null");
  expect(STATUS_POLL_SOURCE).toContain("forceTauriSidecar: true");
  expect(STATUS_POLL_SOURCE).toContain("sidecar:${result.sidecarState}");
});

test("status polling never replaces a pane's about-what goal with a shared incident goal", () => {
  expect(STATUS_POLL_SOURCE).not.toContain(
    "Find why TermFleet kills agent panes after restart so the exact failure can be fixed",
  );
  expect(STATUS_POLL_SOURCE).toContain("result.summary");
});

test("status polling mirrors each pane's summary into the rendered agent workstream", () => {
  const pane = terminal("agent", {
    statusSummary: {
      task: "Old activity",
      mainTask: "Old purpose",
      mainTaskSource: "plan-explanation",
      path: "termfleet",
      now: "Old activity",
      status: "working",
    },
  });
  const source = tab("agent-tab", [pane], {
    workstream: {
      kind: "agent",
      statusSummary: pane.statusSummary,
    },
  });
  const nextSummary = {
    ...pane.statusSummary!,
    mainTask: "Keep each terminal's work understandable when you return",
    now: "Idle — no work is running",
    status: "idle" as const,
  };

  const mirrored = mirroredWorkstream(source, undefined, undefined, {
    statusSummary: nextSummary,
    statusSummarySource: "sidecar",
  });

  expect(mirrored?.statusSummary?.mainTask).toContain("understandable");
  expect(mirrored?.statusSummarySource).toBe("sidecar");
});

test("status poll targets include every live pane in one tick", () => {
  const now = 1_700_000_000_000;
  const busyTabs = Array.from({ length: 30 }, (_, index) =>
    tab(`recent-${index}`, [
      terminal(`recent-${index}`, { activityUpdatedAt: now - index }),
    ]),
  );

  expect(selectStatusPollTargets(busyTabs, null, now)).toHaveLength(30);
});

test("status poll ordering still prioritizes panes that have waited longest", () => {
  const now = 1_700_000_000_000;
  const busyTabs = Array.from({ length: 30 }, (_, index) =>
    tab(`recent-${index}`, [terminal(`recent-${index}`)]),
  );

  const targets = selectStatusPollTargets(
    busyTabs,
    null,
    now,
    ({ terminal: candidate }) =>
      Number(candidate.id.replace("recent-", "")) < 24 ? now : 0,
  );

  expect(targets.slice(0, 6).map(({ terminal: candidate }) => candidate.id)).toEqual(
    Array.from({ length: 6 }, (_, index) => `recent-${index + 24}`),
  );
});

test("a quiet pane is never starved behind recently polled busy panes", () => {
  const now = 1_700_000_000_000;
  const recentlyPolledBusyTabs = Array.from({ length: 24 }, (_, index) =>
    tab(`busy-${index}`, [
      terminal(`busy-${index}`, { activityUpdatedAt: now - index }),
    ]),
  );
  const quietTab = tab("quiet", [terminal("quiet")]);

  const targets = selectStatusPollTargets(
    [...recentlyPolledBusyTabs, quietTab],
    null,
    now,
    ({ terminal: candidate }) => candidate.id === "quiet" ? 0 : now,
  );

  expect(targets.map(({ terminal: candidate }) => candidate.id)).toContain("quiet");
  expect(targets).toHaveLength(25);
});

test("an unchanged status poll does not rewrite a live map terminal", () => {
  const current = terminal("live", {
    agentProvider: "codex",
    statusSummarySource: "sidecar",
    statusSummaryError: undefined,
    statusSummary: {
      task: "Fixing TermFleet freezes",
      path: "termfleet",
      now: "Checking renderer pressure",
      status: "working",
      provider: "codex",
      confidence: "high",
      updatedAt: 1_700_000_000_000,
    },
    mainUserAsk: {
      text: "Keep every terminal live",
      source: "status-sidecar",
      updatedAt: 1_700_000_000_000,
    },
  });

  expect(
    statusPollProjectionChanged(current, {
      agentProvider: "codex",
      statusSummarySource: "sidecar",
      statusSummaryError: undefined,
      statusSummary: { ...current.statusSummary! },
      mainUserAsk: current.mainUserAsk,
    }),
  ).toBe(false);
  expect(
    statusPollProjectionChanged(current, {
      agentProvider: "codex",
      statusSummarySource: "sidecar",
      statusSummary: { ...current.statusSummary!, now: "Applying the fix" },
      mainUserAsk: current.mainUserAsk,
    }),
  ).toBe(true);
});

test("status polling ignores capture timestamps on unchanged task lines", () => {
  const current = terminal("timestamped", {
    taskLine: {
      text: "Fixing TermFleet freezes",
      source: "status-sidecar",
      capturedAt: 1_700_000_000_000,
      expiresAt: null,
    },
    nowLine: {
      text: "Checking renderer pressure",
      source: "status-sidecar",
      capturedAt: 1_700_000_000_000,
      expiresAt: null,
    },
  });

  expect(
    statusPollProjectionChanged(current, {
      taskLine: { ...current.taskLine!, capturedAt: 1_700_000_001_000 },
      nowLine: { ...current.nowLine!, capturedAt: 1_700_000_001_000 },
    }),
  ).toBe(false);
});

test("an expired sidecar stops claiming live work but KEEPS the goal and the task list", () => {
  const stale = terminal("stale", {
    statusSummarySource: "sidecar",
    statusSummary: {
      task: "Confirming every unclear topic",
      path: "hermes",
      now: "Confirming every unclear topic",
      status: "working",
      tasksFromTodoWrite: true,
    },
    mainUserAsk: {
      text: "Confirming every unclear topic",
      source: "status-sidecar",
      updatedAt: 1_699_999_000_000,
    },
    taskLineup: [
      {
        id: "stale-task",
        content: "Confirming every unclear topic",
        status: "in_progress",
        source: "todo-write",
        updatedAt: 1_699_999_000_000,
      },
    ],
  });

  const projection = projectStatusPollResult(
    stale,
    {
      source: "fallback",
      sidecarState: "stale",
      summary: {
        task: "Shell ready",
        path: "hermes",
        now: "Awaiting command",
        status: "idle",
        provider: "shell",
        confidence: "low",
      },
    },
    1_700_000_000_000,
  );

  // The live lines say so — that is what stops a false "running" claim.
  expect(projection?.statusSummary?.status).toBe("unavailable");
  expect(projection?.statusSummary?.now).toBe("Status unavailable");
  // ...but the goal and the list are IDENTITY and survive. Clearing them left the Task
  // row at "No task declared" and the TASKS panel at "No list" on a pane that had 8
  // finished tasks and a fresh request (live report 2026-07-26).
  expect(projection?.mainUserAsk?.text).toBe("Confirming every unclear topic");
  expect(projection?.taskLineup).toHaveLength(1);
  expect(projection?.statusSummary?.task).toBe(
    "Confirming every unclear topic",
  );
});

test("an expired sidecar preserves a durable about-what Goal before clearing activity", () => {
  const projection = projectStatusPollResult(
    terminal("about-what", {
      statusSummarySource: undefined,
    }),
    {
      source: "fallback",
      sidecarState: "stale",
      summary: {
        task: "Terminal",
        path: "termfleet",
        now: "Old activity",
        status: "idle",
        provider: "shell",
        confidence: "low",
        mainTask:
          "This session is about delivering the updated TermFleet build and resolving the remaining restart risk",
        mainTaskSource: "about-what",
      },
    },
    1_700_000_000_000,
  );

  expect(projection?.statusSummary?.mainTaskSource).toBe("about-what");
  expect(projection?.statusSummary?.mainTask).toContain("updated TermFleet build");
  expect(projection?.statusSummary?.status).toBe("idle");
  expect(projection?.statusSummary?.now).toBe("Idle — no work is running");
  expect(projection?.statusSummarySource).toBe("sidecar");
});

test("a temporary sidecar read miss preserves the last trustworthy state", () => {
  const live = terminal("live", {
    statusSummarySource: "sidecar",
    statusSummary: {
      task: "Testing the repair",
      path: "hermes",
      now: "Testing the repair",
      status: "working",
      tasksFromTodoWrite: true,
    },
  });

  expect(
    projectStatusPollResult(
      live,
      {
        source: "fallback",
        sidecarState: "error",
        summary: {
          task: "Shell ready",
          path: "hermes",
          now: "Awaiting command",
          status: "idle",
          provider: "shell",
          confidence: "low",
        },
      },
      1_700_000_000_000,
    ),
  ).toBeNull();
});

test("sidecar expiry preserves manually owned task identity", () => {
  const manualAsk = {
    text: "Repair the Hermes pane",
    source: "manual" as const,
    updatedAt: 1_700_000_000_000,
  };
  const projection = projectStatusPollResult(
    terminal("manual", {
      statusSummarySource: "sidecar",
      statusSummary: {
        task: "Old sidecar activity",
        path: "hermes",
        now: "Old sidecar activity",
        status: "working",
      },
      mainUserAsk: manualAsk,
    }),
    {
      source: "fallback",
      sidecarState: "stale",
      summary: {
        task: "Shell ready",
        path: "hermes",
        now: "Awaiting command",
        status: "idle",
        provider: "shell",
        confidence: "low",
      },
    },
    1_700_000_001_000,
  );

  expect(projection?.mainUserAsk).toEqual(manualAsk);
});

// Live report 2026-07-25: a hermes pane whose agent had gone quiet showed
// "Sitting at a command prompt in hermes". The agent going quiet does not
// invalidate what the terminal is ABOUT — only what it is doing right now.
test("an expired sidecar keeps the last real task and only marks activity unavailable", () => {
  const stale = terminal("stale-keeps-task", {
    statusSummarySource: "sidecar",
    statusSummary: {
      task: "Make the timer job fast and calm",
      path: "hermes",
      now: "Editing the timer card",
      status: "working",
      tasksFromTodoWrite: true,
    },
  });

  const projection = projectStatusPollResult(
    stale,
    {
      source: "fallback",
      sidecarState: "stale",
      summary: {
        task: "Shell ready",
        path: "hermes",
        now: "Awaiting command",
        status: "idle",
        provider: "shell",
        confidence: "low",
      },
    },
    1_700_000_000_000,
  );

  expect(projection?.statusSummary?.task).toBe(
    "Make the timer job fast and calm",
  );
  expect(projection?.statusSummary?.now).toBe("Status unavailable");
});

test("an expired sidecar with no real task still says so honestly", () => {
  const stale = terminal("stale-no-task", {
    statusSummarySource: "sidecar",
    statusSummary: {
      task: "Working",
      path: "hermes",
      now: "Working",
      status: "working",
    },
  });

  const projection = projectStatusPollResult(
    stale,
    {
      source: "fallback",
      sidecarState: "stale",
      summary: {
        task: "Shell ready",
        path: "hermes",
        now: "Awaiting command",
        status: "idle",
        provider: "shell",
        confidence: "low",
      },
    },
    1_700_000_000_000,
  );

  expect(projection?.statusSummary?.task).toBe("Task not captured");
});

test("an expired sidecar keeps a separately captured user task visible", () => {
  const projection = projectStatusPollResult(
    terminal("stale-user-task", {
      statusSummarySource: "sidecar",
      statusSummary: {
        task: "Status unavailable",
        path: "bina-meatzevet-courses",
        now: "Status unavailable",
        status: "unavailable",
      },
      mainUserAsk: {
        text: "Verify every club event in the member hub",
        source: "user-prompt",
        updatedAt: 1_699_999_000_000,
      },
    }),
    {
      source: "fallback",
      sidecarState: "stale",
      summary: {
        task: "Shell ready",
        path: "bina-meatzevet-courses",
        now: "Awaiting command",
        status: "idle",
        provider: "shell",
        confidence: "low",
      },
    },
    1_700_000_000_000,
  );

  expect(projection?.statusSummary?.task).toBe(
    "Verify every club event in the member hub",
  );
});

test("an inferred about-what goal keeps stale activity honest instead of showing unavailable", () => {
  const projection = projectStatusPollResult(
    terminal("stale-inferred-goal", {
      statusSummarySource: "sidecar",
      statusSummary: {
        task: "Identifying the process and kill event",
        path: "termfleet",
        now: "Status unavailable",
        status: "unavailable",
      },
    }),
    {
      source: "fallback",
      sidecarState: "stale",
      summary: {
        task: "Identifying the process and kill event",
        userTask: "Keep every agent terminal connected after relaunch so work can be resumed safely",
        path: "termfleet",
        now: "Awaiting command",
        status: "idle",
        provider: "shell",
        confidence: "high",
      },
    },
    1_700_000_000_000,
  );

  expect(projection?.statusSummary?.now).toBe("Idle — no work is running");
  expect(projection?.statusSummary?.status).toBe("idle");
});

test("a later activity projection cannot drop the pane's accepted Goal", () => {
  const projection = projectStatusPollResult(
    terminal("goal-preserved", {
      statusSummarySource: "sidecar",
      statusSummary: {
        task: "Checking the latest result",
        mainTask: "Help people understand each TermFleet terminal and resume the right work",
        mainTaskSource: "about-what",
        path: "termfleet",
        now: "Checking the latest result",
        status: "working",
      },
    }),
    {
      source: "fallback",
      sidecarState: "stale",
      summary: {
        task: "Shell ready",
        path: "termfleet",
        now: "Awaiting command",
        status: "idle",
        provider: "shell",
        confidence: "low",
      },
    },
    1_700_000_000_000,
  );

  expect(projection?.statusSummary?.mainTask).toBe(
    "Help people understand each TermFleet terminal and resume the right work",
  );
  expect(projection?.statusSummary?.mainTaskSource).toBe("about-what");
});
