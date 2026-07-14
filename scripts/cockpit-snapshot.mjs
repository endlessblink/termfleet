#!/usr/bin/env node
// Read the dev-only cockpit-state snapshot (written by the status server's /cockpit-snapshot
// route) and print, for every rendered terminal, the displayed title + which source produced
// it, next to the agent's REAL task from its sidecar. Flags panes whose title is a command
// scrape / not the real task — i.e. "what you see vs what it's working on", all at once.
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  paneSidecarPath,
  sidecarFresh,
  sidecarPath,
  statusDir,
} from "./lib/agent-status-paths.mjs";

const args = new Set(process.argv.slice(2));
const watchMode = args.has("--watch");
const problemsOnly = args.has("--problems") || args.has("--issues");
const jsonMode = args.has("--json");
const verboseMode = args.has("--verbose");

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function recentLines(value, limit = 8) {
  return String(value ?? "")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+$/g, ""))
    .filter((line) => line.trim())
    .slice(-limit);
}

function short(value, limit = 140) {
  const text = clean(value);
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function visiblePrompt(entry) {
  const lines = recentLines(entry.terminalVisibleText, 12).map((line) => line.trim());
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    const prompt =
      line.match(/^[›❯]\s+(.+)$/)?.[1] ??
      line.match(/^\$\s+(.+)$/)?.[1] ??
      line.match(/^[\w.-]+@[\w.-]+:.*[$#]\s+(.+)$/)?.[1] ??
      "";
    if (!prompt) continue;
    if (/^(?:press up|enter to select|tab to|esc to|auto mode|thinking\b|working\s*\()/i.test(prompt)) continue;
    const afterPrompt = lines.slice(index + 1);
    const hasPostPromptWork = afterPrompt.some((candidate) =>
      !/^(?:[─━-]+|\[OMC\]|⏵⏵|◎ |\/rc active|auto mode\b)/i.test(candidate) &&
      /\b(?:Reading|Calling|Bash|Allowed by|Working|Thinking|Coalescing|Cogitating|Orbiting|Cooked|Updated|Edited|Ran|Error|Failed|Passed)\b|^[●✶✻✢*]\s/i.test(candidate)
    );
    if (hasPostPromptWork) return prompt.trim();
  }
  return "";
}

// Classify which source the rendered title came from, using the raw fields the probe
// recorded. (The component stays dumb; classification lives here.)
function classifyTitleSource(entry) {
  const title = clean(entry.title);
  if (!title) return "empty";
  if (/^(Working|Ready|Idle|Needs attention)$/i.test(title)) return "neutral";
  if (entry.tasksFromTodoWrite) return "real-task";
  if (entry.narration && clean(entry.narration) === title) return "narration";
  if (entry.durableActivityTitle && clean(entry.durableActivityTitle) === title) {
    return "durable-activity";
  }
  return "other-scrape";
}

function realTaskFromSidecar(entry) {
  // The hook keys pane sidecars by the FULL `terminal-<tab>-<pane>` id (what the
  // daemon injects as TERMFLEET_PANE_ID) — the short paneId alone never matches.
  const paneKey = entry.terminalId ?? entry.paneId;
  for (const p of [paneKey ? paneSidecarPath(paneKey) : null, entry.cwd ? sidecarPath(entry.cwd) : null]) {
    if (!p) continue;
    try {
      const sc = JSON.parse(readFileSync(p, "utf8"));
      if (!sidecarFresh(sc)) continue;
      const todos = Array.isArray(sc.todos) ? sc.todos : [];
      const active = todos.find((t) => t.status === "in_progress");
      const open = todos.find((t) => t.status !== "completed");
      const task = clean((active ?? open)?.activeForm || (active ?? open)?.content);
      return { task: task || "(none)", keyed: p.includes("/pane-") ? "pane" : "cwd", count: todos.length };
    } catch {
      // try next
    }
  }
  return { task: "(no sidecar)", keyed: "-", count: 0 };
}

function analyzeEntry(entry, snapshotAgeS) {
  const title = clean(entry.title);
  const task = clean(entry.task);
  const now = clean(entry.now);
  const visible = clean(entry.terminalVisibleText);
  const prompt = visiblePrompt(entry);
  const flags = [];
  const supportedTaskSources = new Set([
    "manual",
    "task-tool",
    "user-prompt",
    "plan-binding",
    "sidecar-todo",
    "workstream",
    "missing",
    // Agent lanes are not shell terminal task identity; keep this accepted for now.
    "agent-status",
  ]);
  const neutralTitle = /^(idle|awaiting next action|waiting for operator selection|needs attention)$/i.test(title);
  const lowerTitle = title.toLowerCase();
  const lowerTask = task.toLowerCase();

  if (snapshotAgeS > 30) flags.push(`snapshot-old:${snapshotAgeS}s`);
  if (!supportedTaskSources.has(clean(entry.taskSource))) {
    flags.push(`unsupported-task-source:${clean(entry.taskSource) || "empty"}`);
  }
  if (!visible && !neutralTitle && !/^(?:user-prompt|task-tool|sidecar-todo|manual|workstream|plan-binding)$/i.test(clean(entry.taskSource))) {
    flags.push("no-visible-terminal-text-for-non-neutral-header");
  }
  if (/^working$/i.test(title)) flags.push("generic-title-working");
  if (/^awaiting terminal output$/i.test(title) || /^awaiting terminal output$/i.test(now)) {
    flags.push("banned-awaiting-terminal-output");
  }
  const visibleLooksCompleted = /\b(?:Goal achieved|Completed|Finished|Done\.|Cogitated for)\b/i.test(visible);
  if (/^idle$/i.test(title) && !visibleLooksCompleted && /\b(thinking|orbiting|working|plan mode|waiting for input)\b/i.test(visible)) {
    flags.push("idle-title-while-visible-agent-active");
  }
  const taskMissing = /^(?:no task list|task not captured)$/i.test(task);
  const activityMissing = /^activity not captured$/i.test(title) || /^activity not captured$/i.test(now);
  if (taskMissing && prompt) flags.push("missing-task-with-visible-prompt");
  if (taskMissing && /^(Thinking|Working on |Waiting for approval|Waiting for operator)/i.test(title)) {
    flags.push("active-title-with-no-task");
  }
  const hasAnyData = Boolean(
    prompt ||
      visible ||
      clean(entry.terminalOutput) ||
      (task && !taskMissing && task.split(/\s+/).length >= 3),
  );
  if (/^task not captured$/i.test(task) && hasAnyData) flags.push("task-not-captured");
  if (activityMissing) flags.push("activity-not-captured");
  if (task.length > 96) flags.push(`task-too-long:${task.length}`);
  if (/(\/tmp\/claude|FIRST read|follow EXACTLY|npm run|npx playwright|--reporter|\/media\/endlessblink)/i.test(task)) {
    flags.push("task-row-contains-implementation-detail");
  }
  if (/^(?:printf|echo|pwd;|cd |git |npm |npx |pnpm |yarn |cargo |python(?:3)? |node |curl |docker )\b/i.test(task)) {
    flags.push("task-row-looks-like-shell-command");
  }
  if (/^[\w.-]+@\d+(?:\.\d+){1,3}\s+[\w:-]+(?:\s|$)/i.test(task)) {
    flags.push("task-row-looks-like-package-script");
  }
  if (/(npm test|npm run|npx playwright|frontend build (passed|failed)|build failed|build passed)/i.test(title)) {
    flags.push("title-looks-like-command-or-result");
  }
  if (title && task && lowerTitle === lowerTask && title.length > 48) {
    flags.push("title-duplicates-long-task");
  }
  if (prompt && title && !/^idle$/i.test(title) && !/^awaiting next action$/i.test(title) && !/^waiting for/i.test(title)) {
    const promptWords = new Set(prompt.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 3));
    const titleWords = title.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 3);
    const overlap = titleWords.filter((word) => promptWords.has(word)).length;
    if (promptWords.size >= 3 && overlap === 0) flags.push("title-does-not-match-visible-prompt");
  }
  if (entry.workspace && entry.previewTitle && clean(entry.workspace) !== clean(entry.previewTitle)) {
    flags.push("workspace-preview-title-mismatch");
  }
  if (now && title && now !== title && /^working$/i.test(now)) flags.push("generic-now-working");

  return {
    paneId: entry.paneId,
    terminalId: entry.terminalId,
    cwd: entry.cwd,
    kind: entry.kind,
    task,
    taskSource: entry.taskSource,
    title,
    titleSource: entry.titleSource,
    now,
    nowSource: entry.nowSource,
    status: entry.status,
    workspace: entry.workspace,
    previewTitle: entry.previewTitle,
    prompt,
    flags,
    visibleTail: recentLines(entry.terminalVisibleText, verboseMode ? 12 : 5),
    debug: entry.debug,
  };
}

function readSnapshot() {
  const file = path.join(statusDir(), "cockpit-snapshot.json");
  try {
    return {
      file,
      snap: JSON.parse(readFileSync(file, "utf8")),
    };
  } catch {
    throw new Error(`No cockpit snapshot at ${file}. Is the app running with the snapshot enabled (dev / VITE_COCKPIT_SNAPSHOT=1)?`);
  }
}

function renderSnapshot() {
  const { snap } = readSnapshot();
  const terminals = Array.isArray(snap.terminals) ? snap.terminals : [];
  const ageS = Math.round((Date.now() - (snap.updatedAt || 0)) / 1000);
  const analyzed = terminals.map((entry) => ({
    ...analyzeEntry(entry, ageS),
    classifiedTitleSource: classifyTitleSource(entry),
    realTask: realTaskFromSidecar(entry),
  }));
  const rows = problemsOnly ? analyzed.filter((entry) => entry.flags.length) : analyzed;

  if (jsonMode) {
    console.log(JSON.stringify({
      updatedAt: snap.updatedAt,
      ageS,
      total: terminals.length,
      problemCount: analyzed.filter((entry) => entry.flags.length).length,
      terminals: rows,
    }, null, 2));
    return;
  }

  console.log(`cockpit snapshot · ${terminals.length} terminals · ${ageS}s old · ${analyzed.filter((entry) => entry.flags.length).length} flagged\n`);
  for (const t of rows) {
    const cwdLabel = clean(t.cwd).split("/").slice(-2).join("/") || t.paneId;
    const flag = t.flags.length ? `  ⚠ ${t.flags.join(", ")}` : "";
    console.log(`▸ ${cwdLabel}  [${t.kind}]${flag}`);
    console.log(`    task:   "${short(t.task)}"   (source: ${clean(t.taskSource) || "-"})`);
    console.log(`    title:  "${short(t.title)}"   (source: ${clean(t.titleSource) || t.classifiedTitleSource || "-"})`);
    console.log(`    now:    "${short(t.now)}"   (source: ${clean(t.nowSource) || "-"})`);
    if (t.workspace || t.previewTitle) {
      console.log(`    labels: workspace="${short(t.workspace) || "-"}" preview="${short(t.previewTitle) || "-"}"`);
    }
    console.log(`    prompt: "${short(t.prompt) || "-"}"`);
    console.log(`    real:   "${short(t.realTask.task)}"   (sidecar: ${t.realTask.keyed}-keyed, ${t.realTask.count} task${t.realTask.count === 1 ? "" : "s"})`);
    if (verboseMode || t.flags.length) {
      console.log("    visible tail:");
      for (const line of t.visibleTail) console.log(`      ${line}`);
      if (t.debug && Object.keys(t.debug).length) {
        console.log(`    debug:  ${JSON.stringify(t.debug)}`);
      }
    }
  }
  if (!rows.length) console.log(problemsOnly ? "No flagged terminal headers in the latest snapshot." : "No terminal headers in snapshot.");
}

function main() {
  if (!watchMode) {
    renderSnapshot();
    return;
  }
  renderSnapshot();
  setInterval(() => {
    if (!jsonMode) {
      console.log("\n" + "-".repeat(80));
    }
    try {
      renderSnapshot();
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
    }
  }, Number(process.env.TERMFLEET_COCKPIT_WATCH_MS || 1000));
}

main();
