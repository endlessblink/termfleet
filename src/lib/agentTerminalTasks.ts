import type { WorkstreamMetadata, WorkstreamStatusSummary } from "./types";

export type AgentTerminalTaskRow = {
  id: string;
  task: string;
  state: string;
  next: string;
};

export function workstreamStateLabel(workstream: WorkstreamMetadata, summary: WorkstreamStatusSummary) {
  if (workstream.status === "failed" || workstream.phase === "blocked" || summary.status === "blocked") return "Blocked";
  if (workstream.status === "waiting" || workstream.phase === "needs-input" || summary.status === "waiting") return "Waiting";
  if (workstream.status === "done" || workstream.phase === "complete" || workstream.phase === "reviewed" || summary.status === "done") return "Ready for review";
  if (workstream.status === "stopped" || workstream.phase === "interrupted" || summary.status === "stopped") return "Stopped";
  if (workstream.status === "running" || workstream.phase === "active" || workstream.phase === "launching" || summary.status === "working") return "Working";
  return "Idle";
}

export function agentTerminalTaskRows(
  workstream: WorkstreamMetadata,
  summary: WorkstreamStatusSummary
): AgentTerminalTaskRow[] {
  const state = workstreamStateLabel(workstream, summary);
  const next = workstream.extractedNextActions?.[0]?.text ?? workstream.nextAction ?? summary.now;
  const extracted = (workstream.extractedTasks ?? [])
    .slice()
    .sort((a, b) => b.at - a.at)
    .map((item) => ({
      id: item.id,
      task: item.text,
      state,
      next,
    }));

  if (extracted.length > 0) return extracted;

  return [{
    id: "mission",
    task: summary.task,
    state,
    next,
  }];
}
