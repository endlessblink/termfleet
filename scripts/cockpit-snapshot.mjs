#!/usr/bin/env node
// Read the dev-only cockpit-state snapshot (written by the status server's /cockpit-snapshot
// route) and print, for every rendered terminal, the displayed title + which source produced
// it, next to the agent's REAL task from its sidecar. Flags panes whose title is a command
// scrape / not the real task — i.e. "what you see vs what it's working on", all at once.
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  paneSidecarPath,
  sidecarFresh,
  sidecarPath,
  statusDir,
} from "./lib/agent-status-paths.mjs";

const argv = process.argv.slice(2);
const args = new Set(argv);
const watchMode = args.has("--watch");
const problemsOnly = args.has("--problems") || args.has("--issues");
const jsonMode = args.has("--json");
const verboseMode = args.has("--verbose");
const verifyMode = args.has("--verify");
const allowStale = args.has("--allow-stale");

function argValue(name) {
  const prefix = `${name}=`;
  const inline = argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

export const COCKPIT_SNAPSHOT_VERIFY_MAX_AGE_S = 15;
const maxAgeS = Number(argValue("--max-age-s") ?? (verifyMode ? COCKPIT_SNAPSHOT_VERIFY_MAX_AGE_S : 30));

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

function looksLikeRawPromptLabel(value) {
  const text = clean(value);
  if (!text) return false;
  return /^(?:and\s+)?(?:this|that|these|those|both)$/i.test(text) ||
    /^and\s+\w+(?:\s+\w+){0,4}$/i.test(text) ||
    /^make sure\b/i.test(text) ||
    /^Goal:\s+/i.test(text) ||
    /^failed\.?$/i.test(text) ||
    /^[\s:;,-]*what you are trying\b/i.test(text) ||
    /^its not\b/i.test(text) ||
    /^[\s:;,-]*i need\b/i.test(text) ||
    /^[\s:;,-]*i can\b/i.test(text) ||
    /^[\s:;,-]*i(?:’|')ll\b/i.test(text) ||
    /^yes\s+lets?\s+move on with this plan\b/i.test(text) ||
    /^(?:Checking|Inspecting|Monitoring|Reviewing|Testing|Verifying)\s+lets?\b/i.test(text) ||
    /^(?:Checking|Inspecting|Monitoring|Reviewing|Testing|Verifying)\s+got stuck\b/i.test(text) ||
    /^(?:so go|load next one|add it|make (?:it |all )?high(?: and continue)?)$/i.test(text) ||
    /^i just need\b/i.test(text) ||
    /\banything else is just\b/i.test(text) ||
    /^the production inbox says\b/i.test(text) ||
    /^the real answer is\b/i.test(text) ||
    /^arrived,\s+but\b/i.test(text) ||
    /^phase should be\b/i.test(text) ||
    /\btitles are right there\b/i.test(text) ||
    /\bshould tell for both what change\b/i.test(text) ||
    /\bnot writing what I write\b/i.test(text) ||
    /\bso add it\b/i.test(text) ||
    /^(?:Checking|Inspecting|Monitoring|Reviewing|Testing|Verifying)\s+(?:you|your|you're|you are|implement this|lets?|got stuck)\b/i.test(text);
}

function looksLikeArtifactTitle(value) {
  const text = clean(value);
  return /\.(?:png|jpe?g|webp)\b/i.test(text) ||
    /\bFull capture\b/i.test(text) ||
    /^Frontend build (?:passed|failed)$/i.test(text) ||
    /^Test suite passed$/i.test(text) ||
    /^Tests\/build\/deploy\s*:/i.test(text) ||
    /^Charged\b/i.test(text) ||
    /^(?:The loop had|Current verification|What is now covered|What shipped|The correct transition is|Update the highest-impact places first|I left the updated continuous watchdog|Treat it as)\b/i.test(text) ||
    /^[\s:;,-]*I (?:re-read|updated|deployed|checked|changed|added|can handle)\b/i.test(text) ||
    /^[\s:;,-]*I(?:’|')ll\b/i.test(text) ||
    /^Cleaned and landed safely\b/i.test(text) ||
    /^Still in Plan Mode\b/i.test(text) ||
    /^You(?:['’]re| are) now testing\b/i.test(text) ||
    /^Confidence Rating\b/i.test(text) ||
    /^Right\s*[—-]\s+/i.test(text) ||
    /^Task\s+\d+\s*[—-]/i.test(text) ||
    /^The failure path was\b/i.test(text) ||
    /^There(?:'|’)?s an existing\b/i.test(text) ||
    /^(?:I['’]m|I am|I fixed)\s+/i.test(text);
}

function looksLikeVagueFollowupPrompt(value) {
  const text = clean(value);
  return /^(?:go|should we add that|and\s+this|this|that|these|those|both)\??(?:\s|$)/i.test(text) ||
    /\bloop\b/i.test(text) && /\bunreal(?:iable|able)\b/i.test(text);
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
    const continuation = [];
    for (const candidate of afterPrompt) {
      if (/^(?:[•●]\s*)?(?:Working|Thinking|Ran|Run|Edited|Updated|Error|Failed|Passed)\b|^[─━-]+|\[OMC\]|⏵⏵|◎ |\/rc active|auto mode\b/i.test(candidate)) {
        break;
      }
      if (/^[›❯]\s+/.test(candidate)) break;
      continuation.push(candidate);
    }
    const hasPostPromptWork = afterPrompt.some((candidate) =>
      !/^(?:[─━-]+|\[OMC\]|⏵⏵|◎ |\/rc active|auto mode\b)/i.test(candidate) &&
      /\b(?:Reading|Calling|Bash|Allowed by|Working|Thinking|Coalescing|Cogitating|Orbiting|Cooked|Updated|Edited|Ran|Error|Failed|Passed)\b|^[●✶✻✢*]\s/i.test(candidate)
    );
    if (hasPostPromptWork) return [prompt, ...continuation].join(" ").trim();
  }
  return "";
}

function hasMeaningfulVisibleData(value) {
  const lines = recentLines(value, 8).map((line) => line.trim()).filter(Boolean);
  return lines.some((line) =>
    !/^(?:•\s*)?Stop hook \(failed\)$/i.test(line) &&
    !/^error:\s+hook exited\b/i.test(line) &&
    !/^[-─━\s]*Worked for\b/i.test(line) &&
    !/^[-─━\s]+$/.test(line) &&
    !/^[›❯]\s*$/.test(line) &&
    !/^[›❯]\s+Use\s+\/skills\b/i.test(line) &&
    !/^[◐◒◑●]\s*(?:low|medium|high|\/effort)\b/i.test(line) &&
    !/^gpt[-\w. ]+\s+default\b/i.test(line) &&
    !/\b\/media\/endlessblink\/data\/my-projects\b/.test(line)
  );
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

function labelsDescribeSameWork(task, activity) {
  const taskText = clean(task).toLowerCase();
  const activityText = clean(activity).toLowerCase();
  return /\bold link\b/.test(taskText) &&
    /\blink replacements?\b/.test(activityText) &&
    /\b(?:updating|checking|replacing|resetting)\b/.test(`${taskText} ${activityText}`);
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
  const entryAgeS = Math.round((Date.now() - Number(entry.updatedAt || 0)) / 1000);
  const supportedTaskSources = new Set([
    "manual",
    "task-tool",
    "user-prompt",
    "plan-binding",
    "sidecar-todo",
    "workstream",
    "missing",
    "none",
    // Agent lanes are not shell terminal task identity; keep this accepted for now.
    "agent-status",
  ]);
  const neutralTitle = /^(ready|idle|idle until the next prompt|ready for next task|awaiting next action|waiting for operator selection|needs attention)$/i.test(title);
  const lowerTitle = title.toLowerCase();
  const lowerTask = task.toLowerCase();

  if (snapshotAgeS > maxAgeS) flags.push(`snapshot-old:${snapshotAgeS}s`);
  if (entryAgeS > maxAgeS) flags.push(`entry-stale:${entryAgeS}s`);
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
  const idleVisibleState = /^(?:idle|idle until the next prompt|ready for next task|awaiting next action|ready)$/i.test(title) &&
    /^(?:idle|idle until the next prompt|ready for next task|awaiting next action|ready)$/i.test(now);
  if (
    /^idle$/i.test(title) &&
    !visibleLooksCompleted &&
    /\b(thinking|orbiting|working|plan mode|waiting for input)\b/i.test(visible) &&
    !/\bauto mode on\b/i.test(visible)
  ) {
    flags.push("idle-title-while-visible-agent-active");
  }
  const taskMissing = /^(?:no task list|task not captured)$/i.test(task);
  const activityMissing = /^activity not captured$/i.test(title) || /^activity not captured$/i.test(now);
  if (taskMissing && prompt && !idleVisibleState) flags.push("missing-task-with-visible-prompt");
  if (taskMissing && /^(Thinking|Working on |Waiting for approval|Waiting for operator)/i.test(title)) {
    flags.push("active-title-with-no-task");
  }
  const hasAnyData = Boolean(
      prompt ||
      hasMeaningfulVisibleData(entry.terminalVisibleText) ||
      hasMeaningfulVisibleData(entry.terminalOutput) ||
      (task && !taskMissing && task.split(/\s+/).length >= 3),
  );
  if (/^task not captured$/i.test(task) && (hasAnyData || idleVisibleState)) flags.push("task-not-captured");
  if (activityMissing) flags.push("activity-not-captured");
  if (looksLikeRawPromptLabel(task)) flags.push("task-row-raw-prompt-fragment");
  if (looksLikeRawPromptLabel(title)) flags.push("title-raw-prompt-fragment");
  if (looksLikeRawPromptLabel(now)) flags.push("now-raw-prompt-fragment");
  if (looksLikeArtifactTitle(title)) flags.push("title-artifact-or-narration");
  if (looksLikeArtifactTitle(now)) flags.push("now-artifact-or-narration");
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
  if (/(npm test|npm run|npx playwright|frontend build (passed|failed)|build failed|build passed)/i.test(now)) {
    flags.push("now-looks-like-command-or-result");
  }
  if (title && task && lowerTitle === lowerTask && title.length > 48) {
    flags.push("title-duplicates-long-task");
  }
  if (title && task && lowerTitle === lowerTask && title.length > 18) {
    flags.push("title-echoes-task");
  }
  if (task && now && task.toLowerCase() === now.toLowerCase() && task.length > 18) {
    flags.push("now-echoes-task");
  }
  if (labelsDescribeSameWork(task, title)) flags.push("title-same-work-as-task");
  if (labelsDescribeSameWork(task, now)) flags.push("now-same-work-as-task");
  if (Array.isArray(entry.taskLineup) && entry.taskLineup.some((item) => clean(item?.content) && clean(item?.status) !== "completed") && /^(?:ready|ready for next task|idle|awaiting next action)$/i.test(title)) {
    flags.push("active-task-panel-with-neutral-title");
  }
  if (prompt && title && !looksLikeVagueFollowupPrompt(prompt) && !/^idle$/i.test(title) && !/^awaiting next action$/i.test(title) && !/^waiting for/i.test(title)) {
    const promptWords = new Set(prompt.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 3));
    const titleWords = title.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 3);
    const taskWords = task.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 3);
    const overlap = titleWords.filter((word) => promptWords.has(word)).length;
    const taskOverlap = taskWords.filter((word) => promptWords.has(word)).length;
    if (promptWords.size >= 3 && overlap === 0 && taskOverlap === 0) flags.push("title-does-not-match-visible-prompt");
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
    entryAgeS,
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
  const stale = ageS > maxAgeS;
  const analyzed = terminals.map((entry) => ({
    ...analyzeEntry(entry, ageS),
    classifiedTitleSource: classifyTitleSource(entry),
    realTask: realTaskFromSidecar(entry),
  }));
  const rows = problemsOnly ? analyzed.filter((entry) => entry.flags.length) : analyzed;
  const problemCount = analyzed.filter((entry) => entry.flags.length).length + (stale && !allowStale ? 1 : 0);
  const report = {
    updatedAt: snap.updatedAt,
    ageS,
    maxAgeS,
    stale,
    ok: problemCount === 0,
    total: terminals.length,
    problemCount,
    terminals: rows,
  };

  if (jsonMode) {
    console.log(JSON.stringify(report, null, 2));
    return report;
  }

  console.log(`cockpit snapshot · ${terminals.length} terminals · ${ageS}s old · ${problemCount} flagged\n`);
  if (stale && !allowStale) {
    console.log(`FAIL snapshot-stale age=${ageS}s max=${maxAgeS}s`);
  }
  for (const t of rows) {
    const cwdLabel = clean(t.cwd).split("/").slice(-2).join("/") || t.paneId;
    const flag = t.flags.length ? `  ⚠ ${t.flags.join(", ")}` : "";
    console.log(`▸ ${cwdLabel}  [${t.kind}]${flag}`);
    console.log(`    task:   "${short(t.task)}"   (source: ${clean(t.taskSource) || "-"})`);
    console.log(`    title:  "${short(t.title)}"   (source: ${clean(t.titleSource) || t.classifiedTitleSource || "-"})`);
    console.log(`    now:    "${short(t.now)}"   (source: ${clean(t.nowSource) || "-"})`);
    console.log(`    entry:  ${t.entryAgeS}s old`);
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
  return report;
}

function main() {
  if (!watchMode) {
    const report = renderSnapshot();
    if (verifyMode && !report.ok) process.exit(1);
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

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main();
}
