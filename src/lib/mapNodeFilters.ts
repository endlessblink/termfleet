import type { CanvasNode, Tab } from "./types";
import { paneBadgeAttention } from "./sessionStatus";

export type MapFilter = "all" | "active" | "failed" | "waiting" | "done" | "idle";

export const MAP_FILTERS: Array<{ id: MapFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "failed", label: "Failed" },
  { id: "waiting", label: "Waiting" },
  { id: "done", label: "Done" },
  { id: "idle", label: "Idle" },
];

export function linkedTerminalForMapNode(node: CanvasNode, linkedTab?: Tab) {
  if (!linkedTab) return undefined;
  return linkedTab.terminals.find((terminal) => terminal.paneId === linkedTab.activePaneId) ??
    linkedTab.terminals.find((terminal) => terminal.paneId === node.id) ??
    linkedTab.terminals.find((terminal) => terminal.id === node.terminalPtyId) ??
    linkedTab.terminals[0];
}

function statusSummaryMarksDone(summary?: {
  status?: string | null;
  completedByCommand?: boolean;
} | null) {
  return summary?.status === "done" || summary?.completedByCommand === true;
}

export function nodeMatchesMapFilter(node: CanvasNode, linkedTab: Tab | undefined, filter: MapFilter) {
  if (filter === "all") return true;
  if (node.type !== "terminal") return false;

  const terminal = linkedTerminalForMapNode(node, linkedTab);
  const workstream = linkedTab?.workstream;
  const badgeAttention = paneBadgeAttention(
    terminal,
    workstream?.statusSummary?.status ?? workstream?.status,
  );
  if (filter === "active") {
    return badgeAttention === "running";
  }
  if (filter === "failed") {
    return terminal?.status === "failed" ||
      workstream?.status === "failed" ||
      workstream?.phase === "blocked" ||
      workstream?.readiness === "auth-required";
  }
  if (filter === "waiting") {
    return badgeAttention === "waiting";
  }
  if (filter === "idle") {
    return badgeAttention === "idle";
  }
  if (filter === "done") {
    return statusSummaryMarksDone(terminal?.statusSummary) ||
      statusSummaryMarksDone(workstream?.statusSummary) ||
      workstream?.status === "done" ||
      workstream?.phase === "complete" ||
      workstream?.phase === "reviewed";
  }
  return false;
}
