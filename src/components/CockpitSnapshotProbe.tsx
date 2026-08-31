import { useEffect } from "react";
import {
  COCKPIT_SNAPSHOT_HEARTBEAT_MS,
  cockpitSnapshotEnabled,
  captureNativePane,
  recordCockpitPane,
  recordNativeCapture,
  removeCockpitPane,
  type CockpitSnapshotEntry,
} from "../lib/cockpitSnapshot";
import { recordTerminalHeaderLog } from "../lib/terminalMainUserAsk";
import { qualityCheckGoalLabel } from "../lib/terminalHeaderQuality";

function snapshotGoal(entry: Omit<CockpitSnapshotEntry, "updatedAt">) {
  const supplied = entry.context?.trim() || entry.statusSummaryGoal?.trim() || "";
  const source = entry.context?.trim()
    ? entry.contextSource ?? ""
    : entry.statusSummaryGoalSource ?? "";
  if (source !== "project-fallback" && /^(?:Make|Keep|Help|Ensure)\s+(?:[A-Z][\w-]*|this project|the project|every|each)\s+.*\b(?:so|so that)\s+(?:people|users|work)\s+can\s+resume\b/i.test(supplied)) {
    return "";
  }
  // A project-wide fallback is useful for internal orientation, but it is not
  // pane-owned `$about-what` evidence and must never make the live gate pass.
  if (
    ![
      "status-summary",
      "task-tool",
      "user-prompt",
      "manual",
      "plan-binding",
      "plan-explanation",
      "opening-request",
      "project-fallback",
    ].includes(source)
  ) {
    return "";
  }
  // An opening request is the pane's own captured Goal. Preserve it through the
  // render boundary even when its conversational wording is not a polished label.
  if (
    source === "opening-request" &&
    supplied.length <= 220 &&
    !/[…]$/.test(supplied) &&
    !/^(?:not|no|stop|failed|error|waiting|blocked|idle|still|again)\b/i.test(supplied)
  ) {
    return supplied;
  }
  const trustedAboutWhat =
    /^(?:this\s+session\s+is\s+about|I['’]m\s+|We['’]re\s+)/i.test(supplied) &&
    (source === "status-summary" || source === "opening-request");
  const qualityInput = source === "opening-request" && supplied.endsWith("?")
    ? `${supplied.slice(0, -1)}.`
    : supplied;
  const accepted = qualityCheckGoalLabel(qualityInput, {
    allowAboutWhatVoice: true,
    allowTrustedAboutWhat: trustedAboutWhat || source === "opening-request",
    maxLength: 220,
  }).ok
    ? supplied
    : "";
  if (accepted) return accepted;
  return "";
}

function snapshotGoalSource(entry: Omit<CockpitSnapshotEntry, "updatedAt">) {
  return entry.context?.trim() ? entry.contextSource ?? "missing" : entry.statusSummaryGoalSource ?? "missing";
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
  const capturePaneRect = () => {
    const escapedPaneId = CSS.escape(entry.paneId);
    const element = document.querySelector<HTMLElement>(
      `.terminal-pane-frame[data-pane-id="${escapedPaneId}"], [data-testid="canvas-terminal-status-block"][data-pane-id="${escapedPaneId}"]`,
    );
    const rect = element?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return undefined;
    return {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
      devicePixelRatio: window.devicePixelRatio || 1,
    };
  };
  const lineupKey = entry.taskLineup.map((item) => `${item.status}:${item.content}`).join("|");
  const debugKey = JSON.stringify(entry.debug ?? {});
  useEffect(() => {
    const recordSnapshot = () => {
      if (cockpitSnapshotEnabled()) {
        const derivedContext = snapshotGoal(entry);
        recordCockpitPane(entry.paneId, {
          ...entry,
          screenRect: capturePaneRect(),
          context: derivedContext || "",
          // A renderer may carry a stale source label alongside a rejected
          // placeholder. Evidence must describe the text that actually survived
          // the Goal gate, never the discarded input's provenance.
          contextSource: derivedContext
            ? snapshotGoalSource(entry) === "missing"
              ? entry.statusSummaryGoalSource ?? "missing"
              : snapshotGoalSource(entry)
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
    entry.statusSummaryGoalSource,
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

  // Split panes are not mounted through the map coordinator, so each rendered
  // probe also owns its hourly app-surface capture. This keeps restart smoke and
  // normal split mode on the same fail-closed evidence path.
  useEffect(() => {
    let cancelled = false;
    const capture = async () => {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      if (cancelled) return;
      const screenRect = capturePaneRect();
      if (!screenRect) return;
      try {
        const path = await captureNativePane(entry.paneId);
        if (!cancelled) {
          recordNativeCapture(entry.paneId, {
            path,
            capturedAt: Date.now(),
            screenRect,
          });
        }
      } catch (error) {
        console.error(`termfleet pane capture failed for ${entry.paneId}`, error);
      }
    };
    const initial = window.setTimeout(() => void capture(), 1500);
    const hourly = window.setInterval(() => void capture(), 60 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearTimeout(initial);
      window.clearInterval(hourly);
    };
    // Capture identity is deliberately stable per pane; content freshness is
    // provided by the hourly capture and the rendered snapshot heartbeat.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.paneId]);
  return null;
}
