import type { AgentProvider } from "./types";

export type ResumableAgentProvider = Exclude<AgentProvider, "shell">;

export interface AgentRecoveryTarget {
  provider: ResumableAgentProvider;
  sessionId: string;
}

export interface AgentRuntimeIdentity {
  provider: ResumableAgentProvider;
  sessionId: string | null;
}

export interface AgentConversationOwner extends AgentRecoveryTarget {
  providerPid: number;
  daemonPaneId: string;
  daemonRootPid: number;
}

export interface AgentReconnectDependencies {
  readRunningIdentity: (paneId: string) => Promise<AgentRuntimeIdentity | null>;
  readRecovery: (paneId: string) => Promise<AgentRecoveryTarget | null>;
  sessionExists: (
    provider: ResumableAgentProvider,
    sessionId: string,
    paneId: string,
  ) => Promise<boolean>;
  /** Resolve the exact live daemon owner before a saved surface is attached. */
  conversationOwner?: (
    provider: ResumableAgentProvider,
    sessionId: string,
    paneId: string,
  ) => Promise<AgentConversationOwner | null>;
  rebindOwnedConversation?: (
    paneId: string,
    target: AgentRecoveryTarget,
    owner: AgentConversationOwner,
  ) => Promise<boolean>;
  confirmExactConversation: (
    paneId: string,
    target: AgentRecoveryTarget,
  ) => Promise<boolean>;
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
  /**
   * The saved conversation is dormant — nothing owns it any more. It is never
   * typed into a live terminal; the daemon respawns the pane straight into its
   * own resume process on the next cold restore.
   */
  pendingColdRestore: string[];
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
    result.pendingColdRestore.length
      ? `${result.pendingColdRestore.length} reconnect on relaunch`
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
    pendingColdRestore: [],
    failed: [],
  };
  const claimedConversations = new Set<string>();
  const pendingConfirmations: Array<{
    paneId: string;
    recovery: AgentRecoveryTarget;
    alreadyRunning: boolean;
  }> = [];

  for (const paneId of [...new Set(paneIds.filter(Boolean))]) {
    try {
      const recovery = await dependencies.readRecovery(paneId);
      if (!recovery) {
        result.missingRecovery.push(paneId);
        continue;
      }

      const runningIdentity = await dependencies.readRunningIdentity(paneId);
      if (
        runningIdentity?.provider === recovery.provider &&
        runningIdentity.sessionId === recovery.sessionId
      ) {
        pendingConfirmations.push({
          paneId,
          recovery,
          alreadyRunning: true,
        });
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
      const conversationKey = `${recovery.provider}:${recovery.sessionId}`;
      if (claimedConversations.has(conversationKey)) {
        result.failed.push({
          paneId,
          reason: "Saved conversation is assigned to more than one pane",
        });
        continue;
      }

      // Recovery attaches to a daemon-owned live conversation. It never writes a
      // provider resume command: Codex and Claude reject or corrupt duplicate
      // writers, and an idle placeholder is not the conversation we are saving.
      const owner = await dependencies.conversationOwner?.(
        recovery.provider,
        recovery.sessionId,
        paneId,
      );
      if (owner) {
        if (await dependencies.rebindOwnedConversation?.(paneId, recovery, owner)) {
          claimedConversations.add(conversationKey);
          result.alreadyRunning.push(paneId);
        } else {
          result.ownedElsewhere.push(paneId);
        }
        continue;
      }
      if (runningIdentity) {
        result.failed.push({
          paneId,
          reason: "Pane is running a different agent conversation",
        });
        continue;
      }

      // A dormant conversation is never typed back into a live terminal: the
      // daemon respawns the pane straight into its own `codex resume` /
      // `claude --resume` process on cold restore, so the pane reconnects once
      // and the scrollback stays free of injected resume commands.
      result.pendingColdRestore.push(paneId);
    } catch (error) {
      result.failed.push({ paneId, reason: errorMessage(error) });
    }
  }

  await Promise.all(
    pendingConfirmations.map(async ({ paneId, recovery, alreadyRunning }) => {
      try {
        if (await dependencies.confirmExactConversation(paneId, recovery)) {
          (alreadyRunning ? result.alreadyRunning : result.resumed).push(paneId);
        } else {
          result.failed.push({
            paneId,
            reason: alreadyRunning
              ? "Existing exact conversation did not remain live"
              : "Exact saved conversation did not remain live",
          });
        }
      } catch (error) {
        result.failed.push({ paneId, reason: errorMessage(error) });
      }
    }),
  );

  return result;
}
