import type { AgentProvider } from "./types";

export function agentProviderIdentity(provider?: AgentProvider | string | null): string | null {
  if (provider === "codex") return "GPT";
  if (provider === "claude") return "CLAUDE";
  if (provider === "opencode") return "OPENCODE";
  return null;
}

export function stableAgentProvider(
  current?: AgentProvider | null,
  incoming?: AgentProvider | null,
): AgentProvider | undefined {
  if (incoming && incoming !== "shell") return incoming;
  if (current && current !== "shell") return current;
  return undefined;
}
