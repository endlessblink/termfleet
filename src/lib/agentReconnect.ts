import type { AgentProvider } from "./types";

export type ResumableAgentProvider = Exclude<AgentProvider, "shell">;

export interface AgentRecoveryTarget {
  provider: ResumableAgentProvider;
  sessionId: string;
}

export interface AgentReconnectDependencies {
  readRunningProvider: (paneId: string) => Promise<AgentProvider | null>;
  readRecovery: (paneId: string) => Promise<AgentRecoveryTarget | null>;
  sessionExists: (
    provider: ResumableAgentProvider,
    sessionId: string,
    paneId: string,
  ) => Promise<boolean>;
  /** Final safety gate before any resume command is injected. */
  conversationOwnedElsewhere: (
    provider: ResumableAgentProvider,
    sessionId: string,
    paneId: string,
  ) => Promise<boolean>;
  writeResumeCommand: (paneId: string, command: string) => Promise<void>;
}

export interface AgentReconnectFailure {
  paneId: string;
  reason: string;
}

export interface AgentReconnectResult {
  resumed: string[];
  alreadyRunning: string[];
  missingRecovery: string[];
  missingSession: string[];
  /** Live agent owns this conversation in another pane; resuming would collide. */
  ownedElsewhere: string[];
  failed: AgentReconnectFailure[];
}

export function formatAgentReconnectResult(result: AgentReconnectResult): string {
  const parts = [
    result.resumed.length ? `${result.resumed.length} resumed` : "",
    result.alreadyRunning.length
      ? `${result.alreadyRunning.length} already running`
      : "",
    result.missingRecovery.length
      ? `${result.missingRecovery.length} missing path`
      : "",
    result.missingSession.length
      ? `${result.missingSession.length} missing locally`
      : "",
    result.ownedElsewhere.length
      ? `${result.ownedElsewhere.length} still open elsewhere`
      : "",
    result.failed.length ? `${result.failed.length} failed` : "",
  ].filter(Boolean);
  return parts.join(" · ") || "No agent panes found";
}

const SAFE_SESSION_ID = /^[A-Za-z0-9_-]{8,160}$/;

export function agentReconnectCommand(target: AgentRecoveryTarget): string {
  switch (target.provider) {
    case "codex":
      return `codex resume ${target.sessionId}`;
    case "claude":
      return `claude --resume ${target.sessionId}`;
    case "opencode":
      return `opencode --session ${target.sessionId}`;
  }
}

function resumeCommand(target: AgentRecoveryTarget): string {
  return `exec ${agentReconnectCommand(target)}\n`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message.trim()
    : "Reconnect failed";
}

export async function reconnectStoppedAgents(
  paneIds: string[],
  dependencies: AgentReconnectDependencies,
): Promise<AgentReconnectResult> {
  const result: AgentReconnectResult = {
    resumed: [],
    alreadyRunning: [],
    missingRecovery: [],
    missingSession: [],
    ownedElsewhere: [],
    failed: [],
  };

  for (const paneId of [...new Set(paneIds.filter(Boolean))]) {
    try {
      if (await dependencies.readRunningProvider(paneId)) {
        result.alreadyRunning.push(paneId);
        continue;
      }

      const recovery = await dependencies.readRecovery(paneId);
      if (!recovery) {
        result.missingRecovery.push(paneId);
        continue;
      }
      if (!SAFE_SESSION_ID.test(recovery.sessionId)) {
        result.failed.push({
          paneId,
          reason: "Invalid saved conversation id",
        });
        continue;
      }
      if (
        !(await dependencies.sessionExists(
          recovery.provider,
          recovery.sessionId,
          paneId,
        ))
      ) {
        result.missingSession.push(paneId);
        continue;
      }
      // Last gate before we type into the terminal. Never inject a resume for a
      // conversation that still has a live owner: the provider rejects it, and
      // an overlap corrupts the transcript.
      if (
        await dependencies.conversationOwnedElsewhere(
          recovery.provider,
          recovery.sessionId,
          paneId,
        )
      ) {
        result.ownedElsewhere.push(paneId);
        continue;
      }

      await dependencies.writeResumeCommand(paneId, resumeCommand(recovery));
      result.resumed.push(paneId);
    } catch (error) {
      result.failed.push({ paneId, reason: errorMessage(error) });
    }
  }

  return result;
}
