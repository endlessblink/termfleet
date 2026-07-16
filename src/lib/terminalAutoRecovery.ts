import type { AgentProvider, WorkstreamStatus, WorkstreamStatusSummaryLifecycle } from "./types";

interface AutoRecoveryState {
  provider?: AgentProvider | string | null;
  taskStatuses?: string[];
  terminalStatus?: WorkstreamStatusSummaryLifecycle | string | null;
  workstreamStatus?: WorkstreamStatus | string | null;
  workstreamPhase?: string | null;
  durableActivityStatus?: string | null;
}

export function shouldAutoRecoverAgent(state: AutoRecoveryState): boolean {
  if (!state.provider || state.provider === "shell") return false;
  return Boolean(
    state.taskStatuses?.some((status) => status === "in_progress") ||
    state.terminalStatus === "working" ||
    state.workstreamStatus === "running" ||
    state.workstreamPhase === "active" ||
    state.durableActivityStatus === "running"
  );
}
