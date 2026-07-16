#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { paneSidecarPath, sidecarFresh, sidecarPath, statusDir } from "./lib/agent-status-paths.mjs";

function hasFlag(name) {
  return process.argv.includes(name);
}

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

function normalizeTokens(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => token && !["the", "a", "an", "and", "or"].includes(token) && !/^\d+$/.test(token));
}

export const COCKPIT_MONITOR_MAX_AGE_S = 15;

export function textsEquivalent(a, b) {
  const ta = normalizeTokens(a);
  const tb = normalizeTokens(b);
  if (!ta.length || !tb.length) return false;
  if (ta.join(" ") === tb.join(" ")) return true;
  if (ta.slice(1).join(" ") === tb.join(" ") || tb.slice(1).join(" ") === ta.join(" ")) return true;
  const shorter = ta.length <= tb.length ? ta : tb;
  const longer = ta.length <= tb.length ? tb : ta;
  const commonPrefix = shorter.findIndex((token, index) => token !== longer[index]);
  const prefixLength = commonPrefix === -1 ? shorter.length : commonPrefix;
  if (shorter.length >= 5 && prefixLength / longer.length >= 0.7) return true;
  const stem = (word) => word.replace(/ing$/, "").replace(/e$/, "");
  return stem(ta[0] ?? "") === stem(tb[0] ?? "") && ta.slice(1).join(" ") === tb.slice(1).join(" ");
}

function labelsDescribeSameWork(task, activity) {
  const taskText = clean(task).toLowerCase();
  const activityText = clean(activity).toLowerCase();
  return /\bold link\b/.test(taskText) &&
    /\blink replacements?\b/.test(activityText) &&
    /\b(?:updating|checking|replacing|resetting)\b/.test(`${taskText} ${activityText}`);
}

function looksLikeCompletionProse(value) {
  const text = clean(value);
  return /^Frontend build (?:passed|failed)$/i.test(text) ||
    /^Test suite passed$/i.test(text) ||
    /^Task Complete\b/i.test(text) ||
    /^Charged\b/i.test(text) ||
    /^Files shipped\b/i.test(text) ||
    /^Confidence is (?:HIGH|MEDIUM|LOW)\b/i.test(text);
}

function looksLikeGenericTask(value) {
  return /^(?:Task not captured|No task list)$/i.test(clean(value));
}

function looksLikeGenericSidecarTask(value) {
  return /^(?:Answering latest prompt|Answering user question|Implement the plan\.?)$/i.test(clean(value));
}

function sidecarLooksLikeAgentPlan(sidecar) {
  return /(?:codex|claude)-(?:tool|plan)/i.test(clean(sidecar?.source));
}

function rowTaskSourceIsUserPrompt(entry) {
  return /^(?:user-prompt|manual)$/i.test(clean(entry?.taskSource));
}

// The real sidecar task, verbatim. This used to hold ~30 hardcoded string->label
// rewrites (one per screenshot someone wanted to look right). Comparing the real
// task to the displayed task is only meaningful when neither side is invented.
function normalizedSidecarTask(value) {
  return clean(value);
}

// Detectors for the three shapes that reached the live cockpit on 2026-07-09:
// a slash command as the Task row, a numbered scrollback line as the Task row,
// and the agent's own truncated chat prose as Now Active.
export function looksLikeSlashCommand(value) {
  return /^[$/][A-Za-z][\w:-]*$/.test(clean(value));
}

export function looksLikeNumberedListFragment(value) {
  return /^\d+[.)]\s+\S/.test(clean(value));
}

export function looksLikePlaceholderTask(value) {
  return /^Answering (?:latest prompt|user question)$/i.test(clean(value));
}

// Mirrors titleIsCommentaryOrDangling in src/lib/terminalHeaderQuality.ts. A bare
// trailing "…" is legitimate — the title shortener adds one to fit the card. What
// marks a cut-off line is what sits before it.
export function looksLikeTruncatedOrReportNarration(value) {
  const text = clean(value);
  if (!text) return false;
  if (/^(?:I|We|You|They|It|This|That|There|Those|These)\b/.test(text)) return true;
  const body = text.replace(/(?:…|\.\.\.)$/, "").trim();
  if (/[,;:—-]$/.test(body)) return true;
  return /\b(?:and|but|or|with|from|to|in|of|for|the|a|an)$/i.test(body);
}

function looksLikeGenericTitle(value) {
  return /^(?:Working|Thinking|Running terminal command|Command is running)$/i.test(clean(value));
}

function looksLikeRawCommand(value) {
  return /^(?:\.\/|~\/|\/|cd\b|npm\b|pnpm\b|yarn\b|bun\b|npx\b|node\b|git\b|gh\b|cargo\b|docker\b|curl\b|ssh\b|sudo\b)\b/i.test(clean(value)) ||
    /(?:&&|\|\||\s;\s|\|\s*\w|>\s*\S|<\s*\S|`[^`]+`|\$\()/i.test(clean(value));
}

function looksLikeRawPromptLabel(value) {
  const text = clean(value);
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
    /^Tests\/build\/deploy\s*:/i.test(text) ||
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

function sidecarCandidates(entry) {
  return [
    entry.terminalId ? paneSidecarPath(entry.terminalId) : null,
    entry.paneId ? paneSidecarPath(entry.paneId) : null,
    entry.cwd ? sidecarPath(entry.cwd) : null,
  ].filter(Boolean);
}

function activeSidecarTask(entry) {
  for (const file of sidecarCandidates(entry)) {
    try {
      const sidecar = readJson(file);
      if (!sidecarFresh(sidecar)) continue;
      const todos = Array.isArray(sidecar.todos) ? sidecar.todos : [];
      const concrete = todos.filter((todo) => !looksLikeGenericSidecarTask(
        todo?.activeForm || todo?.content,
      ));
      const active = concrete.find((todo) => todo.status === "in_progress");
      const open = concrete.find((todo) => todo.status !== "completed");
      const task = active ?? open;
      return {
        file,
        source: clean(sidecar.source),
        task: clean(task?.activeForm || task?.content),
        now: clean(sidecar.now),
        narration: clean(sidecar.narration),
        userTask: clean(sidecar.userTask),
        todoCount: todos.length,
        updatedAt: sidecar.updatedAt,
      };
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

export function analyzeEntry(entry, options) {
  const task = clean(entry.task);
  const title = clean(entry.title);
  const now = clean(entry.now);
  const sidecar = Object.prototype.hasOwnProperty.call(options, "sidecar")
    ? options.sidecar
    : activeSidecarTask(entry);
  const problems = [];
  const warnings = [];
  const nowMs = Number(options.now ?? Date.now());
  const entryAgeS = Math.round((nowMs - Number(entry.updatedAt || 0)) / 1000);
  if (entryAgeS > options.maxAgeS) problems.push(`entry-stale:${entryAgeS}s`);
  const idleVisibleState = /^(?:Idle|Awaiting next action|Ready)$/i.test(title) &&
    /^(?:Idle|Awaiting next action|Ready)$/i.test(now) ||
    /^(?:Idle until the next prompt)$/i.test(title) && /^(?:Idle until the next prompt)$/i.test(now);

  if (looksLikeGenericTask(task)) {
    problems.push("task-not-captured");
  }
  if (looksLikeGenericTitle(title)) problems.push("generic-now-active");
  if (looksLikeGenericTitle(now)) warnings.push("generic-now");
  if (looksLikeCompletionProse(title)) problems.push("completion-prose-now-active");
  if (looksLikeCompletionProse(now)) problems.push("completion-prose-now");
  if (task.length > 18 && title.length > 18 && textsEquivalent(task, title)) {
    problems.push("now-active-echo");
  }
  if (labelsDescribeSameWork(task, title)) problems.push("now-active-same-work");
  if (labelsDescribeSameWork(task, now)) problems.push("now-same-work");
  if (task.length > 18 && now.length > 18 && textsEquivalent(task, now)) problems.push("now-echo");
  if (Array.isArray(entry.taskLineup) && entry.taskLineup.some((item) => clean(item?.content) && clean(item?.status) !== "completed") && /^(?:Ready|Ready for next task|Idle|Awaiting next action)$/i.test(title)) {
    problems.push("active-task-panel-with-neutral-title");
  }
  if (task.length > 96) problems.push(`task-too-long:${task.length}`);
  if (title.length > 72) problems.push(`now-active-too-long:${title.length}`);
  if (now.length > 72) problems.push(`now-too-long:${now.length}`);
  if (looksLikeRawCommand(task)) problems.push("task-looks-like-command");
  if (looksLikeRawCommand(title)) problems.push("now-active-looks-like-command");
  if (looksLikeRawCommand(now)) problems.push("now-looks-like-command");
  if (looksLikeRawPromptLabel(task)) problems.push("task-raw-prompt-fragment");
  if (looksLikeRawPromptLabel(title)) problems.push("now-active-raw-prompt-fragment");
  if (looksLikeRawPromptLabel(now)) problems.push("now-raw-prompt-fragment");
  if (looksLikeArtifactTitle(title)) problems.push("now-active-artifact-or-narration");
  if (looksLikeArtifactTitle(now)) problems.push("now-artifact-or-narration");
  if (looksLikeSlashCommand(task)) problems.push("task-slash-command");
  if (looksLikeNumberedListFragment(task)) problems.push("task-numbered-fragment");
  if (looksLikePlaceholderTask(task)) problems.push("task-placeholder-only");
  if (looksLikeTruncatedOrReportNarration(title)) problems.push("now-active-truncated-or-report");
  if (Array.isArray(entry.flags) && entry.flags.length) problems.push(...entry.flags);
  if (!sidecar) {
    warnings.push("missing-fresh-sidecar");
  } else if (
    sidecar.task &&
    task &&
    !looksLikeGenericSidecarTask(sidecar.task) &&
    !(rowTaskSourceIsUserPrompt(entry) && sidecarLooksLikeAgentPlan(sidecar)) &&
    !textsEquivalent(task, normalizedSidecarTask(sidecar.task))
  ) {
    warnings.push("task-sidecar-drift");
  }
  if (options.requireSidecar && !sidecar) problems.push("missing-fresh-sidecar");

  return {
    workspace: clean(entry.workspace || entry.previewTitle),
    cwd: clean(entry.cwd || entry.path),
    paneId: entry.paneId,
    terminalId: entry.terminalId,
    task,
    taskSource: entry.taskSource,
    title,
    titleSource: entry.titleSource,
    now,
    nowSource: entry.nowSource,
    status: entry.status,
    entryAgeS,
    tasksFromTodoWrite: Boolean(entry.tasksFromTodoWrite),
    sidecar,
    problems,
    warnings,
  };
}

function loadReport(options) {
  const snapshotFile = path.join(statusDir(), "cockpit-snapshot.json");
  const snapshot = readJson(snapshotFile);
  const ageS = Math.round((Date.now() - Number(snapshot.updatedAt || 0)) / 1000);
  const terminals = Array.isArray(snapshot.terminals) ? snapshot.terminals : [];
  const rows = terminals
    .map((entry) => analyzeEntry(entry, options))
    .filter((row) => !options.problemsOnly || row.problems.length || row.warnings.length);
  const stale = ageS > options.maxAgeS;
  const problemCount = rows.reduce((sum, row) => sum + row.problems.length, 0) + (stale ? 1 : 0);
  const warningCount = rows.reduce((sum, row) => sum + row.warnings.length, 0);
  return {
    ok: problemCount === 0,
    snapshotFile,
    ageS,
    maxAgeS: options.maxAgeS,
    total: terminals.length,
    shown: rows.length,
    problemCount,
    warningCount,
    stale,
    rows,
  };
}

function writeHuman(report) {
  console.log(`Cockpit task monitor: ${report.total} terminals, age ${report.ageS}s, problems ${report.problemCount}, warnings ${report.warningCount}`);
  if (report.stale) console.log(`FAIL snapshot-stale age=${report.ageS}s max=${report.maxAgeS}s`);
  for (const row of report.rows) {
    const mark = row.problems.length ? "FAIL" : row.warnings.length ? "WARN" : "OK  ";
    console.log(`${mark} ${row.workspace || "(workspace unknown)"}`);
    console.log(`     cwd: ${row.cwd}`);
    console.log(`     pane: ${row.paneId}`);
    console.log(`     entry age: ${row.entryAgeS}s`);
    console.log(`     task:  ${row.task || "(empty)"} [${row.taskSource || "unknown"}]`);
    console.log(`     now active: ${row.title || "(empty)"} [${row.titleSource || "unknown"}]`);
    console.log(`     now:   ${row.now || "(empty)"} [${row.nowSource || "unknown"}]`);
    if (row.sidecar) {
      console.log(`     sidecar: ${row.sidecar.task || "(no active task)"} [${row.sidecar.source || "unknown"}, todos=${row.sidecar.todoCount}]`);
    } else {
      console.log("     sidecar: missing or stale");
    }
    if (row.problems.length) console.log(`     problems: ${row.problems.join(", ")}`);
    if (row.warnings.length) console.log(`     warnings: ${row.warnings.join(", ")}`);
  }
}

function appendJsonl(report, destination) {
  const file = destination || path.join(statusDir(), "cockpit-task-monitor.jsonl");
  appendFileSync(file, `${JSON.stringify({ at: Date.now(), ...report })}\n`);
}

function alertPayload(report) {
  const problemRows = report.rows.filter((row) => row.problems.length);
  const warningRows = report.rows.filter((row) => row.warnings.length);
  return {
    at: Date.now(),
    ok: report.ok,
    actionRequired: !report.ok,
    ageS: report.ageS,
    maxAgeS: report.maxAgeS,
    total: report.total,
    problemCount: report.problemCount,
    warningCount: report.warningCount,
    stale: report.stale,
    snapshotFile: report.snapshotFile,
    problems: problemRows.map((row) => ({
      workspace: row.workspace,
      cwd: row.cwd,
      paneId: row.paneId,
      terminalId: row.terminalId,
      task: row.task,
      taskSource: row.taskSource,
      nowActive: row.title,
      nowActiveSource: row.titleSource,
      now: row.now,
      nowSource: row.nowSource,
      problems: row.problems,
      sidecar: row.sidecar,
    })),
    warnings: warningRows.map((row) => ({
      workspace: row.workspace,
      cwd: row.cwd,
      paneId: row.paneId,
      task: row.task,
      nowActive: row.title,
      warnings: row.warnings,
    })),
  };
}

function writeAlert(report, destination) {
  const file = destination || path.join(process.cwd(), ".captures", "cockpit-label-alert.json");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(alertPayload(report), null, 2)}\n`);
  return file;
}

function failureSignature(report) {
  if (!report.stale && !report.rows.some((row) => row.problems.length)) return "";
  return [
    report.stale ? `stale:${report.ageS}` : "",
    ...report.rows
      .filter((row) => row.problems.length)
      .map((row) => `${row.paneId}:${row.task}:${row.title}:${row.now}:${row.problems.join(",")}`),
  ].filter(Boolean).join("|");
}

function notifyFailure(report) {
  const problemRows = report.rows.filter((row) => row.problems.length);
  const first = problemRows[0];
  const title = report.stale
    ? "TermFleet cockpit labels stale"
    : `TermFleet label failure: ${report.problemCount} problem${report.problemCount === 1 ? "" : "s"}`;
  const body = first
    ? `${first.workspace || "unknown"}: Task="${first.task || "(empty)"}" Now="${first.title || "(empty)"}" [${first.problems.join(", ")}]`
    : `Snapshot age ${report.ageS}s exceeds ${report.maxAgeS}s`;
  spawnSync("notify-send", ["--urgency=critical", title, body], {
    encoding: "utf8",
    stdio: "ignore",
  });
}

function captureFailure(report, label) {
  const captureName = [
    label || "watchdog-failure",
    String(report.total),
    `${report.problemCount}p`,
  ].join("-");
  const result = spawnSync(process.execPath, [
    "scripts/capture-cockpit.mjs",
    "--crop-header",
    "--name",
    captureName,
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`;
  const captures = [...output.matchAll(/captured\s+(\S+\.png)/g)].map((match) => match[1]);
  return {
    ok: result.status === 0,
    status: result.status,
    captures,
    output: output.trim(),
  };
}

async function main() {
  const verify = hasFlag("--verify");
  let lastCaptureSignature = "";
  let lastCaptureAt = 0;
  let lastNotifySignature = "";
  let lastNotifyAt = 0;
  const options = {
    json: hasFlag("--json"),
    problemsOnly: hasFlag("--problems"),
    requireSidecar: hasFlag("--require-sidecar"),
    alertOnFail: hasFlag("--alert-on-fail"),
    alertPath: argValue("--alert-path"),
    notifyOnFail: hasFlag("--notify-on-fail"),
    notifyMinIntervalMs: Number(argValue("--notify-min-interval-ms") ?? 15000),
    captureOnFail: hasFlag("--capture-on-fail"),
    captureLabel: argValue("--capture-label"),
    captureMinIntervalMs: Number(argValue("--capture-min-interval-ms") ?? 15000),
    watch: hasFlag("--watch"),
    jsonl: hasFlag("--jsonl") || process.argv.some((arg) => arg.startsWith("--jsonl=")),
    jsonlPath: argValue("--jsonl"),
    intervalMs: Number(argValue("--interval-ms") ?? 1000),
    maxAgeS: Number(argValue("--max-age-s") ?? (verify ? COCKPIT_MONITOR_MAX_AGE_S : 30)),
  };

  while (true) {
    let report;
    try {
      report = loadReport(options);
    } catch (error) {
      console.error(JSON.stringify({
        ok: false,
        message: "No cockpit snapshot found",
        snapshotFile: path.join(statusDir(), "cockpit-snapshot.json"),
        error: error instanceof Error ? error.message : String(error),
      }, null, 2));
      process.exit(1);
    }
    const signature = failureSignature(report);
    if (options.captureOnFail && signature) {
      const now = Date.now();
      const shouldCapture =
        signature !== lastCaptureSignature ||
        now - lastCaptureAt >= options.captureMinIntervalMs ||
        !options.watch;
      if (shouldCapture) {
        const capture = captureFailure(report, options.captureLabel);
        report.capture = capture;
        lastCaptureSignature = signature;
        lastCaptureAt = now;
      }
    }
    if (options.alertOnFail) {
      report.alertFile = writeAlert(report, options.alertPath && !options.alertPath.startsWith("--") ? options.alertPath : undefined);
    }
    if (options.notifyOnFail && signature) {
      const now = Date.now();
      const shouldNotify =
        signature !== lastNotifySignature ||
        now - lastNotifyAt >= options.notifyMinIntervalMs ||
        !options.watch;
      if (shouldNotify) {
        notifyFailure(report);
        lastNotifySignature = signature;
        lastNotifyAt = now;
      }
    }
    if (options.jsonl) appendJsonl(report, options.jsonlPath && !options.jsonlPath.startsWith("--") ? options.jsonlPath : undefined);
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      writeHuman(report);
      if (report.capture) {
        const captureLabel = report.capture.ok ? "capture" : "capture-failed";
        console.log(`${captureLabel}: ${(report.capture.captures || []).join(" ") || report.capture.output || "(no output)"}`);
      }
      if (report.alertFile) {
        console.log(`alert: ${report.alertFile}`);
      }
    }
    if (!options.watch) {
      if (verify && !report.ok) process.exit(1);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs));
  }
}

// Only run the CLI when invoked directly, so the detectors above can be imported
// by tests without starting the watch loop.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}
