import { invoke } from "@tauri-apps/api/core";
import type { AgentProvider } from "./types";

export interface AgentProviderDefinition {
  id: AgentProvider;
  label: string;
  command?: string;
  launchMode: string;
  readinessCheck: string;
  authCheck: string;
  stopBehavior: string;
  controlProtocol: string;
  structuredStatus: boolean;
}

export interface AgentProviderAvailability extends AgentProviderDefinition {
  available: boolean;
  message: string;
}

interface AgentProviderStatusResult {
  id: AgentProvider;
  label: string;
  command?: string;
  available: boolean;
  message: string;
}

export const AGENT_PROVIDERS: Record<AgentProvider, AgentProviderDefinition> = {
  codex: {
    id: "codex",
    label: "Codex",
    command: "codex",
    launchMode: "interactive CLI",
    readinessCheck: "PATH check only; auth/session readiness is confirmed by CLI output.",
    authCheck: "CLI output scan for login, API key, OAuth, or sign-in prompts.",
    stopBehavior: "PTY interrupt/kill until provider-native cancel is available.",
    controlProtocol: "TermFleet prompt queue plus PTY Ctrl-C/kill fallback.",
    structuredStatus: false,
  },
  claude: {
    id: "claude",
    label: "Claude",
    command: "claude",
    launchMode: "interactive CLI",
    readinessCheck: "PATH check only; auth/session readiness is confirmed by CLI output.",
    authCheck: "CLI output scan for login, API key, OAuth, or sign-in prompts.",
    stopBehavior: "PTY interrupt/kill until provider-native cancel is available.",
    controlProtocol: "TermFleet prompt queue plus PTY Ctrl-C/kill fallback.",
    structuredStatus: false,
  },
  opencode: {
    id: "opencode",
    label: "OpenCode",
    command: "opencode",
    launchMode: "interactive CLI",
    readinessCheck: "PATH check only; auth/session readiness is confirmed by CLI output.",
    authCheck: "CLI output scan for login, API key, OAuth, or sign-in prompts.",
    stopBehavior: "PTY interrupt/kill until provider-native cancel is available.",
    controlProtocol: "TermFleet prompt queue plus PTY Ctrl-C/kill fallback.",
    structuredStatus: false,
  },
  shell: {
    id: "shell",
    label: "Shell",
    launchMode: "local shell",
    readinessCheck: "Built in.",
    authCheck: "Not required.",
    stopBehavior: "PTY interrupt/kill.",
    controlProtocol: "PTY input, Ctrl-C, and kill.",
    structuredStatus: false,
  },
};

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function providerDefinition(provider: AgentProvider) {
  return AGENT_PROVIDERS[provider] ?? AGENT_PROVIDERS.codex;
}

export async function checkAgentProvider(provider: AgentProvider): Promise<AgentProviderAvailability> {
  const definition = providerDefinition(provider);
  if (provider === "shell") {
    return { ...definition, available: true, message: "Built-in shell workstream" };
  }

  if (!isTauriRuntime()) {
    return {
      ...definition,
      available: true,
      message: "Browser preview simulates provider startup; desktop checks PATH before launch.",
    };
  }

  try {
    const statuses = await invoke<AgentProviderStatusResult[]>("agent_provider_statuses");
    const status = statuses.find((candidate) => candidate.id === provider);
    return status ? {
      ...definition,
      ...status,
      launchMode: "TermFleet adapter + interactive CLI",
      readinessCheck: "PATH check plus adapter-emitted structured launch signal.",
      authCheck: "Adapter launch signal plus CLI output scan for login/API-key prompts.",
      controlProtocol: "Structured lifecycle markers with PTY Ctrl-C/kill fallback.",
      structuredStatus: true,
    } : {
      ...definition,
      available: false,
      message: `${definition.command} was not checked`,
    };
  } catch (error) {
    return {
      ...definition,
      available: false,
      message: `Could not check ${definition.label}: ${String(error)}`,
    };
  }
}
