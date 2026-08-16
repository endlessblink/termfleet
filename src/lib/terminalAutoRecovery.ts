import type { AgentProvider, WorkstreamStatus, WorkstreamStatusSummaryLifecycle } from "./types";

interface AutoRecoveryState {
  provider?: AgentProvider | string | null;
  taskStatuses?: string[];
  terminalStatus?: WorkstreamStatusSummaryLifecycle | string | null;
  workstreamStatus?: WorkstreamStatus | string | null;
  workstreamPhase?: string | null;
  durableActivityStatus?: string | null;
  manuallyStopped?: boolean;
}

export function autoRecoveryDecision(state: AutoRecoveryState): {
  recover: boolean;
  reason: string;
} {
  if (state.manuallyStopped) return { recover: false, reason: "manual-stop" };
  if (!state.provider) return { recover: false, reason: "provider-missing" };
  if (state.provider === "shell") return { recover: false, reason: "ordinary-shell" };
  const activeSignal = Boolean(
    state.taskStatuses?.some((status) => status === "in_progress") ||
    state.terminalStatus === "working" ||
    state.workstreamStatus === "running" ||
    state.workstreamPhase === "active" ||
    state.durableActivityStatus === "running",
  );
  return activeSignal
    ? { recover: true, reason: "agent-state-still-active" }
    : { recover: false, reason: "agent-state-settled" };
}

export function shouldAutoRecoverAgent(state: AutoRecoveryState): boolean {
  return autoRecoveryDecision(state).recover;
}
