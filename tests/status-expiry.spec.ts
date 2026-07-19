import { expect, test } from "@playwright/test";
import { projectStatusPollResult } from "../src/lib/statusPollProjection";
import type { TerminalState } from "../src/lib/types";

function terminal(overrides: Partial<TerminalState> = {}): TerminalState {
  return {
    id: "terminal-stale",
    paneId: "pane-stale",
    cols: 80,
    rows: 24,
    statusSummarySource: "sidecar",
    statusSummary: {
      task: "Confirming every unclear topic",
      path: "hermes",
      now: "Confirming every unclear topic",
      status: "working",
      tasksFromTodoWrite: true,
    },
    ...overrides,
  };
}

const fallback = {
  source: "fallback" as const,
  summary: {
    task: "Shell ready",
    path: "hermes",
    now: "Awaiting command",
    status: "idle" as const,
    provider: "shell" as const,
    confidence: "low" as const,
  },
};

test("confirmed sidecar expiry clears false running work", () => {
  const projection = projectStatusPollResult(terminal({
    mainUserAsk: {
      text: "Confirming every unclear topic",
      source: "status-sidecar",
      updatedAt: 1,
    },
    taskLineup: [{
      id: "stale-task",
      content: "Confirming every unclear topic",
      status: "in_progress",
      source: "todo-write",
      updatedAt: 1,
    }],
  }), { ...fallback, sidecarState: "stale" }, 2);

  expect(projection?.statusSummary?.status).toBe("unavailable");
  expect(projection?.statusSummary?.now).toBe("Status unavailable");
  expect(projection?.mainUserAsk).toBeUndefined();
  expect(projection?.taskLineup).toEqual([]);
});

test("temporary sidecar read failures preserve the last trustworthy state", () => {
  expect(projectStatusPollResult(
    terminal(),
    { ...fallback, sidecarState: "error" },
    2,
  )).toBeNull();
});

test("sidecar expiry preserves manually owned task identity", () => {
  const manualAsk = {
    text: "Repair the Hermes pane",
    source: "manual" as const,
    updatedAt: 1,
  };
  const projection = projectStatusPollResult(
    terminal({ mainUserAsk: manualAsk }),
    { ...fallback, sidecarState: "stale" },
    2,
  );

  expect(projection?.mainUserAsk).toEqual(manualAsk);
});
