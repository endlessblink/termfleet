import { invoke } from "@tauri-apps/api/core";

// "Connect agents": registers the bundled status hooks for Claude Code, Codex, and
// OpenCode so their panes report a Task line and a true Running/Waiting/Idle badge.

export const CONNECT_AGENTS_EVENT = "termfleet:connect-agents";

export type AgentConnectState = "connected" | "not-connected" | "absent" | "blocked" | "error";

export interface AgentConnectSummary {
  ok: boolean;
  connected: number;
  needed: number;
  results: Array<{ agent: string; state: AgentConnectState; detail: string }>;
}

/** Agents that are installed for this user but not connected to TermFleet yet. */
export function agentsNeedingConnection(summary: AgentConnectSummary | null) {
  return (summary?.results ?? [])
    .filter((item) => item.state === "not-connected")
    .map((item) => item.agent);
}

export function agentConnectResultText(summary: AgentConnectSummary) {
  const names: Record<string, string> = { claude: "Claude Code", codex: "Codex", opencode: "OpenCode" };
  const connected = summary.results
    .filter((item) => item.state === "connected")
    .map((item) => names[item.agent] ?? item.agent);
  const problems = summary.results.filter((item) => item.state === "blocked" || item.state === "error");
  if (problems.length) return problems.map((item) => item.detail).join(" · ");
  if (!connected.length) return "No Claude Code, Codex, or OpenCode setup found for this user";
  return `Connected: ${connected.join(", ")}. New agent sessions will report their status.`;
}

export async function runAgentConnect(check: boolean): Promise<AgentConnectSummary> {
  const raw = await invoke<string>("agents_connect", { check });
  return JSON.parse(raw) as AgentConnectSummary;
}
