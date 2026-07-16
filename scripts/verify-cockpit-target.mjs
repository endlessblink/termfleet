#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { paneSidecarPath, sidecarFresh, sidecarPath, statusDir } from "./lib/agent-status-paths.mjs";
import { COCKPIT_MONITOR_MAX_AGE_S, textsEquivalent } from "./monitor-cockpit-tasks.mjs";

export const COCKPIT_TARGET_MAX_AGE_S = COCKPIT_MONITOR_MAX_AGE_S;

function argValue(name) {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function activeSidecarTask(entry) {
  const candidates = [
    entry.terminalId ? paneSidecarPath(entry.terminalId) : null,
    entry.paneId ? paneSidecarPath(entry.paneId) : null,
    entry.cwd ? sidecarPath(entry.cwd) : null,
  ].filter(Boolean);
  for (const file of candidates) {
    try {
      const sidecar = readJson(file);
      if (!sidecarFresh(sidecar)) continue;
      const todos = Array.isArray(sidecar.todos) ? sidecar.todos : [];
      const concrete = todos.filter((todo) => !/^(?:Answering latest prompt|Answering user question)$/i.test(
        clean(todo?.activeForm || todo?.content),
      ));
      const active = concrete.find((todo) => todo.status === "in_progress");
      const open = concrete.find((todo) => todo.status !== "completed");
      const task = clean((active ?? open)?.activeForm || (active ?? open)?.content);
      return {
        task,
        now: clean(sidecar.now),
        userTask: clean(sidecar.userTask),
        source: clean(sidecar.source),
        file,
        todoCount: todos.length,
      };
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

function fail(message, details = {}) {
  console.error(JSON.stringify({ ok: false, message, ...details }, null, 2));
  process.exit(1);
}

export function analyzeTargetEntry(entry, sidecar, options = {}) {
  const task = clean(entry.task);
  const title = clean(entry.title);
  const now = clean(entry.now);
  const nowActive = title;
  const problems = [];
  const entryAgeS = Math.round((Number(options.now ?? Date.now()) - Number(entry.updatedAt || 0)) / 1000);
  const maxAgeS = Number(options.maxAgeS ?? COCKPIT_TARGET_MAX_AGE_S);

  if (entryAgeS > maxAgeS) problems.push(`entry-stale:${entryAgeS}s`);
  if (/^(?:task not captured|no task list)$/i.test(task)) problems.push("task-not-captured");
  if (/^working$/i.test(nowActive)) problems.push("generic-now-active-working");
  if (/^working$/i.test(now)) problems.push("generic-now-working");
  if (/\bYou were right: the earlier checks\b/i.test(`${nowActive} ${now}`)) problems.push("stale-assistant-prose");
  if (task.length > 18 && title.length > 18 && textsEquivalent(task, title)) problems.push("now-active-echo");
  if (task.length > 18 && now.length > 18 && textsEquivalent(task, now)) problems.push("now-echo");
  if (entry.flags?.length) problems.push(...entry.flags);
  if (!sidecar) problems.push("missing-fresh-sidecar");
  if (sidecar?.task && task && !textsEquivalent(task, sidecar.task)) problems.push("task-mismatches-sidecar");

  return {
    ok: problems.length === 0,
    entryAgeS,
    target: {
      cwd: entry.cwd,
      paneId: entry.paneId,
      terminalId: entry.terminalId,
      task,
      nowActive,
      title,
      now,
      taskSource: entry.taskSource,
      titleSource: entry.titleSource,
      nowSource: entry.nowSource,
      flags: entry.flags ?? [],
    },
    sidecar,
    problems,
  };
}

function main() {
  const snapshotFile = path.join(statusDir(), "cockpit-snapshot.json");
  let snapshot;
  try {
    snapshot = readJson(snapshotFile);
  } catch (error) {
    fail("No cockpit snapshot found", { snapshotFile, error: error instanceof Error ? error.message : String(error) });
  }

  const maxAgeS = Number(argValue("--max-age-s") ?? COCKPIT_TARGET_MAX_AGE_S);
  const cwd = argValue("--cwd");
  const paneId = argValue("--pane-id");
  const terminalId = argValue("--terminal-id");
  const terminals = Array.isArray(snapshot.terminals) ? snapshot.terminals : [];
  const entry = terminals.find((candidate) =>
    (terminalId && candidate.terminalId === terminalId) ||
    (paneId && candidate.paneId === paneId) ||
    (cwd && clean(candidate.cwd) === clean(cwd))
  );

  if (!entry) fail("Target pane not found in cockpit snapshot", { cwd, paneId, terminalId, total: terminals.length });

  const ageS = Math.round((Date.now() - Number(snapshot.updatedAt || 0)) / 1000);
  if (ageS > maxAgeS) fail("Cockpit snapshot is stale", { ageS, maxAgeS, snapshotFile });

  const report = { ageS, ...analyzeTargetEntry(entry, activeSidecarTask(entry), { maxAgeS }) };
  if (report.problems.length) fail("Cockpit target failed reliability gate", report);
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main();
}
