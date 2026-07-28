import { invoke } from "@tauri-apps/api/core";
import {
  cleanTranscriptForSummary,
  fallbackAgentStatusSummary,
  parseAgentStatusSummaryResponse,
  type AgentStatusSummary,
  type AgentStatusSummaryInput,
} from "./agentStatusSummary";
import {
  readLocalSidecarStatus,
  sidecarCompletedByCommand,
  type AgentStatusSidecar,
  type SidecarFileReader,
} from "./agentStatusSidecar";
import { parseOpeningRequest, parseTranscript } from "./sessionTranscript";
import { resolvePaneTaskLine, type PaneTaskLine } from "./taskLine";
import { stripComposerChrome } from "./terminalHeaderQuality";

export interface AgentStatusSummarizerResult {
  summary: AgentStatusSummary;
  // "sidecar" = the agent's REAL task list read straight from the status file —
  // authoritative; "process" = the HTTP status worker; "fallback" = local heuristic.
  source: "fallback" | "process" | "sidecar";
  sidecarState?: "fresh" | "stale" | "missing" | "error";
  error?: string;
  // TC-060: an always-true, plain-language line for this pane, resolved from the
  // agent's declared task, the vendor's own session record, or the running process.
  taskLine?: PaneTaskLine;
}

export interface AgentStatusSummarizerOptions {
  endpoint?: string;
  fetcher?: typeof fetch;
  // Injectable sidecar file reader (tests). `null` disables the local sidecar path;
  // undefined uses the Tauri command when running in the desktop app.
  sidecarReader?: SidecarFileReader | null;
  // Injectable vendor session-record reader. Same seam as `sidecarReader`, and for the
  // same reason: without it the transcript rungs of the ladder can only run inside the
  // desktop app, so a regression there is invisible to every test — which is how panes
  // whose own session record named the work still rendered "No task declared".
  transcriptReader?: SessionTranscriptReader | null;
}

export type SessionTranscriptReader = (
  provider: "claude" | "codex",
  sessionId: string,
  /** "tail" = what is happening now; "head" = the operator's opening request. */
  part?: "head" | "tail",
) => Promise<string | null>;

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

// Read a sidecar file through the Rust backend (works in EVERY launch mode — desktop
// double-click included). The HTTP status server is only an optional override now
// (browser preview, opt-in Ollama worker); it previously was the ONLY reader, so the
// title/TASKS feature died whenever the app outlived the launcher that started it.
function tauriSidecarReader(): SidecarFileReader | null {
  if (!isTauriRuntime()) return null;
  return async (fileName) => {
    const text = await invoke<string | null>("agent_status_read_sidecar", {
      fileName,
    });
    return typeof text === "string" ? text : null;
  };
}

function tauriTranscriptReader(): SessionTranscriptReader | null {
  if (!isTauriRuntime()) return null;
  return async (provider, sessionId, part = "tail") => {
    const text = await invoke<string | null>(
      part === "head" ? "session_transcript_head_read" : "session_transcript_read",
      { provider, sessionId },
    );
    return typeof text === "string" ? text : null;
  };
}

/**
 * The opening request never changes, so it is read ONCE per session and then reused —
 * otherwise every pane would re-read the start of its record on every poll.
 * `null` records "this session has no usable opening line", so it is not retried either.
 */
const openingRequestBySession = new Map<string, string | null>();
const OPENING_CACHE_LIMIT = 500;

async function openingRequestFor(
  provider: "claude" | "codex",
  sessionId: string,
  readTranscript: SessionTranscriptReader,
): Promise<string | undefined> {
  const key = `${provider}:${sessionId}`;
  const cached = openingRequestBySession.get(key);
  if (cached !== undefined) return cached ?? undefined;
  let opening: string | undefined;
  try {
    const head = await readTranscript(provider, sessionId, "head");
    if (typeof head === "string" && head)
      opening = parseOpeningRequest(provider, head);
  } catch {
    // Same rule as the tail: fewer facts, never an error on screen.
  }
  if (openingRequestBySession.size > OPENING_CACHE_LIMIT) {
    const oldest = openingRequestBySession.keys().next();
    if (!oldest.done) openingRequestBySession.delete(oldest.value);
  }
  openingRequestBySession.set(key, opening ?? null);
  return opening;
}

function configuredEndpoint() {
  const env = (
    import.meta as ImportMeta & { env?: Record<string, string | undefined> }
  ).env;
  const explicit = env?.VITE_AGENT_STATUS_SUMMARY_ENDPOINT?.trim();
  if (explicit) return explicit;
  return "";
}

export function isAgentStatusSummarizerConfigured() {
  return Boolean(configuredEndpoint()) || isTauriRuntime();
}

function shortError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").trim().slice(0, 180);
}

function buildRequestBody(
  input: AgentStatusSummaryInput,
  fallbackOverride?: AgentStatusSummary,
) {
  const fallback = fallbackOverride ?? fallbackAgentStatusSummary(input);
  const transcript = cleanTranscriptForSummary(input.terminalOutput, 1800);
  return {
    type: "agent-workstream-status",
    promptVersion: "terminal-status-v2-tiny",
    instructions: [
      "Return compact JSON for a terminal cockpit.",
      "Use the heuristicCandidate unless the transcript clearly improves it.",
      "Ignore prompts, model names, spinners, esc-to-interrupt, repeated commands, and chrome.",
      "Describe only visible/current activity. Never overclaim.",
      "Keep task/path/now short, plain, and free of bullets.",
      "Also return arrays named tasks, blockers, evidence, and nextActions for reviewable cockpit rows.",
      "Each extracted array item can be a string or {text, excerpt}; exclude prompt chrome and repeated instructions.",
    ],
    projectId: input.gitRoot ?? input.cwd ?? input.cwdLabel ?? "workspace",
    // Per-terminal status key (TC-035): the worker prefers the pane-keyed sidecar
    // when this is set, so same-cwd terminals don't share one status file.
    paneId: input.paneId,
    transcript,
    transcriptWindow: "visible grid snapshot plus recent transcript tail",
    heuristicCandidate: fallback,
    workstream: {
      mission: input.mission,
      prompt: input.prompt,
      userTask: input.userTask,
      provider: input.provider,
      status: input.status,
      phase: input.phase,
      path: input.worktreePath ?? input.gitRoot ?? input.cwd ?? input.cwdLabel,
      branch: input.gitBranch,
      currentActivity: input.currentActivity,
      lastSummary: input.lastSummary,
      nextAction: input.nextAction,
      evidence: input.evidence,
      risk: input.risk,
      events: input.events,
    },
    schema: {
      task: "string",
      path: "string",
      now: "string",
      status: "working | idle | waiting | blocked | stopped | done",
      provider: "codex | claude | opencode | shell",
      confidence: "low | medium | high",
      proof: "optional string",
      blocker: "optional string",
      tasks: "array of extracted task strings or { text, excerpt }",
      blockers: "array of extracted blocker strings or { text, excerpt }",
      evidence:
        "array of extracted proof/evidence strings or { text, excerpt }",
      nextActions:
        "array of extracted next-action strings or { text, excerpt }",
    },
    examples: [
      {
        transcript: "cargo test\\nRunning 15 tests\\ntest renderer ... FAILED",
        summary: {
          task: "Running tests",
          path: "project",
          now: "renderer test failed",
          status: "working",
          provider: input.provider ?? "shell",
          confidence: "high",
        },
      },
      {
        transcript:
          "gpt-5.5 default · ~\\n› Use /skills to list available skills",
        summary: {
          task: "Shell ready",
          path: "workspace",
          now: "Awaiting command",
          status: "idle",
          provider: input.provider ?? "shell",
          confidence: "low",
        },
      },
    ],
  };
}

async function responseText(response: Response) {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `status summarizer returned ${response.status}: ${text.slice(0, 120)}`,
    );
  }
  return text;
}

/**
 * TC-060. Build this pane's always-true line.
 *
 * The vendor session records are written by Claude Code / Codex themselves with no
 * hook involvement, so this works for hand-started and long-running panes — the
 * class that used to render "Task not captured". The read is a best-effort probe:
 * any failure simply yields fewer facts, and the ladder falls through to a rung
 * that cannot fail.
 */
async function resolveTaskLineFor(
  input: AgentStatusSummaryInput,
  sidecar: AgentStatusSidecar | null,
  // An expired record may still answer "what is this terminal about" (goal, session
  // plan, last finished step) but may NOT answer "what is it doing right now" — the
  // in-progress step is the one rung that goes stale with the record.
  expired = false,
  readTranscript: SessionTranscriptReader | null = null,
): Promise<PaneTaskLine> {
  let facts = null;
  const sessionId =
    typeof sidecar?.sessionId === "string" ? sidecar.sessionId : "";
  if (readTranscript && /^[0-9a-f][0-9a-f-]{7,63}$/i.test(sessionId)) {
    // `provider` is absent on most sidecars, so try both records and let the id decide.
    for (const provider of ["claude", "codex"] as const) {
      try {
        const text = await readTranscript(provider, sessionId, "tail");
        if (typeof text === "string" && text) {
          facts = parseTranscript(provider, text);
          const opening = await openingRequestFor(
            provider,
            sessionId,
            readTranscript,
          );
          if (opening) facts = { ...facts, openingRequest: opening };
          break;
        }
      } catch {
        // A changed vendor layout is not an error worth surfacing — fall through.
      }
    }
  }
  const todos = sidecar?.todos ?? [];
  const activeTodo = todos.find((todo) => todo?.status === "in_progress");
  // The most recent COMPLETED step — for an agent that finished and went idle,
  // "what it just did" beats "sitting at a prompt".
  const lastCompleted = [...todos]
    .reverse()
    .find((todo) => todo?.status === "completed");
  const cwd = sidecar?.cwd ?? input.cwd ?? input.cwdLabel ?? null;
  // The Task row answers "what is being done in relation to what the USER asked for"
  // (operator, 2026-07-25). The sidecar has carried that ask all along — 201 of 241
  // live records have a `userTask` — and this resolver never read it, so a pane with
  // no usable todo list fell straight to the folder template.
  const sidecarUserTask =
    typeof sidecar?.userTask === "string"
      ? stripComposerChrome(sidecar.userTask)
      : "";
  const effectiveFacts =
    sidecarUserTask && !facts?.operatorRequest
      ? { ...(facts ?? {}), operatorRequest: sidecarUserTask }
      : facts;
  return resolvePaneTaskLine({
    now: Date.now(),
    // The overarching goal leads the line; the in-progress todo is only the step.
    mainGoal: sidecar?.mainTask ?? null,
    currentStep: expired
      ? null
      : // `||`, not `??`: the hooks write `activeForm: ""` when the agent gave none, and
        // `??` treats that empty string as a value — so the step text was replaced by
        // nothing and the row fell to a placeholder while the task list named the work
        // (live report 2026-07-26). agentStatusSidecar.ts had this right all along.
        activeTodo?.activeForm || activeTodo?.content || null,
    facts: effectiveFacts,
    lastCompletedTask:
      lastCompleted?.activeForm || lastCompleted?.content || null,
    // The agent's own newest note. `narration` is the sentence it wrote about the work;
    // `recent` is the activity trail. Both were only ever used for the activity row, so
    // a pane with plenty to say still fell to the placeholder.
    recentActivity: expired
      ? null
      : (sidecar?.narration ??
        [...(sidecar?.recent ?? [])].reverse().find((entry) => entry?.text)
          ?.text ??
        null),
    folder: cwd ? (cwd.split("/").filter(Boolean).pop() ?? null) : null,
  });
}

/**
 * The pane's task line, resolved from the local records alone.
 *
 * `summarizeAgentStatus` only runs for a pane whose runtime is currently on screen
 * (`isRuntimeVisible` in `Terminal.tsx`), and the line is not part of the persisted
 * snapshot, so every other pane — most cards on the operations map, and every card in
 * the first seconds after a relaunch — had no line at all and its header printed the
 * placeholder. This entry point is the cheap one the workspace-wide sweep uses: local
 * file reads only, no HTTP, no summary shaping.
 */
export async function resolvePaneTaskLineFromDisk(
  input: AgentStatusSummaryInput,
  options: Pick<
    AgentStatusSummarizerOptions,
    "sidecarReader" | "transcriptReader"
  > = {},
): Promise<{ taskLine: PaneTaskLine; sidecarUpdatedAt: number } | null> {
  const sidecarReader =
    options.sidecarReader === null
      ? null
      : (options.sidecarReader ?? tauriSidecarReader());
  if (!sidecarReader) return null;
  const transcriptReader =
    options.transcriptReader === null
      ? null
      : (options.transcriptReader ?? tauriTranscriptReader());
  const fallback = fallbackAgentStatusSummary(input);
  let lookup;
  try {
    lookup = await readLocalSidecarStatus(input, fallback, sidecarReader);
  } catch {
    return null;
  }
  const taskLine = await resolveTaskLineFor(
    input,
    lookup.sidecar ?? null,
    lookup.state === "stale",
    transcriptReader,
  );
  return {
    taskLine,
    sidecarUpdatedAt: Number(lookup.sidecar?.updatedAt ?? 0),
  };
}

export async function summarizeAgentStatus(
  input: AgentStatusSummaryInput,
  options: AgentStatusSummarizerOptions = {},
): Promise<AgentStatusSummarizerResult> {
  const fallback = fallbackAgentStatusSummary(input);

  // Local sidecar first: the agent's REAL task list, read directly from disk via the
  // Rust backend — no helper process to babysit. Same shaping as the node worker.
  const sidecarReader =
    options.sidecarReader === null
      ? null
      : (options.sidecarReader ?? tauriSidecarReader());
  let sidecarShapedFallback: AgentStatusSummary | null = null;
  let sidecarState: AgentStatusSummarizerResult["sidecarState"];
  let rawSidecar: AgentStatusSidecar | null = null;
  if (sidecarReader) {
    try {
      const lookup = await readLocalSidecarStatus(
        input,
        fallback,
        sidecarReader,
      );
      sidecarState = lookup.state;
      rawSidecar = lookup.sidecar ?? null;
      const shaped = lookup.summary;
      if (shaped)
        sidecarShapedFallback = parseAgentStatusSummaryResponse(
          JSON.stringify(shaped),
          fallback,
        );
    } catch {
      sidecarState = "error";
      // Sidecar read failed → fall through to the endpoint / heuristic fallback.
    }
  }

  const transcriptReader =
    options.transcriptReader === null
      ? null
      : (options.transcriptReader ?? tauriTranscriptReader());
  const taskLine = await resolveTaskLineFor(
    input,
    rawSidecar,
    sidecarState === "stale",
    transcriptReader,
  );

  const effectiveFallback = sidecarShapedFallback ??
    (rawSidecar && sidecarCompletedByCommand(rawSidecar)
      ? { ...fallback, completedByCommand: true }
      : fallback);
  const endpoint = options.endpoint ?? configuredEndpoint();
  if (!endpoint) {
    return {
      summary: effectiveFallback,
      source: sidecarShapedFallback ? "sidecar" : "fallback",
      sidecarState,
      taskLine,
    };
  }

  try {
    const fetcher = options.fetcher ?? fetch;
    const response = await fetcher(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildRequestBody(input, effectiveFallback)),
    });
    const text = await responseText(response);
    const parsedSummary = parseAgentStatusSummaryResponse(
      text,
      effectiveFallback,
    );
    const summary = sidecarShapedFallback?.tasksFromTodoWrite
      ? {
          ...parsedSummary,
          task: sidecarShapedFallback.task,
          userTask: sidecarShapedFallback.userTask,
          now: sidecarShapedFallback.now,
          status: sidecarShapedFallback.status,
          tasks: sidecarShapedFallback.tasks,
          tasksFromTodoWrite: true,
        }
      : parsedSummary;
    // The line rides on EVERY return path. It used to be attached only to the
    // no-endpoint branch, so any launch that configured the optional status worker
    // dropped the ladder line for every pane and the header fell back to its own
    // factless re-resolve — i.e. "No task declared".
    return { summary, source: "process", sidecarState, taskLine };
  } catch (error) {
    return {
      summary: effectiveFallback,
      source: sidecarShapedFallback ? "sidecar" : "fallback",
      sidecarState,
      error: shortError(error),
      taskLine,
    };
  }
}
