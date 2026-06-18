import type { CanvasNode, Tab, TerminalRuntimeStatus, WorkstreamStatus } from "./types";

export type LocalServiceStatus = "live" | "failed" | "waiting" | "stopped" | "unknown";

export interface LocalServiceSummary {
  id: string;
  url: string;
  port: string;
  status: LocalServiceStatus;
  ownerTitle: string;
  ownerTabId?: string;
  terminalPaneId?: string;
  terminalId?: string;
  previewNodeId?: string;
  terminalNodeId?: string;
  activity?: string;
  logs?: string;
}

function trimServiceLogs(value?: string) {
  const lines = value
    ?.split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .slice(-8);
  return lines?.length ? lines.join("\n") : undefined;
}

function normalizeLocalUrl(value?: string) {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.replace("0.0.0.0", "127.0.0.1"));
    if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)) return null;
    return url.toString().replace(/\/$/, "");
  } catch {
    const match = value.match(/\b(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{2,5})\b/);
    if (!match) return null;
    return `http://127.0.0.1:${match[1]}`;
  }
}

function serviceStatus(terminalStatus?: TerminalRuntimeStatus, workstreamStatus?: WorkstreamStatus): LocalServiceStatus {
  if (terminalStatus === "failed" || workstreamStatus === "failed") return "failed";
  if (workstreamStatus === "waiting") return "waiting";
  if (terminalStatus === "running" || terminalStatus === "reconnected" || workstreamStatus === "running") return "live";
  if (terminalStatus === "exited" || terminalStatus === "stale" || workstreamStatus === "stopped" || workstreamStatus === "done") return "stopped";
  return "unknown";
}

export function summarizeLocalServices(tabs: Tab[], nodes: CanvasNode[]): LocalServiceSummary[] {
  const summaries = new Map<string, LocalServiceSummary>();
  const tabById = new Map(tabs.map((tab) => [tab.id, tab]));

  const upsert = (summary: LocalServiceSummary) => {
    const existing = summaries.get(summary.id);
    summaries.set(summary.id, {
      ...existing,
      ...summary,
      previewNodeId: existing?.previewNodeId ?? summary.previewNodeId,
      terminalNodeId: existing?.terminalNodeId ?? summary.terminalNodeId,
      terminalId: existing?.terminalId ?? summary.terminalId,
      terminalPaneId: existing?.terminalPaneId ?? summary.terminalPaneId,
      activity: summary.activity ?? existing?.activity,
      logs: summary.logs ?? existing?.logs,
    });
  };

  for (const tab of tabs) {
    for (const terminal of tab.terminals) {
      const url = normalizeLocalUrl(terminal.previewUrl);
      if (!url) continue;
      const parsed = new URL(url);
      const id = `${tab.id}:${url}`;
      const terminalNode = nodes.find((node) =>
        node.type === "terminal" &&
        node.terminalTabId === tab.id &&
        (node.terminalPtyId === terminal.id || !node.terminalPtyId)
      );
      upsert({
        id,
        url,
        port: parsed.port || (parsed.protocol === "https:" ? "443" : "80"),
        status: serviceStatus(terminal.status, tab.workstream?.status),
        ownerTitle: tab.title,
        ownerTabId: tab.id,
        terminalPaneId: terminal.paneId,
        terminalId: terminal.id,
        terminalNodeId: terminalNode?.id,
        activity: terminal.currentActivity ?? tab.workstream?.currentActivity,
        logs: trimServiceLogs(terminal.terminalOutput ?? tab.workstream?.terminalOutput),
      });
    }
  }

  for (const node of nodes) {
    const url = normalizeLocalUrl(node.previewUrl);
    if (!url) continue;
    const tab = node.terminalTabId ? tabById.get(node.terminalTabId) : undefined;
    const terminal = tab?.terminals.find((candidate) => candidate.paneId === node.linkedTerminalPaneId) ??
      tab?.terminals.find((candidate) => candidate.paneId === tab.activePaneId) ??
      tab?.terminals[0];
    const parsed = new URL(url);
    upsert({
      id: `${tab?.id ?? node.id}:${url}`,
      url,
      port: parsed.port || (parsed.protocol === "https:" ? "443" : "80"),
      status: serviceStatus(terminal?.status, tab?.workstream?.status),
      ownerTitle: tab?.title ?? node.title,
      ownerTabId: tab?.id,
      terminalPaneId: terminal?.paneId,
      terminalId: terminal?.id,
      previewNodeId: node.type === "preview" ? node.id : undefined,
      terminalNodeId: node.type === "terminal" ? node.id : undefined,
      activity: terminal?.currentActivity ?? tab?.workstream?.currentActivity,
      logs: trimServiceLogs(terminal?.terminalOutput ?? tab?.workstream?.terminalOutput),
    });
  }

  return [...summaries.values()].sort((a, b) => Number(a.port) - Number(b.port) || a.ownerTitle.localeCompare(b.ownerTitle));
}

export function formatLocalServiceBrief(service: LocalServiceSummary) {
  return [
    `Service: ${service.url}`,
    `Owner: ${service.ownerTitle}`,
    `Status: ${service.status}`,
    `Port: ${service.port}`,
    service.activity ? `Activity: ${service.activity}` : null,
    service.logs ? `Logs:\n${service.logs}` : "Logs: none captured",
  ].filter(Boolean).join("\n");
}
