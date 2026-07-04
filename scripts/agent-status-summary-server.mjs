#!/usr/bin/env node
import http from "node:http";
import { spawn } from "node:child_process";
import { argv } from "node:process";
import { appendFileSync, mkdirSync, renameSync, statSync, writeFileSync } from "node:fs";
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

// ---- Local contextual summarizer (2026-07-04, user-approved tiny fast model) ----
// The operator's gate: every pane header must say goal + current step + the SPECIFIC
// object ("verifying the session-switch diagnosis before implementing the fix").
// Heuristics can't synthesize that; a local llama3.2 call (~0.5s warm) can. Applied
// ONLY when the pane has no real task list (sidecar-backed panes never reach the
// endpoint). Cached per pane so polling never hammers Ollama; keep_alive keeps the
// model warm so the cockpit stays sub-second.
const OLLAMA_URL = process.env.TERMFLEET_OLLAMA_URL || "http://127.0.0.1:11434/api/generate";
const CONTEXT_MODEL = process.env.TERMFLEET_CONTEXT_TITLE_MODEL || "llama3.2:latest";
const CONTEXT_TTL_MS = Number(process.env.TERMFLEET_CONTEXT_TITLE_TTL_MS || 45_000);
const contextCache = new Map(); // key -> { at, line } | { at, promise }

function contextCacheKey(payload) {
  return cleanText(payload?.paneId) || cleanText(payload?.projectId) || "unknown";
}

function buildContextPrompt(payload, heuristic) {
  const workstream = payload?.workstream ?? {};
  const ask = cleanText(workstream.userTask || workstream.prompt || heuristic?.userTask).slice(0, 220);
  const narration = cleanText(heuristic?.narration).slice(0, 300);
  const activity = cleanText(workstream.currentActivity || heuristic?.now).slice(0, 160);
  const tail = cleanText(payload?.transcript).slice(-700);
  const finished = looksFinished(heuristic, tail);
  return [
    "Output EXACTLY two lines for a terminal status header, for a non-technical observer.",
    "GOAL: <max 12 words - what the operator ultimately wants in this terminal, specific>",
    finished
      ? "NOW: <max 12 words - what the agent JUST FINISHED, PAST tense, concrete outcome. It already finished - do NOT use -ing verbs.>"
      : "NOW: <max 12 words - what the agent is doing right now AND WHY>",
    "Name concrete objects (which bug, which scripts, which page). Plain words, no file paths, no quotes, no preamble, no 'The agent'.",
    ask ? `Operator asked: ${ask}` : "",
    narration ? `Agent just said: ${narration}` : "",
    activity ? `Latest activity: ${activity}` : "",
    tail ? `Terminal tail: ${tail}` : "",
    "Two lines:",
  ].filter(Boolean).join("\n");
}

// Finished-ness must come from the CONTENT, not only a stale lifecycle flag: a tail
// that reads as a wrap-up report means the work is done even if status says working.
function looksFinished(heuristic, tail) {
  if (["done", "idle", "stopped"].includes(String(heuristic?.status ?? ""))) return true;
  const text = String(tail ?? "");
  return /\b(?:Verified now|All checks passed|Committed|Pushed|Worked for \d|Done\.|completed successfully)\b/i.test(text) &&
    !/\besc to interrupt\b|\bWorking\s*\(/i.test(text.slice(-200));
}

function ollamaContextLine(payload, heuristic) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: CONTEXT_MODEL,
      stream: false,
      keep_alive: "30m",
      options: { num_predict: 36, temperature: 0.2 },
      prompt: buildContextPrompt(payload, heuristic),
    });
    const url = new URL(OLLAMA_URL);
    const request = http.request(
      { hostname: url.hostname, port: url.port, path: url.pathname, method: "POST", headers: { "content-type": "application/json" } },
      (response) => {
        let text = "";
        response.on("data", (chunk) => (text += chunk));
        response.on("end", () => {
          if (response.statusCode !== 200) {
            reject(new Error(`ollama ${response.statusCode}`));
            return;
          }
          try {
            resolve(String(JSON.parse(text)?.response ?? ""));
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    request.setTimeout(Number(process.env.TERMFLEET_CONTEXT_TITLE_TIMEOUT_MS || 6000), () => {
      request.destroy(new Error("ollama timed out"));
    });
    request.on("error", reject);
    request.end(body);
  });
}

// Model output hygiene: first line only, strip quotes/bullets/boilerplate, clamp
// length; empty result → caller keeps the heuristic.
function cleanContextLine(raw) {
  let line = String(raw ?? "").split("\n").map((entry) => entry.trim()).find(Boolean) ?? "";
  line = line
    .replace(/^["'“”`•*-]+|["'“”`]+$/g, "")
    .replace(/^(?:\d+[.)]\s*)?(?:status line|header|title|goal|now)\s*[:\-]\s*/i, "")
    .replace(/^the\s+(?:terminal\s+)?(?:ai\s+)?agent\s+is\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!line) return "";
  line = line.charAt(0).toUpperCase() + line.slice(1);
  // Frontend now-line gate rejects >80 chars — clamp below it.
  if (line.length > 78) {
    const clause = line.split(/,\s+/)[0].trim();
    line = clause.length >= 24 && clause.length <= 78 ? clause : `${line.slice(0, 75).replace(/\s+\S*$/, "").trim()}…`;
  }
  return line.replace(/[.!?]+$/, "");
}

function askIsVague(ask) {
  const text = cleanText(ask);
  if (!text) return true;
  if (/^(?:go|ok|okay|sure|yes|continue|do it|proceed|fill everything|fix it|make it work|next)[.!]?$/i.test(text)) return true;
  return text.split(/\s+/).length < 4;
}

function parseContextLines(raw) {
  const lines = String(raw ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
  let goal = "";
  let now = "";
  // Pass 1: labeled lines only (the requested format).
  for (const line of lines) {
    const goalMatch = line.match(/^[*\s"'`-]*(?:\d+[.)]\s*)?goal\s*[:\-]\s*(.+)$/i);
    if (goalMatch && !goal) { goal = cleanContextLine(goalMatch[1]); continue; }
    const nowMatch = line.match(/^[*\s"'`-]*(?:\d+[.)]\s*)?now\s*[:\-]\s*(.+)$/i);
    if (nowMatch && !now) now = cleanContextLine(nowMatch[1]);
  }
  // Pass 2 (labels missing): last substantive line, never chat preamble.
  if (!now) {
    const candidate = [...lines].reverse().find((line) =>
      !/[:：]\s*$/.test(line) && !/two lines|status header|here (?:are|is)\b/i.test(line));
    now = cleanContextLine(candidate ?? "");
  }
  // A goal must be a whole statement, not a dangling clause ("for bina-meatzevet
  // profile") — reject fragments so the Task row never shows half a sentence.
  if (goal && (/^(?:for|with|to|of|in|on|at|by|from|about)\b/i.test(goal) || goal.split(/\s+/).length < 4)) {
    goal = "";
  }
  return { goal, now };
}

async function contextTitleFor(payload, heuristic) {
  // A real declared task list outranks the model — never overwrite it.
  if (Array.isArray(heuristic?.tasks) && heuristic.tasksFromTodoWrite) return null;
  const key = contextCacheKey(payload);
  const cached = contextCache.get(key);
  const now = Date.now();
  if (cached && "line" in cached && now - cached.at < CONTEXT_TTL_MS) return cached.line;
  if (cached?.promise) return cached.promise;
  const promise = ollamaContextLine(payload, heuristic)
    .then((raw) => {
      const line = parseContextLines(raw);
      contextCache.set(key, { at: Date.now(), line });
      return line;
    })
    .catch(() => {
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
      response.writeHead(200, {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
      });
      response.end(commandOutput.trim());
      return;
    }
    const heuristic = payload?.heuristicCandidate ?? fallbackSummary(payload);
    const context = await contextTitleFor(payload, heuristic);
    const ask = heuristic?.userTask ?? payload?.workstream?.userTask;
    process.stdout.write(`status ${contextCacheKey(payload)} -> ${context?.now ? `model: ${context.now.slice(0, 60)}` : "heuristic"}${context?.goal && askIsVague(ask) ? ` | goal: ${context.goal.slice(0, 40)}` : ""}\n`);
    if (context?.now) {
      const finished = looksFinished(heuristic, cleanText(payload?.transcript).slice(-700));
      // Operator rule: a finished pane says BOTH the outcome and that it awaits.
      const nowLine = finished && context.now.length <= 58 ? `${context.now} · awaiting next task` : context.now;
      sendJson(response, 200, {
        ...heuristic,
        now: nowLine,
        narration: nowLine,
        ...(context.goal && askIsVague(ask) ? { userTask: context.goal } : {}),
        status: finished ? "idle" : heuristic.status || "working",
        confidence: "high",
      });
      return;
    }
    sendJson(response, 200, heuristic);
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
