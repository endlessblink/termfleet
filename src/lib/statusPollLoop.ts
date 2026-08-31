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
import { preferPaneTaskLine } from "./taskLine";
import { taskLineupFromExtractedItems } from "./taskLineup";
import { mainUserAskFromSummary } from "./terminalMainUserAsk";
import { selectStatusPollTargets, type StatusPollTarget } from "./statusPollTargets";
import { useWorkspaceStore } from "../stores/workspace";
import type { Tab, TerminalState, WorkstreamStatus } from "./types";
import { stableAgentProvider } from "./agentProviderIdentity";
import { runBoundedTasks } from "./statusPollScheduler";
import { heartbeatTaskRun } from "./canonicalTaskRuntime";
import {
  mirroredWorkstream,
  preserveDurablePaneGoal,
  projectStatusPollResult,
  statusPollProjectionChanged,
  terminalMatchesPollTarget,
} from "./statusPollProjection";


const POLL_INTERVAL_MS = 4_000;
// Every pane's badge must stay correct at a glance, so re-read all of them on a short
// cycle. A finished background pane that isn't polled keeps a stale status (the "I have
// to click it" bug). Reads are cheap local sidecar files.
const ACTIVE_PANE_MIN_POLL_MS = 3_000;
const BACKGROUND_PANE_MIN_POLL_MS = 8_000;
const STATUS_POLL_CONCURRENCY = 8;

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

function latestTabForPollTarget(tabs: Tab[], target: StatusPollTarget) {
  return tabs.find((candidate) => candidate.id === target.tab.id) ??
    tabs.find((candidate) =>
      candidate.terminals.some((terminal) => terminal.paneId === target.terminal.paneId),
    );
}

function shouldPollTarget(target: StatusPollTarget, activeTabId: string | null | undefined, now: number) {
  const key = panePollKey(target.tab, target.terminal);
  const lastPolledAt = lastPolledByPane.get(key) ?? 0;
  const minInterval = target.tab.id === activeTabId ? ACTIVE_PANE_MIN_POLL_MS : BACKGROUND_PANE_MIN_POLL_MS;
  if (now - lastPolledAt < minInterval) return false;
  lastPolledByPane.set(key, now);
  return true;
}

function syncCanonicalRunHeartbeat(tab: Tab, terminal: TerminalState, source: string, status?: string) {
  const workstream = tab.workstream;
  if (!workstream?.canonicalTaskId || !workstream.runId) return;
  const now = Date.now();
  const terminalState = terminal.status === "failed" || status === "failed"
    ? "failed"
    : terminal.status === "exited" || status === "done"
      ? "finished"
      : status === "waiting"
        ? "waiting"
        : "running";
  void heartbeatTaskRun(workstream.runId, {
    state: terminalState,
    heartbeatAt: now,
    activityAt: terminalState === "running" && source !== "fallback" ? now : undefined,
    phase: workstream.phase,
    action: terminal.currentActivity ?? workstream.currentActivity,
    terminalPaneId: terminal.paneId,
    runtimeSessionId: panePollKey(tab, terminal),
    terminalLink: `pane:${terminal.paneId}`,
    ...(terminalState === "failed" ? { failureReason: workstream.statusSummaryError ?? "Agent pane reported failure" } : {}),
    ...(terminalState === "finished" ? { finishedAt: now } : {}),
  }).catch(() => undefined);
}

async function pollOnce() {
  if (ticking) return;
  ticking = true;
  try {
    const store = useWorkspaceStore.getState();
    const targets = selectStatusPollTargets(
      store.tabs,
      store.activeTabId,
      Date.now(),
      ({ tab, terminal }) => lastPolledByPane.get(panePollKey(tab, terminal)) ?? 0,
    );
    const liveKeys = new Set(targets.map(({ tab, terminal }) => panePollKey(tab, terminal)));
    for (const key of lastPolledByPane.keys()) {
      if (!liveKeys.has(key)) lastPolledByPane.delete(key);
    }
    const eligibleTargets = targets.filter((target) =>
      shouldPollTarget(target, store.activeTabId, Date.now()),
    );
    const pollResults = await runBoundedTasks(
      eligibleTargets,
      STATUS_POLL_CONCURRENCY,
      async (target) => {
        const { tab, terminal } = target;
        const liveCwd = store.liveCwds[terminal.id];
        try {
          const result = await summarizeAgentStatus({
          paneId: panePollKey(tab, terminal),
          sessionId: tab.workstream?.providerSessionId,
          userTask: tab.workstream?.kind === "agent" ? tab.workstream.mission ?? tab.workstream.prompt : undefined,
          mission: "Terminal",
          provider: "shell",
          status: statusForTerminal(terminal.status),
          cwd: liveCwd,
          currentActivity: terminal.currentActivity,
          terminalOutput: terminal.terminalOutput,
          terminalVisibleText: terminal.terminalVisibleText,
        }, {
          // Background polling uses the same local evidence as the visible pane:
          // the pane sidecar plus the provider's own session record. Disabling the
          // transcript reader here made every unmounted/map pane lose its opening
          // request and session title, so it could only render a placeholder.
          endpoint: "",
          forceTauriSidecar: true,
          // Leave transcriptReader undefined so the desktop uses the local Tauri
          // reader; browser previews still resolve this to null automatically.
          // Context synthesis remains disabled: deterministic evidence is enough and
          // cannot invent a new goal for a pane.
          contextTaskSummarizer: null,
          });
          return { target, result };
        } catch (error) {
          return {
            target,
            result: null,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    );

    for (const { target, result, error } of pollResults) {
      if (!result) {
        const { terminal } = target;
        const latest = useWorkspaceStore.getState();
        const latestTab = latestTabForPollTarget(latest.tabs, target);
        const latestTerminal = latestTab?.terminals.find(
          (candidate) => terminalMatchesPollTarget(candidate, terminal),
        );
        const pollError = `poll-error:${error || "unknown"}`;
        if (!latestTab || !latestTerminal || latestTerminal.statusSummaryError === pollError) continue;
        latest.updateTab(latestTab.id, {
          workstream: mirroredWorkstream(latestTab, undefined, undefined, {
            statusSummarySource: "fallback",
            statusSummaryError: pollError,
          }),
          terminals: latestTab.terminals.map((candidate) =>
            terminalMatchesPollTarget(candidate, terminal)
              ? { ...candidate, statusSummarySource: "fallback", statusSummaryError: pollError }
              : candidate,
          ),
        });
        continue;
      }
      const { terminal } = target;
      try {
        const contextual = result.source === "process" && Boolean(result.summary.narration);
        const trusted = result.source === "sidecar" || contextual;
        const latest = useWorkspaceStore.getState();
        const latestTab = latestTabForPollTarget(latest.tabs, target);
        const latestTerminal = latestTab?.terminals.find(
          (candidate) => terminalMatchesPollTarget(candidate, terminal),
        );
        if (!latestTab || !latestTerminal) continue;
        syncCanonicalRunHeartbeat(latestTab, latestTerminal, result.source, result.summary.status);

        const expiredProjection = projectStatusPollResult(latestTerminal, result, Date.now());
        if (expiredProjection) {
          // An expired record still says what the pane is ABOUT, so the line rides along.
          const expiredLine = preferPaneTaskLine(latestTerminal.taskLine, result.taskLine);
          // An expired record has no LIVE step to report, so the second row clears.
          const expiredNow = null;
          latest.updateTab(latestTab.id, {
            workstream: mirroredWorkstream(latestTab, expiredLine, undefined, {
              statusSummary: expiredProjection.statusSummary,
              statusSummaryUpdatedAt: expiredProjection.statusSummaryUpdatedAt,
              statusSummarySource: expiredProjection.statusSummarySource,
              statusSummaryError: expiredProjection.statusSummaryError,
            }),
            terminals: latestTab.terminals.map((candidate) =>
              terminalMatchesPollTarget(candidate, terminal)
                ? {
                    ...candidate,
                    ...expiredProjection,
                    ...(expiredLine ? { taskLine: expiredLine } : {}),
                    nowLine: expiredNow,
                  }
                : candidate,
            ),
          });
          continue;
        }

        // The Running/Waiting/Idle badge is a PURE render-time translation of
        // `statusSummary.status` (sessionStatus.paneBadgeAttention) — the views compute
        // it from the store, so this loop only has to keep statusSummary fresh for
        // EVERY pane. An untrusted (plain-shell / heuristic) result must not overwrite
        // the richer statusSummary.
        if (!trusted) {
          // The SUMMARY stays gated (heuristic scrapes produced junk headers), but the
          // task line is provenance-checked and cannot invent text — and this is the
          // only loop that visits panes whose runtime is not on screen. Discarding it
          // here is why most cards on the operations map rendered "No task declared"
          // over a record whose own session title named the work.
          const untrustedLine = preferPaneTaskLine(
            latestTerminal.taskLine,
            result.taskLine,
          );
          const untrustedNow = result.nowLine ?? null;
          const inferredProvider = stableAgentProvider(
            latestTerminal.agentProvider,
            result.summary.provider,
          );
          const pollDiagnostic = result.sidecarState
            ? `sidecar:${result.sidecarState}`
            : `source:${result.source}`;
          if (
            (untrustedLine && untrustedLine !== latestTerminal.taskLine) ||
            untrustedNow?.text !== latestTerminal.nowLine?.text ||
            inferredProvider !== latestTerminal.agentProvider ||
            latestTerminal.statusSummarySource !== result.source ||
            latestTerminal.statusSummaryError !== pollDiagnostic
          ) {
            latest.updateTab(latestTab.id, {
              workstream: mirroredWorkstream(latestTab, untrustedLine, undefined, {
                statusSummarySource: result.source,
                statusSummaryError: pollDiagnostic,
              }),
              terminals: latestTab.terminals.map((candidate) =>
                terminalMatchesPollTarget(candidate, terminal)
                  ? {
                      ...candidate,
                      ...(untrustedLine ? { taskLine: untrustedLine } : {}),
                      // The second row is provenance-checked exactly like the first, so
                      // it rides the untrusted path too — otherwise every plain-shell
                      // pane (most of the map) had a blank "Now" line forever.
                      nowLine: untrustedNow,
                      agentProvider: inferredProvider,
                      statusSummarySource: result.source,
                      statusSummaryError: pollDiagnostic,
                    }
                  : candidate,
              ),
            });
          }
          continue;
        }
        // Never clobber a live declared task list with a modeled line.
        if (latestTerminal.statusSummary?.tasksFromTodoWrite && !result.summary.tasksFromTodoWrite && !contextual) continue;
        const updatedAt = Date.now();
        const projectedSummary = preserveDurablePaneGoal(
          latestTerminal.statusSummary,
          result.summary,
        );
        // Never DOWNGRADE the Task row: a thin ask ("done", "do it") from the
        // heuristic must not replace an existing richer goal.
        const candidateAsk = String(result.summary.userTask ?? "").trim();
        const previousAsk = String(latestTerminal.mainUserAsk?.text ?? "").trim();
        const askImproves =
          candidateAsk.split(/\s+/).length >= 4 ||
          (!previousAsk && Boolean(candidateAsk)) ||
          candidateAsk.split(/\s+/).length > previousAsk.split(/\s+/).length;
        const mainUserAsk = result.source === "sidecar" || askImproves
          ? mainUserAskFromSummary(projectedSummary, "status-sidecar", {
              previous: latestTerminal.mainUserAsk,
              runId: latestTerminal.activeRunId,
              now: updatedAt,
            })
          : latestTerminal.mainUserAsk;
        const taskLineup = projectedSummary.tasksFromTodoWrite
          ? taskLineupFromExtractedItems(projectedSummary.tasks, "todo-write", "pending", updatedAt, latestTerminal.activeRunId)
          : undefined;
        const taskLine = preferPaneTaskLine(
          latestTerminal.taskLine,
          result.taskLine,
        );
        const projection: Partial<TerminalState> = {
          ...(taskLineup && taskLineup.length > 0 ? { taskLineup } : {}),
          ...(taskLine ? { taskLine } : {}),
          nowLine: result.nowLine ?? null,
          statusSummary: projectedSummary,
          agentProvider: stableAgentProvider(latestTerminal.agentProvider, projectedSummary.provider),
          statusSummaryUpdatedAt: updatedAt,
          statusSummarySource: result.source,
          statusSummaryError: result.error,
          mainUserAsk,
        };
        if (!statusPollProjectionChanged(latestTerminal, projection)) continue;
        latest.updateTab(latestTab.id, {
          workstream: mirroredWorkstream(latestTab, taskLine, taskLineup, {
            statusSummary: projection.statusSummary,
            statusSummaryUpdatedAt: projection.statusSummaryUpdatedAt,
            statusSummarySource: projection.statusSummarySource,
            statusSummaryError: projection.statusSummaryError,
          }),
          terminals: latestTab.terminals.map((candidate) =>
            terminalMatchesPollTarget(candidate, terminal)
              ? { ...candidate, ...projection }
              : candidate,
          ),
        });
      } catch {
        // One pane failing must never stop the loop.
      }
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
