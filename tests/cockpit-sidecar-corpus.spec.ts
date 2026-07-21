import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { summaryFromSidecar } from "../src/lib/agentStatusSidecar";
import { buildShellTerminalHeaderViewModel } from "../src/lib/terminalHeaderViewModel";
import {
  COCKPIT_MONITOR_MAX_AGE_S,
  analyzeEntry,
  looksLikeNumberedListFragment,
  looksLikePlaceholderTask,
  looksLikeSlashCommand,
  looksLikeTruncatedOrReportNarration,
} from "../scripts/monitor-cockpit-tasks.mjs";
import { COCKPIT_SNAPSHOT_VERIFY_MAX_AGE_S } from "../scripts/cockpit-snapshot.mjs";
import {
  COCKPIT_SNAPSHOT_HEARTBEAT_MS,
  COCKPIT_SNAPSHOT_FLUSH_DELAY_MS,
} from "../src/lib/cockpitSnapshot";
import {
  COCKPIT_TARGET_MAX_AGE_S,
  analyzeTargetEntry,
} from "../scripts/verify-cockpit-target.mjs";

/**
 * The cockpit renders labels derived from real agent-status sidecars. Unit tests
 * use hand-written inputs; this one runs the SAME code over whatever sidecars are
 * actually on this machine, because every bad label that ever shipped ($dropoff,
 * a numbered scrollback line, the agent's own truncated chat prose) was a shape
 * nobody thought to write a fixture for.
 *
 * The sidecars hold real user prompts, so they are never committed. On a machine
 * without them (CI), the test skips rather than passing vacuously.
 */

const HONEST_FALLBACKS = new Set([
  "Task not captured",
  "Activity not captured",
  "Awaiting next action",
  "No active work",
  "Ready for next task",
  "Idle",
  "Working",
]);

test("cockpit freshness gates allow one heartbeat plus flush jitter", () => {
  const minimumFreshnessMs = COCKPIT_SNAPSHOT_HEARTBEAT_MS + COCKPIT_SNAPSHOT_FLUSH_DELAY_MS;
  expect(COCKPIT_MONITOR_MAX_AGE_S * 1000).toBeGreaterThanOrEqual(minimumFreshnessMs);
  expect(COCKPIT_SNAPSHOT_VERIFY_MAX_AGE_S * 1000).toBeGreaterThanOrEqual(minimumFreshnessMs);
  expect(COCKPIT_TARGET_MAX_AGE_S * 1000).toBeGreaterThanOrEqual(minimumFreshnessMs);
});

test("cockpit activity may differ from the authoritative task without failing the gate", () => {
  const entry = {
    paneId: "terminal-a",
    terminalId: "terminal-a",
    cwd: "/repo/project",
    task: "Fixing session restore",
    taskSource: "todo-write",
    title: "Running focused tests",
    titleSource: "agent-status",
    now: "Checking test output",
    nowSource: "agent-status",
    updatedAt: 99_000,
    taskLineup: [{ content: "Fixing session restore", status: "in_progress" }],
  };
  const sidecar = { task: "Fixing session restore", todoCount: 1 };

  const target = analyzeTargetEntry(entry, sidecar, { now: 100_000, maxAgeS: 15 });
  expect(target.problems).not.toContain("activity-mismatches-sidecar");
  expect(target.problems).toEqual([]);

  const echo = analyzeTargetEntry({ ...entry, title: entry.task }, sidecar, {
    now: 100_000,
    maxAgeS: 15,
  });
  expect(echo.problems).toContain("now-active-echo");
});

test("cockpit target compares a user-goal Task with the sidecar user goal, not the active todo", () => {
  const entry = {
    paneId: "terminal-events",
    terminalId: "terminal-events",
    cwd: "/repo/courses",
    task: "when editing the existing event I dont see שמור וצפה",
    taskSource: "user-prompt",
    title: "Testing the revised Cardcom-only flow",
    titleSource: "task-list",
    now: "Testing the revised Cardcom-only flow",
    nowSource: "agent-status",
    updatedAt: 99_000,
  };
  const sidecar = {
    task: "Testing the revised Cardcom-only flow",
    userTask: "[Image #1] also when editing the existing event I dont see שמור וצפה - [Image #2]",
    todoCount: 4,
  };

  const target = analyzeTargetEntry(entry, sidecar, { now: 100_000, maxAgeS: 15 });
  expect(target.problems).not.toContain("task-mismatches-sidecar");
  expect(target.problems).toEqual([]);
});

test("monitor equality checks report one deterministic task activity echo", () => {
  const row = analyzeEntry({
    paneId: "terminal-a",
    cwd: "/repo/project",
    task: "Verifying terminal session recovery",
    title: "Verifying terminal session recovery",
    now: "Reading test output",
    updatedAt: 99_000,
    taskLineup: [],
  }, { maxAgeS: 15, problemsOnly: false, requireSidecar: false, now: 100_000, sidecar: null });

  expect(row.problems.filter((problem: string) => problem === "now-active-echo")).toHaveLength(1);
});

function corpusDir() {
  const override = process.env.TERMFLEET_SIDECAR_CORPUS_DIR;
  if (override) return override;
  const dataHome = process.env.XDG_DATA_HOME ?? path.join(process.env.HOME ?? "", ".local", "share");
  return path.join(dataHome, "terminal-workspace", "agent-status");
}

function loadCorpus() {
  const dir = corpusDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.startsWith("pane-") && name.endsWith(".json"))
    .flatMap((name) => {
      try {
        return [{ name, sidecar: JSON.parse(readFileSync(path.join(dir, name), "utf8")) }];
      } catch {
        return [];
      }
    });
}

function headerFor(sidecar: Record<string, unknown>) {
  const cwd = typeof sidecar.cwd === "string" ? sidecar.cwd : "/repo";
  const fallback = {
    task: "Ready",
    path: cwd,
    now: "Awaiting command",
    status: "idle" as const,
    provider: "shell" as const,
    confidence: "low" as const,
    tasksFromTodoWrite: false,
  };
  const summary = summaryFromSidecar(sidecar as never, fallback as never);
  // The app feeds the sidecar's own todos in as the task lineup; without them the
  // authoritative task can never win and the harness would blame the wrong layer.
  const todos = Array.isArray(sidecar.todos) ? (sidecar.todos as Record<string, unknown>[]) : [];
  const taskLineup = todos.map((todo, index) => ({
    id: String(todo.id ?? index),
    content: String(todo.activeForm ?? todo.content ?? ""),
    status: (todo.status ?? "pending") as "pending" | "in_progress" | "completed",
    source: "todo-write" as const,
    updatedAt: Number(sidecar.updatedAt ?? 0),
  }));
  return buildShellTerminalHeaderViewModel({
    project: { id: "g", name: path.basename(cwd), projectRoot: cwd },
    liveCwd: cwd,
    terminalStatus: "running",
    taskLineup,
    statusSummary: summary,
  });
}

test("no sidecar on this machine renders a junk Task row or Now Active line", () => {
  const corpus = loadCorpus();
  test.skip(corpus.length === 0, `no sidecars at ${corpusDir()}`);

  const offenders: string[] = [];
  for (const { name, sidecar } of corpus) {
    let header;
    try {
      header = headerFor(sidecar);
    } catch (error) {
      offenders.push(`${name}: threw ${(error as Error).message}`);
      continue;
    }

    const task = header.taskDescription.text;
    const title = header.title.text;

    if (!HONEST_FALLBACKS.has(task)) {
      if (looksLikeSlashCommand(task)) offenders.push(`${name}: slash command as Task -> ${task}`);
      if (looksLikeNumberedListFragment(task)) offenders.push(`${name}: numbered fragment as Task -> ${task}`);
      if (looksLikePlaceholderTask(task)) offenders.push(`${name}: placeholder as Task -> ${task}`);
    }
    if (!HONEST_FALLBACKS.has(title) && looksLikeTruncatedOrReportNarration(title)) {
      offenders.push(`${name}: truncated/report prose as Now Active -> ${title}`);
    }
  }

  expect(offenders, `${corpus.length} sidecars scanned`).toEqual([]);
});
