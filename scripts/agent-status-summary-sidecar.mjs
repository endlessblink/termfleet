#!/usr/bin/env node
// Status-summary worker that reads the agent's real todo list + activity from the
// sidecar file written by termfleet-claude-status-hook.mjs (keyed by cwd). Same
// stdin→stdout contract as the Ollama worker, but ZERO model/CLI calls — it just
// reads a local file. Falls back to the request's heuristic candidate when no
// fresh sidecar exists. (TC-033, cost-minimizing path.)
import { appendFileSync, readFileSync } from "node:fs";
import { stdin, stdout } from "node:process";
import {
  paneSidecarPath,
  sidecarFresh,
  sidecarPath,
} from "./lib/agent-status-paths.mjs";

function cleanText(value) {
  return typeof value === "string"
    ? value
        .replace(/\s+/g, " ")
        .replace(/^[•*-]\s+/, "")
        .trim()
    : "";
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
      return {
        id: `summary:${sourceHash}`,
        text,
        provenance: "summary",
        at: 0,
        excerpt: text.slice(0, 240),
        sourceHash,
      };
    })
    .filter((item) =>
      seen.has(item.sourceHash) ? false : (seen.add(item.sourceHash), true),
    )
    .slice(0, 8);
}

export function fallbackSummary(payload) {
  return (
    payload?.heuristicCandidate ?? {
      task: "Shell ready",
      path: payload?.projectId ?? "workspace",
      now: "Awaiting command",
      status: "idle",
      provider: payload?.workstream?.provider ?? "shell",
      confidence: "low",
    }
  );
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
  const active = todos.find((todo) => todo.status === "in_progress");
  const firstOpen = todos.find((todo) => todo.status !== "completed");
  const lastDone = [...todos]
    .reverse()
    .find((todo) => todo.status === "completed");
  const working = Boolean(active);
  // Title = the agent's CURRENT task, preferring its human-readable `activeForm` over the
  // terse subject. When nothing is live (all complete), fall back to the LAST completed
  // task — a clean summary of what was just done. NEVER fall back to `now` (the momentary
  // raw tool activity, e.g. "Running: cd /long/path") as the title; that belongs only on
  // the activity line. (TC-033)
  const current = active ?? firstOpen;
  const currentTask =
    cleanText(current?.activeForm || current?.content) ||
    cleanText(lastDone?.content);
  return {
    ...fallback,
    task: currentTask || fallback.task,
    now: now || fallback.now,
    status: working ? "working" : todos.length > 0 ? "idle" : fallback.status,
    provider: fallback.provider,
    confidence: "high",
    tasks: extractedItems(todos.map(todoToTaskText)),
    // These tasks ARE the agent's real Claude TodoWrite list (captured by the
    // status hook), not heuristic summary items. Flag it so the consumer renders
    // them as the authoritative `todo-write` source. Todos only ever originate
    // from a TodoWrite call (the live-now path merely preserves them), so a
    // non-empty list is sufficient proof.
    tasksFromTodoWrite: todos.length > 0,
    // The agent's own last words (from the Stop-hook transcript capture) — a reliable
    // title source when there's no task list, since it's what the model SAID it's doing
    // (not a heuristic scrape of terminal output). (TC-033)
    narration: cleanText(sidecar?.narration).slice(0, 90) || undefined,
    // The agent's rolling recent-activity log (what it actually did) — a reliable feed
    // to show when there's no task list, instead of inferring a title. (TC-033)
    recent: (Array.isArray(sidecar?.recent) ? sidecar.recent : [])
      .filter((entry) => entry && cleanText(entry.text))
      .map((entry) => ({
        text: cleanText(entry.text).slice(0, 90),
        at: Number(entry.at) || 0,
      }))
      .slice(-8),
    blockers: [],
    evidence: [],
    nextActions: [],
  };
}

export function readSidecarForPayload(
  payload,
  read = (p) => readFileSync(p, "utf8"),
) {
  // Per-terminal status (TC-035): when the request carries the pane's id, prefer its
  // pane-keyed sidecar so two terminals in the SAME cwd read independent status. Falls
  // through to the cwd candidates when the pane sidecar is missing/stale (the pane id
  // isn't injected into the PTY yet, or this is a non-termfleet shell) → legacy behavior.
  const paneId = payload?.paneId;
  if (paneId) {
    try {
      const sidecar = JSON.parse(read(paneSidecarPath(paneId)));
      if (sidecarFresh(sidecar)) return sidecar;
    } catch {
      // no fresh pane sidecar → fall through to cwd keying
    }
  }
  const candidates = [
    payload?.workstream?.path,
    payload?.projectId,
    payload?.cwd,
    payload?.cwdLabel,
  ].filter(Boolean);
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
    const summary = sidecar
      ? summaryFromSidecar(sidecar, payload)
      : fallbackSummary(payload);
    stdout.write(`${JSON.stringify(summary)}\n`);
  } catch {
    stdout.write(`${JSON.stringify(fallbackSummary(payload))}\n`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
