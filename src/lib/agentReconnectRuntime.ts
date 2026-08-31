import { invoke } from "@tauri-apps/api/core";
import type { Tab } from "./types";
import {
  reconnectStoppedAgents,
  type AgentReconnectResult,
  type AgentConversationOwner,
  type AgentRecoveryTarget,
  type AgentRuntimeIdentity,
} from "./agentReconnect";
import {
  normalizeCwdForSidecar,
  paneSidecarFileName,
  type AgentStatusSidecar,
} from "./agentStatusSidecar";
import { readPaneAgentProvider } from "./paneAgentProcess";
import { getPaneCwd } from "./splitUtils";
import { rebindSavedPaneToLiveOwner } from "../stores/workspace";

interface SavedPaneReconnectTarget {
  daemonSessionId: string;
  runtimeSessionId: string;
  paneId: string;
  providerSessionId: string | null;
  cwd: string;
}

type TranscriptBackedProvider = Extract<
  AgentRecoveryTarget["provider"],
  "codex" | "claude"
>;

interface PaneAgentRuntimeInfo {
  provider: string;
  providerSessionId: string;
}

interface BackendConversationOwner {
  provider: string;
  providerSessionId: string;
  providerPid: number;
  daemonPaneId: string;
  daemonRootPid: number;
}

interface PersistedRecoveryRecord {
  id: string;
  provider?: string | null;
  providerSessionId?: string | null;
}

interface LiveDaemonSession {
  id: string;
  pid?: number | null;
  lastExit?: number | null;
}

const EXACT_RUNTIME_CONFIRM_TIMEOUT_MS = 8_000;
const EXACT_RUNTIME_STABLE_MS = 750;
const EXACT_RUNTIME_POLL_MS = 150;

function sameExactOwner(
  first: BackendConversationOwner,
  second: BackendConversationOwner,
): boolean {
  return (
    first.provider === second.provider &&
    first.providerSessionId === second.providerSessionId &&
    first.providerPid === second.providerPid &&
    first.daemonPaneId === second.daemonPaneId &&
    first.daemonRootPid === second.daemonRootPid
  );
}

function isExactOwner(
  owner: BackendConversationOwner | null,
  target: AgentRecoveryTarget,
): owner is BackendConversationOwner {
  return Boolean(
    owner &&
      owner.provider === target.provider &&
      owner.providerSessionId === target.sessionId &&
      owner.daemonPaneId &&
      Number.isInteger(owner.providerPid) &&
      owner.providerPid > 0 &&
      Number.isInteger(owner.daemonRootPid) &&
      owner.daemonRootPid > 0,
  );
}

async function readStableExactConversationOwner(
  target: AgentRecoveryTarget,
  expected?: AgentConversationOwner,
): Promise<BackendConversationOwner | null> {
  const first = expected
    ? {
        provider: expected.provider,
        providerSessionId: expected.sessionId,
        providerPid: expected.providerPid,
        daemonPaneId: expected.daemonPaneId,
        daemonRootPid: expected.daemonRootPid,
      }
    : await invoke<BackendConversationOwner | null>(
        "agent_conversation_owner",
        { provider: target.provider, sessionId: target.sessionId },
      );
  if (!isExactOwner(first, target)) return null;

  await new Promise((resolve) => window.setTimeout(resolve, EXACT_RUNTIME_POLL_MS));
  const second = await invoke<BackendConversationOwner | null>(
    "agent_conversation_owner",
    { provider: target.provider, sessionId: target.sessionId },
  );
  if (!isExactOwner(second, target) || !sameExactOwner(first, second)) return null;

  const sessions = await invoke<LiveDaemonSession[]>("daemon_list_sessions");
  return sessions.some(
    (session) =>
      session.id === second.daemonPaneId &&
      session.pid === second.daemonRootPid &&
      session.lastExit == null,
  )
    ? second
    : null;
}

async function readExactPaneAgentIdentity(
  paneId: string,
): Promise<AgentRuntimeIdentity | null> {
  const exact = await invoke<PaneAgentRuntimeInfo | null>(
    "pane_agent_runtime_info",
    { paneId },
  );
  if (
    exact &&
    (exact.provider === "codex" ||
      exact.provider === "claude" ||
      exact.provider === "opencode") &&
    exact.providerSessionId
  ) {
    return {
      provider: exact.provider,
      sessionId: exact.providerSessionId,
    };
  }

  // A provider process without an exact conversation id is not a shell and must
  // never receive another resume command. Surface it as an identity mismatch.
  const provider = await readPaneAgentProvider(paneId);
  return provider && provider !== "shell"
    ? { provider, sessionId: null }
    : null;
}

async function waitForExactPaneAgentIdentity(
  paneId: string,
  target: AgentRecoveryTarget,
): Promise<boolean> {
  const deadline = Date.now() + EXACT_RUNTIME_CONFIRM_TIMEOUT_MS;
  let firstExactAt: number | null = null;
  while (Date.now() < deadline) {
    const running = await readExactPaneAgentIdentity(paneId);
    if (
      running?.provider === target.provider &&
      running.sessionId === target.sessionId
    ) {
      firstExactAt ??= Date.now();
      if (Date.now() - firstExactAt >= EXACT_RUNTIME_STABLE_MS) return true;
    } else {
      firstExactAt = null;
      // The provider can become visible before its full resume argv is
      // observable. Keep polling that same provider, but fail immediately for
      // a different provider or a confirmed different conversation.
      if (
        running &&
        (running.provider !== target.provider || running.sessionId !== null)
      ) {
        return false;
      }
    }
    await new Promise((resolve) => window.setTimeout(resolve, EXACT_RUNTIME_POLL_MS));
  }
  return false;
}

function savedPaneReconnectTargets(
  tabs: Tab[],
  intentionallyClosedSessionIds: Iterable<string>,
  closedProviderSessionIds: Iterable<string>,
): SavedPaneReconnectTarget[] {
  const closed = new Set(intentionallyClosedSessionIds);
  const closedProviders = new Set(closedProviderSessionIds);
  return tabs
    .filter((tab) => !tab.id.startsWith("recovered-tab-"))
    .flatMap((tab) =>
      tab.terminals
        .map((terminal) => ({
          daemonSessionId: terminal.id,
          runtimeSessionId: `terminal-${tab.id}-${terminal.paneId}`,
          paneId: terminal.paneId,
          providerSessionId: terminal.providerSessionId ?? null,
          cwd: getPaneCwd(tab.splitLayout, terminal.paneId) ?? tab.initialCwd ?? "",
        }))
        .filter((target) =>
          !closed.has(target.daemonSessionId) &&
          !closed.has(target.runtimeSessionId) &&
          !(
            target.providerSessionId &&
            closedProviders.has(target.providerSessionId)
          ),
        ),
    );
}

async function inferTranscriptBackedProvider(
  sessionId: string,
): Promise<TranscriptBackedProvider | null> {
  const providers: TranscriptBackedProvider[] = ["codex", "claude"];
  const matches: TranscriptBackedProvider[] = [];
  for (const provider of providers) {
    const transcript = await invoke<string | null>("session_transcript_head_read", {
      provider,
      sessionId,
    });
    if (transcript !== null) matches.push(provider);
  }
  return matches.length === 1 ? matches[0] : null;
}

export async function reconnectSavedAgentPanes(
  tabs: Tab[],
  intentionallyClosedSessionIds: Iterable<string>,
  closedProviderSessionIds: Iterable<string> = [],
  onlyDaemonSessionIds?: Iterable<string>,
): Promise<AgentReconnectResult> {
  const requestedIds = onlyDaemonSessionIds
    ? new Set(onlyDaemonSessionIds)
    : null;
  const targets = savedPaneReconnectTargets(
    tabs,
    intentionallyClosedSessionIds,
    closedProviderSessionIds,
  ).filter(
    (target) =>
      requestedIds === null || requestedIds.has(target.daemonSessionId),
  );
  const byDaemonSessionId = new Map(
    targets.map((target) => [target.daemonSessionId, target]),
  );
  const closedProviders = new Set(closedProviderSessionIds);
  const persisted = await invoke<PersistedRecoveryRecord[] | null>(
    "workspace_persisted_sessions",
  ).catch(() => null);
  const durableRecoveries = new Map<string, AgentRecoveryTarget>();
  for (const record of persisted ?? []) {
    const provider =
      record.provider === "codex" ||
      record.provider === "claude" ||
      record.provider === "opencode"
        ? record.provider
        : null;
    const sessionId = record.providerSessionId?.trim();
    if (provider && sessionId) {
      durableRecoveries.set(record.id, { provider, sessionId });
    }
  }
  const resolvedRecoveries = new Map<string, AgentRecoveryTarget>();

  const result = await reconnectStoppedAgents(
    targets.map((target) => target.daemonSessionId),
    {
      readRunningIdentity: readExactPaneAgentIdentity,
      readRecovery: async (daemonSessionId): Promise<AgentRecoveryTarget | null> => {
        const target = byDaemonSessionId.get(daemonSessionId);
        if (!target) return null;
        const durable =
          durableRecoveries.get(target.daemonSessionId) ??
          durableRecoveries.get(target.runtimeSessionId);
        if (durable) {
          if (closedProviders.has(durable.sessionId)) return null;
          resolvedRecoveries.set(daemonSessionId, durable);
          return durable;
        }
        const sidecarKeys = [...new Set([
          target.runtimeSessionId,
          target.daemonSessionId,
          target.paneId,
        ])];
        for (const sidecarKey of sidecarKeys) {
          const text = await invoke<string | null>("agent_status_read_sidecar", {
            fileName: paneSidecarFileName(sidecarKey),
          });
          if (!text) continue;
          const sidecar = JSON.parse(text) as AgentStatusSidecar;
          const savedCwd = normalizeCwdForSidecar(target.cwd);
          const sidecarCwd = normalizeCwdForSidecar(sidecar.cwd);
          if (sidecarCwd && savedCwd && sidecarCwd !== savedCwd) continue;
          const provider =
            sidecar.provider === "codex" ||
            sidecar.provider === "claude" ||
            sidecar.provider === "opencode"
              ? sidecar.provider
              : null;
          const sessionId = sidecar.sessionId?.trim();
          if (sessionId && closedProviders.has(sessionId)) return null;
          if (provider && sessionId) {
            const recovery = { provider, sessionId };
            resolvedRecoveries.set(daemonSessionId, recovery);
            return recovery;
          }
          if (!provider && sessionId) {
            const inferredProvider = await inferTranscriptBackedProvider(
              sessionId,
            );
            if (inferredProvider) {
              const recovery = { provider: inferredProvider, sessionId };
              resolvedRecoveries.set(daemonSessionId, recovery);
              return recovery;
            }
          }
        }
        return null;
      },
      sessionExists: async (provider, sessionId) => {
        if (provider === "opencode") return true;
        return (
          (await invoke<string | null>("session_transcript_head_read", {
            provider,
            sessionId,
          })) !== null
        );
      },
      conversationOwner: async (provider, sessionId) => {
        const owner = await invoke<BackendConversationOwner | null>(
          "agent_conversation_owner",
          { provider, sessionId },
        );
        if (!owner) return null;
        if (
          owner.provider !== provider ||
          owner.providerSessionId !== sessionId ||
          !owner.daemonPaneId ||
          !Number.isInteger(owner.providerPid) ||
          owner.providerPid <= 0 ||
          !Number.isInteger(owner.daemonRootPid) ||
          owner.daemonRootPid <= 0
        ) {
          throw new Error("Conversation owner identity was incomplete or mismatched");
        }
        return {
          provider,
          sessionId,
          providerPid: owner.providerPid,
          daemonPaneId: owner.daemonPaneId,
          daemonRootPid: owner.daemonRootPid,
        };
      },
      rebindOwnedConversation: async (paneId, target, owner) => {
        const sessions = await invoke<LiveDaemonSession[]>("daemon_list_sessions");
        const saved = sessions.find((session) => session.id === paneId);
        const stableOwner = await readStableExactConversationOwner(target, owner);
        if (!stableOwner) return false;

        // A cold-restored card can have no daemon placeholder at all. That is
        // safe to rebind: the exact live owner was observed twice and there is
        // no local PTY whose input or foreground job could be displaced. Only
        // a currently-live saved placeholder needs repeated idle-shell proof.
        const savedPlaceholderPid =
          saved?.pid && saved.lastExit == null ? saved.pid : null;
        if (stableOwner.daemonPaneId !== paneId && savedPlaceholderPid !== null) {
          if (
            !(await invoke<boolean>("pane_root_is_idle_shell", {
              pid: savedPlaceholderPid,
            }))
          ) {
            return false;
          }

          const stableSessions = await invoke<LiveDaemonSession[]>(
            "daemon_list_sessions",
          );
          const stableSaved = stableSessions.find(
            (session) => session.id === paneId,
          );
          const stableOwnerPane = stableSessions.find(
            (session) => session.id === owner.daemonPaneId,
          );
          if (
            stableSaved?.pid !== savedPlaceholderPid ||
            stableSaved.lastExit != null ||
            stableOwnerPane?.pid !== stableOwner.daemonRootPid ||
            stableOwnerPane.lastExit != null ||
            !(await invoke<boolean>("pane_root_is_idle_shell", {
              pid: savedPlaceholderPid,
            }))
          ) {
            return false;
          }

        }

        const rebound = rebindSavedPaneToLiveOwner({
          savedSessionId: paneId,
          ownerSessionId: stableOwner.daemonPaneId,
          provider: target.provider,
          providerSessionId: target.sessionId,
        });
        if (!rebound) return false;

        if (stableOwner.daemonPaneId !== paneId && savedPlaceholderPid !== null) {
          await invoke("daemon_kill_session", {
            id: paneId,
            userRequested: false,
          });
        }
        await invoke("lifecycle_audit", {
          id: paneId,
          kind: "agent-reconnect-live-owner-rebind",
          reason: `saved pane rebound to exact live owner ${stableOwner.daemonPaneId} (provider pid ${stableOwner.providerPid})`,
        }).catch(() => undefined);
        return true;
      },
      confirmExactConversation: async (paneId, target) => {
        if (await waitForExactPaneAgentIdentity(paneId, target)) return true;

        // The frontend probe is deliberately conservative and can miss a live
        // provider below a daemon child. A stable exact owner record is stronger
        // evidence and lets the saved surface attach without another provider
        // command ever being written.
        const exactOwner = await readStableExactConversationOwner(target);
        if (exactOwner?.daemonPaneId === paneId) return true;

        return false;
      },
    },
  );

  const auditDecision = (paneId: string, decision: string, reason?: string) =>
    invoke("lifecycle_audit", {
      id: paneId,
      kind: `agent-reconnect-${decision}`,
      reason,
    }).catch(() => undefined);
  await Promise.all([
    ...result.resumed.map((paneId) => auditDecision(paneId, "resumed")),
    ...result.alreadyRunning.map((paneId) =>
      auditDecision(paneId, "already-running"),
    ),
    ...result.missingRecovery.map((paneId) =>
      auditDecision(paneId, "skipped", "no exact saved conversation identity"),
    ),
    ...result.missingSession.map((paneId) =>
      auditDecision(paneId, "skipped", "saved conversation is missing locally"),
    ),
    ...result.ownedElsewhere.map((paneId) =>
      auditDecision(paneId, "skipped", "saved conversation is owned elsewhere"),
    ),
    ...result.failed.map(({ paneId, reason }) =>
      auditDecision(paneId, "failed", reason),
    ),
  ]);

  const receipts: Array<Promise<unknown>> = [];
  const persistReceipt = (
    paneId: string,
    restoreStatus: "live-attached" | "resume-failed",
    reason?: string,
  ) => {
    const recovery = resolvedRecoveries.get(paneId);
    if (!recovery) return;
    receipts.push(
      invoke("daemon_update_agent_recovery_manifest", {
        payload: {
          id: paneId,
          provider: recovery.provider,
          providerSessionId: recovery.sessionId,
          restoreStatus,
          restoreFailureReason: reason,
        },
      }).catch(() => undefined),
    );
  };
  for (const paneId of [...result.resumed, ...result.alreadyRunning]) {
    persistReceipt(paneId, "live-attached");
  }
  for (const paneId of result.missingSession) {
    persistReceipt(paneId, "resume-failed", "saved agent session no longer exists");
  }
  for (const paneId of result.ownedElsewhere) {
    persistReceipt(paneId, "resume-failed", "agent conversation is owned elsewhere");
  }
  for (const failure of result.failed) {
    persistReceipt(failure.paneId, "resume-failed", failure.reason);
  }
  await Promise.all(receipts);
  return result;
}
