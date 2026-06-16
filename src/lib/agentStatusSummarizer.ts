import {
  fallbackAgentStatusSummary,
  parseAgentStatusSummaryResponse,
  type AgentStatusSummary,
  type AgentStatusSummaryInput,
} from "./agentStatusSummary";

export interface AgentStatusSummarizerResult {
  summary: AgentStatusSummary;
  source: "fallback" | "process";
  error?: string;
}

export interface AgentStatusSummarizerOptions {
  endpoint?: string;
  fetcher?: typeof fetch;
}

function configuredEndpoint() {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return env?.VITE_AGENT_STATUS_SUMMARY_ENDPOINT?.trim();
}

export function isAgentStatusSummarizerConfigured() {
  return Boolean(configuredEndpoint());
}

function shortError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").trim().slice(0, 180);
}

function buildRequestBody(input: AgentStatusSummaryInput) {
  return {
    type: "agent-workstream-status",
    projectId: input.gitRoot ?? input.cwd ?? input.cwdLabel ?? "workspace",
    transcript: input.terminalOutput ?? "",
    workstream: {
      mission: input.mission,
      prompt: input.prompt,
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
    },
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
