#!/usr/bin/env node

import { createReadStream, statSync } from "node:fs";
import { createInterface } from "node:readline";

const tracePath =
  process.env.TERMFLEET_HEADER_TRACE ??
  `${process.env.XDG_DATA_HOME ?? `${process.env.HOME}/.local/share`}/terminal-workspace/agent-status/cockpit-header-trace.jsonl`;
const maxAgeMs = Number(process.env.TERMFLEET_HEADER_MAX_AGE_MS ?? 30_000);
const maxTraceBytes = 25 * 1024 * 1024;

function fail(message) {
  console.error(`LIVE_TASK_GOAL_NOW_FAIL ${message}`);
  process.exit(1);
}

let lastLine = "";
try {
  const traceBytes = statSync(tracePath).size;
  if (traceBytes > maxTraceBytes) {
    fail(`trace-oversized bytes=${traceBytes} maxBytes=${maxTraceBytes}`);
  }
  const input = createReadStream(tracePath, { encoding: "utf8" });
  const reader = createInterface({ input, crlfDelay: Infinity });
  for await (const line of reader) {
    if (line.trim()) lastLine = line;
  }
} catch (error) {
  fail(`trace-unreadable ${error.message}`);
}

let report;
try {
  report = JSON.parse(lastLine);
} catch (error) {
  fail(`trace-invalid ${error.message}`);
}

const updatedAt = Number(report?.updatedAt ?? report?.receivedAt ?? 0);
const ageMs = Date.now() - updatedAt;
if (!updatedAt || ageMs < 0 || ageMs > maxAgeMs) {
  fail(`trace-stale ageMs=${Math.max(ageMs, 0)} maxAgeMs=${maxAgeMs}`);
}

const terminals = Array.isArray(report?.terminals) ? report.terminals : [];
if (!terminals.length) fail("no-terminals");

const placeholderTask = /^(?:task not captured|no user task captured yet|no task declared|activity not captured|no task assigned to this terminal)$/i;
const placeholderGoal = /^(?:goal not captured|no project goal recorded yet|no project goal captured yet|project intent not captured|project intent not recorded yet|project context:\s*.+\s+·\s*no goal set)$/i;
const placeholderNow = /^(?:idle|ready|ready for a user task|awaiting next action|activity not captured|no current activity recorded|waiting for a task or command)$/i;
const workspaceFallback = /^(?:ready to work in the .+ project|supporting work in the .+ project|ready to receive work in .+|working toward: .+)$/i;
const workflowChrome = /(?:^|\b)(?:goal|task)\s+(?:achieved|stalled|resumed|paused)\b|(?:^|\b)(?:sessionstart|userpromptsubmit|pretooluse|posttooluse)\s+hook\b|hook context:|^\s*>\s*|\bweekly\s+\d+%\s+left\b|\bcontext\s+\d+%\s+used\b/i;
const firstPersonNarration = /^(?:i|we|my|our)\s+/i;
const failures = [];
let fallbackCount = 0;

for (const terminal of terminals) {
  const id = terminal.paneId ?? terminal.terminalId ?? terminal.workspace ?? "unknown";
  const task = String(terminal.task ?? "").trim();
  const goal = String(terminal.context ?? terminal.goal ?? "").trim();
  const now = String(terminal.now ?? "").trim();
  const title = String(terminal.title ?? "").trim();
  const hasTaskRecord = Boolean(
    terminal.taskSource && !/^(?:missing|none|neutral)$/i.test(terminal.taskSource),
  );
  const hasGoalRecord = Boolean(
    terminal.contextSource && !/^(?:missing|none|neutral)$/i.test(terminal.contextSource),
  ) || Boolean(terminal.statusSummaryTask || terminal.statusSummaryNow || terminal.mainUserAsk);
  const taskFallback = !task || placeholderTask.test(task);
  const goalFallback = !goal || placeholderGoal.test(goal);
  const nowFallback = placeholderNow.test(now);
  if (taskFallback) {
    if (hasTaskRecord) {
      fallbackCount += 1;
      failures.push(`${id}:placeholder-task-with-record=${task || "<empty>"}`);
    }
  }
  if (goalFallback && hasGoalRecord) failures.push(`${id}:placeholder-goal-with-record=${goal || "<empty>"}`);
  if (!now && terminal.nowSource && !/^(?:missing|neutral)$/i.test(terminal.nowSource)) {
    failures.push(`${id}:empty-now-with-source`);
  }
  if (nowFallback && now && (hasTaskRecord || hasGoalRecord)) {
    failures.push(`${id}:placeholder-now-with-record=${now}`);
  }
  if (workspaceFallback.test(task)) failures.push(`${id}:generic-task=${task}`);
  if (workspaceFallback.test(goal)) failures.push(`${id}:generic-goal=${goal}`);
  if (workspaceFallback.test(now)) failures.push(`${id}:generic-now=${now}`);
  if (workflowChrome.test(task) || workflowChrome.test(goal) || workflowChrome.test(now) || workflowChrome.test(title)) {
    failures.push(`${id}:workflow-chrome`);
  }
  if (firstPersonNarration.test(now)) failures.push(`${id}:first-person-now=${now}`);
  if (title && /^(?:idle|working|status unavailable|awaiting next action)$/i.test(title)) {
    failures.push(`${id}:neutral-title=${title}`);
  }
  if (task && goal && (goal.toLowerCase() === task.toLowerCase() ||
      goal.replace(/^working toward:\s*/i, "").toLowerCase() === task.toLowerCase())) {
    failures.push(`${id}:goal-restates-task`);
  }
  if (now && task && now.toLowerCase() === task.toLowerCase()) {
    failures.push(`${id}:now-restates-task`);
  }
  const activeStep = (terminal.taskLineup ?? []).find((item) => item?.status === "in_progress")?.content?.trim();
  const completedStep = (terminal.taskLineup ?? []).find((item) => item?.status === "completed" && item?.content?.trim() === now)?.content?.trim();
  if (activeStep && completedStep && activeStep.toLowerCase() !== completedStep.toLowerCase()) {
    failures.push(`${id}:now-is-completed-step active=${activeStep} completed=${completedStep}`);
  }
}

const fallbackBudget = Math.max(1, Math.ceil(terminals.length * 0.1));
if (fallbackCount > fallbackBudget) {
  failures.push(`fallback-density=${fallbackCount}/${terminals.length} max=${fallbackBudget}`);
}

if (failures.length) fail(failures.join("; "));
console.log(`LIVE_TASK_GOAL_NOW_OK terminals=${terminals.length} ageMs=${Math.max(ageMs, 0)}`);
