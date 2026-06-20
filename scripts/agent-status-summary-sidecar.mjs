#!/usr/bin/env node
// Status-summary worker that reads the agent's real todo list + activity from the
// sidecar file written by termfleet-claude-status-hook.mjs (keyed by cwd). Same
// stdin→stdout contract as the Ollama worker, but ZERO model/CLI calls — it just
// reads a local file. Falls back to the request's heuristic candidate when no
// fresh sidecar exists. (TC-033, cost-minimizing path.)
import { appendFileSync, readFileSync } from "node:fs";
import { stdin, stdout } from "node:process";
import { sidecarFresh, sidecarPath } from "./lib/agent-status-paths.mjs";

function cleanText(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").replace(/^[•*-]\s+/, "").trim() : "";
}

function hashText(value) {
  let hash = 2166136261;
  const text = String(value ?? "");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function extractedItems(values) {
  const seen = new Set();
  return (Array.isArray(values) ? values : [])
    .map((value) => cleanText(value).slice(0, 180))
    .filter(Boolean)
    .map((text) => {
      const sourceHash = hashText(`summary:${text}`);
      return { id: `summary:${sourceHash}`, text, provenance: "summary", at: 0, excerpt: text.slice(0, 240), sourceHash };
    })
    .filter((item) => (seen.has(item.sourceHash) ? false : (seen.add(item.sourceHash), true)))
    .slice(0, 8);
}

export function fallbackSummary(payload) {
  return payload?.heuristicCandidate ?? {
    task: "Shell ready",
    path: payload?.projectId ?? "workspace",
    now: "Awaiting command",
    status: "idle",
    provider: payload?.workstream?.provider ?? "shell",
    confidence: "low",
  };
}

// Encode a todo into task text whose prefix termfleet's inferStatus maps back to a
// status ("done:" → completed, "in-progress:" → in_progress); cleanTaskLineupContent
// then strips the prefix for display.
function todoToTaskText(todo) {
  const content = cleanText(todo?.content);
  if (!content) return "";
  if (todo.status === "completed") return `done: ${content}`;
  if (todo.status === "in_progress") return `in-progress: ${content}`;
  return content;
}

export function summaryFromSidecar(sidecar, payload) {
  const fallback = fallbackSummary(payload);
  const todos = Array.isArray(sidecar?.todos) ? sidecar.todos : [];
  const now = cleanText(sidecar?.now);
  const working = todos.some((todo) => todo.status === "in_progress");
  return {
    ...fallback,
    task: now || fallback.task,
    now: now || fallback.now,
    status: working ? "working" : todos.length > 0 ? "idle" : fallback.status,
    provider: fallback.provider,
    confidence: "high",
    tasks: extractedItems(todos.map(todoToTaskText)),
    blockers: [],
    evidence: [],
    nextActions: [],
  };
}

export function readSidecarForPayload(payload, read = (p) => readFileSync(p, "utf8")) {
  const candidates = [payload?.workstream?.path, payload?.projectId, payload?.cwd, payload?.cwdLabel].filter(Boolean);
  if (process.env.TERMFLEET_SIDECAR_DEBUG) {
    try {
      appendFileSync(
        process.env.TERMFLEET_SIDECAR_DEBUG,
        `${new Date().toISOString()} candidates=${JSON.stringify(candidates)} paths=${JSON.stringify(candidates.map((c) => sidecarPath(c)))}\n`,
      );
    } catch {
      // debug only
    }
  }
  for (const key of candidates) {
    try {
      const sidecar = JSON.parse(read(sidecarPath(key)));
      if (sidecarFresh(sidecar)) return sidecar;
    } catch {
      // missing/stale/unreadable → try the next candidate key
    }
  }
  return null;
}

function readStdin() {
  return new Promise((resolve) => {
    let text = "";
    stdin.setEncoding("utf8");
    stdin.on("data", (chunk) => (text += chunk));
    stdin.on("end", () => resolve(text));
    stdin.on("error", () => resolve(""));
  });
}

async function main() {
  let payload = {};
  try {
    const raw = await readStdin();
    payload = raw ? JSON.parse(raw) : {};
    const sidecar = readSidecarForPayload(payload);
    const summary = sidecar ? summaryFromSidecar(sidecar, payload) : fallbackSummary(payload);
    stdout.write(`${JSON.stringify(summary)}\n`);
  } catch {
    stdout.write(`${JSON.stringify(fallbackSummary(payload))}\n`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
