import { useEffect } from "react";
import {
  COCKPIT_SNAPSHOT_HEARTBEAT_MS,
  cockpitSnapshotEnabled,
  recordCockpitPane,
  removeCockpitPane,
  type CockpitSnapshotEntry,
} from "../lib/cockpitSnapshot";
import { recordTerminalHeaderLog } from "../lib/terminalMainUserAsk";
import { qualityCheckGoalLabel } from "../lib/terminalHeaderQuality";

function snapshotGoal(entry: Omit<CockpitSnapshotEntry, "updatedAt">) {
  const supplied = entry.context?.trim() ?? "";
  if (/^Make (?:[A-Z][\w-]*|this project|the project) work clear and dependable so people can resume it confidently[.!]?$/i.test(supplied)) {
    return "";
  }
  // A project-wide fallback is useful for internal orientation, but it is not
  // pane-owned `$about-what` evidence and must never make the live gate pass.
  if (
    !["status-summary", "sidecar-todo", "task-tool", "user-prompt"].includes(
      entry.contextSource ?? "",
    )
  ) {
    return "";
  }
  const trustedAboutWhat =
    /^(?:this\s+session\s+is\s+about|I['’]m\s+|We['’]re\s+)/i.test(supplied) &&
    (entry.contextSource === "status-summary" || entry.contextSource === "sidecar-todo");
  return qualityCheckGoalLabel(supplied, {
    allowAboutWhatVoice: true,
    allowTrustedAboutWhat: trustedAboutWhat,
    maxLength: 150,
  }).ok
    ? supplied
    : "";
}

// Null-returning probe (TC-035 observability). Rendered once per terminal header so it can
// report the EXACT title/now/source the header is displaying, without violating the
// hooks-in-a-`.map()` rule. Records on change and schedules a debounced flush only when
// VITE_COCKPIT_SNAPSHOT=1, so normal dev map rendering does not run diagnostics forever.
export function CockpitSnapshotProbe({
  entry,
}: {
  entry: Omit<CockpitSnapshotEntry, "updatedAt">;
}) {
  const lineupKey = entry.taskLineup.map((item) => `${item.status}:${item.content}`).join("|");
  const debugKey = JSON.stringify(entry.debug ?? {});
  useEffect(() => {
    const recordSnapshot = () => {
      if (cockpitSnapshotEnabled()) {
        const derivedContext = snapshotGoal(entry);
        recordCockpitPane(entry.paneId, {
          ...entry,
          context: derivedContext || "",
          // A renderer may carry a stale source label alongside a rejected
          // placeholder. Evidence must describe the text that actually survived
          // the Goal gate, never the discarded input's provenance.
          contextSource: derivedContext
            ? entry.contextSource || "derived-purpose"
            : "missing",
          updatedAt: Date.now(),
        });
      }
    };
    recordSnapshot();
    const heartbeat = window.setInterval(recordSnapshot, COCKPIT_SNAPSHOT_HEARTBEAT_MS);
    const derivedContext = snapshotGoal(entry);
    recordTerminalHeaderLog({
      paneId: entry.paneId,
      field: "header",
      source: [
        entry.taskSource ? `task:${entry.taskSource}` : undefined,
        entry.contextSource ? `context:${entry.contextSource}` : undefined,
        entry.titleSource ? `title:${entry.titleSource}` : undefined,
        entry.nowSource ? `now:${entry.nowSource}` : undefined,
      ].filter(Boolean).join(" "),
      text: [
        entry.task ? `Task=${entry.task}` : undefined,
        derivedContext ? `Goal=${derivedContext}` : undefined,
        `Title=${entry.title}`,
        `Now=${entry.now}`,
      ].filter(Boolean).join(" | "),
    });
    return () => {
      window.clearInterval(heartbeat);
      removeCockpitPane(entry.paneId);
    };
    // Key on the displayed values so we only re-record when something actually changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    entry.paneId,
    entry.terminalId,
    entry.tabId,
    entry.groupId,
    entry.cwd,
    entry.path,
    entry.workspace,
    entry.previewTitle,
    entry.projectEmoji,
    entry.kind,
    entry.task,
    entry.taskSource,
    entry.context,
    entry.contextSource,
    entry.title,
    entry.titleSource,
    entry.now,
    entry.nowSource,
    entry.status,
    entry.statusSummarySource,
    entry.statusSummaryError,
    entry.statusSummaryUpdatedAt,
    entry.statusSummaryNarration,
    entry.statusSummaryTask,
    entry.statusSummaryGoal,
    entry.statusSummaryNow,
    entry.tasksFromTodoWrite,
    entry.narration,
    entry.durableActivityTitle,
    entry.currentActivity,
    entry.terminalOutput,
    entry.terminalVisibleText,
    entry.terminalVisibleTextUpdatedAt,
    entry.statusSummaryPath,
    lineupKey,
    debugKey,
  ]);
  return null;
}
