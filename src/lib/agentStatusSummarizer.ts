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
  type AgentStatusSidecar,
  type SidecarFileReader,
} from "./agentStatusSidecar";
import { parseTranscript } from "./sessionTranscript";
import { resolvePaneTaskLine, type PaneTaskLine } from "./taskLine";

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
}

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
): Promise<PaneTaskLine> {
  let facts = null;
  const sessionId =
    typeof sidecar?.sessionId === "string" ? sidecar.sessionId : "";
  if (isTauriRuntime() && /^[0-9a-f][0-9a-f-]{7,63}$/i.test(sessionId)) {
    // `provider` is absent on most sidecars, so try both records and let the id decide.
    for (const provider of ["claude", "codex"] as const) {
      try {
        const text = await invoke<string | null>("session_transcript_read", {
          provider,
          sessionId,
        });
        if (typeof text === "string" && text) {
          facts = parseTranscript(provider, text);
          break;
        }
      } catch {
        // A changed vendor layout is not an error worth surfacing — fall through.
      }
    }
  }
  const activeTodo = (sidecar?.todos ?? []).find(
    (todo) => todo?.status === "in_progress",
  );
  const cwd = sidecar?.cwd ?? input.cwd ?? input.cwdLabel ?? null;
  return resolvePaneTaskLine({
    now: Date.now(),
    declaredTask:
      sidecar?.mainTask ??
      activeTodo?.activeForm ??
      activeTodo?.content ??
      null,
    facts,
    folder: cwd ? (cwd.split("/").filter(Boolean).pop() ?? null) : null,
  });
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

  const taskLine = await resolveTaskLineFor(input, rawSidecar);

  const effectiveFallback = sidecarShapedFallback ?? fallback;
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
    return { summary, source: "process", sidecarState };
  } catch (error) {
    return {
      summary: effectiveFallback,
      source: sidecarShapedFallback ? "sidecar" : "fallback",
      sidecarState,
      error: shortError(error),
    };
  }
}
