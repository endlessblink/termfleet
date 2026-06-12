import { CSSProperties, useCallback, useRef, useState } from "react";
import {
  ArrowUpRight,
  Ban,
  Bot,
  CheckCircle2,
  ClipboardCopy,
  FileText,
  Globe,
  LocateFixed,
  Layers3,
  ListTodo,
  Maximize2,
  Minus,
  NotebookText,
  Plus,
  RefreshCw,
  RotateCcw,
  Square,
  TerminalSquare,
  X,
} from "lucide-react";
import type { CanvasNode } from "../lib/types";
import { masterPlanPath, taskStatusColor, taskStatusLabel } from "../lib/masterPlanTasks";
import { useMasterPlanTasks } from "../hooks/useMasterPlanTasks";
import { pathTail, projectForTab } from "../lib/projectDisplay";
import { createNewTab, useWorkspaceStore } from "../stores/workspace";
import { TerminalComponent } from "./Terminal";
import { LocalhostPreview } from "./LocalhostPreview";
import type { GridSnapshot } from "../lib/gridSnapshot";
import type { Tab, TerminalRuntimeStatus } from "../lib/types";
import { agentLaneStatusText, summarizeAgentLane } from "../lib/agentWorkstreamLane";

const styles: Record<string, CSSProperties> = {
  shell: {
    position: "relative",
    width: "100%",
    height: "100%",
    overflow: "hidden",
    cursor: "grab",
    background:
      "linear-gradient(var(--canvas-grid-soft) 1px, transparent 1px), linear-gradient(90deg, var(--canvas-grid-soft) 1px, transparent 1px), #1b2022",
    backgroundSize: "128px 128px, 128px 128px, auto",
  },
  toolbar: {
    position: "absolute",
    top: 14,
    left: 14,
    zIndex: 20,
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: 7,
    background: "color-mix(in srgb, var(--surface-raised) 96%, transparent)",
    border: "1px solid transparent",
    borderRadius: "var(--radius-md)",
    boxShadow: "var(--shadow-menu)",
    animation: "workbench-popover-in var(--motion-med)",
  },
  agentLaneOverlay: {
    position: "absolute",
    top: 62,
    left: 14,
    zIndex: 20,
    minWidth: 286,
    maxWidth: 420,
    display: "grid",
    gap: 8,
    padding: "9px 10px",
    background: "color-mix(in srgb, var(--surface-raised) 94%, transparent)",
    border: "1px solid var(--border-subtle)",
    borderRadius: "var(--radius-md)",
    boxShadow: "var(--shadow-menu)",
    animation: "workbench-popover-in var(--motion-med)",
  },
  agentLaneHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    color: "var(--text-primary)",
    fontSize: 12,
    fontWeight: 500,
  },
  agentLaneStats: {
    display: "flex",
    flexWrap: "wrap",
    gap: 5,
  },
  agentLaneChip: {
    height: 20,
    display: "inline-flex",
    alignItems: "center",
    padding: "0 6px",
    borderRadius: "var(--radius-xs)",
    background: "var(--surface-base)",
    color: "var(--text-secondary)",
    fontSize: 10,
  },
  agentLaneList: {
    display: "grid",
    gap: 4,
  },
  agentLaneItem: {
    minWidth: 0,
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    gap: 8,
    alignItems: "center",
    color: "var(--text-secondary)",
    fontSize: 11,
  },
  toolbarLabel: {
    height: 28,
    display: "flex",
    alignItems: "center",
    gap: 7,
    padding: "0 9px 0 4px",
    color: "var(--accent-live)",
    fontSize: 11,
    letterSpacing: 0,
    textTransform: "uppercase",
    borderRight: "1px solid var(--border-subtle)",
  },
  viewportControls: {
    position: "absolute",
    right: 12,
    bottom: 12,
    zIndex: 20,
    display: "flex",
    alignItems: "center",
    gap: 4,
    padding: 5,
    background: "color-mix(in srgb, var(--surface-raised) 94%, transparent)",
    border: "1px solid transparent",
    borderRadius: "var(--radius-md)",
    boxShadow: "var(--shadow-menu)",
    animation: "workbench-popover-in var(--motion-med)",
  },
  zoomReadout: {
    minWidth: 54,
    textAlign: "center",
    color: "var(--text-secondary)",
    fontSize: 12,
    fontFamily: "var(--font-ui)",
  },
  button: {
    height: 28,
    border: "1px solid transparent",
    borderRadius: "var(--radius-sm)",
    background: "var(--surface-base)",
    color: "var(--text-secondary)",
    fontFamily: "var(--font-ui)",
    fontSize: 12,
    padding: "0 10px",
    cursor: "pointer",
    transition: "background var(--motion-fast), border-color var(--motion-fast), color var(--motion-fast), transform var(--motion-fast)",
  },
  stage: {
    position: "absolute",
    inset: 0,
    transformOrigin: "0 0",
    willChange: "transform",
    backfaceVisibility: "hidden",
  },
  node: {
    position: "absolute",
    display: "flex",
    flexDirection: "column",
    background: "var(--surface-raised)",
    border: "1px solid transparent",
    borderRadius: "var(--radius-md)",
    boxShadow: "var(--shadow-card)",
    overflow: "hidden",
    transition: "border-color var(--motion-med), box-shadow var(--motion-med), transform var(--motion-fast)",
    animation: "workbench-surface-in var(--motion-med)",
  },
  nodeHeader: {
    minHeight: 42,
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "0 9px 0 11px",
    borderBottom: "1px solid var(--border-subtle)",
    background: "linear-gradient(180deg, var(--surface-raised), var(--surface-wash))",
    cursor: "grab",
    userSelect: "none",
  },
  nodeTitle: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: 13,
    fontWeight: 500,
    color: "var(--text-primary)",
  },
  nodeTitleMeta: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: "var(--text-secondary)",
    fontSize: 10,
    marginTop: 1,
  },
  nodeKind: {
    height: 18,
    display: "flex",
    alignItems: "center",
    padding: "0 6px",
    borderRadius: "var(--radius-xs)",
    background: "rgba(217, 154, 69, 0.12)",
    color: "var(--accent-live)",
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0,
  },
  taskBadge: {
    height: 22,
    minWidth: 0,
    maxWidth: 188,
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "0 7px",
    border: "1px solid var(--border-subtle)",
    borderRadius: "var(--radius-sm)",
    background: "var(--surface-base)",
    color: "var(--text-secondary)",
    fontSize: 11,
    fontFamily: "var(--font-ui)",
    cursor: "pointer",
  },
  taskDot: {
    width: 6,
    height: 6,
    borderRadius: 999,
    flexShrink: 0,
  },
  nodeBody: {
    flex: 1,
    minHeight: 0,
    padding: 10,
    color: "var(--text-secondary)",
    fontSize: 13,
    lineHeight: 1.45,
    overflow: "auto",
  },
  terminalBody: {
    flex: 1,
    minHeight: 0,
    padding: 0,
    overflow: "hidden",
    background: "var(--surface-sunken)",
  },
  agentCockpit: {
    height: "100%",
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    background: "var(--surface-sunken)",
  },
  agentMissionPanel: {
    position: "relative",
    zIndex: 2,
    flex: "0 0 auto",
    display: "grid",
    gap: 8,
    padding: "9px 10px",
    borderBottom: "1px solid var(--border-subtle)",
    background: "color-mix(in srgb, var(--surface-raised) 88%, #10161a)",
  },
  agentMissionHeader: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    alignItems: "start",
    gap: 8,
  },
  agentMissionLabel: {
    color: "var(--text-secondary)",
    fontSize: 10,
    letterSpacing: 0,
    textTransform: "uppercase",
  },
  agentMissionText: {
    marginTop: 2,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: "var(--text-primary)",
    fontSize: 12,
    fontWeight: 500,
  },
  agentProviderGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
    gap: 6,
  },
  agentDecisionRow: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
    gap: 6,
  },
  agentComposer: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto auto",
    alignItems: "stretch",
    gap: 6,
  },
  agentComposerInput: {
    minWidth: 0,
    minHeight: 30,
    maxHeight: 58,
    resize: "vertical",
    padding: "7px 8px",
    borderRadius: "var(--radius-sm)",
    border: "1px solid var(--border-subtle)",
    outline: "none",
    background: "var(--surface-base)",
    color: "var(--text-primary)",
    font: "inherit",
    fontSize: 11,
  },
  agentComposerButton: {
    width: 34,
    borderRadius: "var(--radius-sm)",
    border: "1px solid var(--border-subtle)",
    background: "var(--accent-live)",
    color: "#08100c",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
  },
  agentInputStrip: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) 96px",
    gap: 6,
  },
  agentRunRecordRow: {
    display: "grid",
    gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
    gap: 6,
  },
  agentDecisionCell: {
    minWidth: 0,
    display: "grid",
    gap: 2,
    padding: "6px 7px",
    borderRadius: "var(--radius-sm)",
    border: "1px solid var(--border-subtle)",
    background: "color-mix(in srgb, var(--surface-base) 86%, transparent)",
  },
  agentProviderCell: {
    minWidth: 0,
    display: "grid",
    gap: 2,
    padding: "6px 7px",
    borderRadius: "var(--radius-sm)",
    border: "1px solid var(--border-subtle)",
    background: "color-mix(in srgb, var(--surface-base) 88%, transparent)",
  },
  agentProviderCellLabel: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: "var(--text-secondary)",
    fontSize: 9,
    textTransform: "uppercase",
  },
  agentProviderCellValue: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: "var(--text-primary)",
    fontSize: 11,
  },
  agentStatusPill: {
    minWidth: 72,
    height: 22,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "0 8px",
    borderRadius: "var(--radius-sm)",
    border: "1px solid var(--border-subtle)",
    background: "var(--surface-base)",
    color: "var(--accent-live)",
    fontSize: 11,
    textTransform: "uppercase",
  },
  agentTimeline: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: 6,
  },
  agentEvent: {
    minWidth: 0,
    minHeight: 44,
    display: "grid",
    alignContent: "start",
    gap: 2,
    padding: "6px 7px",
    borderRadius: "var(--radius-sm)",
    border: "1px solid var(--border-subtle)",
    background: "color-mix(in srgb, var(--surface-base) 92%, transparent)",
  },
  agentEventTop: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
    minWidth: 0,
  },
  agentEventKind: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: "var(--accent-live)",
    fontSize: 10,
    textTransform: "uppercase",
  },
  agentEventTime: {
    color: "var(--text-secondary)",
    fontSize: 10,
    flexShrink: 0,
  },
  agentEventLabel: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: "var(--text-primary)",
    fontSize: 11,
  },
  agentTerminalSlot: {
    position: "relative",
    zIndex: 1,
    flex: "1 1 auto",
    minHeight: 0,
    overflow: "hidden",
  },
  nativeTerminalPreview: {
    height: "100%",
    display: "grid",
    gridTemplateRows: "1fr auto",
    gap: 12,
    padding: 16,
    background: "linear-gradient(180deg, #10161a, #0b1013)",
    color: "var(--terminal-fg)",
    cursor: "pointer",
  },
  nativeTerminalPreviewGrid: {
    display: "grid",
    alignContent: "start",
    gap: 8,
    padding: 12,
    border: "1px solid transparent",
    borderRadius: "var(--radius-sm)",
    background:
      "linear-gradient(90deg, rgba(255,255,255,0.045) 1px, transparent 1px), linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), rgba(0,0,0,0.18)",
    backgroundSize: "28px 28px",
  },
  nativeTerminalPrompt: {
    display: "flex",
    alignItems: "center",
    gap: 9,
    minWidth: 0,
    fontFamily: "var(--font-mono)",
    fontSize: 13,
    color: "var(--terminal-fg)",
  },
  nativeTerminalPromptGlyph: {
    color: "var(--accent-live)",
  },
  nativeTerminalPath: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: "var(--text-secondary)",
  },
  nativeTerminalAction: {
    height: 32,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    border: "1px solid transparent",
    borderRadius: "var(--radius-sm)",
    background: "var(--surface-raised)",
    color: "var(--text-primary)",
    fontFamily: "var(--font-ui)",
    fontSize: 12,
    cursor: "pointer",
  },
  terminalSummary: {
    height: "100%",
    overflow: "hidden",
    background: "linear-gradient(180deg, #151a1d, #111619)",
    cursor: "pointer",
    userSelect: "none",
  },
  terminalSummaryContent: {
    height: "100%",
    display: "grid",
    gridTemplateRows: "1fr auto",
    gap: 12,
    padding: 14,
    color: "var(--terminal-fg)",
    transformOrigin: "top left",
    userSelect: "none",
  },
  terminalMiniSummaryContent: {
    height: "100%",
    display: "grid",
    gridTemplateRows: "1fr auto",
    gap: 8,
    padding: 10,
    color: "var(--terminal-fg)",
    transformOrigin: "top left",
    userSelect: "none",
  },
  terminalMiniTitle: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    alignSelf: "end",
    color: "var(--text-primary)",
    fontFamily: "var(--font-ui)",
    fontSize: 14,
    fontWeight: 500,
  },
  terminalMiniMeta: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: "var(--text-secondary)",
    fontFamily: "var(--font-mono)",
    fontSize: 11,
  },
  terminalMiniFooter: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    color: "var(--text-secondary)",
    fontFamily: "var(--font-ui)",
    fontSize: 11,
  },
  terminalSummaryPanel: {
    minHeight: 0,
    display: "grid",
    alignContent: "start",
    gap: 8,
    padding: 13,
    borderRadius: "var(--radius-sm)",
    background: "rgba(255,255,255,0.025)",
    border: "1px solid var(--border-subtle)",
  },
  terminalSummaryTitle: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: "var(--text-primary)",
    fontFamily: "var(--font-ui)",
    fontSize: 14,
    fontWeight: 500,
  },
  terminalSummaryMeta: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: "var(--text-secondary)",
    fontFamily: "var(--font-mono)",
    fontSize: 12,
  },
  terminalSummaryCommand: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
    marginTop: 6,
    paddingTop: 10,
    borderTop: "1px solid var(--border-subtle)",
    color: "var(--terminal-fg)",
    fontFamily: "var(--font-mono)",
    fontSize: 12,
  },
  terminalSummaryFooter: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    color: "var(--text-secondary)",
    fontFamily: "var(--font-ui)",
    fontSize: 11,
  },
  terminalMapPreview: {
    height: "100%",
    display: "grid",
    gridTemplateRows: "auto 1fr auto",
    gap: 9,
    padding: 10,
    overflow: "hidden",
    background: "linear-gradient(180deg, #14191c, #101517)",
    color: "var(--terminal-fg)",
    cursor: "pointer",
    userSelect: "none",
  },
  terminalMapPreviewHeader: {
    minWidth: 0,
    display: "grid",
    gridTemplateColumns: "1fr auto",
    gap: 10,
    alignItems: "start",
  },
  terminalMapPreviewTitle: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: "var(--text-primary)",
    fontFamily: "var(--font-ui)",
    fontSize: 13,
    fontWeight: 500,
  },
  terminalMapPreviewMeta: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: "var(--text-secondary)",
    fontFamily: "var(--font-mono)",
    fontSize: 10,
  },
  terminalMapPreviewStatus: {
    minWidth: 0,
    color: "var(--text-secondary)",
    fontFamily: "var(--font-ui)",
    fontSize: 10,
    textTransform: "uppercase",
  },
  terminalMapPreviewBody: {
    minHeight: 0,
    display: "block",
    padding: "6px 7px",
    borderRadius: "var(--radius-sm)",
    background: "#101416",
    border: "1px solid rgba(255,255,255,0.045)",
    overflow: "hidden",
  },
  terminalMapPreviewRow: {
    height: 8,
    display: "block",
    overflow: "hidden",
    whiteSpace: "pre",
    fontFamily: "var(--font-mono)",
    fontSize: 8,
    lineHeight: "8px",
    letterSpacing: 0,
  },
  terminalMapPreviewCell: {
    display: "inline",
  },
  terminalMapPreviewFooter: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    color: "var(--text-secondary)",
    fontFamily: "var(--font-ui)",
    fontSize: 10,
  },
  closeButton: {
    border: "none",
    background: "transparent",
    color: "var(--text-secondary)",
    cursor: "pointer",
    fontFamily: "var(--font-ui)",
    fontSize: 14,
  },
  headerButton: {
    border: "1px solid transparent",
    background: "var(--surface-raised)",
    color: "var(--text-secondary)",
    cursor: "pointer",
    fontFamily: "var(--font-ui)",
    fontSize: 12,
    height: 22,
    minWidth: 22,
    borderRadius: "var(--radius-sm)",
    padding: "0 5px",
    transition: "background var(--motion-fast), border-color var(--motion-fast), color var(--motion-fast)",
  },
  resizeHandle: {
    position: "absolute",
    zIndex: 8,
  },
  cornerHandle: {
    width: 14,
    height: 14,
    border: "1px solid transparent",
    borderRadius: 3,
    background: "var(--surface-base)",
  },
  edgeHandle: {
    background: "transparent",
  },
  sizeBadge: {
    position: "absolute",
    right: 22,
    bottom: 5,
    zIndex: 7,
    padding: "2px 6px",
    borderRadius: 4,
    background: "color-mix(in srgb, var(--surface-sunken) 90%, transparent)",
    border: "1px solid transparent",
    color: "var(--text-secondary)",
    fontSize: 11,
    fontFamily: "var(--font-ui)",
    pointerEvents: "none",
  },
  empty: {
    position: "absolute",
    left: "50%",
    top: "50%",
    transform: "translate(-50%, -50%)",
    color: "var(--text-secondary)",
    fontSize: 13,
    textAlign: "center",
  },
};

const NODE_MIN_SIZE = {
  terminal: { width: 820, height: 460 },
  preview: { width: 620, height: 420 },
  file: { width: 260, height: 120 },
  note: { width: 220, height: 120 },
};
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2.2;
const READABLE_TERMINAL_ZOOM = 1;
const FOCUS_TERMINAL_ZOOM = 1;
const MAP_TERMINAL_RENDER_SCALE = 2;

function workstreamLabel(provider?: string) {
  if (provider === "opencode") return "OpenCode";
  if (provider === "claude") return "Claude";
  if (provider === "shell") return "Shell";
  return "Codex";
}

function shortEventTime(at: number) {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function shortRunId(runId?: string) {
  return runId ? runId.split("-").slice(-1)[0] : "pending";
}

function runTimestamp(at?: number) {
  return at ? new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "pending";
}

function latestWorkstreamInput(workstream?: Tab["workstream"]) {
  const inputs = workstream?.inputQueue ?? [];
  return inputs[inputs.length - 1];
}

function recoveryPromptFor(workstream?: Tab["workstream"]) {
  return `Recover ${workstreamLabel(workstream?.provider)} workstream: inspect the failure output, summarize the root cause, and propose the next command.`;
}

function formatAgentRunBrief(tab: Tab) {
  const workstream = tab.workstream;
  if (!workstream) return `${tab.title}\nNo workstream metadata available.`;
  const latestEvent = workstream.events?.[workstream.events.length - 1];
  const mission = workstream.mission ?? workstream.prompt ?? "Supervised workstream";
  const latestInput = latestWorkstreamInput(workstream);
  return [
    `Agent workstream: ${tab.title}`,
    `Run: ${workstream.runId ?? "pending"} (generation ${workstream.generation ?? 0})`,
    `Mission: ${mission}`,
    `Provider: ${workstreamLabel(workstream.provider)}`,
    `Status: ${workstream.status} / ${workstream.phase ?? "unknown"}`,
    `Readiness: ${workstream.readiness ?? "unknown"}`,
    `Exit: ${typeof workstream.exitCode === "number" ? workstream.exitCode : "pending"}`,
    `Timing: started=${workstream.createdAt ? new Date(workstream.createdAt).toISOString() : "unknown"}, completed=${workstream.completedAt ? new Date(workstream.completedAt).toISOString() : "pending"}, reviewed=${workstream.reviewedAt ? new Date(workstream.reviewedAt).toISOString() : "pending"}`,
    `Summary: ${workstream.lastSummary ?? "No summary yet"}`,
    `Next: ${workstream.nextAction ?? "Watch provider response"}`,
    `Outcome: ${workstream.outcome ?? "Pending"}`,
    `Latest input: ${latestInput ? `${latestInput.sentAt ? "sent" : "queued"} - ${latestInput.text}` : "none"}`,
    `Run record: prompts=${workstream.promptCount ?? 0}, sent=${workstream.sentCount ?? 0}, signals=${workstream.signalCount ?? 0}, controls=${workstream.controlCount ?? 0}`,
    `Latest event: ${latestEvent ? `${latestEvent.kind} - ${latestEvent.label}` : "none"}`,
  ].join("\n");
}
type ResizeDirection = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

function isDesktopNativeRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function snapTerminalPixel(value: number, nodeType: CanvasNode["type"], zoom: number) {
  return nodeType === "terminal" && zoom === 1 ? Math.round(value) : value;
}

function clampNodeSize(type: CanvasNode["type"], width: number, height: number) {
  const min = NODE_MIN_SIZE[type];
  return {
    width: Math.max(min.width, Math.round(width)),
    height: Math.max(min.height, Math.round(height)),
  };
}

function cursorForDirection(direction: ResizeDirection) {
  if (direction === "n" || direction === "s") return "ns-resize";
  if (direction === "e" || direction === "w") return "ew-resize";
  if (direction === "ne" || direction === "sw") return "nesw-resize";
  return "nwse-resize";
}

function handleStyle(direction: ResizeDirection): CSSProperties {
  const edge = 6;
  const corner = 14;
  const base = {
    ...styles.resizeHandle,
    cursor: cursorForDirection(direction),
  };

  if (direction === "n") return { ...base, ...styles.edgeHandle, left: corner, right: corner, top: -edge, height: edge * 2 };
  if (direction === "s") return { ...base, ...styles.edgeHandle, left: corner, right: corner, bottom: -edge, height: edge * 2 };
  if (direction === "e") return { ...base, ...styles.edgeHandle, top: corner, bottom: corner, right: -edge, width: edge * 2 };
  if (direction === "w") return { ...base, ...styles.edgeHandle, top: corner, bottom: corner, left: -edge, width: edge * 2 };
  if (direction === "ne") return { ...base, ...styles.cornerHandle, top: -corner / 2, right: -corner / 2 };
  if (direction === "nw") return { ...base, ...styles.cornerHandle, top: -corner / 2, left: -corner / 2 };
  if (direction === "se") return { ...base, ...styles.cornerHandle, bottom: -corner / 2, right: -corner / 2 };
  return { ...base, ...styles.cornerHandle, bottom: -corner / 2, left: -corner / 2 };
}

function nextNodePosition(count: number) {
  return {
    x: 120 + (count % 4) * 36,
    y: 90 + (count % 5) * 34,
  };
}

type TerminalPreviewEntry = {
  snapshot: GridSnapshot;
  updatedAt: number;
};

export function snapshotPreviewRows(snapshot: GridSnapshot | undefined, maxRows = 14, maxCols = 72) {
  if (!snapshot?.cells.length) {
    return Array.from({ length: maxRows }, () => ({
      segments: [{ text: " ".repeat(maxCols), color: "rgba(148, 163, 184, 0.22)", active: false }],
    }));
  }

  const rowCount = Math.min(maxRows, snapshot.cells.length);
  return Array.from({ length: rowCount }, (_, index) => {
    const sourceRow = snapshot.cells[Math.floor(index * snapshot.cells.length / rowCount)] ?? [];
    const colCount = Math.min(maxCols, Math.max(1, snapshot.cols));
    const cells = Array.from({ length: colCount }, (_, colIndex) => {
      const sourceIndex = Math.floor(colIndex * Math.max(1, sourceRow.length) / colCount);
      const cell = sourceRow[sourceIndex];
      const active = Boolean(cell?.c?.trim());
      const char = cell?.c && cell.c !== "\u0000" ? cell.c : " ";
      const color = active
        ? cell?.fg ?? "var(--terminal-fg)"
        : "rgba(148, 163, 184, 0.16)";
      return { char, color, active };
    });
    const segments = cells.reduce<Array<{ text: string; color: string; active: boolean }>>((acc, cell) => {
      const prev = acc[acc.length - 1];
      if (prev && prev.color === cell.color && prev.active === cell.active) {
        prev.text += cell.char;
        return acc;
      }
      acc.push({ text: cell.char, color: cell.color, active: cell.active });
      return acc;
    }, []);
    return { segments };
  });
}

function TerminalMapPreview({
  title,
  meta,
  status,
  ptyCount,
  preview,
  onActivate,
  onOpen,
}: {
  title: string;
  meta?: string;
  status?: TerminalRuntimeStatus;
  ptyCount: number;
  preview?: TerminalPreviewEntry;
  onActivate: () => void;
  onOpen: () => void;
}) {
  const rows = snapshotPreviewRows(preview?.snapshot);
  const ageSeconds = preview ? Math.max(0, Math.round((Date.now() - preview.updatedAt) / 1000)) : null;

  return (
    <div
      style={styles.terminalMapPreview}
      role="button"
      tabIndex={0}
      data-terminal-map-preview="state-shape"
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onActivate();
      }}
      onClick={(event) => {
        event.stopPropagation();
        onActivate();
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        event.stopPropagation();
        onActivate();
      }}
    >
      <div style={styles.terminalMapPreviewHeader}>
        <div style={{ minWidth: 0 }}>
          <div style={styles.terminalMapPreviewTitle}>{title}</div>
          <div style={styles.terminalMapPreviewMeta}>{meta ?? "No cwd"}</div>
        </div>
        <div style={styles.terminalMapPreviewStatus}>{status ?? "stale"}</div>
      </div>
      <div style={styles.terminalMapPreviewBody} aria-hidden="true">
        {rows.map((row, rowIndex) => (
          <div key={rowIndex} style={styles.terminalMapPreviewRow}>
            {row.segments.map((segment, segmentIndex) => (
              <span
                key={segmentIndex}
                style={{
                  ...styles.terminalMapPreviewCell,
                  color: segment.color,
                  opacity: segment.active ? 0.95 : 0.28,
                }}
              >
                {segment.text}
              </span>
            ))}
          </div>
        ))}
      </div>
      <div style={styles.terminalMapPreviewFooter}>
        <span>{preview ? `${preview.snapshot.cols}x${preview.snapshot.rows}` : "waiting"}</span>
        <span>{ageSeconds === null ? `${ptyCount} PTY` : `${ageSeconds}s ago`}</span>
      </div>
    </div>
  );
}

function CanvasNodeView({
  node,
  focusNode,
  terminalPreview,
  onTerminalSnapshot,
}: {
  node: CanvasNode;
  focusNode: (node: CanvasNode, zoom: number) => void;
  terminalPreview?: TerminalPreviewEntry;
  onTerminalSnapshot: (nodeId: string, snapshot: GridSnapshot) => void;
}) {
  const tabs = useWorkspaceStore((state) => state.tabs);
  const groups = useWorkspaceStore((state) => state.groups);
  const liveCwds = useWorkspaceStore((state) => state.liveCwds);
  const selectedNodeId = useWorkspaceStore((state) => state.canvasState.selectedNodeId);
  const zoom = useWorkspaceStore((state) => state.canvasState.viewport.zoom);
  const updateCanvasNode = useWorkspaceStore((state) => state.updateCanvasNode);
  const removeCanvasNode = useWorkspaceStore((state) => state.removeCanvasNode);
  const closeTerminalSession = useWorkspaceStore((state) => state.closeTerminalSession);
  const closePane = useWorkspaceStore((state) => state.closePane);
  const updatePreviewPaneUrl = useWorkspaceStore((state) => state.updatePreviewPaneUrl);
  const selectCanvasNode = useWorkspaceStore((state) => state.selectCanvasNode);
  const setActiveTab = useWorkspaceStore((state) => state.setActiveTab);
  const setWorkspaceMode = useWorkspaceStore((state) => state.setWorkspaceMode);
  const terminalRendererMode = useWorkspaceStore((state) => state.workspaceUiState.terminalRendererMode);
  const dragRef = useRef<{ x: number; y: number; nodeX: number; nodeY: number } | null>(null);
  const resizeRef = useRef<{
    pointerX: number;
    pointerY: number;
    nodeX: number;
    nodeY: number;
    width: number;
    height: number;
    direction: ResizeDirection;
  } | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const [operatorDraft, setOperatorDraft] = useState("");
  const selected = selectedNodeId === node.id;
  const showTerminalPreview = node.type === "terminal" && zoom < READABLE_TERMINAL_ZOOM;

  const activateTerminalNode = useCallback(() => {
    selectCanvasNode(node.id);
    if (node.type === "terminal" && zoom < READABLE_TERMINAL_ZOOM) {
      focusNode(node, FOCUS_TERMINAL_ZOOM);
    }
  }, [focusNode, node, selectCanvasNode, zoom]);

  const onMouseDown = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    selectCanvasNode(node.id);
    dragRef.current = {
      x: event.clientX,
      y: event.clientY,
      nodeX: node.x,
      nodeY: node.y,
    };

    function onMouseMove(moveEvent: MouseEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      const nextX = drag.nodeX + (moveEvent.clientX - drag.x) / zoom;
      const nextY = drag.nodeY + (moveEvent.clientY - drag.y) / zoom;
      updateCanvasNode(node.id, {
        x: snapTerminalPixel(nextX, node.type, zoom),
        y: snapTerminalPixel(nextY, node.type, zoom),
      });
    }

    function onMouseUp() {
      dragRef.current = null;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [node.id, node.x, node.y, selectCanvasNode, updateCanvasNode, zoom]);

  const onResizeMouseDown = useCallback((event: React.MouseEvent, direction: ResizeDirection) => {
    event.preventDefault();
    event.stopPropagation();
    selectCanvasNode(node.id);
    setIsResizing(true);
    resizeRef.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      nodeX: node.x,
      nodeY: node.y,
      width: node.width,
      height: node.height,
      direction,
    };

    function onMouseMove(moveEvent: MouseEvent) {
      const resize = resizeRef.current;
      if (!resize) return;
      const deltaX = (moveEvent.clientX - resize.pointerX) / zoom;
      const deltaY = (moveEvent.clientY - resize.pointerY) / zoom;
      const affectsWest = resize.direction.includes("w");
      const affectsEast = resize.direction.includes("e");
      const affectsNorth = resize.direction.includes("n");
      const affectsSouth = resize.direction.includes("s");

      const rawWidth = resize.width + (affectsEast ? deltaX : 0) - (affectsWest ? deltaX : 0);
      const rawHeight = resize.height + (affectsSouth ? deltaY : 0) - (affectsNorth ? deltaY : 0);
      const next = clampNodeSize(node.type, rawWidth, rawHeight);

      updateCanvasNode(node.id, {
        ...next,
        x: snapTerminalPixel(
          affectsWest ? resize.nodeX + resize.width - next.width : resize.nodeX,
          node.type,
          zoom
        ),
        y: snapTerminalPixel(
          affectsNorth ? resize.nodeY + resize.height - next.height : resize.nodeY,
          node.type,
          zoom
        ),
      });
    }

    function onMouseUp() {
      resizeRef.current = null;
      setIsResizing(false);
      document.body.classList.remove("no-select");
      document.body.style.cursor = "";
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    }

    document.body.classList.add("no-select");
    document.body.style.cursor = cursorForDirection(direction);
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [node.height, node.id, node.type, node.width, node.x, node.y, selectCanvasNode, updateCanvasNode, zoom]);

  const onRename = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const nextTitle = window.prompt(`Rename ${node.type}`, node.title);
    const trimmed = nextTitle?.trim();
    if (trimmed) {
      updateCanvasNode(node.id, { title: trimmed });
    }
  }, [node.id, node.title, node.type, updateCanvasNode]);

  const linkedTab = node.terminalTabId
    ? tabs.find((tab) => tab.id === node.terminalTabId)
    : undefined;
  const linkedProject = projectForTab(linkedTab, groups);
  const terminalRoot = node.terminalCwd ?? linkedTab?.initialCwd;
  const taskRoot = linkedProject?.projectRoot ?? terminalRoot;
  const normalizedTaskRoot = taskRoot?.replace(/\/+$/, "");
  const tasksByRoot = useMasterPlanTasks([normalizedTaskRoot]);
  const rootTasks = normalizedTaskRoot ? tasksByRoot[normalizedTaskRoot] ?? [] : [];
  const boundTask = node.taskBinding
    ? rootTasks.find((task) => task.id.toLowerCase() === node.taskBinding?.taskId.toLowerCase())
    : undefined;
  const terminalTabId = linkedTab?.id ?? `canvas-${node.id}`;
  // The map node MUST share the tab's active pane identity. Terminal.tsx derives
  // runtimeSessionId = `terminal-${tabId}-${paneId}`, so the map node and the split
  // pane only attach to the SAME daemon PTY when they agree on this paneId. The map
  // and split views are mutually exclusive (workspaceMode is canvas xor split, and
  // WorkspaceSurface mounts only one), so they never compete over the session at the
  // same time — sharing the id is exactly what lets switching between map and split
  // reattach to the live shell instead of minting a fresh one (the terminal-reset
  // regression). The `node.id` fallback is the LAST resort (a node with no live
  // tab); before it, prefer any pane the tab already owns, because spawning
  // against `node.id` (`terminal-map-<tabId>`) mints a SEPARATE daemon PTY from
  // the split's `terminal-<tabId>-<activePaneId>` — that orphan shell is the
  // "extra line on the map" that accrues across map↔split switches.
  const terminalPaneId =
    linkedTab?.activePaneId ?? linkedTab?.terminals[0]?.paneId ?? node.id;
  // Resolve the live PTY id for this shared pane (for attach only), falling back to
  // the persisted node pty or the tab's first terminal.
  const linkedPaneTerminalId = linkedTab?.terminals.find((terminal) => terminal.paneId === terminalPaneId)?.id;
  const linkedTerminalId = linkedPaneTerminalId ?? node.terminalPtyId ?? linkedTab?.terminals[0]?.id;
  const linkedTerminal = linkedTerminalId
    ? linkedTab?.terminals.find((terminal) => terminal.id === linkedTerminalId)
    : undefined;
  // Prefer the live cwd (polled from the PTY) over the initial cwd so the
  // breadcrumb tracks `cd`/`z`; falls back to the spawn cwd before the first poll.
  const liveTerminalRoot = (linkedTerminalId ? liveCwds[linkedTerminalId] : undefined) ?? terminalRoot;
  // Title a terminal node by what it actually points at: a named project wins,
  // otherwise the current directory's name (tracks cd/z via liveTerminalRoot).
  // A manual rename (title differs from the default) is respected.
  const cwdName = liveTerminalRoot?.split("/").filter(Boolean).pop();
  const isDefaultName = (value?: string) => !value || value === "Terminal";
  const terminalTitle =
    linkedProject?.name ??
    (isDefaultName(linkedTab?.title) && isDefaultName(node.title)
      ? cwdName ?? "Terminal"
      : linkedTab?.title ?? node.title);
  const workstream = linkedTab?.workstream;
  const queuedWorkstreamInput = workstream?.inputQueue?.find((input) => !input.sentAt);
  const latestInput = latestWorkstreamInput(workstream);
  const cancellationPending = workstream?.phase === "cancelling";
  const canDraftRecovery =
    workstream?.phase === "blocked" ||
    workstream?.status === "failed" ||
    workstream?.providerAvailable === false;
  const canReviewWorkstream =
    workstream?.phase !== "reviewed" && (workstream?.status === "done" || workstream?.phase === "complete");
  const nodeKind = workstream?.kind === "agent"
    ? "agent"
    : node.type === "terminal"
      ? "shell"
      : node.type === "preview"
        ? "preview"
        : node.type;
  // Native VTE is disabled app-wide (see useNativeTerminalPane.wantsNativeRenderer):
  // the GTK overlay could not live on the zoom/pan canvas, which is why map nodes
  // used to fall back to a static "Open terminal" card. With xterm.js everywhere,
  // map nodes render a live terminal directly. Kept as a constant so the card
  // branch and its helpers type-check; restore the old expression alongside the
  // `native-vte-snapshot` tag if native VTE is reinstated.
  const shouldUseNativeSplitForInteraction = false;
  void isDesktopNativeRuntime;
  void terminalRendererMode;
  const openLinkedTerminal = useCallback(() => {
    if (!linkedTab) return;
    setActiveTab(linkedTab.id);
    setWorkspaceMode("split");
  }, [linkedTab, setActiveTab, setWorkspaceMode]);

  const onBindTask = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();

    if (!normalizedTaskRoot) {
      window.alert("No project root is available for this terminal.");
      return;
    }

    const options = rootTasks
      .slice(0, 24)
      .map((task) => `${task.id}  ${taskStatusLabel(task.status)}  ${task.title}`)
      .join("\n");
    const nextTaskId = window.prompt(
      `Bind this terminal to a MASTER_PLAN task id.\n\n${options || "No tasks found in MASTER_PLAN.md."}\n\nLeave blank to clear the binding.`,
      node.taskBinding?.taskId ?? ""
    );
    if (nextTaskId === null) return;

    const trimmed = nextTaskId.trim();
    updateCanvasNode(node.id, {
      taskBinding: trimmed
        ? { taskId: trimmed, planPath: masterPlanPath(normalizedTaskRoot) }
        : undefined,
    });
  }, [node.id, node.taskBinding?.taskId, normalizedTaskRoot, rootTasks, updateCanvasNode]);

  const queueOperatorDraft = useCallback(() => {
    if (!linkedTab?.workstream) return;
    const queued = useWorkspaceStore.getState().queueWorkstreamInput(linkedTab.id, operatorDraft);
    if (!queued) return;
    setOperatorDraft("");
    setActiveTab(linkedTab.id);
  }, [linkedTab, operatorDraft, setActiveTab]);

  const onFocusWorkstreamComposer = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    composerRef.current?.focus();
  }, []);

  const onSubmitWorkstreamInput = useCallback((event: React.FormEvent) => {
    event.preventDefault();
    event.stopPropagation();
    queueOperatorDraft();
  }, [queueOperatorDraft]);

  const onDraftRecoveryPrompt = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setOperatorDraft(recoveryPromptFor(linkedTab?.workstream));
    requestAnimationFrame(() => composerRef.current?.focus());
  }, [linkedTab]);

  const onCopyWorkstreamBrief = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!linkedTab?.workstream) return;
    const brief = formatAgentRunBrief(linkedTab);
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(brief);
      return;
    }
    window.prompt("Agent run brief", brief);
  }, [linkedTab]);

  const onStopWorkstream = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!linkedTab?.workstream) return;
    void useWorkspaceStore.getState().stopWorkstream(linkedTab.id);
  }, [linkedTab]);

  const onInterruptWorkstream = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!linkedTab?.workstream) return;
    void useWorkspaceStore.getState().interruptWorkstream(linkedTab.id);
  }, [linkedTab]);

  const onRestartWorkstream = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!linkedTab?.workstream) return;
    setActiveTab(linkedTab.id);
    void useWorkspaceStore.getState().restartWorkstream(linkedTab.id);
  }, [linkedTab, setActiveTab]);

  const onReviewWorkstream = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!linkedTab?.workstream) return;
    useWorkspaceStore.getState().reviewWorkstream(linkedTab.id);
  }, [linkedTab]);

  const body =
    node.type === "terminal" && shouldUseNativeSplitForInteraction ? (
      <div
        style={styles.nativeTerminalPreview}
        role="button"
        tabIndex={0}
        onClick={(event) => {
          event.stopPropagation();
          openLinkedTerminal();
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          event.stopPropagation();
          openLinkedTerminal();
        }}
      >
        <div style={styles.nativeTerminalPreviewGrid}>
          <div style={styles.nativeTerminalPrompt}>
            <TerminalSquare size={15} strokeWidth={1.8} />
            <span style={styles.nativeTerminalPromptGlyph}>$</span>
            <span style={styles.nativeTerminalPath}>{pathTail(liveTerminalRoot)}</span>
          </div>
          <div style={styles.nativeTerminalPrompt}>
            <span style={styles.nativeTerminalPromptGlyph}>native</span>
            <span style={styles.nativeTerminalPath}>{linkedTab?.title ?? node.title}</span>
          </div>
        </div>
        <button
          style={styles.nativeTerminalAction}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            openLinkedTerminal();
          }}
        >
          <ArrowUpRight size={14} strokeWidth={1.8} />
          Open terminal
        </button>
      </div>
    ) : showTerminalPreview ? (
      <TerminalMapPreview
        title={terminalTitle}
        meta={pathTail(liveTerminalRoot)}
        status={linkedTerminal?.status}
        ptyCount={linkedTab?.terminals.length ?? 0}
        preview={terminalPreview}
        onActivate={activateTerminalNode}
        onOpen={openLinkedTerminal}
      />
    ) : node.type === "terminal" ? (
      <TerminalComponent
        key={`${terminalTabId}-${terminalPaneId}-${workstream?.generation ?? 0}`}
        tabId={terminalTabId}
        paneId={terminalPaneId}
        cwd={node.terminalCwd ?? linkedTab?.initialCwd}
        command={workstream?.startupCommand}
        queuedInput={queuedWorkstreamInput}
        onQueuedInputSent={(inputId) => {
          if (linkedTab) useWorkspaceStore.getState().markWorkstreamInputSent(linkedTab.id, inputId);
        }}
        attachToPtyId={linkedTerminalId ?? null}
        runtimeActive={selected}
        onActivate={activateTerminalNode}
        standalone
        renderScale={MAP_TERMINAL_RENDER_SCALE}
        onSnapshot={(snapshot) => onTerminalSnapshot(node.id, snapshot)}
        // The selected map terminal is the user's active work surface, so it
        // must reflow to the node and stay readable instead of showing a frozen,
        // scaled-down projection of a larger split-pane grid.
        mapProjection={false}
      />
    ) : node.type === "preview" ? (
      <LocalhostPreview
        previewUrl={node.previewUrl}
        onPreviewUrlChange={(previewUrl) => {
          if (linkedTab && node.previewPaneId) {
            updatePreviewPaneUrl(linkedTab.id, node.previewPaneId, previewUrl);
            return;
          }
          updateCanvasNode(node.id, {
            title: `Preview ${previewUrl.replace(/^https?:\/\//, "")}`,
            previewUrl,
          });
        }}
      />
    ) : node.type === "file" ? (
      <div dir="auto">{node.filePath ?? "No file attached yet"}</div>
    ) : (
      <div dir="auto">{node.content}</div>
    );

  return (
    <section
      style={{
        ...styles.node,
        left: node.x,
        top: node.y,
        width: node.width,
        height: node.height,
        borderColor: selected ? "var(--border-focus)" : "var(--border-subtle)",
        boxShadow: selected
          ? "0 0 0 1px rgba(217,154,69,0.36), 0 20px 54px rgba(0,0,0,0.52)"
          : styles.node.boxShadow,
      }}
      onMouseDown={(event) => {
        event.stopPropagation();
        activateTerminalNode();
      }}
    >
      <div style={styles.nodeHeader} onMouseDown={onMouseDown}>
        <span
          style={{
            ...styles.nodeKind,
            borderLeft: linkedTab?.color ? `2px solid ${linkedTab.color}` : undefined,
          }}
        >
          {nodeKind}
        </span>
        {node.type === "terminal" && workstream?.kind === "agent" && (
          <span
            style={styles.taskBadge}
            title={[
              workstream.startupCommand ? `Starts ${workstream.startupCommand}` : workstream.mission ?? workstream.prompt ?? "Supervised agent workstream",
              workstream.providerAvailabilityMessage,
            ].filter(Boolean).join(" · ")}
          >
            <Bot size={12} strokeWidth={1.8} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {workstreamLabel(workstream.provider)} · {workstream.status}
            </span>
          </span>
        )}
        {node.type === "terminal" && node.taskBinding && (
          <button
            type="button"
            style={styles.taskBadge}
            title={boundTask ? boundTask.title : "Task not found in MASTER_PLAN.md"}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={onBindTask}
          >
            <span
              style={{
                ...styles.taskDot,
                background: taskStatusColor(boundTask?.status ?? "unknown"),
              }}
            />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {node.taskBinding.taskId} · {taskStatusLabel(boundTask?.status ?? "unknown")}
            </span>
          </button>
        )}
        <span
          style={{ minWidth: 0, flex: 1 }}
          dir="auto"
          title="Double-click to rename"
          onDoubleClick={onRename}
        >
          <div style={styles.nodeTitle}>
            {node.type === "terminal" ? terminalTitle : node.title}
          </div>
          {node.type === "terminal" && (
            <div style={styles.nodeTitleMeta}>
              {linkedProject ? `${pathTail(liveTerminalRoot)} · ${linkedTab?.title ?? node.title}` : pathTail(liveTerminalRoot)}
            </div>
          )}
          {node.type === "preview" && node.previewUrl && (
            <div style={styles.nodeTitleMeta}>{node.previewUrl}</div>
          )}
        </span>
        {node.type === "preview" && (
          <button
            style={styles.headerButton}
            title="Open preview pane"
            aria-label="Open preview pane"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              if (linkedTab) {
                setActiveTab(linkedTab.id);
                if (node.previewPaneId) useWorkspaceStore.getState().setActivePane(linkedTab.id, node.previewPaneId);
                setWorkspaceMode("split");
              }
            }}
          >
            <Globe size={13} strokeWidth={1.8} />
          </button>
        )}
        {node.type === "terminal" && (
          <>
          {workstream?.kind === "agent" && (
            <>
            <button
              style={styles.headerButton}
              title="Focus follow-up composer"
              aria-label="Focus follow-up composer"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={onFocusWorkstreamComposer}
            >
              <Bot size={13} strokeWidth={1.8} />
            </button>
            <button
              style={styles.headerButton}
              title="Copy agent run brief"
              aria-label="Copy agent run brief"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={onCopyWorkstreamBrief}
            >
              <ClipboardCopy size={13} strokeWidth={1.8} />
            </button>
            <button
              style={{
                ...styles.headerButton,
                opacity: canReviewWorkstream ? undefined : 0.45,
                cursor: canReviewWorkstream ? styles.headerButton.cursor : "default",
              }}
              title={canReviewWorkstream ? "Mark run reviewed" : "Run is not complete yet"}
              aria-label="Mark run reviewed"
              disabled={!canReviewWorkstream}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={onReviewWorkstream}
            >
              <CheckCircle2 size={13} strokeWidth={1.8} />
            </button>
            <button
              style={{
                ...styles.headerButton,
                opacity: cancellationPending ? 0.55 : undefined,
                cursor: cancellationPending ? "default" : styles.headerButton.cursor,
              }}
              title={cancellationPending ? "Cancellation already requested" : "Request graceful cancellation"}
              aria-label="Interrupt workstream"
              disabled={cancellationPending}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={onInterruptWorkstream}
            >
              <Ban size={13} strokeWidth={1.8} />
            </button>
            <button
              style={styles.headerButton}
              title="Stop workstream"
              aria-label="Stop workstream"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={onStopWorkstream}
            >
              <Square size={12} strokeWidth={1.8} />
            </button>
            <button
              style={styles.headerButton}
              title="Restart workstream"
              aria-label="Restart workstream"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={onRestartWorkstream}
            >
              <RefreshCw size={13} strokeWidth={1.8} />
            </button>
            </>
          )}
          <button
            style={styles.headerButton}
            title={node.taskBinding ? "Change task binding" : "Bind MASTER_PLAN task"}
            aria-label={node.taskBinding ? "Change task binding" : "Bind MASTER_PLAN task"}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={onBindTask}
          >
            <ListTodo size={13} strokeWidth={1.8} />
          </button>
          </>
        )}
        {node.type === "terminal" && (
          <button
            style={styles.headerButton}
            title="Open full terminal"
            aria-label="Open full terminal"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              openLinkedTerminal();
            }}
          >
            <ArrowUpRight size={13} strokeWidth={1.8} />
          </button>
        )}
        <button
          style={{ ...styles.closeButton, ...styles.headerButton }}
          title={linkedTab ? "Close terminal session" : "Remove node"}
          aria-label={linkedTab ? `Close ${linkedTab.title}` : "Remove node"}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            if (linkedTab) {
              if (node.type === "preview" && node.previewPaneId) {
                closePane(linkedTab.id, node.previewPaneId);
                return;
              }
              closeTerminalSession(linkedTab.id);
              return;
            }
            removeCanvasNode(node.id);
          }}
        >
          <X size={13} strokeWidth={1.8} />
        </button>
      </div>
      <div
        style={node.type === "terminal" ? styles.terminalBody : styles.nodeBody}
        onMouseDown={node.type === "terminal"
          ? (event) => {
              event.stopPropagation();
              activateTerminalNode();
            }
          : undefined}
        onClick={node.type === "terminal" ? (event) => event.stopPropagation() : undefined}
      >
        {node.type === "terminal" && workstream?.kind === "agent" ? (
          <div style={styles.agentCockpit}>
            <div style={styles.agentMissionPanel} data-testid="agent-cockpit-panel">
              <div style={styles.agentMissionHeader}>
                <span style={{ minWidth: 0 }}>
                  <div style={styles.agentMissionLabel}>Mission</div>
                  <div style={styles.agentMissionText} title={workstream.mission ?? workstream.prompt ?? "Supervised workstream"}>
                    {workstream.mission ?? workstream.prompt ?? "Supervised workstream"}
                  </div>
                </span>
                <span style={styles.agentStatusPill}>{workstream.phase ?? workstream.status}</span>
              </div>
              <div style={styles.agentProviderGrid} aria-label="Agent provider control surface">
                <div style={styles.agentProviderCell} title={workstream.launchMode ?? "Terminal command"}>
                  <span style={styles.agentProviderCellLabel}>Launch</span>
                  <span style={styles.agentProviderCellValue}>{workstream.launchMode ?? "terminal"}</span>
                </div>
                <div style={styles.agentProviderCell} title={workstream.readinessCheck ?? workstream.providerAvailabilityMessage}>
                  <span style={styles.agentProviderCellLabel}>Readiness</span>
                  <span style={styles.agentProviderCellValue}>
                    {workstream.providerAvailable === false ? "unavailable" : workstream.readiness ?? "unknown"}
                  </span>
                </div>
                <div style={styles.agentProviderCell} title={workstream.authCheck ?? "Auth inferred from provider output"}>
                  <span style={styles.agentProviderCellLabel}>Auth</span>
                  <span style={styles.agentProviderCellValue}>
                    {workstream.readiness === "auth-required" ? "required" : workstream.readiness === "provider-ready" ? "ready" : "watching"}
                  </span>
                </div>
                <div style={styles.agentProviderCell} title={workstream.structuredStatus ? "Provider-native status" : "Status inferred from terminal output"}>
                  <span style={styles.agentProviderCellLabel}>Status</span>
                  <span style={styles.agentProviderCellValue}>{workstream.structuredStatus ? "structured" : "terminal inferred"}</span>
                </div>
                <div style={styles.agentProviderCell} title={workstream.controlProtocol ?? workstream.stopBehavior ?? "PTY interrupt/kill"}>
                  <span style={styles.agentProviderCellLabel}>Control</span>
                  <span style={styles.agentProviderCellValue}>{workstream.structuredStatus ? "markers + pty" : "pty fallback"}</span>
                </div>
              </div>
              <div style={styles.agentDecisionRow} aria-label="Agent operator guidance">
                <div style={styles.agentDecisionCell} title={workstream.lastSummary ?? "No summary yet"}>
                  <span style={styles.agentProviderCellLabel}>Summary</span>
                  <span style={styles.agentProviderCellValue}>{workstream.lastSummary ?? "Starting workstream"}</span>
                </div>
                <div style={styles.agentDecisionCell} title={workstream.nextAction ?? "Watch provider response"}>
                  <span style={styles.agentProviderCellLabel}>Next</span>
                  <span style={styles.agentProviderCellValue}>{workstream.nextAction ?? "Watch provider response"}</span>
                </div>
              </div>
              <form style={styles.agentComposer} aria-label="Agent operator composer" onSubmit={onSubmitWorkstreamInput}>
                <textarea
                  ref={composerRef}
                  style={styles.agentComposerInput}
                  aria-label="Agent follow-up prompt"
                  placeholder="Send follow-up to agent..."
                  value={operatorDraft}
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) => setOperatorDraft(event.target.value)}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                      event.preventDefault();
                      queueOperatorDraft();
                    }
                  }}
                />
                <button
                  type="button"
                  style={{
                    ...styles.agentComposerButton,
                    display: canDraftRecovery ? styles.agentComposerButton.display : "none",
                    background: "var(--surface-hover)",
                    color: "var(--text-primary)",
                  }}
                  aria-label="Draft recovery prompt"
                  title="Draft recovery prompt"
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={onDraftRecoveryPrompt}
                >
                  <RefreshCw size={14} strokeWidth={2} />
                </button>
                <button
                  type="submit"
                  style={{
                    ...styles.agentComposerButton,
                    opacity: operatorDraft.trim() ? undefined : 0.45,
                    cursor: operatorDraft.trim() ? "pointer" : "default",
                  }}
                  aria-label="Queue follow-up prompt"
                  title="Queue follow-up prompt"
                  disabled={!operatorDraft.trim()}
                  onMouseDown={(event) => event.stopPropagation()}
                >
                  <Bot size={14} strokeWidth={2} />
                </button>
              </form>
              <div style={styles.agentInputStrip} aria-label="Agent input history">
                <div style={styles.agentDecisionCell} title={latestInput?.text ?? "No operator input queued yet"}>
                  <span style={styles.agentProviderCellLabel}>Latest input</span>
                  <span style={styles.agentProviderCellValue}>{latestInput?.text ?? "None"}</span>
                </div>
                <div style={styles.agentDecisionCell} title={latestInput?.sentAt ? "Prompt has been sent to the provider" : latestInput ? "Prompt is queued for dispatch" : "No prompt yet"}>
                  <span style={styles.agentProviderCellLabel}>Input</span>
                  <span style={styles.agentProviderCellValue}>{latestInput ? (latestInput.sentAt ? "sent" : "queued") : "none"}</span>
                </div>
              </div>
              <div style={styles.agentRunRecordRow} aria-label="Agent run record">
                <div style={styles.agentProviderCell} title={workstream.runId ?? "Run id pending"}>
                  <span style={styles.agentProviderCellLabel}>Run</span>
                  <span style={styles.agentProviderCellValue}>{shortRunId(workstream.runId)} · g{workstream.generation ?? 0}</span>
                </div>
                <div style={styles.agentProviderCell} title="Queued prompts">
                  <span style={styles.agentProviderCellLabel}>Prompts</span>
                  <span style={styles.agentProviderCellValue}>{workstream.promptCount ?? 0}</span>
                </div>
                <div style={styles.agentProviderCell} title="Prompts sent to the provider">
                  <span style={styles.agentProviderCellLabel}>Sent</span>
                  <span style={styles.agentProviderCellValue}>{workstream.sentCount ?? 0}</span>
                </div>
                <div style={styles.agentProviderCell} title="Structured provider signals">
                  <span style={styles.agentProviderCellLabel}>Signals</span>
                  <span style={styles.agentProviderCellValue}>{workstream.signalCount ?? 0}</span>
                </div>
                <div style={styles.agentProviderCell} title="Operator control actions">
                  <span style={styles.agentProviderCellLabel}>Control</span>
                  <span style={styles.agentProviderCellValue}>{workstream.controlCount ?? 0}</span>
                </div>
                <div style={styles.agentProviderCell} title={workstream.outcome ?? workstream.lastSummary ?? "No outcome yet"}>
                  <span style={styles.agentProviderCellLabel}>Outcome</span>
                  <span style={styles.agentProviderCellValue}>{workstream.outcome ?? "Pending"}</span>
                </div>
                <div style={styles.agentProviderCell} title={typeof workstream.exitCode === "number" ? `Provider exited with code ${workstream.exitCode}` : "Provider has not exited"}>
                  <span style={styles.agentProviderCellLabel}>Exit</span>
                  <span style={styles.agentProviderCellValue}>{typeof workstream.exitCode === "number" ? workstream.exitCode : "pending"}</span>
                </div>
                <div style={styles.agentProviderCell} title={workstream.completedAt ? `Completed ${new Date(workstream.completedAt).toLocaleString()}` : "Run not complete yet"}>
                  <span style={styles.agentProviderCellLabel}>Done</span>
                  <span style={styles.agentProviderCellValue}>{runTimestamp(workstream.completedAt)}</span>
                </div>
                <div style={styles.agentProviderCell} title={workstream.reviewedAt ? `Reviewed ${new Date(workstream.reviewedAt).toLocaleString()}` : "Run not reviewed yet"}>
                  <span style={styles.agentProviderCellLabel}>Reviewed</span>
                  <span style={styles.agentProviderCellValue}>{runTimestamp(workstream.reviewedAt)}</span>
                </div>
              </div>
              <div style={styles.agentTimeline} aria-label="Agent workstream timeline">
                {(workstream.events ?? []).slice(-3).map((event) => (
                  <div key={event.id} style={styles.agentEvent} title={event.detail ?? event.label}>
                    <div style={styles.agentEventTop}>
                      <span style={styles.agentEventKind}>{event.kind}</span>
                      <span style={styles.agentEventTime}>{shortEventTime(event.at)}</span>
                    </div>
                    <div style={styles.agentEventLabel}>{event.label}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="agent-terminal-slot" style={styles.agentTerminalSlot}>{body}</div>
          </div>
        ) : (
          body
        )}
      </div>
      {selected && (
        <>
          {(["n", "s", "e", "w", "ne", "nw", "se", "sw"] as ResizeDirection[]).map((direction) => (
            <div
              key={direction}
              style={handleStyle(direction)}
              onMouseDown={(event) => onResizeMouseDown(event, direction)}
              title={`Resize ${direction.toUpperCase()}`}
            />
          ))}
          {isResizing && (
            <div style={styles.sizeBadge}>
              {Math.round(node.width)} × {Math.round(node.height)}
            </div>
          )}
        </>
      )}
    </section>
  );
}

export function MagicCanvas() {
  const canvasState = useWorkspaceStore((state) => state.canvasState);
  const tabs = useWorkspaceStore((state) => state.tabs);
  const setActiveTab = useWorkspaceStore((state) => state.setActiveTab);
  const addCanvasNode = useWorkspaceStore((state) => state.addCanvasNode);
  const updateCanvasNode = useWorkspaceStore((state) => state.updateCanvasNode);
  const updateCanvasViewport = useWorkspaceStore((state) => state.updateCanvasViewport);
  const openFiles = useWorkspaceStore((state) => state.openFiles);
  const shellRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<{ x: number; y: number; viewportX: number; viewportY: number } | null>(null);
  const [fileIndex, setFileIndex] = useState(0);
  const [terminalPreviews, setTerminalPreviews] = useState<Record<string, TerminalPreviewEntry>>({});
  // Right-click "create here" menu. Screen coords place the menu; canvas coords
  // drop the new node where the cursor is.
  const [menu, setMenu] = useState<{ x: number; y: number; canvasX: number; canvasY: number } | null>(null);
  const agentLane = summarizeAgentLane(tabs);

  const openCanvasMenu = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return; // only empty canvas background
    event.preventDefault();
    const rect = shellRef.current?.getBoundingClientRect();
    const viewport = canvasState.viewport;
    const canvasX = rect ? (event.clientX - rect.left - viewport.x) / viewport.zoom : 0;
    const canvasY = rect ? (event.clientY - rect.top - viewport.y) / viewport.zoom : 0;
    setMenu({ x: event.clientX, y: event.clientY, canvasX, canvasY });
  }, [canvasState.viewport]);

  const createTerminalAt = useCallback(async (canvasX: number, canvasY: number) => {
    await createNewTab();
    const newTabId = useWorkspaceStore.getState().activeTabId;
    if (newTabId) {
      updateCanvasNode(`terminal-map-${newTabId}`, { x: Math.round(canvasX), y: Math.round(canvasY) });
    }
  }, [updateCanvasNode]);

  const updateTerminalPreview = useCallback((nodeId: string, snapshot: GridSnapshot) => {
    setTerminalPreviews((current) => ({
      ...current,
      [nodeId]: {
        snapshot: {
          ...snapshot,
          cells: snapshot.cells.map((row) => row.slice()),
        },
        updatedAt: Date.now(),
      },
    }));
  }, []);

  const centerNode = useCallback((node: CanvasNode, zoom: number) => {
    const shellRect = shellRef.current?.getBoundingClientRect();
    const width = shellRect?.width ?? window.innerWidth;
    const height = shellRect?.height ?? window.innerHeight;
    const padding = node.type === "terminal" ? 24 : 56;
    const fittedZoom = node.type === "terminal"
      ? zoom
      : Math.min(
          zoom,
          (width - padding * 2) / Math.max(1, node.width),
          (height - padding * 2) / Math.max(1, node.height)
        );
    const nextZoom = clamp(fittedZoom, MIN_ZOOM, MAX_ZOOM);
    const nextX = width / 2 - (node.x + node.width / 2) * nextZoom;
    const nextY = height / 2 - (node.y + node.height / 2) * nextZoom;
    updateCanvasViewport({
      zoom: nextZoom,
      x: snapTerminalPixel(nextX, node.type, nextZoom),
      y: snapTerminalPixel(nextY, node.type, nextZoom),
    });
  }, [updateCanvasViewport]);

  const focusSelectedNode = useCallback(() => {
    const selected =
      canvasState.nodes.find((node) => node.id === canvasState.selectedNodeId) ??
      canvasState.nodes.find((node) => node.type === "terminal") ??
      canvasState.nodes[0];
    if (!selected) {
      updateCanvasViewport({ x: 0, y: 0, zoom: 1 });
      return;
    }
    centerNode(selected, selected.type === "terminal" ? FOCUS_TERMINAL_ZOOM : 1);
  }, [canvasState.nodes, canvasState.selectedNodeId, centerNode, updateCanvasViewport]);

  const fitAllNodes = useCallback(() => {
    if (canvasState.nodes.length === 0) {
      updateCanvasViewport({ x: 0, y: 0, zoom: 1 });
      return;
    }
    const shellRect = shellRef.current?.getBoundingClientRect();
    const width = shellRect?.width ?? window.innerWidth;
    const height = shellRect?.height ?? window.innerHeight;
    const padding = 96;
    const bounds = canvasState.nodes.reduce(
      (acc, node) => ({
        minX: Math.min(acc.minX, node.x),
        minY: Math.min(acc.minY, node.y),
        maxX: Math.max(acc.maxX, node.x + node.width),
        maxY: Math.max(acc.maxY, node.y + node.height),
      }),
      { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
    );
    const contentWidth = Math.max(1, bounds.maxX - bounds.minX);
    const contentHeight = Math.max(1, bounds.maxY - bounds.minY);
    const nextZoom = clamp(
      Math.min((width - padding * 2) / contentWidth, (height - padding * 2) / contentHeight),
      MIN_ZOOM,
      1
    );
    updateCanvasViewport({
      zoom: nextZoom,
      x: width / 2 - (bounds.minX + contentWidth / 2) * nextZoom,
      y: height / 2 - (bounds.minY + contentHeight / 2) * nextZoom,
    });
  }, [canvasState.nodes, updateCanvasViewport]);

  const setZoomAt = useCallback((nextZoomValue: number, clientX?: number, clientY?: number) => {
    const viewport = canvasState.viewport;
    const nextZoom = clamp(nextZoomValue, MIN_ZOOM, MAX_ZOOM);
    const shellRect = shellRef.current?.getBoundingClientRect();

    if (!shellRect || clientX === undefined || clientY === undefined) {
      updateCanvasViewport({ zoom: nextZoom });
      return;
    }

    const localX = clientX - shellRect.left;
    const localY = clientY - shellRect.top;
    const canvasX = (localX - viewport.x) / viewport.zoom;
    const canvasY = (localY - viewport.y) / viewport.zoom;

    updateCanvasViewport({
      zoom: nextZoom,
      x: localX - canvasX * nextZoom,
      y: localY - canvasY * nextZoom,
    });
  }, [canvasState.viewport, updateCanvasViewport]);

  const onCanvasMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.target !== event.currentTarget) return;
    event.preventDefault();
    panRef.current = {
      x: event.clientX,
      y: event.clientY,
      viewportX: canvasState.viewport.x,
      viewportY: canvasState.viewport.y,
    };
    document.body.classList.add("no-select");
    if (shellRef.current) shellRef.current.style.cursor = "grabbing";

    function onMouseMove(moveEvent: MouseEvent) {
      const pan = panRef.current;
      if (!pan) return;
      updateCanvasViewport({
        x: pan.viewportX + moveEvent.clientX - pan.x,
        y: pan.viewportY + moveEvent.clientY - pan.y,
      });
    }

    function onMouseUp() {
      panRef.current = null;
      document.body.classList.remove("no-select");
      if (shellRef.current) shellRef.current.style.cursor = "";
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [canvasState.viewport.x, canvasState.viewport.y, updateCanvasViewport]);

  const onCanvasWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest(".terminal-container")) return;
    event.preventDefault();
    const direction = event.deltaY > 0 ? -1 : 1;
    const factor = direction > 0 ? 1.1 : 0.9;
    setZoomAt(canvasState.viewport.zoom * factor, event.clientX, event.clientY);
  }, [canvasState.viewport.zoom, setZoomAt]);

  const addNote = useCallback(() => {
    const pos = nextNodePosition(canvasState.nodes.length);
    addCanvasNode({
      type: "note",
      title: "Run note",
      x: pos.x,
      y: pos.y,
      width: 280,
      height: 160,
      content: "Capture the command, blocker, or next action for this run.",
    });
  }, [addCanvasNode, canvasState.nodes.length]);

  const addTerminal = useCallback(() => {
    createNewTab();
  }, []);

  const addFile = useCallback(() => {
    const file = openFiles[fileIndex % Math.max(openFiles.length, 1)];
    const pos = nextNodePosition(canvasState.nodes.length);
    addCanvasNode({
      type: "file",
      title: file?.name ?? "File",
      x: pos.x,
      y: pos.y,
      width: 320,
      height: 150,
      filePath: file?.path,
      content: file?.path ?? "Open a file from the explorer, then add another file node.",
    });
    setFileIndex((index) => index + 1);
  }, [addCanvasNode, canvasState.nodes.length, fileIndex, openFiles]);

  return (
    <div
      ref={shellRef}
      data-magic-canvas-shell
      style={{
        ...styles.shell,
        backgroundSize: `${128 * canvasState.viewport.zoom}px ${128 * canvasState.viewport.zoom}px, ${128 * canvasState.viewport.zoom}px ${128 * canvasState.viewport.zoom}px, auto`,
        backgroundPosition: `${canvasState.viewport.x}px ${canvasState.viewport.y}px`,
      }}
      onMouseDown={onCanvasMouseDown}
      onWheel={onCanvasWheel}
      onContextMenu={openCanvasMenu}
    >
      <div style={styles.toolbar}>
        <span style={styles.toolbarLabel}>
          <Layers3 size={13} strokeWidth={1.8} />
          Map
        </span>
        <button className="magic-canvas-button" style={styles.button} title="Add note" aria-label="Add note" onClick={addNote}>
          <NotebookText size={14} strokeWidth={1.8} />
        </button>
        <button className="magic-canvas-button" style={styles.button} title="Add terminal" aria-label="Add terminal" onClick={addTerminal}>
          <TerminalSquare size={14} strokeWidth={1.8} />
        </button>
        <button className="magic-canvas-button" style={styles.button} title="Add file" aria-label="Add file" onClick={addFile}>
          <FileText size={14} strokeWidth={1.8} />
        </button>
      </div>

      {agentLane.total > 0 && (
        <div
          style={styles.agentLaneOverlay}
          data-testid="canvas-agent-lane-summary"
          aria-label={agentLaneStatusText(agentLane)}
        >
          <div style={styles.agentLaneHeader}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
              <Bot size={13} strokeWidth={1.8} />
              Agent workstreams
            </span>
            <span>{agentLane.total}</span>
          </div>
          <div style={styles.agentLaneStats}>
            <span style={styles.agentLaneChip} data-testid="canvas-agent-lane-total">{agentLane.total} agents</span>
            <span style={styles.agentLaneChip}>{agentLane.active} active</span>
            <span style={styles.agentLaneChip}>{agentLane.waiting} waiting</span>
            <span style={styles.agentLaneChip}>{agentLane.blocked} blocked</span>
            <span style={styles.agentLaneChip}>{agentLane.complete} complete</span>
            <span style={styles.agentLaneChip}>{agentLane.attention} attention</span>
          </div>
          {agentLane.primaryAttention && (
            <button
              type="button"
              className="magic-canvas-button"
              style={{ ...styles.agentLaneItem, background: "transparent", border: "none", padding: "3px 0", textAlign: "left", cursor: "pointer" }}
              data-testid="canvas-agent-lane-attention"
              title={`Focus ${agentLane.primaryAttention.title}`}
              onClick={() => {
                const attention = agentLane.primaryAttention;
                if (!attention) return;
                const node = canvasState.nodes.find((candidate) => candidate.terminalTabId === attention.tabId);
                setActiveTab(attention.tabId);
                if (node) centerNode(node, FOCUS_TERMINAL_ZOOM);
              }}
            >
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-primary)" }}>
                {agentLane.primaryAttention.label}
              </span>
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {agentLane.primaryAttention.title} · {agentLane.primaryAttention.detail}
              </span>
            </button>
          )}
          <div style={styles.agentLaneList}>
            {agentLane.workstreams.slice(0, 3).map(({ tab, workstream }) => {
              const node = canvasState.nodes.find((candidate) => candidate.terminalTabId === tab.id);
              return (
                <button
                  key={tab.id}
                  type="button"
                  className="magic-canvas-button"
                  style={{ ...styles.agentLaneItem, background: "transparent", border: "none", padding: "3px 0", textAlign: "left", cursor: node ? "pointer" : "default" }}
                  title={workstream.lastSummary ?? workstream.mission ?? workstream.prompt ?? tab.title}
                  onClick={() => {
                    setActiveTab(tab.id);
                    if (node) centerNode(node, FOCUS_TERMINAL_ZOOM);
                  }}
                >
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {tab.title}
                  </span>
                  <span>{workstreamLabel(workstream.provider)} · {workstream.phase ?? workstream.status}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {canvasState.nodes.length === 0 && (
        <div style={styles.empty}>Map is empty. Add a note, shell, or file node.</div>
      )}

      <div
        style={{
          ...styles.stage,
          transform: `translate(${canvasState.viewport.x}px, ${canvasState.viewport.y}px) scale(${canvasState.viewport.zoom})`,
        }}
        onMouseDown={onCanvasMouseDown}
        onContextMenu={openCanvasMenu}
      >
        {canvasState.nodes.map((node) => (
          <CanvasNodeView
            key={node.id}
            node={node}
            focusNode={centerNode}
            terminalPreview={terminalPreviews[node.id]}
            onTerminalSnapshot={updateTerminalPreview}
          />
        ))}
      </div>

      <div style={styles.viewportControls}>
        <button
          className="magic-canvas-button"
          style={styles.button}
          onClick={() => setZoomAt(canvasState.viewport.zoom * 0.9)}
          title="Zoom out"
          aria-label="Zoom out"
        >
          <Minus size={14} strokeWidth={1.8} />
        </button>
        <button
          className="magic-canvas-button"
          style={styles.button}
          onClick={focusSelectedNode}
          title="Fit active"
          aria-label="Fit active"
        >
          <LocateFixed size={14} strokeWidth={1.8} />
        </button>
        <span style={styles.zoomReadout}>{Math.round(canvasState.viewport.zoom * 100)}%</span>
        <button
          className="magic-canvas-button"
          style={styles.button}
          onClick={() => setZoomAt(canvasState.viewport.zoom * 1.1)}
          title="Zoom in"
          aria-label="Zoom in"
        >
          <Plus size={14} strokeWidth={1.8} />
        </button>
        <button
          className="magic-canvas-button"
          style={styles.button}
          onClick={fitAllNodes}
          title="Fit all"
          aria-label="Fit all"
        >
          <Maximize2 size={14} strokeWidth={1.8} />
        </button>
        <button
          className="magic-canvas-button"
          style={styles.button}
          onClick={focusSelectedNode}
          title="Reset to readable view"
          aria-label="Reset to readable view"
        >
          <RotateCcw size={14} strokeWidth={1.8} />
        </button>
      </div>

      {menu && (
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 50 }}
            onMouseDown={() => setMenu(null)}
            onContextMenu={(event) => {
              event.preventDefault();
              setMenu(null);
            }}
          />
          <div
            role="menu"
            style={{
              position: "fixed",
              left: Math.min(menu.x, window.innerWidth - 196),
              top: Math.min(menu.y, window.innerHeight - 120),
              zIndex: 51,
              minWidth: 184,
              padding: 5,
              background: "var(--surface-raised)",
              borderRadius: "var(--radius-md)",
              boxShadow: "var(--shadow-menu)",
              border: "none",
            }}
          >
            {[
              {
                icon: <TerminalSquare size={14} strokeWidth={1.8} />,
                label: "New terminal here",
                run: () => createTerminalAt(menu.canvasX, menu.canvasY),
              },
              {
                icon: <NotebookText size={14} strokeWidth={1.8} />,
                label: "New note here",
                run: () =>
                  addCanvasNode({
                    type: "note",
                    title: "Run note",
                    x: Math.round(menu.canvasX),
                    y: Math.round(menu.canvasY),
                    width: 280,
                    height: 160,
                    content: "Capture the command, blocker, or next action for this run.",
                  }),
              },
            ].map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                className="workspace-launch-config-item"
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  padding: "9px 10px",
                  border: "none",
                  borderRadius: "var(--radius-sm)",
                  background: "transparent",
                  color: "var(--text-primary)",
                  fontFamily: "var(--font-ui)",
                  fontSize: 13,
                  cursor: "pointer",
                  textAlign: "left",
                }}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  item.run();
                  setMenu(null);
                }}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
