import { invoke } from "@tauri-apps/api/core";
import {
  cleanTranscriptForSummary,
  fallbackAgentStatusSummary,
  parseAgentStatusSummaryResponse,
  type AgentStatusSummary,
  type AgentStatusSummaryInput,
} from "./agentStatusSummary";
import { readLocalSidecarSummary, type SidecarFileReader } from "./agentStatusSidecar";

export interface AgentStatusSummarizerResult {
  summary: AgentStatusSummary;
  // "sidecar" = the agent's REAL task list read straight from the status file —
  // authoritative; "process" = the HTTP status worker; "fallback" = local heuristic.
  source: "fallback" | "process" | "sidecar";
  error?: string;
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
    const text = await invoke<string | null>("agent_status_read_sidecar", { fileName });
    return typeof text === "string" ? text : null;
  };
}

const DEFAULT_AGENT_STATUS_SUMMARY_ENDPOINT = "http://127.0.0.1:37819/status";

function configuredEndpoint() {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  const explicit = env?.VITE_AGENT_STATUS_SUMMARY_ENDPOINT?.trim();
  if (explicit) return explicit;
  if (typeof window !== "undefined" && window.location.port !== "1420") return "";
  return DEFAULT_AGENT_STATUS_SUMMARY_ENDPOINT;
}

export function isAgentStatusSummarizerConfigured() {
  return Boolean(configuredEndpoint()) || isTauriRuntime();
}

function shortError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").trim().slice(0, 180);
}

function buildRequestBody(input: AgentStatusSummaryInput) {
  const fallback = fallbackAgentStatusSummary(input);
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
      evidence: "array of extracted proof/evidence strings or { text, excerpt }",
      nextActions: "array of extracted next-action strings or { text, excerpt }",
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
        transcript: "gpt-5.5 default · ~\\n› Use /skills to list available skills",
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
    throw new Error(`status summarizer returned ${response.status}: ${text.slice(0, 120)}`);
  }
  return text;
}

export async function summarizeAgentStatus(
  input: AgentStatusSummaryInput,
  options: AgentStatusSummarizerOptions = {}
): Promise<AgentStatusSummarizerResult> {
  const fallback = fallbackAgentStatusSummary(input);

  // Local sidecar first: the agent's REAL task list, read directly from disk via the
  // Rust backend — no helper process to babysit. Same shaping as the node worker.
  const sidecarReader = options.sidecarReader === null ? null : options.sidecarReader ?? tauriSidecarReader();
  if (sidecarReader) {
    try {
      const shaped = await readLocalSidecarSummary(input, fallback, sidecarReader);
      if (shaped) {
        return {
          summary: parseAgentStatusSummaryResponse(JSON.stringify(shaped), fallback),
          source: "sidecar",
        };
      }
    } catch {
      // Sidecar read failed → fall through to the endpoint / heuristic fallback.
    }
  }

  const endpoint = options.endpoint ?? configuredEndpoint();
  if (!endpoint) {
    return { summary: fallback, source: "fallback" };
  }

  try {
    const fetcher = options.fetcher ?? fetch;
    const response = await fetcher(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildRequestBody(input)),
    });
    const text = await responseText(response);
    const summary = parseAgentStatusSummaryResponse(text, fallback);
    return { summary, source: "process" };
  } catch (error) {
    return {
      summary: fallback,
      source: "fallback",
      error: shortError(error),
    };
  }
}
