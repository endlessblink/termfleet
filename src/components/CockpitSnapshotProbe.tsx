import { useEffect, useRef } from "react";
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

export function snapshotGoal(entry: Omit<CockpitSnapshotEntry, "updatedAt">) {
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
      "agent-goal",
      "opening-request",
      "project-fallback",
      "shell-role",
    ].includes(source)
  ) {
    return "";
  }
  // Shell panes have a deterministic structural Goal, not agent-authored
  // `$about-what` prose. Accept only that exact renderer-owned form here so
  // the final evidence boundary cannot erase it or admit arbitrary text.
  if (
    source === "shell-role" &&
    /^Run commands directly in .+\.$/.test(supplied) &&
    supplied.length <= 220
  ) {
    return supplied;
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
  // Plan explanations are allowed to carry the agent's own purpose, but a
  // clipped sentence is not evidence. Never let the trusted voice bypass the
  // same completeness boundary used by ordinary Goals.
  if (
    source === "plan-explanation" &&
    (/[…]$/.test(supplied) || /\b(?:instead of|while|and|or|to|for|the|a|an|then)\s*[.!?]?$/i.test(supplied))
  ) {
    return "";
  }
  const trustedAboutWhat =
    /^(?:this\s+session\s+is\s+about|I['’]m\s+|We['’]re\s+)/i.test(supplied) &&
    (source === "status-summary" || source === "opening-request" || source === "plan-explanation");
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
  const latestEntryRef = useRef(entry);
  latestEntryRef.current = entry;
  const capturePaneRect = (paneId: string) => {
    const escapedPaneId = CSS.escape(paneId);
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
  useEffect(() => {
    const recordSnapshot = () => {
      if (cockpitSnapshotEnabled()) {
        const currentEntry = latestEntryRef.current;
        const derivedContext = snapshotGoal(currentEntry);
        recordCockpitPane(currentEntry.paneId, {
          ...currentEntry,
          screenRect: capturePaneRect(currentEntry.paneId),
          context: derivedContext || "",
          // A renderer may carry a stale source label alongside a rejected
          // placeholder. Evidence must describe the text that actually survived
          // the Goal gate, never the discarded input's provenance.
          contextSource: derivedContext
            ? snapshotGoalSource(currentEntry) === "missing"
              ? currentEntry.statusSummaryGoalSource ?? "missing"
              : snapshotGoalSource(currentEntry)
            : "missing",
          updatedAt: Date.now(),
        });
        recordTerminalHeaderLog({
          paneId: currentEntry.paneId,
          field: "header",
          source: [
            currentEntry.taskSource ? `task:${currentEntry.taskSource}` : undefined,
            currentEntry.contextSource ? `context:${currentEntry.contextSource}` : undefined,
            currentEntry.titleSource ? `title:${currentEntry.titleSource}` : undefined,
            currentEntry.nowSource ? `now:${currentEntry.nowSource}` : undefined,
          ].filter(Boolean).join(" "),
          text: [
            currentEntry.task ? `Task=${currentEntry.task}` : undefined,
            derivedContext ? `Goal=${derivedContext}` : undefined,
            `Title=${currentEntry.title}`,
            `Now=${currentEntry.now}`,
          ].filter(Boolean).join(" | "),
        });
      }
    };
    recordSnapshot();
    const heartbeat = window.setInterval(recordSnapshot, COCKPIT_SNAPSHOT_HEARTBEAT_MS);
    return () => {
      window.clearInterval(heartbeat);
      removeCockpitPane(entry.paneId);
    };
    // Key only on rendered identity. All diagnostic state stays current through
    // latestEntryRef and flushes on the existing heartbeat.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.paneId]);

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
      const screenRect = capturePaneRect(entry.paneId);
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
