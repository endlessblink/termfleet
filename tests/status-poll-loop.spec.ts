import { expect, test } from "@playwright/test";
import { selectStatusPollTargets } from "../src/lib/statusPollTargets";
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

test("status poll targets active, real-task, and recent panes without sweeping all stale panes", () => {
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

  expect(ids).toEqual(["active-1", "active-2", "todo", "recent"]);
  expect(targets).toHaveLength(4);
});

test("status poll targets are capped per tick", () => {
  const now = 1_700_000_000_000;
  const busyTabs = Array.from({ length: 12 }, (_, index) =>
    tab(`recent-${index}`, [terminal(`recent-${index}`, { activityUpdatedAt: now - index })]),
  );

  expect(selectStatusPollTargets(busyTabs, null, now)).toHaveLength(6);
});
