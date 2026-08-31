import type { Tab, TerminalState } from "./types";

// Keep the active pane fresh immediately, then rotate background panes across
// ticks. Unbounded fan-out made the first post-hydration poll compete with
// terminal attach and repaint for every pane at once.
export const MAX_STATUS_POLL_TARGETS_PER_TICK = 8;
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

export function selectStatusPollTargets(
  tabs: Tab[],
  activeTabId: string | null | undefined,
  now = Date.now(),
  lastPolledAt: (target: StatusPollTarget) => number = () => 0,
) {
  return tabs
    .flatMap((tab) =>
      (tab.terminals ?? []).map((terminal): StatusPollTarget => ({
        tab,
        terminal,
        priority: statusPollPriority(tab, terminal, activeTabId, now),
      })),
    )
    .filter(({ priority }) => priority > 0)
    .sort((a, b) => {
      const activeOrder =
        Number(b.tab.id === activeTabId) - Number(a.tab.id === activeTabId);
      if (activeOrder !== 0) return activeOrder;
      return (
        lastPolledAt(a) - lastPolledAt(b) ||
        b.priority - a.priority ||
        statusPollTerminalTimestamp(b.terminal) -
          statusPollTerminalTimestamp(a.terminal)
      );
    })
    .slice(0, MAX_STATUS_POLL_TARGETS_PER_TICK);
}
