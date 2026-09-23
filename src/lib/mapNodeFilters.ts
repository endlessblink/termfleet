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

function mapNodePaneIds(node: CanvasNode) {
  const restored = node.id.startsWith("recovered-pane-")
    ? node.id.slice("recovered-pane-".length)
    : node.id;
  return new Set(
    [node.id, restored, node.linkedTerminalPaneId].filter(
      (value): value is string => Boolean(value),
    ),
  );
}

/**
 * The tab a map node belongs to — the same rule the map card uses: the tab that owns
 * the node's own pane first, its recorded tab id second. Looking only at the recorded
 * id left rows with no tab (and so no status) that the card itself resolved fine.
 */
export function tabForMapNode(node: CanvasNode, tabs: Tab[]): Tab | undefined {
  const paneIds = mapNodePaneIds(node);
  return (
    tabs.find((tab) => tab.terminals.some((terminal) => paneIds.has(terminal.paneId))) ??
    (node.terminalTabId ? tabs.find((tab) => tab.id === node.terminalTabId) : undefined)
  );
}

/**
 * The terminal a map node shows — its OWN pane first, exactly like the map card. This
 * used to prefer the tab's focused pane, so the sidebar, its Running/Waiting/Idle
 * counts and the approvals list reported ANOTHER terminal's status (TF-044).
 */
export function linkedTerminalForMapNode(node: CanvasNode, linkedTab?: Tab) {
  if (!linkedTab) return undefined;
  const paneIds = mapNodePaneIds(node);
  return linkedTab.terminals.find((terminal) => terminal.id === node.terminalPtyId) ??
    linkedTab.terminals.find((terminal) => terminal.paneId === node.linkedTerminalPaneId) ??
    linkedTab.terminals.find((terminal) => paneIds.has(terminal.paneId)) ??
    linkedTab.terminals.find((terminal) => terminal.paneId === linkedTab.activePaneId) ??
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
  // The pane's own status only; the tab-wide status is a fallback for a node with no
  // terminal at all, never a second opinion that can contradict the card.
  const badgeAttention = paneBadgeAttention(
    terminal,
    terminal ? undefined : workstream?.statusSummary?.status ?? workstream?.status,
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
