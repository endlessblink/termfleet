// Central status poll (2026-07-04): ONE loop that keeps every terminal's header
// context fresh, regardless of which components happen to be mounted or selected.
//
// WHY: header polling used to live inside Terminal.tsx / MagicCanvas node effects,
// so it silently stopped for unmounted/unselected panes — the operator's gate
// ("every pane explains itself") can never pass on architecture like that. This
// loop iterates the STORE (the source of truth for panes), asks the summarizer
// (sidecar → contextual endpoint → heuristic), and applies only the safe fields:
// statusSummary + mainUserAsk. Task lineups keep their existing authoritative
// writers; a live todo-write list still outranks anything from here.
import { summarizeAgentStatus } from "./agentStatusSummarizer";
import { taskLineupFromExtractedItems } from "./taskLineup";
import { mainUserAskFromSummary } from "./terminalMainUserAsk";
import { selectStatusPollTargets, type StatusPollTarget } from "./statusPollTargets";
import { useWorkspaceStore } from "../stores/workspace";
import type { Tab, TerminalState, WorkstreamStatus } from "./types";

const POLL_INTERVAL_MS = 4_000;
// Stagger requests so N panes don't burst the summarizer at once.
const PER_PANE_DELAY_MS = 120;
// Every pane's badge must stay correct at a glance, so re-read all of them on a short
// cycle. A finished background pane that isn't polled keeps a stale status (the "I have
// to click it" bug). Reads are cheap local sidecar files.
const ACTIVE_PANE_MIN_POLL_MS = 3_000;
const BACKGROUND_PANE_MIN_POLL_MS = 8_000;

function statusForTerminal(status?: string): WorkstreamStatus {
  if (status === "failed") return "failed";
  if (status === "exited") return "done";
  if (status === "running" || status === "reconnected") return "running";
  return "ready";
}

let started = false;
let ticking = false;
const lastPolledByPane = new Map<string, number>();

function panePollKey(tab: Tab, terminal: TerminalState) {
  return `terminal-${tab.id}-${terminal.paneId}`;
}

function shouldPollTarget(target: StatusPollTarget, activeTabId: string | null | undefined, now: number) {
  const key = panePollKey(target.tab, target.terminal);
  const lastPolledAt = lastPolledByPane.get(key) ?? 0;
  const minInterval = target.tab.id === activeTabId ? ACTIVE_PANE_MIN_POLL_MS : BACKGROUND_PANE_MIN_POLL_MS;
  if (now - lastPolledAt < minInterval) return false;
  lastPolledByPane.set(key, now);
  return true;
}

async function pollOnce() {
  if (ticking) return;
  ticking = true;
  try {
    const store = useWorkspaceStore.getState();
    const targets = selectStatusPollTargets(store.tabs, store.activeTabId, Date.now());
    for (const target of targets) {
      if (!shouldPollTarget(target, store.activeTabId, Date.now())) continue;
      const { tab, terminal } = target;
      // Agent lanes get contextual lines too — their mission/prompt is the ask.
      const liveCwd = store.liveCwds[terminal.id];
      try {
        const result = await summarizeAgentStatus({
          paneId: panePollKey(tab, terminal),
          userTask: tab.workstream?.kind === "agent" ? tab.workstream.mission ?? tab.workstream.prompt : undefined,
          mission: "Terminal",
          provider: "shell",
          status: statusForTerminal(terminal.status),
          cwd: liveCwd,
          currentActivity: terminal.currentActivity,
          terminalOutput: terminal.terminalOutput,
          terminalVisibleText: terminal.terminalVisibleText,
        }, {
          // Global background polling is for authoritative local sidecar data.
          // The HTTP worker can fall back to heuristic(context-disabled), which
          // creates map-wide churn while producing results this loop discards.
          endpoint: "",
        });
        // Apply only trustworthy results: the agent's real sidecar, or a
        // contextual (narration-bearing) line from the local summarizer.
        const contextual = result.source === "process" && Boolean(result.summary.narration);
        if (result.source !== "sidecar" && !contextual) continue;
        const latest = useWorkspaceStore.getState();
        const latestTab = latest.tabs.find((candidate) => candidate.id === tab.id);
        const latestTerminal = latestTab?.terminals.find((candidate) => candidate.id === terminal.id);
        if (!latestTab || !latestTerminal) continue;
        // Never clobber a live declared task list with a modeled line.
        if (latestTerminal.statusSummary?.tasksFromTodoWrite && !result.summary.tasksFromTodoWrite && !contextual) continue;
        const updatedAt = Date.now();
        // Never DOWNGRADE the Task row: a thin ask ("done", "do it") from the
        // heuristic must not replace an existing richer goal.
        const candidateAsk = String(result.summary.userTask ?? "").trim();
        const previousAsk = String(latestTerminal.mainUserAsk?.text ?? "").trim();
        const askImproves =
          candidateAsk.split(/\s+/).length >= 4 ||
          (!previousAsk && Boolean(candidateAsk)) ||
          candidateAsk.split(/\s+/).length > previousAsk.split(/\s+/).length;
        const mainUserAsk = askImproves
          ? mainUserAskFromSummary(result.summary, "status-sidecar", {
              previous: latestTerminal.mainUserAsk,
              runId: latestTerminal.activeRunId,
              now: updatedAt,
            })
          : latestTerminal.mainUserAsk;
        const taskLineup = result.summary.tasksFromTodoWrite
          ? taskLineupFromExtractedItems(result.summary.tasks, "todo-write", "pending", updatedAt, latestTerminal.activeRunId)
          : undefined;
        latest.updateTab(latestTab.id, {
          terminals: latestTab.terminals.map((candidate) =>
            candidate.id === terminal.id
              ? {
                  ...candidate,
                  ...(taskLineup && taskLineup.length > 0 ? { taskLineup } : {}),
                  statusSummary: result.summary,
                  statusSummaryUpdatedAt: updatedAt,
                  statusSummarySource: result.source,
                  statusSummaryError: result.error,
                  mainUserAsk,
                }
              : candidate,
          ),
        });
      } catch {
        // One pane failing must never stop the loop.
      }
      await new Promise((resolve) => setTimeout(resolve, PER_PANE_DELAY_MS));
    }
  } finally {
    ticking = false;
  }
}

export function startStatusPollLoop() {
  if (started || typeof window === "undefined") return;
  started = true;
  void pollOnce();
  window.setInterval(() => void pollOnce(), POLL_INTERVAL_MS);
}
