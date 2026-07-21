import { expect, test } from "@playwright/test";
import { MAX_STATUS_POLL_TARGETS_PER_TICK, selectStatusPollTargets } from "../src/lib/statusPollTargets";
import { projectStatusPollResult, statusPollProjectionChanged } from "../src/lib/statusPollProjection";
import type { Tab, TerminalState } from "../src/lib/types";

function terminal(id: string, overrides: Partial<TerminalState> = {}): TerminalState {
  return {
    id,
    paneId: `pane-${id}`,
    cols: 80,
    rows: 24,
    status: "running",
    ...overrides,
  };
}

function tab(id: string, terminals: TerminalState[], overrides: Partial<Tab> = {}): Tab {
  return {
    id,
    title: id,
    emoji: "",
    color: "#000",
    groupId: null,
    terminals,
    splitLayout: { id: `split-${id}`, type: "terminal", linkedTerminalPaneId: terminals[0]?.paneId },
    activePaneId: terminals[0]?.paneId ?? "",
    ...overrides,
  };
}

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
  const recent = tab("recent", [terminal("recent", { activityUpdatedAt: now - 10_000 })]);
  const stale = Array.from({ length: 10 }, (_, index) => tab(`stale-${index}`, [terminal(`stale-${index}`)]));

  const targets = selectStatusPollTargets([active, taskList, recent, ...stale], "active", now);
  const ids = targets.map(({ terminal: candidate }) => candidate.id);

  expect(ids).toEqual([
    "active-1", "active-2", "todo", "recent",
    ...Array.from({ length: 10 }, (_, index) => `stale-${index}`),
  ]);
  expect(targets).toHaveLength(14);
});

test("status poll targets are capped per tick", () => {
  const now = 1_700_000_000_000;
  const busyTabs = Array.from({ length: 30 }, (_, index) =>
    tab(`recent-${index}`, [terminal(`recent-${index}`, { activityUpdatedAt: now - index })]),
  );

  expect(selectStatusPollTargets(busyTabs, null, now)).toHaveLength(MAX_STATUS_POLL_TARGETS_PER_TICK);
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

  expect(statusPollProjectionChanged(current, {
    agentProvider: "codex",
    statusSummarySource: "sidecar",
    statusSummaryError: undefined,
    statusSummary: { ...current.statusSummary! },
    mainUserAsk: current.mainUserAsk,
  })).toBe(false);
  expect(statusPollProjectionChanged(current, {
    agentProvider: "codex",
    statusSummarySource: "sidecar",
    statusSummary: { ...current.statusSummary!, now: "Applying the fix" },
    mainUserAsk: current.mainUserAsk,
  })).toBe(true);
});

test("an expired sidecar clears stale work instead of preserving a false running task", () => {
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
    taskLineup: [{
      id: "stale-task",
      content: "Confirming every unclear topic",
      status: "in_progress",
      source: "todo-write",
      updatedAt: 1_699_999_000_000,
    }],
  });

  const projection = projectStatusPollResult(stale, {
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
  }, 1_700_000_000_000);

  expect(projection?.statusSummary?.status).toBe("unavailable");
  expect(projection?.statusSummary?.now).toBe("Status unavailable");
  expect(projection?.mainUserAsk).toBeUndefined();
  expect(projection?.taskLineup).toEqual([]);
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

  expect(projectStatusPollResult(live, {
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
  }, 1_700_000_000_000)).toBeNull();
});

test("sidecar expiry preserves manually owned task identity", () => {
  const manualAsk = {
    text: "Repair the Hermes pane",
    source: "manual" as const,
    updatedAt: 1_700_000_000_000,
  };
  const projection = projectStatusPollResult(terminal("manual", {
    statusSummarySource: "sidecar",
    statusSummary: {
      task: "Old sidecar activity",
      path: "hermes",
      now: "Old sidecar activity",
      status: "working",
    },
    mainUserAsk: manualAsk,
  }), {
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
  }, 1_700_000_001_000);

  expect(projection?.mainUserAsk).toEqual(manualAsk);
});
