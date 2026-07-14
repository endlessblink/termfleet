#!/usr/bin/env node
import http from "node:http";
import { spawn } from "node:child_process";
import { argv } from "node:process";
import { appendFileSync, closeSync, fstatSync, mkdirSync, openSync, readSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { statusDir } from "./lib/agent-status-paths.mjs";

// Dev-only cockpit-state capture (TC-035 observability): the frontend POSTs a faithful dump
// of every rendered terminal's title/source here, and we write it to a file the operator (or
// an agent) can read to compare "what's shown" vs "what each terminal is really working on".
// The frontend can't resolve an absolute path itself, so the node server owns the write.
function writeCockpitSnapshot(rawBody) {
  const dir = statusDir();
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "cockpit-snapshot.json");
  const traceFile = path.join(dir, "cockpit-header-trace.jsonl");
  const tmp = `${file}.${process.pid}.tmp`;
  const body = rawBody || "{}";
  writeFileSync(tmp, body);
  renameSync(tmp, file);
  let entry;
  try {
    entry = JSON.parse(body);
  } catch {
    entry = { parseError: true, raw: body.slice(0, 2000) };
  }
  // Rotate instead of growing forever: the unbounded append once reached 8 GB on a
  // long-lived cockpit. Keep one previous generation for debugging.
  try {
    if (statSync(traceFile).size > 25 * 1024 * 1024) {
      renameSync(traceFile, `${traceFile}.1`);
    }
  } catch {
    // Missing trace file → nothing to rotate.
  }
  appendFileSync(traceFile, `${JSON.stringify({ receivedAt: Date.now(), ...entry })}\n`);
}

const host = process.env.TERMFLEET_AGENT_STATUS_HOST || "127.0.0.1";
const port = Number(process.env.TERMFLEET_AGENT_STATUS_PORT || 37819);
const command = process.env.TERMFLEET_AGENT_STATUS_COMMAND || argv[2];
const commandArgs = (() => {
  const raw = process.env.TERMFLEET_AGENT_STATUS_ARGS;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return raw.split(/\s+/).filter(Boolean);
    }
  }
  return argv.slice(3);
})();
const commandLine = [command, ...commandArgs].filter(Boolean).join(" ");
const contextTitleDisabled =
  process.env.TERMFLEET_CONTEXT_TITLE_DISABLE === "1" ||
  /\bagent-status-summary-sidecar\.mjs\b/.test(commandLine);

function cleanText(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").replace(/^[•*-]\s+/, "").trim() : "";
}

function hashText(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function extractedItems(values, fallbackExcerpt = "") {
  const seen = new Set();
  return values
    .flat()
    .map((value) => cleanText(value).slice(0, 180))
    .filter(Boolean)
    .map((text) => {
      const excerpt = cleanText(fallbackExcerpt || text).slice(0, 240);
      const sourceHash = hashText(`summary:${excerpt}:${text}`);
      return {
        id: `summary:${sourceHash}`,
        text,
        provenance: "summary",
        at: 0,
        excerpt,
        sourceHash,
      };
    })
    .filter((item) => {
      if (seen.has(item.sourceHash)) return false;
      seen.add(item.sourceHash);
      return true;
    })
    .slice(0, 5);
}

function lifecycleFrom(workstream = {}) {
  if (workstream.status === "done" || workstream.phase === "complete" || workstream.phase === "reviewed") return "done";
  if (workstream.status === "failed" || workstream.phase === "blocked") return "blocked";
  if (workstream.status === "waiting" || workstream.phase === "needs-input") return "waiting";
  if (workstream.status === "stopped" || workstream.phase === "interrupted") return "stopped";
  if (workstream.status === "running" || workstream.phase === "active" || workstream.phase === "launching" || workstream.phase === "queued") return "working";
  return "idle";
}

function isNoisy(value) {
  const text = cleanText(value);
  if (!text) return true;
  return [
    /^\/clear$/i,
    /^hi[!.]?$/i,
    /^hello[!.]?$/i,
    /^web\$ /i,
    /^bash[$#]?\s*/i,
    /^supervised agent run$/i,
    /^shell ready$/i,
    /^›\s*/i,
    /^›\s*use\s+\/\w+/i,
    /^use\s+\/\w+/i,
    /^F\d+\w+\s+F\d+/i,
    /\bF10Quit\b/i,
    /^[«‹›|│┃¦\s•·-]*gpt[-\w. ]+\s+default\b/i,
    /^«?\s*\|?\s*gpt[-\w. ]+\s+default\b/i,
    /^«?\s*\|?\s*[\w.-]+\s+default\b/i,
    /\|\|?>/,
    /\besc to interrupt\b/i,
    /^codex: command is not available/i,
    /^claude: command is not available/i,
    /^opencode: command is not available/i,
    /command is not available in browser preview/i,
    /^provider (acknowledged cancellation|process exited)/i,
  ].some((pattern) => pattern.test(text));
}

function rawTranscriptLines(payload) {
  return (typeof payload?.transcript === "string" ? payload.transcript : "")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => cleanText(line))
    .filter(Boolean)
}

function hasVisibleShellPrompt(payload) {
  return rawTranscriptLines(payload).slice(-5).some((line) =>
    /^[\w.-]+@[\w.-]+:[^$#>]*[$#>]\s*$/.test(line) ||
    /^[~./\w -]+[$#>]\s*$/.test(line)
  );
}

function transcriptLines(payload) {
  return rawTranscriptLines(payload)
    .filter((line) => !isNoisy(line));
}

function inferTranscriptTask(lines) {
  const text = lines.join("\n");
  if (/\bTasks:\s*\d+/.test(text) && /\bLoad average:/.test(text)) return "Monitoring processes";
  return lines.find((line) =>
    /^[\p{L}\p{N}][\p{L}\p{N}\s:_/-]{3,90}$/u.test(line) &&
    !/^(what changed|verified|done|output|path|signal|now)$/i.test(line) &&
    !/\b(passed|failed|error|http|github\.com|https?:\/\/)\b/i.test(line)
  );
}

function inferTranscriptNow(lines, task) {
  const text = lines.join("\n");
  if (/\bTasks:\s*\d+/.test(text) && /\bLoad average:/.test(text)) return "htop live process table";
  return lines.find((line) =>
    line !== task &&
    !/^(what changed|verified|done|output|path|signal|now):?$/i.test(line) &&
    /\b(now runs|validates|repair|rewrite|checking|reviewing|translated|translation|quality-gate|regression|deployed|active|200 ok|passed|completed|hook|triage|prompt-routing|explored|search|read|apply_patch|touching|architecture|mirroring|mirror)\b/i.test(line)
  );
}

function stripExtractionPrefix(line) {
  return line.replace(/^(task|todo|blocker|blocked|evidence|proof|verified|next|next action)\s*[:=-]\s*/i, "").trim();
}

function fallbackSummary(payload) {
  const workstream = payload?.workstream ?? {};
  const lines = transcriptLines(payload);
  const mission = cleanText(workstream.mission);
  const explicitUserTask =
    cleanText(workstream.userTask) ||
    (mission && mission !== "Terminal" ? mission : "") ||
    cleanText(workstream.prompt);
  const transcriptTask = inferTranscriptTask(lines);
  const promptVisible = hasVisibleShellPrompt(payload);
  const task = promptVisible && !transcriptTask
    ? "Ready"
    : (mission && mission !== "Terminal" ? mission : "") || cleanText(workstream.prompt) || transcriptTask || "Supervised agent run";
  const path = cleanText(workstream.path) || cleanText(payload?.projectId) || "workspace path unknown";
  const status = promptVisible && task === "Ready" ? "idle" : lifecycleFrom(workstream);
  const now =
    (promptVisible && task === "Ready" && "Awaiting command") ||
    (!isNoisy(workstream.currentActivity) && cleanText(workstream.currentActivity)) ||
    (!isNoisy(workstream.nextAction) && cleanText(workstream.nextAction)) ||
    (!isNoisy(workstream.lastSummary) && cleanText(workstream.lastSummary)) ||
    inferTranscriptNow(lines, task) ||
    (status === "blocked" ? "Needs operator attention" :
      status === "done" ? "Ready for review" :
        status === "waiting" ? "Waiting for input" :
          status === "stopped" ? "Stopped by operator" :
            status === "idle" ? "Idle until the next prompt" :
              `Working on ${task}`);
  const excerpt = cleanText(payload?.transcript || workstream.currentActivity || workstream.lastSummary || task).slice(-240);
  const tasks = [
    mission && mission !== "Terminal" ? mission : "",
    cleanText(workstream.prompt),
    task && task !== "Ready" && task !== "Supervised agent run" ? task : "",
    ...lines.filter((line) => /^(task|todo|fix|implement|add|update|review|wire|persist)\b/i.test(line)).map(stripExtractionPrefix),
  ];
  const blockers = [
    workstream.risk,
    status === "blocked" ? workstream.lastSummary : "",
    ...lines.filter((line) => /\b(blocked|blocker|failed|failure|error|cannot|missing|auth|credential|permission)\b/i.test(line)).map(stripExtractionPrefix),
  ];
  const evidence = [
    workstream.evidence,
    ...lines.filter((line) => /\b(evidence|proof|verified|passed|screenshot|artifact|report|build passed|tests? passed)\b/i.test(line)).map(stripExtractionPrefix),
  ];
  const nextActions = [
    workstream.nextAction,
    ...lines.filter((line) => /^(next|next action|todo)\b/i.test(line)).map(stripExtractionPrefix),
  ];

  return {
    task,
    userTask: explicitUserTask || undefined,
    path,
    now,
    status,
    provider: workstream.provider || "codex",
    confidence: cleanText(workstream.currentActivity) && !isNoisy(workstream.currentActivity) ? "medium" : "low",
    proof: cleanText(workstream.evidence) || undefined,
    blocker: status === "blocked" ? cleanText(workstream.risk) || cleanText(workstream.lastSummary) || undefined : undefined,
    tasks: extractedItems(tasks, excerpt),
    blockers: extractedItems(blockers, excerpt),
    evidence: extractedItems(evidence, excerpt),
    nextActions: extractedItems(nextActions, excerpt),
  };
}

// ---- Local contextual summarizer (2026-07-04, user-approved local model) ----
// The operator's gate: every pane header must say goal + current step + the SPECIFIC
// object ("verifying the session-switch diagnosis before implementing the fix").
// Heuristics can't synthesize that; a local model call can. Cached per pane so
// polling never hammers Ollama; keep_alive keeps the model warm.
const OLLAMA_URL = process.env.TERMFLEET_OLLAMA_URL || "http://127.0.0.1:11434/api/generate";
// Keep the default small enough for the cockpit to run continuously. qwen2.5:7b
// is available only when explicitly requested through TERMFLEET_CONTEXT_TITLE_MODEL.
// The env var accepts a comma-separated fallback list, e.g. llama3.2:latest,gemma4:e2b.
const CONTEXT_MODELS = (process.env.TERMFLEET_CONTEXT_TITLE_MODEL || "llama3.2:latest,gemma4:e2b")
  .split(",")
  .map((model) => cleanText(model))
  .filter(Boolean);
const CONTEXT_KEEP_ALIVE = process.env.TERMFLEET_CONTEXT_TITLE_KEEP_ALIVE || "2m";
const CONTEXT_TTL_MS = Number(process.env.TERMFLEET_CONTEXT_TITLE_TTL_MS || 45_000);
const contextCache = new Map(); // key -> { at, line } | { at, promise }
const lastGoodLines = new Map(); // key -> { at, now, goal } — flicker guard

function contextCacheKey(payload) {
  return cleanText(payload?.paneId) || cleanText(payload?.projectId) || "unknown";
}

// The daemon persists every session's scrollback on disk (hex-encoded pane id).
// When the frontend payload carries no content (background pane whose component
// never mounted), read the truth from there — the operator's gate can't depend on
// which React components happen to be alive.
function stripAnsi(text) {
  return String(text ?? "")
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, "")
    .replace(/\x1b[@-_]/g, "")
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
}

function sessionScrollbackTail(paneId) {
  try {
    const hex = Buffer.from(String(paneId ?? ""), "utf8").toString("hex");
    const file = path.join(statusDir(), "..", "sessions", `${hex}.scrollback`);
    const fd = openSync(file, "r");
    try {
      const size = fstatSync(fd).size;
      const length = Math.min(8192, size);
      if (length === 0) return "";
      const buffer = Buffer.alloc(length);
      readSync(fd, buffer, 0, length, size - length);
      return stripAnsi(buffer.toString("utf8"));
    } finally {
      closeSync(fd);
    }
  } catch {
    return "";
  }
}

// Our OWN placeholder phrases must never reach the model as "context" — it will
// faithfully paraphrase them into nonsense ("The agent finished nothing; it was
// idle until the next prompt").
function realContext(value) {
  const text = cleanText(value);
  if (!text) return "";
  // Composer placeholder suggestions are UI chrome, not user asks.
  if (/@filename\b|@filepath\b/i.test(text)) return "";
  if (/^(?:find and fix a bug in|write tests for|summarize recent commits|use \/\w+ to|improve documentation in|explain this codebase)\b/i.test(text)) return "";
  if (/^(?:idle(?:\s+until.*)?|ready|working(?:\s+on\b.*)?|awaiting\b.*|waiting for input|prompt submitted|supervised agent run|terminal|shell ready|no activity)$/i.test(text)) return "";
  return text;
}

function contextSources(payload, heuristic) {
  const workstream = payload?.workstream ?? {};
  return {
    ask: realContext(workstream.userTask || workstream.prompt || heuristic?.userTask).slice(0, 220),
    narration: realContext(heuristic?.narration).slice(0, 300),
    activity: realContext(workstream.currentActivity || heuristic?.now).slice(0, 160),
    tail: cleanText(payload?.transcript).slice(-700),
  };
}

function contextSourcesWithDisk(payload, heuristic) {
  const src = contextSources(payload, heuristic);
  if (src.tail.length < 200) {
    const diskTail = cleanText(sessionScrollbackTail(payload?.paneId)).slice(-700);
    if (diskTail.length > src.tail.length) src.tail = diskTail;
  }
  return src;
}

// Never let the model INVENT: with almost no real content it produces generic
// filler ("System Booted Successfully"). Below this floor, say nothing.
function hasEnoughContext(src) {
  return (src.ask + " " + src.narration + " " + src.activity + " " + src.tail).trim().length >= 80;
}

function looksFinished(heuristic, tail) {
  if (["done", "idle", "stopped"].includes(String(heuristic?.status ?? ""))) return true;
  const text = String(tail ?? "");
  return /\b(?:Verified now|All checks passed|Committed|Pushed|Worked for \d|Done\.|completed successfully)\b/i.test(text) &&
    !/\besc to interrupt\b|\bWorking\s*\(/i.test(text.slice(-200));
}

// ---- Two-step schema-constrained generation (2026-07-05 operator-approved) ----
// Analyzer turns noisy terminal context into a small intent object. Translator
// turns only that normalized object into plain English. This keeps raw hook text,
// file paths, prompt chrome, and logs out of the visible header sentence.
const ANALYZER_SCHEMA = {
  type: "object",
  properties: {
    core_action: { type: "string", maxLength: 36, description: "The plain present-tense action, like checking, fixing, waiting for, finishing, or proving." },
    main_object: { type: "string", maxLength: 56, description: "The plain object of that action, without file names, paths, flags, or raw commands." },
    status: { type: "string", enum: ["success", "error", "warning", "running", "incomplete", "unknown"], description: "Current status of the work." },
    user_goal: { type: "string", maxLength: 90, description: "The operator's main goal in plain language, phrased as a wish." },
    confidence: { type: "number", minimum: 0, maximum: 1, description: "Confidence in this interpretation (lower for very vague logs)" },
    brief_reason: { type: "string", maxLength: 80, description: "Short private reason grounded in the context." },
  },
  required: ["core_action", "main_object", "status", "confidence"],
};

const TRANSLATOR_SCHEMA = {
  type: "object",
  properties: {
    sentence: { type: "string", maxLength: 80, description: "One short plain-English sentence for a cockpit pane title." },
    confidence: { type: "number", minimum: 0, maximum: 1, description: "Confidence that the sentence accurately translates the analyzer object." },
  },
  required: ["sentence", "confidence"],
};

const CRITIC_SCHEMA = {
  type: "object",
  properties: {
    sentence: { type: "string", maxLength: 80, description: "The best final cockpit pane title. Return the original sentence if it is already good." },
    confidence: { type: "number", minimum: 0, maximum: 1, description: "Confidence that this final sentence is accurate and clear." },
    critique_note: { type: "string", maxLength: 80, description: "Short private note explaining what changed, or 'kept'." },
  },
  required: ["sentence", "confidence"],
};

const ANALYZER_SYSTEM = [
  "You read noisy terminal and agent-status context and extract the underlying work intent.",
  "Use ONLY facts from the provided context. Do not invent names, numbers, events, files, paths, commands, or flags.",
  "Write plain everyday words. Convert raw technical wording into what the person is trying to do.",
  "Examples:",
  'Log: "The consolidation now: - removes stale rollout names from the active July..."',
  '{"core_action": "cleaning up", "main_object": "old rollout names from July", "status": "incomplete", "user_goal": "Get the project data cleaned up", "confidence": 0.65, "brief_reason": "The log says old rollout names are being removed."}',
  'Log: "build; passed"',
  '{"core_action": "finished", "main_object": "the build check", "status": "success", "user_goal": "Get the code building cleanly", "confidence": 0.9, "brief_reason": "The build passed."}',
  'Log: "3 subfailures in content-pool size guards; workflow stops on failing tests, no commit was made"',
  '{"core_action": "stopped on", "main_object": "three failing content checks", "status": "error", "user_goal": "Get the changes committed", "confidence": 0.85, "brief_reason": "The log says failures stopped the workflow."}',
  'Log: "Question 1/3: quick fix or tracked task? enter to submit answer"',
  '{"core_action": "waiting for", "main_object": "your tracking choice", "status": "incomplete", "user_goal": "Decide how to track this fix", "confidence": 0.8, "brief_reason": "The pane is asking the operator to choose."}',
  "Respond with valid JSON only.",
].join("\n");

const TRANSLATOR_SYSTEM = [
  "You translate a normalized work-intent object into one cockpit pane title.",
  "Write one short sentence in plain English for a non-technical observer.",
  "No file names, paths, flags, raw commands, jargon, markdown, quotes, or semicolons.",
  "Use active voice. Do not start with The. Do not write instructions.",
  "Examples:",
  '{"core_action":"cleaning up","main_object":"old rollout names from July","status":"incomplete"} -> {"sentence":"Cleaning up old rollout names from July","confidence":0.9}',
  '{"core_action":"finished","main_object":"the build check","status":"success"} -> {"sentence":"Build check completed successfully","confidence":0.9}',
  '{"core_action":"stopped on","main_object":"three failing content checks","status":"error"} -> {"sentence":"Three content checks are failing","confidence":0.9}',
  '{"core_action":"waiting for","main_object":"your tracking choice","status":"incomplete"} -> {"sentence":"Waiting for your tracking choice","confidence":0.9}',
  "Respond with valid JSON only.",
].join("\n");

const CRITIC_SYSTEM = [
  "You are the final quality check for a cockpit pane title.",
  "Keep the sentence if it is accurate, plain, active, and specific.",
  "Improve it only when it is vague, passive, too technical, too long, or not grounded in the context.",
  "No file names, paths, flags, raw commands, jargon, markdown, quotes, semicolons, or invented facts.",
  "Use active voice. Do not start with The. Do not write instructions.",
  "Respond with valid JSON only.",
].join("\n");

function buildAnalyzerMessages(src, finishedHint) {
  const user = [
    src.ask ? `Operator's main ask: ${src.ask}` : "",
    finishedHint ? "Hint: the work appears finished — describe the outcome." : "",
    src.narration ? `Agent just said: ${src.narration}` : "",
    src.activity ? `Latest activity: ${src.activity}` : "",
    src.tail ? `Task/Log: ${src.tail}` : "",
  ].filter(Boolean).join("\n");
  return [
    { role: "system", content: ANALYZER_SYSTEM },
    { role: "user", content: user },
  ];
}

function buildTranslatorMessages(analysis, src) {
  const user = [
    `Analyzer JSON: ${JSON.stringify({
      core_action: cleanText(analysis?.core_action),
      main_object: cleanText(analysis?.main_object),
      status: cleanText(analysis?.status),
    })}`,
    cleanText(analysis?.user_goal) || src.ask ? `User goal: ${cleanText(analysis?.user_goal) || src.ask}` : "",
    "Return the display sentence only in JSON.",
  ].filter(Boolean).join("\n");
  return [
    { role: "system", content: TRANSLATOR_SYSTEM },
    { role: "user", content: user },
  ];
}

function buildCriticMessages(analysis, translation, src) {
  const user = [
    `Analyzer JSON: ${JSON.stringify({
      core_action: cleanText(analysis?.core_action),
      main_object: cleanText(analysis?.main_object),
      status: cleanText(analysis?.status),
      user_goal: cleanText(analysis?.user_goal) || src.ask,
    })}`,
    `Current sentence: ${cleanText(translation?.sentence)}`,
    src.ask ? `Operator's main ask: ${src.ask}` : "",
    src.narration ? `Agent just said: ${src.narration}` : "",
    src.activity ? `Latest activity: ${src.activity}` : "",
    src.tail ? `Task/log excerpt: ${src.tail}` : "",
  ].filter(Boolean).join("\n");
  return [
    { role: "system", content: CRITIC_SYSTEM },
    { role: "user", content: user },
  ];
}

function ollamaJson(messages, schema = ANALYZER_SCHEMA) {
  const tryModel = (model) => new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model,
      stream: false,
      keep_alive: CONTEXT_KEEP_ALIVE,
      format: schema,
      // Empirically verified on gemma4:e4b: `think:false` prevents hidden
      // reasoning from consuming the output budget while preserving schema output.
      think: false,
      options: { num_predict: 220, temperature: 0 },
      messages,
    });
    const url = new URL(OLLAMA_URL.replace(/\/api\/generate$/, "/api/chat"));
    const request = http.request(
      { hostname: url.hostname, port: url.port, path: url.pathname, method: "POST", headers: { "content-type": "application/json" } },
      (response) => {
        let text = "";
        response.on("data", (chunk) => (text += chunk));
        response.on("end", () => {
          if (response.statusCode !== 200) { reject(new Error(`ollama ${response.statusCode}`)); return; }
          try { resolve(JSON.parse(String(JSON.parse(text)?.message?.content ?? "{}"))); } catch (error) { reject(error); }
        });
      },
    );
    request.setTimeout(Number(process.env.TERMFLEET_CONTEXT_TITLE_TIMEOUT_MS || 25000), () => {
      request.destroy(new Error("ollama timed out"));
    });
    request.on("error", reject);
    request.end(body);
  });
  return (async () => {
    const errors = [];
    for (const model of CONTEXT_MODELS) {
      try {
        return await tryModel(model);
      } catch (error) {
        errors.push(`${model}: ${String(error?.message ?? error).slice(0, 120)}`);
      }
    }
    throw new Error(`ollama failed for all models: ${errors.join(" | ")}`);
  })();
}

let ollamaChain = Promise.resolve();
function ollamaJsonQueued(messages, schema) {
  const next = ollamaChain.then(() => ollamaJson(messages, schema), () => ollamaJson(messages, schema));
  ollamaChain = next.catch(() => {});
  return next;
}

// Grounding: numbers and quoted names in a generated line must exist in the
// source context (word-anchoring only when soft=false, i.e. thin context).
function groundedIn(line, contextText, soft = false) {
  const context = String(contextText ?? "").toLowerCase();
  for (const number of String(line).match(/\d{2,}/g) ?? []) {
    if (!context.includes(number)) return false;
  }
  for (const quoted of String(line).match(/["'“”]([^"'“”]{2,40})["'“”]/g) ?? []) {
    if (!context.includes(quoted.slice(1, -1).toLowerCase())) return false;
  }
  if (!soft) {
    const words = String(line).toLowerCase().match(/[a-z]{5,}/g) ?? [];
    const anchored = words.filter((word) => context.includes(word));
    if (words.length >= 2 && anchored.length === 0) return false;
  }
  return true;
}

function cleanPlainObjectText(value, limit) {
  let text = cleanText(value);
  text = text.replace(/^```(?:json)?|```$/g, "").trim().split(/;\s*/)[0].trim();
  text = text.replace(/\.[a-z]{2,4}\b/gi, "").replace(/[~/\\][^\s,;]*/g, "").replace(/\s+/g, " ").trim();
  if (text.length <= limit) return text;
  text = text.slice(0, limit - 1).replace(/\s+\S*$/, "");
  text = text.replace(/[\s'"‘’“”\-–—:,;]+$/, "").replace(/\s+(?:to|for|of|the|a|an|and|or|in|on|at|with)$/i, "");
  return `${text.trim()}…`;
}

// Deterministic auto-fix BEFORE validation: pure length/path leakage is fixed
// without spending a model retry.
function autoFixAnalysisResult(parsed) {
  if (!parsed) return parsed;
  const fix = { ...parsed };
  fix.core_action = cleanPlainObjectText(fix.core_action, 36).toLowerCase();
  fix.main_object = cleanPlainObjectText(fix.main_object, 56);
  fix.user_goal = cleanPlainObjectText(fix.user_goal, 90);
  fix.brief_reason = cleanPlainObjectText(fix.brief_reason, 80);
  return fix;
}

function autoFixTranslationResult(parsed) {
  if (!parsed) return parsed;
  const fix = { ...parsed };
  let line = cleanText(fix.sentence);
  line = line.replace(/^```(?:json)?|```$/g, "").trim().split(/;\s*/)[0].trim();
  if (line.length > 64) {
    const clause = line.split(/,\s+/)[0].trim();
    if (clause.length >= 20 && clause.length <= 64) {
      line = clause;
    } else {
      line = line.slice(0, 63).replace(/\s+\S*$/, "");
      line = line.replace(/[\s'"‘’“”\-–—:,;]+$/, "").replace(/\s+(?:to|for|of|the|a|an|and|or|in|on|at|with)$/i, "");
      line = `${line.trim()}…`;
    }
  }
  fix.sentence = line;
  return fix;
}

// The operator's rules as a machine validator. Returns violation strings; empty = pass.
function validateAnalysisResult(parsed, context) {
  const violations = [];
  const action = cleanText(parsed?.core_action);
  const object = cleanText(parsed?.main_object);
  const goal = cleanText(parsed?.user_goal);
  const status = String(parsed?.status ?? "");
  const confidence = Number(parsed?.confidence ?? 0);
  const words = (t) => t.split(/\s+/).filter(Boolean).length;
  if (!action) violations.push("core_action is empty");
  else {
    if (words(action) > 5) violations.push("core_action must be short");
    if (/\.[a-z]{2,4}\b|\//i.test(action)) violations.push("core_action contains a file name or path");
  }
  if (!object) violations.push("main_object is empty");
  else {
    if (words(object) < 2) violations.push("main_object must be specific");
    if (/\.[a-z]{2,4}\b|\//i.test(object)) violations.push("main_object contains a file name or path");
    if (!groundedIn(`${action} ${object}`, context, true)) violations.push("main intent contains numbers or quoted names not present in the context");
  }
  if (goal) {
    if (words(goal) < 4) violations.push("user_goal must be 4-12 words phrased as the user's wish");
    if (/\.[a-z]{2,4}\b|\//i.test(goal)) violations.push("user_goal contains a file name or path");
    if (/^(?:stop|no |not |failed|error|blocked|done|waiting)/i.test(goal)) violations.push("user_goal must be the user's wish, not a status");
  }
  if (!["success", "error", "warning", "running", "incomplete", "unknown"].includes(status)) violations.push("invalid status");
  if (!(confidence >= 0 && confidence <= 1)) violations.push("confidence must be 0..1");
  return violations;
}

function validateTranslationResult(parsed, context) {
  const violations = [];
  const line = cleanText(parsed?.sentence);
  const confidence = Number(parsed?.confidence ?? 0);
  const words = (t) => t.split(/\s+/).filter(Boolean).length;
  if (!line) violations.push("what_its_doing is empty");
  else {
    if (words(line) < 4) violations.push("what_its_doing must be a real sentence (4+ words)");
    if (/^the\s+\w+(?:\s+\w+)?\s+(?:was|were|has been|had been)\b/i.test(line)) violations.push("active voice — never 'The X was …'");
    if (/^(?:stop|do not|don't|never)\b/i.test(line)) violations.push("no imperatives aimed at nobody");
    if (/\.[a-z]{2,4}\b|\//i.test(line)) violations.push("no file names or paths — plain words");
    if (!groundedIn(line, context, true)) violations.push("contains numbers or quoted names not present in the context");
    if (/\b(?:finished nothing|was idle|is idle|no activity|nothing to (?:do|report)|based on the context)\b/i.test(line)) violations.push("self-referential emptiness is not a status");
  }
  if (!(confidence >= 0 && confidence <= 1)) violations.push("confidence must be 0..1");
  return violations;
}

function askIsVague(ask) {
  const text = cleanText(ask);
  if (!text) return true;
  if (/@filename\b|@filepath\b/i.test(text)) return true;
  if ((/\b(?:const|let|var|function|return|=>)\b/.test(text) && /[{};()]/.test(text)) || (text.match(/"/g) ?? []).length % 2 === 1) return true;
  if (/^(?:go|ok|okay|sure|yes|done|continue|do it|proceed|fill everything|fix it|make it work|next|deploy and \$?done)[.!]?$/i.test(text)) return true;
  return text.split(/\s+/).length < 4;
}

const CLEAR_TASK_VERB = /^(?:add(?:ing)?|answer(?:ing)?|audit(?:ing)?|build(?:ing)?|check(?:ing)?|clean(?:ing)?|create|creating|debug(?:ging)?|deploy(?:ing)?|edit(?:ing)?|explain(?:ing)?|fix(?:ing)?|implement(?:ing)?|improve|improving|investigat(?:e|ing)|make|making|migrat(?:e|ing)|monitor(?:ing)?|patch(?:ing)?|plan(?:ning)?|polish(?:ing)?|review(?:ing)?|rotate|rotating|run(?:ning)?|test(?:ing)?|update|updating|verif(?:y|ying)|write|writing|wait(?:ing)?\b|await(?:ing)?\b)/i;
const VAGUE_TASK_LABEL = /^(?:approval|verdict|review|fixed|done|idle|waiting|awaiting next action|in progress|gate passed|working|next action)$/i;
const USER_PROMPT_LABEL = /^(?:share|tell|show|send|provide)\s+(?:me\s+)?your\b|would you like\b|feel free\b|if you\b/i;

function taskTextFromItem(item) {
  if (typeof item === "string") return item;
  return cleanText(item?.text ?? item?.content ?? item?.title);
}

function stripTaskStatusPrefix(value) {
  return cleanText(value)
    .replace(/^(?:\d+[.)]|[-*])\s+/, "")
    .replace(/^(?:\[(?:x|done|complete|completed)\]|[✓✔])\s*/i, "")
    .replace(/^(?:done|complete|completed|pending|todo|in[-_ ]?progress|working|blocked|cancelled|canceled)\s*:\s*/i, "")
    .replace(/\.$/, "")
    .trim();
}

function activeSidecarTaskText(heuristic) {
  if (!heuristic?.tasksFromTodoWrite) return "";
  const tasks = Array.isArray(heuristic.tasks) ? heuristic.tasks : [];
  const active = tasks.find((item) => /^(?:in[-_ ]?progress|working)\s*:/i.test(taskTextFromItem(item)));
  return stripTaskStatusPrefix(taskTextFromItem(active) || heuristic.task);
}

function hasDecisionObject(text) {
  if (!/\b(?:approval|verdict|decision|response|reply|follow[- ]?up)\b/i.test(text)) return true;
  if (/\bapproval$/i.test(text)) {
    const before = text.replace(/\bapproval$/i, "").trim();
    if (before.split(/\s+/).filter((word) => !/^(?:waiting|awaiting|for|operator|user|human|reviewer|the|a|an)$/i.test(word)).length >= 3) return true;
  }
  return /\b(?:for|on|about|of)\s+(?!operator\b|user\b|human\b|reviewer\b|approval\b|verdict\b|decision\b|response\b|reply\b|follow[- ]?up\b)[a-z0-9][a-z0-9 -]{5,}\b/i.test(text);
}

function hasConcreteTaskObject(text) {
  const words = cleanText(text).split(/\s+/).filter(Boolean);
  if (words.length < 4 || words.length > 16) return false;
  const rest = words.slice(1).join(" ");
  if (rest.split(/\s+/).filter((word) => !/^(?:the|a|an|this|that|it|exact|same|operator|user|human)$/i.test(word)).length < 2) return false;
  return true;
}

function shortTitleFromTask(value) {
  let text = stripTaskStatusPrefix(value);
  text = text
    .replace(/^(?:rechecking|checking)\s+(.+?)\s+approval$/i, "Checking $1")
    .replace(/^(?:waiting|awaiting)\s+for\s+(?:operator|user|reviewer)\s+(?:verdict|approval|decision)\s+(?:on|for|about)\s+(.+)$/i, "Waiting for $1 approval")
    .replace(/\bapproval\s+approval\b/i, "approval")
    .trim();
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length > 8) text = words.slice(0, 8).join(" ");
  return text.replace(/[,:;]+$/, "").trim();
}

function imperativeTaskSentence(task, title, payload) {
  let base = stripTaskStatusPrefix(task);
  if (/^(?:rechecking|checking)\s+(.+?)\s+approval$/i.test(base)) {
    base = base.replace(/^(?:rechecking|checking)\s+(.+?)\s+approval$/i, "Check $1 approval");
  } else {
    base = base
      .replace(/^checking\b/i, "Check")
      .replace(/^rechecking\b/i, "Check")
      .replace(/^fixing\b/i, "Fix")
      .replace(/^updating\b/i, "Update")
      .replace(/^verifying\b/i, "Verify")
      .replace(/^reviewing\b/i, "Review")
      .replace(/^implementing\b/i, "Implement")
      .replace(/^testing\b/i, "Test")
      .replace(/^waiting\b/i, "Wait");
  }
  if (/\b(?:pane|header|cockpit)\b/i.test(base) && !/\bTermFleet\b/i.test(base)) base = base.replace(/^(\w+)/, "$1 TermFleet");
  if (!base && title) base = title;
  return `${base.replace(/[.]+$/, "")}.`;
}

function clearSidecarContextTitle(payload, heuristic) {
  const task = activeSidecarTaskText(heuristic);
  if (!task) return null;
  if (VAGUE_TASK_LABEL.test(task) || USER_PROMPT_LABEL.test(task)) return null;
  if (!CLEAR_TASK_VERB.test(task) || !hasConcreteTaskObject(task) || !hasDecisionObject(task)) return null;
  if (/\b(?:src|scripts|tests|docs)\/|\.[a-z]{2,4}\b|[~/\\][^\s,;]*/i.test(task)) return null;
  const title = shortTitleFromTask(task);
  if (!title || VAGUE_TASK_LABEL.test(title) || !CLEAR_TASK_VERB.test(title) || !hasConcreteTaskObject(title)) return null;
  const goal = imperativeTaskSentence(task, title, payload);
  return {
    goal,
    now: title,
    state: String(heuristic?.status ?? "") === "done" ? "success" : "running",
    reason: "task-sidecar",
    taskText: goal,
  };
}

function shouldReplaceAskWithGoal(ask) {
  return askIsVague(ask) || !hasDecisionObject(cleanText(ask));
}

function rewriteActiveTaskText(tasks, taskText) {
  if (!taskText || !Array.isArray(tasks) || tasks.length === 0) return tasks;
  let replaced = false;
  return tasks.map((item, index) => {
    const raw = taskTextFromItem(item);
    const isActive = /^(?:in[-_ ]?progress|working)\s*:/i.test(raw) || (!replaced && index === 0);
    if (!isActive) return item;
    replaced = true;
    const text = /^(?:in[-_ ]?progress|working)\s*:/i.test(raw)
      ? raw.replace(/^(?:in[-_ ]?progress|working)\s*:\s*.*/i, `in-progress: ${taskText}`)
      : taskText;
    return typeof item === "string" ? text : { ...item, text };
  });
}

async function contextTitleFor(payload, heuristic) {
  const key = contextCacheKey(payload);
  const deterministic = clearSidecarContextTitle(payload, heuristic);
  if (deterministic) {
    const at = Date.now();
    contextCache.set(key, { at, line: deterministic });
    lastGoodLines.set(key, { at, now: deterministic.now, goal: deterministic.goal, state: deterministic.state });
    return deterministic;
  }
  if (contextTitleDisabled) {
    const line = { goal: "", now: "", state: "", reason: "context-disabled" };
    contextCache.set(key, { at: Date.now(), line });
    return line;
  }
  const cached = contextCache.get(key);
  const now = Date.now();
  if (cached && "line" in cached && now - cached.at < CONTEXT_TTL_MS) return cached.line;
  if (cached?.promise) return cached.promise;
  const src = contextSourcesWithDisk(payload, heuristic);
  if (!hasEnoughContext(src)) {
    contextCache.set(key, { at: now, line: { goal: "", now: "", state: "", reason: "thin-context" } });
    return { goal: "", now: "", state: "", reason: "thin-context" };
  }
  const finishedHint = looksFinished(heuristic, src.tail);
  const context = `${src.ask} ${src.narration} ${src.activity} ${src.tail}`;
  const promise = (async () => {
    let analysis = autoFixAnalysisResult(await ollamaJsonQueued(buildAnalyzerMessages(src, finishedHint), ANALYZER_SCHEMA).catch(() => null));
    let violations = analysis ? validateAnalysisResult(analysis, context) : ["analyzer returned nothing"];
    if (violations.length && analysis) {
      const badFields = new Set(violations.map((v) => (
        v.startsWith("core_action") ? "core_action"
        : v.startsWith("main_object") || v.includes("main intent") ? "main_object"
        : v.startsWith("user_goal") ? "user_goal"
        : v.includes("status") ? "status"
        : v.includes("confidence") ? "confidence"
        : "main_object"
      )));
      const fieldSchema = { type: "object", properties: {}, required: [...badFields] };
      for (const field of badFields) fieldSchema.properties[field] = ANALYZER_SCHEMA.properties[field];
      const repairMessages = [
        ...buildAnalyzerMessages(src, finishedHint),
        { role: "assistant", content: JSON.stringify(Object.fromEntries([...badFields].map((f) => [f, analysis[f]]))) },
        { role: "user", content: `That violated: ${violations.join("; ")}. Return ONLY corrected analyzer JSON for ${[...badFields].join(", ")}.` },
      ];
      const repaired = await ollamaJsonQueued(repairMessages, fieldSchema).catch(() => null);
      if (repaired) analysis = autoFixAnalysisResult({ ...analysis, ...repaired });
      violations = analysis ? validateAnalysisResult(analysis, context) : violations;
    }

    let translation = null;
    let translationViolations = [];
    let critique = null;
    let critiqueViolations = [];
    if (analysis && violations.length === 0 && Number(analysis.confidence ?? 0) >= 0.45) {
      const translatorContext = `${cleanText(analysis.core_action)} ${cleanText(analysis.main_object)} ${cleanText(analysis.user_goal)} ${src.ask}`;
      translation = autoFixTranslationResult(await ollamaJsonQueued(buildTranslatorMessages(analysis, src), TRANSLATOR_SCHEMA).catch(() => null));
      translationViolations = translation ? validateTranslationResult(translation, translatorContext) : ["translator returned nothing"];
      if (translationViolations.length && translation) {
        const repairSchema = { type: "object", properties: { sentence: TRANSLATOR_SCHEMA.properties.sentence }, required: ["sentence"] };
        const repairMessages = [
          ...buildTranslatorMessages(analysis, src),
          { role: "assistant", content: JSON.stringify({ sentence: translation.sentence }) },
          { role: "user", content: `That violated: ${translationViolations.join("; ")}. Return ONLY corrected JSON for sentence.` },
        ];
        const repaired = await ollamaJsonQueued(repairMessages, repairSchema).catch(() => null);
        if (repaired) translation = autoFixTranslationResult({ ...translation, ...repaired });
        translationViolations = translation ? validateTranslationResult(translation, translatorContext) : translationViolations;
      }
      if (translation && translationViolations.length === 0 && Number(translation.confidence ?? 0) >= 0.45) {
        critique = autoFixTranslationResult(await ollamaJsonQueued(buildCriticMessages(analysis, translation, src), CRITIC_SCHEMA).catch(() => null));
        critiqueViolations = critique ? validateTranslationResult(critique, `${translatorContext} ${context}`) : ["critic returned nothing"];
        if (critiqueViolations.length && critique) {
          const repairSchema = { type: "object", properties: { sentence: CRITIC_SCHEMA.properties.sentence }, required: ["sentence"] };
          const repairMessages = [
            ...buildCriticMessages(analysis, translation, src),
            { role: "assistant", content: JSON.stringify({ sentence: critique.sentence }) },
            { role: "user", content: `That violated: ${critiqueViolations.join("; ")}. Return ONLY corrected JSON for sentence.` },
          ];
          const repaired = await ollamaJsonQueued(repairMessages, repairSchema).catch(() => null);
          if (repaired) critique = autoFixTranslationResult({ ...critique, ...repaired });
          critiqueViolations = critique ? validateTranslationResult(critique, `${translatorContext} ${context}`) : critiqueViolations;
        }
      }
    }

    let nowLine = "";
    let goal = "";
    let state = "";
    // Confidence thresholding: low-confidence interpretation must not display.
    if (
      analysis &&
      violations.length === 0 &&
      translation &&
      translationViolations.length === 0 &&
      critique &&
      critiqueViolations.length === 0 &&
      Number(analysis.confidence ?? 0) >= 0.45 &&
      Number(translation.confidence ?? 0) >= 0.45 &&
      Number(critique.confidence ?? 0) >= 0.45
    ) {
      nowLine = cleanText(critique.sentence);
      goal = cleanText(analysis.user_goal) || src.ask;
      state = String(analysis.status);
    }
    const prevGood = lastGoodLines.get(key);
    const prevFresh = prevGood && Date.now() - prevGood.at < 10 * 60_000;
    if (!nowLine && prevFresh) { nowLine = prevGood.now; state = prevGood.state ?? state; }
    if (!goal && prevFresh && prevGood.goal) goal = prevGood.goal;
    // Wording stickiness: a paraphrase keeps the previous wording.
    if (nowLine && prevFresh && prevGood.now && nowLine !== prevGood.now) {
      const tokens = (t) => new Set(String(t).toLowerCase().match(/[a-z]{5,}/g) ?? []);
      const a = tokens(nowLine);
      const b = tokens(prevGood.now);
      const shared = [...a].filter((w) => b.has(w)).length;
      if (shared >= 2 && shared >= Math.min(a.size, b.size) * 0.5) nowLine = prevGood.now;
    }
    if (nowLine) lastGoodLines.set(key, { at: Date.now(), now: nowLine, goal, state });
    const allViolations = [...violations, ...translationViolations, ...critiqueViolations];
    const line = { goal, now: nowLine, state, reason: nowLine ? "ok" : `rejected: ${allViolations.join("; ").slice(0, 120)}` };
    const at = nowLine ? Date.now() : Date.now() - CONTEXT_TTL_MS + 10_000;
    contextCache.set(key, { at, line });
    return line;
  })().catch((error) => {
    process.stdout.write(`context-error ${key.slice(0, 24)}: ${String(error?.message ?? error).slice(0, 120)}\n`);
    contextCache.set(key, { at: Date.now(), line: null });
    return null;
  });
  contextCache.set(key, { at: now, promise });
  return promise;
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function runCommand(payload) {
  return new Promise((resolve, reject) => {
    if (!command) {
      resolve(null);
      return;
    }

    const child = spawn(command, commandArgs, {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("status command timed out"));
    }, Number(process.env.TERMFLEET_AGENT_STATUS_TIMEOUT_MS || 8000));

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`status command exited ${code}: ${stderr || stdout}`));
      }
    });
    child.stdin.end(JSON.stringify({
      ...payload,
      heuristicCandidate: fallbackSummary(payload),
    }));
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
  });
  response.end(JSON.stringify(payload));
}

async function sendStatusSummary(response, payload, heuristic) {
  const context = await contextTitleFor(payload, heuristic);
  const ask = heuristic?.userTask ?? payload?.workstream?.userTask;
  const contextSource = context?.reason === "task-sidecar" ? "task" : "model";
  const replaceAsk = shouldReplaceAskWithGoal(ask);
  process.stdout.write(`status ${contextCacheKey(payload)} -> ${context?.now ? `${contextSource}: ${context.now.slice(0, 60)}` : `heuristic(${context?.reason ?? "no-context"})`}${context?.goal && replaceAsk ? ` | goal: ${context.goal.slice(0, 40)}` : ""}\n`);
  // A pane waiting on the OPERATOR keeps its question wording — the model only
  // supplies the goal; "Working" must never mask a question. (Operator gate)
  if (String(heuristic?.status) === "waiting") {
    sendJson(response, 200, {
      ...heuristic,
      ...(context?.goal && replaceAsk ? { userTask: context.goal } : {}),
      confidence: "high",
    });
    return;
  }
  if (context?.now) {
    sendJson(response, 200, {
      ...heuristic,
      now: context.now,
      narration: context.now,
      ...(context.taskText ? { task: context.taskText, tasks: rewriteActiveTaskText(heuristic.tasks, context.taskText) } : {}),
      ...(context.goal && replaceAsk ? { userTask: context.goal } : {}),
      status:
        context.state === "error" ? "blocked"
        : context.state === "success" ? "idle"
        : context.state === "warning" ? "working"
        : context.state === "running" || context.state === "incomplete" ? "working"
        : heuristic.status || "working",
      confidence: "high",
    });
    return;
  }
  sendJson(response, 200, heuristic);
}

const server = http.createServer(async (request, response) => {
  if (request.method === "OPTIONS") {
    sendJson(response, 204, {});
    return;
  }
  // Dev-only observability route: accept the frontend's rendered cockpit-state dump.
  if (request.method === "POST" && request.url === "/cockpit-snapshot") {
    try {
      const raw = await readRequestBody(request);
      writeCockpitSnapshot(raw);
      sendJson(response, 200, { ok: true });
    } catch (error) {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }
  if (request.method !== "POST" || request.url !== "/status") {
    sendJson(response, 404, { error: "Use POST /status" });
    return;
  }

  try {
    const raw = await readRequestBody(request);
    const payload = raw ? JSON.parse(raw) : {};
    const commandOutput = await runCommand(payload);
    if (commandOutput) {
      const commandSummary = JSON.parse(commandOutput.trim());
      await sendStatusSummary(response, payload, commandSummary);
      return;
    }
    const heuristic = payload?.heuristicCandidate ?? fallbackSummary(payload);
    await sendStatusSummary(response, payload, heuristic);
  } catch (error) {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : String(error),
      ...fallbackSummary({}),
    });
  }
});

server.listen(port, host, () => {
  process.stdout.write(`TERMFLEET_AGENT_STATUS_SUMMARY_ENDPOINT=http://${host}:${port}/status\n`);
});
