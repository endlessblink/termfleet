#!/usr/bin/env node
import http from "node:http";
import { stdin, stdout } from "node:process";
import { readSidecarForPayload, summaryFromSidecar } from "./agent-status-summary-sidecar.mjs";

const model = process.env.TERMFLEET_AGENT_STATUS_MODEL || "qwen3:4b";
const endpoint = process.env.TERMFLEET_OLLAMA_URL || "http://127.0.0.1:11434";

function readStdin() {
  return new Promise((resolve, reject) => {
    let text = "";
    stdin.setEncoding("utf8");
    stdin.on("data", (chunk) => {
      text += chunk;
    });
    stdin.on("end", () => resolve(text));
    stdin.on("error", reject);
  });
}

function compactJson(value) {
  return JSON.stringify(value ?? {});
}

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
  const sourceValues = Array.isArray(values) ? values : values ? [values] : [];
  const seen = new Set();
  return sourceValues
    .map((value) => typeof value === "string" ? value : value && typeof value === "object" ? value.text : "")
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

function isNoisy(value) {
  const text = cleanText(value);
  if (!text) return true;
  return [
    /^supervised agent run$/i,
    /^shell ready$/i,
    /^›\s*/i,
    /^use\s+\/\w+/i,
    /^F\d+\w+\s+F\d+/i,
    /\bF10Quit\b/i,
    /^[«‹›|│┃¦\s•·-]*gpt[-\w. ]+\s+default\b/i,
    /^«?\s*\|?\s*gpt[-\w. ]+\s+default\b/i,
    /^«?\s*\|?\s*[\w.-]+\s+default\b/i,
    /\|\|?>/,
    /\besc to interrupt\b/i,
    /^working\s*[.:…-]*$/i,
    /^idle\s*[.:…-]*$/i,
    /^›\s*use\s+\/\w+/i,
  ].some((pattern) => pattern.test(text));
}

function fallbackSummary(payload) {
  return payload?.heuristicCandidate ?? {
    task: "Shell ready",
    path: payload?.projectId ?? "workspace",
    now: "Awaiting command",
    status: "idle",
    provider: payload?.workstream?.provider ?? "shell",
    confidence: "low",
  };
}

function extractJsonObject(text) {
  const trimmed = cleanText(text);
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

function buildPrompt(payload) {
  const candidate = fallbackSummary(payload);
  return [
    "Return ONLY one compact JSON object for this terminal status.",
    "Schema: task,path,now,status,provider,confidence,tasks,blockers,evidence,nextActions.",
    "Use heuristicCandidate unless transcript clearly improves it.",
    "Ignore prompts, model names, spinners, esc-to-interrupt, repeated commands, and UI chrome.",
    "Never overclaim. Keep task/path/now short and user-facing.",
    `heuristicCandidate=${compactJson(candidate)}`,
    `workstream=${compactJson(payload?.workstream)}`,
    `transcript=${JSON.stringify(String(payload?.transcript ?? "").slice(-1800))}`,
  ].join("\n");
}

function postJson(url, payload) {
  return new Promise((resolve, reject) => {
    const target = new URL("/api/generate", url);
    const body = JSON.stringify(payload);
    const request = http.request({
      hostname: target.hostname,
      port: target.port || 80,
      path: target.pathname,
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
      },
      timeout: Number(process.env.TERMFLEET_AGENT_STATUS_TIMEOUT_MS || 2500),
    }, (response) => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        text += chunk;
      });
      response.on("end", () => {
        if (!response.statusCode || response.statusCode >= 400) {
          reject(new Error(`ollama returned ${response.statusCode}: ${text.slice(0, 120)}`));
          return;
        }
        resolve(text);
      });
    });
    request.on("timeout", () => {
      request.destroy(new Error("ollama request timed out"));
    });
    request.on("error", reject);
    request.end(body);
  });
}

function parseOllamaResponse(raw, payload) {
  const outer = JSON.parse(raw);
  const text = typeof outer.response === "string" ? outer.response : raw;
  const parsed = JSON.parse(extractJsonObject(text));
  const fallback = fallbackSummary(payload);
  const task = cleanText(parsed.task);
  const userTask = cleanText(parsed.userTask) || cleanText(fallback.userTask);
  const path = cleanText(parsed.path);
  const now = cleanText(parsed.now);
  return {
    ...fallback,
    ...parsed,
    task: task && !isNoisy(task) ? task : fallback.task,
    userTask: userTask && !isNoisy(userTask) ? userTask : undefined,
    path: path && !isNoisy(path) ? path : fallback.path,
    now: now && !isNoisy(now) ? now : fallback.now,
    status: parsed.status || fallback.status,
    provider: parsed.provider || fallback.provider,
    confidence: parsed.confidence || fallback.confidence || "low",
    tasks: extractedItems(parsed.tasks ?? fallback.tasks, text),
    blockers: extractedItems(parsed.blockers ?? fallback.blockers, text),
    evidence: extractedItems(parsed.evidence ?? fallback.evidence, text),
    nextActions: extractedItems(parsed.nextActions ?? fallback.nextActions, text),
  };
}

let payload = {};
try {
  const raw = await readStdin();
  payload = raw ? JSON.parse(raw) : {};
  // Sidecar-first: when the agent's own status hook has written a fresh sidecar for
  // this cwd (Claude Code panes), use its REAL task list + activity — free, accurate,
  // and never the model's hallucination of the scrollback. Only fall through to the
  // local model when no sidecar exists (e.g. Codex/OpenCode panes, which don't write
  // one). This makes the single worker serve every agent type. (TC-033)
  const sidecar = readSidecarForPayload(payload);
  if (sidecar) {
    stdout.write(`${JSON.stringify(summaryFromSidecar(sidecar, payload))}\n`);
    process.exit(0);
  }
  const body = {
    model,
    prompt: buildPrompt(payload),
    stream: false,
    format: "json",
    options: {
      temperature: 0,
      num_ctx: 2048,
      num_predict: 120,
    },
  };
  const response = await postJson(endpoint, body);
  stdout.write(`${JSON.stringify(parseOllamaResponse(response, payload))}\n`);
} catch {
  stdout.write(`${JSON.stringify(fallbackSummary(payload))}\n`);
}
