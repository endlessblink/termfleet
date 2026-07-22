import { expect, test } from "@playwright/test";
import { resolveTaskIdentity } from "../src/lib/taskIdentity";
import { resolvePaneTaskLine } from "../src/lib/taskLine";
import { buildTerminalHeaderState } from "../src/lib/terminalHeaderState";

const NOW = Date.parse("2026-07-22T12:00:00.000Z");

// TC-060 R1: with the ladder supplied, the placeholder is unreachable. The ladder
// is applied at RENDER time — task identity still means a DECLARED task, because
// every title/activity heuristic downstream keys on that meaning.
test("with no declared task, the ladder supplies the rendered text", () => {
  expect(resolveTaskIdentity({}).source).toBe("missing");

  const header = buildTerminalHeaderState({
    paneId: "pane-0",
    terminalId: "pane-0",
    liveCwd: "/tmp/termfleet",
    taskLine: resolvePaneTaskLine({
      now: NOW,
      facts: { operatorRequest: "sort the sidebar by name" },
    }),
  });
  expect(header.goalLabel).toBe("sort the sidebar by name");
  expect(header.sources.goal).toBe("task-line");
});

test("a shell pane is no longer starved of a description", () => {
  const header = buildTerminalHeaderState({
    paneId: "pane-1",
    terminalId: "pane-1",
    liveCwd: "/tmp/termfleet",
    taskLine: resolvePaneTaskLine({
      now: NOW,
      folder: "termfleet",
      branch: "main",
    }),
  });
  expect(header.goalLabel).toBe(
    "Sitting at a command prompt in termfleet on main",
  );
});

test("the rendered header shows the ladder's line, not 'Task not captured'", () => {
  const header = buildTerminalHeaderState({
    paneId: "pane-1",
    terminalId: "pane-1",
    liveCwd: "/tmp/termfleet",
    taskLine: resolvePaneTaskLine({
      now: NOW,
      facts: { title: "Investigate e2e redirect to free content section" },
    }),
  });
  expect(header.goalLabel).toBe(
    "Investigate e2e redirect to free content section",
  );
  expect(header.goalLabel).not.toMatch(/task not captured/i);
});

// TC-060 R3: a pane whose saved steps are ALL completed must not keep showing the
// last finished step while the agent has moved on — it shows the live current line.
test("all-completed checklist defers to the agent's live current line", () => {
  const header = buildTerminalHeaderState({
    paneId: "pane-hermes",
    terminalId: "pane-hermes",
    liveCwd: "/repo/hermes",
    terminalStatus: "running",
    // Every declared step is done → no active plan item.
    taskLineup: [
      {
        id: "t1",
        content: "Tracing why the two Telegram bots are mixing messages",
        status: "completed",
        source: "todo-write",
      },
      {
        id: "t2",
        content: "Explaining the cause and the safest fix",
        status: "completed",
        source: "todo-write",
      },
    ],
    statusSummary: {
      task: "Tracing why the two Telegram bots are mixing messages",
      tasksFromTodoWrite: true,
      status: "working",
    } as never,
    // The ladder's live current-work line.
    taskLine: resolvePaneTaskLine({
      now: NOW,
      facts: {
        agentSaid:
          "Correcting the Diet bot's durable Telegram destination to topic 306",
      },
    }),
  });
  expect(header.goalLabel).toBe(
    "Correcting the Diet bot's durable Telegram destination to topic 306",
  );
  expect(header.goalLabel).not.toMatch(/Tracing why/);
});

// The override is scoped: an IN-PROGRESS declared step still wins over the ladder.
test("an in-progress declared step still beats the live line", () => {
  const header = buildTerminalHeaderState({
    paneId: "pane-x",
    terminalId: "pane-x",
    liveCwd: "/repo/hermes",
    terminalStatus: "running",
    taskLineup: [
      {
        id: "t1",
        content: "Fixing the compressor timeout",
        activeForm: "Fixing the compressor timeout",
        status: "in_progress",
        source: "todo-write",
      },
    ],
    statusSummary: {
      task: "Fixing the compressor timeout",
      tasksFromTodoWrite: true,
      status: "working",
    } as never,
    taskLine: resolvePaneTaskLine({
      now: NOW,
      facts: { agentSaid: "Poking around in some unrelated file" },
    }),
  });
  expect(header.goalLabel).toBe("Fixing the compressor timeout");
});

// R1 everywhere: a pane that never polled — sidebar-only rows, panes that were
// never mounted — still gets a true line rather than the placeholder.
test("a pane with no supplied line still never says 'Task not captured'", () => {
  const idle = buildTerminalHeaderState({
    paneId: "pane-2",
    terminalId: "pane-2",
    liveCwd: "/tmp/termfleet",
  });
  expect(idle.goalLabel).toBe("Sitting at a command prompt in termfleet");

  // ...and it never claims a busy pane is idle at a prompt.
  const busy = buildTerminalHeaderState({
    paneId: "pane-3",
    terminalId: "pane-3",
    liveCwd: "/tmp/termfleet",
    terminalStatus: "running",
  });
  expect(busy.goalLabel).toBe("Working in termfleet");
  expect(busy.goalLabel).not.toMatch(/task not captured/i);
});
