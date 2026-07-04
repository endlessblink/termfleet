// App-owned agent-status sidecar reading (TC-035 follow-up).
//
// The cockpit title + TASKS panel come from sidecar files written by the Claude
// status hook (`scripts/termfleet-claude-status-hook.mjs`). Historically only the
// launcher-lifetime HTTP status server could read them, so the feature silently
// died whenever the app outlived (or never had) that server — e.g. any desktop
// launch. This module ports the node worker's read/shape logic
// (`scripts/agent-status-summary-sidecar.mjs` + `scripts/lib/agent-status-paths.mjs`)
// so the app reads the files directly through a Tauri command. The file-name
// scheme MUST stay byte-identical to the node side; parity is enforced by
// `tests/agent-status-local-sidecar.spec.ts`.
import type { AgentStatusSummary, AgentStatusSummaryInput } from "./agentStatusSummary";

export function fnv(value: unknown): string {
  let hash = 2166136261;
  const text = String(value ?? "");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Browser-safe port of the hook's `normalizeCwd` (node `path.resolve` + trailing-slash
 * strip). The hook only ever writes absolute paths (a process cwd), so relative input
 * is trimmed best-effort rather than resolved.
 */
export function normalizeCwdForSidecar(cwd: unknown): string {
  if (!cwd) return "";
  const text = String(cwd);
  if (!text.startsWith("/")) return text.replace(/\/+$/, "");
  const segments: string[] = [];
  for (const part of text.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      segments.pop();
      continue;
    }
    segments.push(part);
  }
  const resolved = `/${segments.join("/")}`;
  return resolved.length > 1 ? resolved.replace(/\/+$/, "") : resolved;
}

export function paneSidecarFileName(paneId: unknown): string {
  return `pane-${fnv(String(paneId ?? ""))}.json`;
}

export function cwdSidecarFileName(cwd: unknown): string {
  return `${fnv(normalizeCwdForSidecar(cwd))}.json`;
}

const SIDECAR_TTL_MS = 30 * 60 * 1000;

export interface AgentStatusSidecar {
  updatedAt?: number;
  now?: string;
  userTask?: string;
  narration?: string;
  todos?: Array<{ id?: string; content?: string; status?: string; activeForm?: string }>;
  recent?: Array<{ text?: string; at?: number }>;
}

export function sidecarFresh(
  sidecar: AgentStatusSidecar | null | undefined,
  ttlMs: number = SIDECAR_TTL_MS,
  now: number = Date.now(),
): boolean {
  if (!sidecar || typeof sidecar.updatedAt !== "number") return false;
  return now - sidecar.updatedAt <= ttlMs;
}

function cleanText(value: unknown): string {
  return typeof value === "string"
    ? value
        .replace(/\s+/g, " ")
        .replace(/^[•*-]\s+/, "")
        .trim()
    : "";
}

function extractedItems(values: string[]) {
  const seen = new Set<string>();
  return values
    .map((value) => cleanText(value).slice(0, 180))
    .filter(Boolean)
    .map((text) => {
      const sourceHash = fnv(`summary:${text}`);
      return {
        id: `summary:${sourceHash}`,
        text,
        provenance: "summary" as const,
        at: 0,
        excerpt: text.slice(0, 240),
        sourceHash,
      };
    })
    .filter((item) => (seen.has(item.sourceHash) ? false : (seen.add(item.sourceHash), true)))
    .slice(0, 8);
}

// Encode a todo into task text whose prefix termfleet's inferStatus maps back to a
// status ("done:" → completed, "in-progress:" → in_progress); cleanTaskLineupContent
// then strips the prefix for display. Must match the node worker exactly.
function todoToTaskText(todo: NonNullable<AgentStatusSidecar["todos"]>[number]): string {
  const content = cleanText(todo?.content);
  if (!content) return "";
  if (todo?.status === "completed") return `done: ${content}`;
  if (todo?.status === "in_progress") return `in-progress: ${content}`;
  return content;
}

export function summaryFromSidecar(
  sidecar: AgentStatusSidecar,
  fallback: AgentStatusSummary,
): AgentStatusSummary {
  const todos = Array.isArray(sidecar?.todos) ? sidecar.todos : [];
  const now = cleanText(sidecar?.now);
  const active = todos.find((todo) => todo?.status === "in_progress");
  const firstOpen = todos.find((todo) => todo?.status !== "completed");
  const lastDone = [...todos].reverse().find((todo) => todo?.status === "completed");
  const working = Boolean(active);
  // Title = the agent's CURRENT task, preferring its human-readable `activeForm` over
  // the terse subject. When nothing is live (all complete), fall back to the LAST
  // completed task. NEVER fall back to `now` (momentary raw tool activity) as the
  // title; that belongs only on the activity line. (TC-033)
  const current = active ?? firstOpen;
  const currentTask =
    cleanText(current?.activeForm || current?.content) || cleanText(lastDone?.content);
  const userTask =
    cleanText(sidecar?.userTask) ||
    cleanText(fallback?.userTask) ||
    (todos.length > 0 ? cleanText(todos[0]?.content) : "");
  const activityTitle =
    currentTask || (userTask && now && now !== "Prompt submitted" ? now : "") || fallback.task;
  return {
    ...fallback,
    task: activityTitle,
    userTask: userTask || undefined,
    now: now || fallback.now,
    status: working ? "working" : todos.length > 0 ? "idle" : fallback.status,
    provider: fallback.provider,
    confidence: "high",
    tasks: extractedItems(todos.map(todoToTaskText)),
    // These ARE the agent's real task list (captured by the status hook), not
    // heuristic summary items — flag them as the authoritative `todo-write` source.
    tasksFromTodoWrite: todos.length > 0,
    narration: cleanText(sidecar?.narration).slice(0, 90) || undefined,
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

export type SidecarFileReader = (fileName: string) => Promise<string | null>;

/**
 * Candidate sidecar file names in the same precedence order as the node worker's
 * `readSidecarForPayload`: the pane-keyed file first (per-terminal status, TC-035),
 * then the cwd-keyed candidates the request body would have carried.
 */
export function sidecarCandidateFileNames(
  input: Pick<AgentStatusSummaryInput, "paneId" | "worktreePath" | "gitRoot" | "cwd" | "cwdLabel">,
): string[] {
  const names: string[] = [];
  if (input.paneId) names.push(paneSidecarFileName(input.paneId));
  const cwdCandidates = [
    input.worktreePath ?? input.gitRoot ?? input.cwd ?? input.cwdLabel,
    input.gitRoot ?? input.cwd ?? input.cwdLabel,
    input.cwd,
    input.cwdLabel,
  ].filter((value): value is string => Boolean(value));
  for (const candidate of cwdCandidates) {
    const name = cwdSidecarFileName(candidate);
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

/**
 * Read the freshest matching sidecar via the injected file reader and shape it into a
 * summary. Returns null when no fresh sidecar exists (caller falls back to the HTTP
 * endpoint or the local heuristic, exactly like the worker's fallback path).
 */
export async function readLocalSidecarSummary(
  input: AgentStatusSummaryInput,
  fallback: AgentStatusSummary,
  readFile: SidecarFileReader,
): Promise<AgentStatusSummary | null> {
  for (const name of sidecarCandidateFileNames(input)) {
    let sidecar: AgentStatusSidecar | null = null;
    try {
      const text = await readFile(name);
      if (!text) continue;
      sidecar = JSON.parse(text) as AgentStatusSidecar;
    } catch {
      continue;
    }
    if (sidecar && sidecarFresh(sidecar)) return summaryFromSidecar(sidecar, fallback);
  }
  return null;
}
