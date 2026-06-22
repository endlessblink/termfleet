import { useEffect } from "react";
import { recordCockpitPane, type CockpitSnapshotEntry } from "../lib/cockpitSnapshot";

// Null-returning probe (TC-035 observability). Rendered once per terminal header so it can
// report the EXACT title/now/source the header is displaying, without violating the
// hooks-in-a-`.map()` rule. Records on change and schedules a debounced flush. The recorder
// is a no-op unless dev mode / VITE_COCKPIT_SNAPSHOT, so this is safe to leave mounted.
export function CockpitSnapshotProbe({
  entry,
}: {
  entry: Omit<CockpitSnapshotEntry, "updatedAt">;
}) {
  const lineupKey = entry.taskLineup.map((item) => `${item.status}:${item.content}`).join("|");
  useEffect(() => {
    recordCockpitPane(entry.paneId, { ...entry, updatedAt: Date.now() });
    // Key on the displayed values so we only re-record when something actually changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    entry.paneId,
    entry.tabId,
    entry.cwd,
    entry.kind,
    entry.title,
    entry.now,
    entry.status,
    entry.tasksFromTodoWrite,
    entry.narration,
    entry.durableActivityTitle,
    lineupKey,
  ]);
  return null;
}
