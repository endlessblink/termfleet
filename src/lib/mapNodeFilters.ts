import type { CanvasNode, Tab } from "./types";

export type MapFilter = "all" | "active" | "failed" | "waiting" | "testing" | "preview";

export const MAP_FILTERS: Array<{ id: MapFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "failed", label: "Failed" },
  { id: "waiting", label: "Waiting" },
  { id: "testing", label: "Tests" },
  { id: "preview", label: "Preview" },
];

export function linkedTerminalForMapNode(node: CanvasNode, linkedTab?: Tab) {
  if (!linkedTab) return undefined;
  return linkedTab.terminals.find((terminal) => terminal.paneId === linkedTab.activePaneId) ??
    linkedTab.terminals.find((terminal) => terminal.paneId === node.id) ??
    linkedTab.terminals.find((terminal) => terminal.id === node.terminalPtyId) ??
    linkedTab.terminals[0];
}

export function nodeMatchesMapFilter(node: CanvasNode, linkedTab: Tab | undefined, filter: MapFilter) {
  if (filter === "all") return true;
  if (filter === "preview") {
    return node.type === "preview" ||
      Boolean(node.previewUrl) ||
      Boolean(linkedTab?.terminals.some((terminal) => terminal.previewUrl));
  }
  if (node.type !== "terminal") return false;

  const terminal = linkedTerminalForMapNode(node, linkedTab);
  const workstream = linkedTab?.workstream;
  if (filter === "active") {
    return terminal?.status === "starting" ||
      terminal?.status === "running" ||
      terminal?.status === "reconnected" ||
      workstream?.status === "running" ||
      workstream?.phase === "active" ||
      workstream?.phase === "launching";
  }
  if (filter === "failed") {
    return terminal?.status === "failed" ||
      workstream?.status === "failed" ||
      workstream?.phase === "blocked" ||
      workstream?.readiness === "auth-required";
  }
  if (filter === "waiting") {
    return workstream?.status === "waiting" ||
      workstream?.phase === "needs-input" ||
      workstream?.activityKind === "waiting";
  }
  if (filter === "testing") {
    const text = [
      terminal?.activityKind,
      terminal?.currentActivity,
      terminal?.statusSummary?.task,
      terminal?.statusSummary?.now,
      workstream?.activityKind,
      workstream?.currentActivity,
      workstream?.statusSummary?.task,
      workstream?.statusSummary?.now,
    ].filter(Boolean).join(" ");
    return /\b(test|tests|testing|spec|playwright|cargo test|npm test|verify)\b/i.test(text);
  }
  return false;
}
