import type { Tab, TerminalState } from "./types";

// The sidebar/map badges must be right AT A GLANCE, so every pane has to be re-read on
// a short cycle — not just the active one. A finished background pane that never gets
// polled keeps a stale "working" status forever (the "must click to update" bug).
export const MAX_STATUS_POLL_TARGETS_PER_TICK = 24;
const RECENT_ACTIVITY_MS = 60_000;

export interface StatusPollTarget {
  tab: Tab;
  terminal: TerminalState;
  priority: number;
}

export function statusPollTerminalTimestamp(terminal: TerminalState) {
  return Math.max(
    terminal.activityUpdatedAt ?? 0,
    terminal.terminalVisibleTextUpdatedAt ?? 0,
    terminal.durableActivity?.updatedAt ?? 0,
    terminal.statusSummaryUpdatedAt ?? 0,
  );
}

function statusPollPriority(tab: Tab, terminal: TerminalState, activeTabId: string | null | undefined, now: number) {
  const activeTab = tab.id === activeTabId;
  const realTaskList = Boolean(terminal.statusSummary?.tasksFromTodoWrite);
  const agentLane = tab.workstream?.kind === "agent";
  const recentActivity = now - statusPollTerminalTimestamp(terminal) <= RECENT_ACTIVITY_MS;
  const running = terminal.status === "running" || terminal.status === "reconnected";

  if (activeTab && running) return 100;
  if (activeTab) return 90;
  if (realTaskList) return 80;
  if (agentLane && running) return 70;
  if (recentActivity && running) return 60;
  // Baseline: EVERY live terminal is still polled (lower priority, rotated by staleness)
  // so its badge stays correct without the user clicking it. Only truly dead panes drop.
  if (running || terminal.status === "reconnected") return 20;
  return 10;
}

export function selectStatusPollTargets(tabs: Tab[], activeTabId: string | null | undefined, now = Date.now()) {
  return tabs
    .flatMap((tab) =>
      (tab.terminals ?? []).map((terminal): StatusPollTarget => ({
        tab,
        terminal,
        priority: statusPollPriority(tab, terminal, activeTabId, now),
      })),
    )
    .filter(({ priority }) => priority > 0)
    .sort((a, b) => b.priority - a.priority || statusPollTerminalTimestamp(b.terminal) - statusPollTerminalTimestamp(a.terminal))
    .slice(0, MAX_STATUS_POLL_TARGETS_PER_TICK);
}
