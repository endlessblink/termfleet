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
  /**
   * Is this conversation already owned by a live agent in a DIFFERENT pane?
   *
   * `readRunningProvider` only answers "is an agent running in *this* pane",
   * which is not enough: the pane can be an empty shell while the original
   * agent is still alive elsewhere (a rebuilt window leaves the old agent
   * running, because the PTY daemon deliberately survives a window replace).
   * Writing a resume in that state makes the provider reject it with
   * "already has an active writer", and when both writers briefly overlap the
   * transcript gets a duplicated record — permanent history corruption that
   * breaks forking the conversation. Verified on 2026-08-12.
   *
   * Optional so existing callers keep working; when absent the check is skipped.
   */
  conversationOwnedElsewhere?: (
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
        await dependencies.conversationOwnedElsewhere?.(
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
