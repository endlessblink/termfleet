import { invoke } from "@tauri-apps/api/core";
import type { AgentProvider } from "./types";

/**
 * Which agent is RUNNING in a pane right now, read from the process table by the
 * app (`pane_agent_provider`).
 *
 * Every other provider signal needs something to have gone right first: a launch
 * through TermFleet's agent button (records the command), or a vendor hook/plugin
 * (writes the status sidecar, and only after the agent starts). An operator who
 * simply types `opencode` in a shell gets neither — which is exactly how people
 * actually work. This asks the operating system instead, so a hand-started agent is
 * recognised with no setup, no restart, and no cooperation from the agent.
 */
const KNOWN_PROVIDERS = new Set<AgentProvider>(["opencode", "claude", "codex"]);

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function asAgentProvider(value: unknown): AgentProvider | null {
  return typeof value === "string" &&
    KNOWN_PROVIDERS.has(value as AgentProvider)
    ? (value as AgentProvider)
    : null;
}

export async function readPaneAgentProvider(
  paneId: string,
): Promise<AgentProvider | null> {
  if (!paneId || !isTauriRuntime()) return null;
  try {
    return asAgentProvider(
      await invoke<string | null>("pane_agent_provider", { paneId }),
    );
  } catch {
    // Detection is an enhancement: never let it surface as a terminal error.
    return null;
  }
}

/**
 * How often to re-ask while a pane is still unidentified. The operator can start an
 * agent at any moment (that is the whole point), so this keeps polling — cheaply,
 * since the backend serves all panes from one short-lived process-table scan.
 */
export const PANE_AGENT_POLL_MS = 4000;
