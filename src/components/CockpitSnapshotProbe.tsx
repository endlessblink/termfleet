import { useEffect } from "react";
import {
  COCKPIT_SNAPSHOT_HEARTBEAT_MS,
  cockpitSnapshotEnabled,
  recordCockpitPane,
  removeCockpitPane,
  type CockpitSnapshotEntry,
} from "../lib/cockpitSnapshot";
import { recordTerminalHeaderLog } from "../lib/terminalMainUserAsk";

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
        recordCockpitPane(entry.paneId, { ...entry, updatedAt: Date.now() });
      }
    };
    recordSnapshot();
    const heartbeat = window.setInterval(recordSnapshot, COCKPIT_SNAPSHOT_HEARTBEAT_MS);
    recordTerminalHeaderLog({
      paneId: entry.paneId,
      field: "header",
      source: [
        entry.taskSource ? `task:${entry.taskSource}` : undefined,
        entry.titleSource ? `title:${entry.titleSource}` : undefined,
        entry.nowSource ? `now:${entry.nowSource}` : undefined,
      ].filter(Boolean).join(" "),
      text: [
        entry.task ? `Task=${entry.task}` : undefined,
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
    entry.cwd,
    entry.path,
    entry.workspace,
    entry.previewTitle,
    entry.projectEmoji,
    entry.kind,
    entry.task,
    entry.taskSource,
    entry.title,
    entry.titleSource,
    entry.now,
    entry.nowSource,
    entry.status,
    entry.tasksFromTodoWrite,
    entry.narration,
    entry.durableActivityTitle,
    entry.currentActivity,
    entry.terminalOutput,
    entry.terminalVisibleText,
    entry.terminalVisibleTextUpdatedAt,
    entry.statusSummaryTask,
    entry.statusSummaryNow,
    entry.statusSummaryPath,
    lineupKey,
    debugKey,
  ]);
  return null;
}
