#!/usr/bin/env node
import http from "node:http";
import { spawn } from "node:child_process";
import { argv } from "node:process";

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
    sendJson(response, 200, fallbackSummary(payload));
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
