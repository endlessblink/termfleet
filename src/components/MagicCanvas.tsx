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
  MousePointer2,
  NotebookText,
  Plus,
  RefreshCw,
  RotateCcw,
  Square,
  TerminalSquare,
  Trash2,
  X,
} from "lucide-react";
import type { CanvasNode } from "../lib/types";
import { masterPlanPath, taskStatusColor, taskStatusLabel } from "../lib/masterPlanTasks";
import { useMasterPlanTasks } from "../hooks/useMasterPlanTasks";
import { pathTail, projectForTab, workspaceLabelFor } from "../lib/projectDisplay";
import { createNewTab, useWorkspaceStore } from "../stores/workspace";
import { TerminalComponent } from "./Terminal";
import { LocalhostPreview } from "./LocalhostPreview";
import type { GridSnapshot } from "../lib/gridSnapshot";
import type { Tab, TerminalRuntimeStatus } from "../lib/types";
import { agentLaneAuthRetryText, agentLaneAuthRetryTitle, agentLaneCleanupRequestText, agentLaneCleanupRequestTitle, agentLaneCloseoutText, agentLaneCloseoutTitle, agentLaneHealthText, agentLaneInterruptText, agentLaneInterruptTitle, agentLaneMemoryRequestText, agentLaneMemoryRequestTitle, agentLaneProofRequestText, agentLaneProofRequestTitle, agentLaneRestartText, agentLaneRestartTitle, agentLaneRiskMitigationText, agentLaneRiskMitigationTitle, agentLaneStatusSweepText, agentLaneStatusSweepTitle, agentLaneStatusText, attentionBreakdownText, cleanupBreakdownText, closeoutBreakdownText, formatAgentLaneBrief, formatAgentMissionControlBrief, formatAgentRunBrief, handoffMemoryPromptForWorkstream, isActiveAgentWorkstream, isAgentReviewCloseoutReady, isAuthRetryableAgentWorkstream, isCleanupRequestableAgentWorkstream, isRestartableAgentWorkstream, isReviewItemCloseoutReady, isStaleAgentWorkstream, isolationBreakdownText, latestMissionControlAskText, missionBreakdownText, missionControlAlternateText, missionControlDispatchBreakdownText, needsAgentProofRequest, proofRequestPromptForWorkstream, providerBreakdownText, readinessBreakdownText, riskBreakdownText, statusCheckPromptForWorkstream, summarizeAgentLane } from "../lib/agentWorkstreamLane";
import { agentStatusChipText, agentStatusSummaryFromWorkstream, getDisplaySummary } from "../lib/agentStatusSummary";
import { workstreamActivityMeta, workstreamActivityText } from "../lib/workstreamActivity";
import { formatWorkstreamBranch, formatWorkstreamIsolation, formatWorkstreamOpsContext } from "../lib/workstreamOpsContext";
import { snapshotPreviewRows } from "../lib/snapshotPreviewRows";

type CanvasRect = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

type SelectionBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

const TERMINAL_LABEL_COLORS = [
  { label: "Default", value: undefined },
  { label: "Cyan", value: "#7dbac3" },
  { label: "Amber", value: "#d4a44f" },
  { label: "Red", value: "#d96767" },
  { label: "Violet", value: "#a890d3" },
];

function rectsIntersect(a: CanvasRect, b: CanvasRect) {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

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
    left: 14,
    bottom: 14,
    zIndex: 20,
    minWidth: 286,
    maxWidth: 420,
    maxHeight: 280,
    display: "grid",
    gap: 8,
    padding: "9px 10px",
    background: "color-mix(in srgb, var(--surface-raised) 94%, transparent)",
    border: "1px solid var(--border-subtle)",
    borderRadius: "var(--radius-md)",
    boxShadow: "var(--shadow-menu)",
    animation: "workbench-popover-in var(--motion-med)",
    overflowY: "auto",
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
  selectionRect: {
    position: "fixed",
    zIndex: 30,
    border: "1px solid color-mix(in srgb, var(--accent-info) 72%, transparent)",
    background: "color-mix(in srgb, var(--accent-info) 13%, transparent)",
    borderRadius: "var(--radius-xs)",
    pointerEvents: "none",
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
    pointerEvents: "auto",
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
  terminalNodeHeader: {
    minHeight: 118,
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr) auto",
    columnGap: 10,
    rowGap: 7,
    alignItems: "start",
    padding: "10px 12px 11px",
  },
  agentNodeHeader: {
    minHeight: 132,
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr) auto",
    alignItems: "start",
    gap: 8,
    padding: "9px 10px 10px 11px",
  },
  agentHeaderMetaRow: {
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  agentHeaderActions: {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 5,
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
  nodeTitleActivity: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: "var(--accent-live)",
    fontSize: 11,
    fontWeight: 500,
    marginTop: 1,
  },
  nodeTitleActivityLabel: {
    color: "var(--text-secondary)",
    fontSize: 10,
    fontWeight: 500,
    textTransform: "uppercase",
    letterSpacing: 0,
  },
  terminalStatusBlock: {
    minWidth: 0,
    display: "grid",
    gap: 9,
    alignContent: "start",
  },
  terminalStatusKicker: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    color: "var(--text-secondary)",
    fontSize: 10,
    fontWeight: 500,
    textTransform: "uppercase",
    letterSpacing: 0,
  },
  workspacePill: {
    minWidth: 0,
    maxWidth: 170,
    height: 18,
    display: "inline-flex",
    alignItems: "center",
    padding: "0 6px",
    border: "1px solid var(--border-subtle)",
    borderRadius: "var(--radius-xs)",
    background: "color-mix(in srgb, var(--surface-base) 82%, transparent)",
    color: "var(--text-primary)",
    fontSize: 10,
    fontWeight: 500,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    textTransform: "none",
  },
  terminalStatusTitle: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: "var(--text-primary)",
    fontSize: 16,
    fontWeight: 500,
    lineHeight: 1.15,
  },
  terminalStatusGrid: {
    minWidth: 0,
    display: "grid",
    gridTemplateColumns: "minmax(120px, 0.6fr) minmax(180px, 1fr)",
    gap: 7,
  },
  terminalStatusField: {
    minWidth: 0,
    maxWidth: "100%",
    minHeight: 34,
    display: "grid",
    alignContent: "center",
    gap: 2,
    padding: "5px 8px 6px",
    borderRadius: "var(--radius-sm)",
    border: "1px solid var(--border-subtle)",
    background: "color-mix(in srgb, var(--surface-base) 76%, transparent)",
  },
  terminalStatusFieldLabel: {
    color: "var(--text-secondary)",
    fontSize: 10,
    fontWeight: 500,
    textTransform: "uppercase",
    letterSpacing: 0,
  },
  terminalStatusFieldValue: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: "var(--text-secondary)",
    fontSize: 11,
    lineHeight: 1.2,
  },
  terminalStatusNow: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: "var(--accent-live)",
    fontSize: 12,
    fontWeight: 500,
    lineHeight: 1.2,
  },
  agentStatusBlock: {
    minWidth: 0,
    gridColumn: "1 / -1",
    display: "grid",
    gap: 7,
  },
  agentWorkingLine: {
    minWidth: 0,
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr)",
    alignItems: "start",
    gap: 6,
    color: "var(--text-primary)",
    fontSize: 13,
    fontWeight: 500,
    lineHeight: 1.15,
  },
  agentStatusLabel: {
    flex: "0 0 auto",
    color: "var(--text-secondary)",
    fontSize: 10,
    fontWeight: 500,
    textTransform: "uppercase",
    letterSpacing: 0,
  },
  agentWorkingText: {
    minWidth: 0,
    overflow: "hidden",
    display: "-webkit-box",
    WebkitBoxOrient: "vertical",
    WebkitLineClamp: 3,
  },
  agentStatusDetailGrid: {
    minWidth: 0,
    display: "grid",
    gridTemplateRows: "auto auto",
    gap: 5,
    alignItems: "start",
  },
  agentStatusDetail: {
    minWidth: 0,
    display: "flex",
    alignItems: "baseline",
    gap: 5,
    overflow: "hidden",
    color: "var(--text-secondary)",
    fontSize: 11,
    lineHeight: 1.2,
  },
  agentStatusDetailText: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  agentStatusChips: {
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    gap: 5,
    flexWrap: "wrap",
  },
  agentStatusChip: {
    maxWidth: 220,
    height: 18,
    display: "inline-flex",
    alignItems: "center",
    padding: "0 6px",
    border: "1px solid var(--border-subtle)",
    borderRadius: "var(--radius-xs)",
    background: "color-mix(in srgb, var(--surface-base) 82%, transparent)",
    color: "var(--text-secondary)",
    fontSize: 10,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
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
  noteBody: {
    flex: 1,
    minHeight: 0,
    display: "flex",
    padding: 8,
    background: "color-mix(in srgb, var(--surface-raised) 88%, var(--surface-base))",
  },
  noteTextarea: {
    width: "100%",
    minHeight: 0,
    resize: "none",
    padding: "7px 8px",
    border: "1px solid var(--border-subtle)",
    borderRadius: "var(--radius-sm)",
    outline: "none",
    background: "var(--surface-base)",
    color: "var(--text-primary)",
    font: "inherit",
    fontSize: 13,
    lineHeight: 1.45,
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
    gap: 7,
    padding: "8px 10px",
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
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    gap: 6,
  },
  agentDecisionRow: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
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
  agentDetails: {
    display: "grid",
    gap: 7,
    paddingTop: 2,
    color: "var(--text-secondary)",
    fontSize: 11,
  },
  agentDetailsSummary: {
    cursor: "pointer",
    color: "var(--text-secondary)",
    fontSize: 10,
    textTransform: "uppercase",
    userSelect: "none",
  },
  agentDetailsBody: {
    display: "grid",
    gap: 6,
    paddingTop: 6,
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

function recoveryPromptFor(workstream?: Tab["workstream"]) {
  return `Recover ${workstreamLabel(workstream?.provider)} agent: inspect the failure output, summarize the root cause, and propose the next command.`;
}

function snapshotText(snapshot?: GridSnapshot) {
  if (!snapshot?.cells.length) return undefined;
  const lines = snapshot.cells
    .map((row) => row.map((cell) => cell.c && cell.c !== "\u0000" ? cell.c : " ").join("").trimEnd())
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.slice(-24).join("\n") || undefined;
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

function TerminalMapPreview({
  title,
  meta,
  status,
  activity,
  ptyCount,
  preview,
  onActivate,
  onOpen,
}: {
  title: string;
  meta?: string;
  status?: TerminalRuntimeStatus;
  activity?: string;
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
          {activity && <div style={styles.nodeTitleActivity} title={activity}>Now: {activity}</div>}
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
  onOpenNodeLabelMenu,
}: {
  node: CanvasNode;
  focusNode: (node: CanvasNode, zoom: number) => void;
  terminalPreview?: TerminalPreviewEntry;
  onTerminalSnapshot: (nodeId: string, snapshot: GridSnapshot) => void;
  onOpenNodeLabelMenu: (nodeId: string, event: React.MouseEvent) => void;
}) {
  const tabs = useWorkspaceStore((state) => state.tabs);
  const groups = useWorkspaceStore((state) => state.groups);
  const liveCwds = useWorkspaceStore((state) => state.liveCwds);
  const selectedNodeId = useWorkspaceStore((state) => state.canvasState.selectedNodeId);
  const storedSelectedNodeIds = useWorkspaceStore((state) => state.canvasState.selectedNodeIds);
  const zoom = useWorkspaceStore((state) => state.canvasState.viewport.zoom);
  const updateCanvasNode = useWorkspaceStore((state) => state.updateCanvasNode);
  const moveCanvasNodes = useWorkspaceStore((state) => state.moveCanvasNodes);
  const removeCanvasNode = useWorkspaceStore((state) => state.removeCanvasNode);
  const closeTerminalSession = useWorkspaceStore((state) => state.closeTerminalSession);
  const closePane = useWorkspaceStore((state) => state.closePane);
  const updatePreviewPaneUrl = useWorkspaceStore((state) => state.updatePreviewPaneUrl);
  const selectCanvasNode = useWorkspaceStore((state) => state.selectCanvasNode);
  const selectCanvasNodes = useWorkspaceStore((state) => state.selectCanvasNodes);
  const setActiveTab = useWorkspaceStore((state) => state.setActiveTab);
  const setWorkspaceMode = useWorkspaceStore((state) => state.setWorkspaceMode);
  const terminalRendererMode = useWorkspaceStore((state) => state.workspaceUiState.terminalRendererMode);
  const dragRef = useRef<{ x: number; y: number; nodeX: number; nodeY: number; lastDeltaX: number; lastDeltaY: number } | null>(null);
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
  const selectedNodeIds = storedSelectedNodeIds ?? (selectedNodeId ? [selectedNodeId] : []);
  const selected = selectedNodeIds.includes(node.id) || selectedNodeId === node.id;
  const labelColor = node.type === "terminal" ? node.labelColor : undefined;
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
    if (event.shiftKey || event.metaKey || event.ctrlKey) {
      const nextIds = selectedNodeIds.includes(node.id)
        ? selectedNodeIds.filter((id) => id !== node.id)
        : [...selectedNodeIds, node.id];
      selectCanvasNodes(nextIds.length > 0 ? nextIds : [node.id]);
    } else if (!selectedNodeIds.includes(node.id)) {
      selectCanvasNode(node.id);
    }
    const dragIds = selectedNodeIds.includes(node.id) && selectedNodeIds.length > 1
      ? selectedNodeIds
      : [node.id];
    dragRef.current = {
      x: event.clientX,
      y: event.clientY,
      nodeX: node.x,
      nodeY: node.y,
      lastDeltaX: 0,
      lastDeltaY: 0,
    };

    function onMouseMove(moveEvent: MouseEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      const nextX = drag.nodeX + (moveEvent.clientX - drag.x) / zoom;
      const nextY = drag.nodeY + (moveEvent.clientY - drag.y) / zoom;
      const totalDeltaX = snapTerminalPixel(nextX, node.type, zoom) - node.x;
      const totalDeltaY = snapTerminalPixel(nextY, node.type, zoom) - node.y;
      moveCanvasNodes(dragIds, {
        x: totalDeltaX - drag.lastDeltaX,
        y: totalDeltaY - drag.lastDeltaY,
      });
      drag.lastDeltaX = totalDeltaX;
      drag.lastDeltaY = totalDeltaY;
    }

    function onMouseUp() {
      dragRef.current = null;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [moveCanvasNodes, node.id, node.type, node.x, node.y, selectCanvasNode, selectCanvasNodes, selectedNodeIds, zoom]);

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
  const terminalActivity = linkedTerminal?.currentActivity;
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
  const workspaceLabel = workspaceLabelFor({
    project: linkedProject,
    cwd: liveTerminalRoot,
    tabTitle: linkedTab?.title,
    nodeTitle: node.title,
  });
  const terminalStatusSummary = linkedTerminal?.statusSummary;
  const terminalVisibleTranscript = snapshotText(terminalPreview?.snapshot);
  const terminalDisplaySummary = getDisplaySummary({
    mission: "Terminal",
    provider: "shell",
    status: linkedTerminal?.status === "failed"
      ? "failed"
      : linkedTerminal?.status === "exited"
        ? "done"
        : linkedTerminal?.status === "running" || linkedTerminal?.status === "reconnected"
          ? "running"
          : "ready",
    cwd: liveTerminalRoot,
    cwdLabel: pathTail(liveTerminalRoot),
    currentActivity: terminalActivity,
    terminalOutput: [linkedTerminal?.terminalOutput, terminalVisibleTranscript].filter(Boolean).join("\n"),
  }, terminalStatusSummary);
  const terminalHeaderTitle = terminalDisplaySummary.task === "Ready" ? terminalTitle : terminalDisplaySummary.task;
  const terminalHeaderPath = terminalDisplaySummary.path;
  const terminalHeaderSummarySignal = terminalDisplaySummary.now;
  const terminalHeaderHasUsefulNow = terminalDisplaySummary.now !== "Awaiting terminal output";
  const terminalHeaderHasUsefulSummary = terminalDisplaySummary.task !== "Ready";
  const workstream = linkedTab?.workstream;
  const queuedWorkstreamInput = workstream?.inputQueue?.find((input) => !input.sentAt);
  const latestInput = workstream?.inputQueue?.[workstream.inputQueue.length - 1];
  const latestMissionControlInput = latestInput?.source === "mission-control" ? latestInput : undefined;
  const cancellationPending = workstream?.phase === "cancelling";
  const canDraftRecovery =
    workstream?.phase === "blocked" ||
    workstream?.status === "failed" ||
    workstream?.providerAvailable === false;
  const canDraftProofRequest = needsAgentProofRequest(workstream);
  const canDraftStatusCheck = workstream?.kind === "agent" && isStaleAgentWorkstream(workstream);
  const canReviewWorkstream =
    workstream?.phase !== "reviewed" &&
    (workstream?.status === "done" || workstream?.phase === "complete") &&
    isAgentReviewCloseoutReady(workstream);
  const canRequestWorktreeCleanup =
    workstream?.kind === "agent" &&
    workstream.isolationMode === "dedicated-worktree" &&
    workstream.worktreeCleanupStatus !== "requested";
  const canExecuteWorktreeCleanup =
    workstream?.kind === "agent" &&
    workstream.isolationMode === "dedicated-worktree" &&
    workstream.worktreeCleanupStatus !== "removed" &&
    workstream.worktreeCleanupStatus !== "not-needed";
  const agentHeaderTitle =
    workstream?.kind === "agent"
      ? workstream.mission ?? workstream.prompt ?? "Supervised agent run"
      : undefined;
  const agentHeaderMeta =
    workstream?.kind === "agent"
      ? `${workstreamLabel(workstream.provider)} agent · ${workstream.phase ?? workstream.status} · ${workstreamActivityText(workstream)}`
      : undefined;
  const agentStatusSummary = agentStatusSummaryFromWorkstream(workstream);
  const agentStatusChip = workstream?.kind === "agent" && agentStatusSummary
    ? agentStatusChipText(workstream, agentStatusSummary)
    : undefined;
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

  const saveOperatorMemory = useCallback(() => {
    const trimmed = operatorDraft.trim();
    if (!linkedTab?.workstream || !trimmed) return;
    useWorkspaceStore.getState().recordWorkstreamMemory(linkedTab.id, trimmed);
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

  const onDraftProofRequest = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setOperatorDraft(proofRequestPromptForWorkstream(linkedTab?.workstream));
    requestAnimationFrame(() => composerRef.current?.focus());
  }, [linkedTab]);

  const onDraftStatusCheck = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!linkedTab?.workstream) return;
    setOperatorDraft(statusCheckPromptForWorkstream(linkedTab.workstream));
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

  const onRequestWorktreeCleanup = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!linkedTab?.workstream) return;
    useWorkspaceStore.getState().requestWorktreeCleanup(linkedTab.id);
  }, [linkedTab]);

  const onExecuteWorktreeCleanup = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!linkedTab?.workstream) return;
    void useWorkspaceStore.getState().executeWorktreeCleanup(linkedTab.id);
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
        activity={terminalHeaderHasUsefulNow ? terminalHeaderSummarySignal : undefined}
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
    ) : node.type === "note" ? (
      <textarea
        data-testid="canvas-note-editor"
        aria-label={`${node.title} note`}
        dir="auto"
        style={styles.noteTextarea}
        value={node.content ?? ""}
        placeholder="Write a command, blocker, or next action..."
        onMouseDown={(event) => {
          event.stopPropagation();
          selectCanvasNode(node.id);
        }}
        onClick={(event) => event.stopPropagation()}
        onWheel={(event) => event.stopPropagation()}
        onChange={(event) => updateCanvasNode(node.id, { content: event.target.value })}
        onKeyDown={(event) => event.stopPropagation()}
      />
    ) : (
      <div dir="auto">{node.content}</div>
    );

  return (
    <section
      data-testid={node.type === "terminal" ? "canvas-terminal-node" : "canvas-node"}
      data-node-id={node.id}
      style={{
        ...styles.node,
        left: node.x,
        top: node.y,
        width: node.width,
        height: node.height,
        zIndex: node.type === "terminal" && workstream?.kind === "agent" ? 25 : selected ? 15 : 1,
        borderColor: selected ? "var(--border-focus)" : "var(--border-subtle)",
        boxShadow: selected
          ? "0 0 0 1px rgba(217,154,69,0.36), 0 20px 54px rgba(0,0,0,0.52)"
          : styles.node.boxShadow,
      }}
      onMouseDown={(event) => {
        event.stopPropagation();
        if (dragRef.current) return;
        const target = event.target as HTMLElement;
        if (
          selectedNodeIds.includes(node.id) &&
          selectedNodeIds.length > 1 &&
          !target.closest(".terminal-container,button,input,textarea,select")
        ) {
          onMouseDown(event);
          return;
        }
        activateTerminalNode();
      }}
      onContextMenu={(event) => {
        if (node.type === "terminal") {
          onOpenNodeLabelMenu(node.id, event);
        }
      }}
    >
      <div
        data-testid={node.type === "terminal" ? "canvas-terminal-node-header" : "canvas-node-header"}
        style={{
          ...styles.nodeHeader,
          ...(node.type === "terminal" && !agentStatusSummary
            ? styles.terminalNodeHeader
            : null),
          ...(agentStatusSummary
            ? styles.agentNodeHeader
            : null),
        }}
        onMouseDown={onMouseDown}
        onContextMenu={(event) => {
          if (node.type === "terminal") {
            onOpenNodeLabelMenu(node.id, event);
          }
        }}
      >
        <span
          style={{
            ...styles.nodeKind,
            borderLeft: labelColor || linkedTab?.color ? `2px solid ${labelColor ?? linkedTab?.color}` : undefined,
            color: labelColor ?? styles.nodeKind.color,
          }}
        >
          {nodeKind}
        </span>
        {node.type === "terminal" && workstream?.kind === "agent" && !agentStatusSummary && (
          <span
            style={styles.taskBadge}
            title={[
              workstream.startupCommand ? `Starts ${workstream.startupCommand}` : workstream.mission ?? workstream.prompt ?? "Supervised agent run",
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
        {node.type === "terminal" && agentStatusSummary ? (
          <div
            style={styles.agentStatusBlock}
            dir="auto"
            title={`${workspaceLabel} · ${agentStatusSummary.task} · ${agentStatusSummary.path} · ${agentStatusSummary.now}`}
            onMouseDown={onMouseDown}
            onDoubleClick={onRename}
          >
            <div style={styles.terminalStatusKicker}>
              <span>Workspace</span>
              <span style={styles.workspacePill} data-testid="canvas-agent-node-workspace" title={workspaceLabel}>
                {workspaceLabel}
              </span>
            </div>
            <div style={styles.agentWorkingLine} data-testid="canvas-agent-working-on">
              <span style={styles.agentStatusLabel}>Working on</span>
              <span style={styles.agentWorkingText}>{agentStatusSummary.task}</span>
            </div>
            <div style={styles.agentStatusDetailGrid}>
              <div style={styles.agentStatusDetail} data-testid="canvas-agent-status-path">
                <span style={styles.agentStatusLabel}>Path</span>
                <span style={styles.agentStatusDetailText}>{agentStatusSummary.path}</span>
              </div>
              <div style={styles.agentStatusDetail} data-testid="canvas-agent-status-now">
                <span style={styles.agentStatusLabel}>Now</span>
                <span style={styles.agentStatusDetailText}>{agentStatusSummary.now}</span>
              </div>
            </div>
            <div style={styles.agentStatusChips} data-testid="canvas-agent-status-chips">
              <span style={styles.agentStatusChip}>{agentStatusChip}</span>
              {agentStatusSummary.confidence && (
                <span style={styles.agentStatusChip}>summary · {agentStatusSummary.confidence}</span>
              )}
            </div>
          </div>
        ) : node.type === "terminal" && workstream?.kind !== "agent" ? (
          <div
            style={styles.terminalStatusBlock}
            dir="auto"
            title={`${workspaceLabel} · ${terminalHeaderTitle} · ${terminalHeaderPath} · ${terminalHeaderSummarySignal}`}
            onMouseDown={onMouseDown}
            onDoubleClick={onRename}
          >
            <div style={styles.terminalStatusKicker}>
              <span>Context</span>
              <span>·</span>
              <span>{terminalHeaderHasUsefulSummary ? "live summary" : "terminal state"}</span>
              <span style={styles.workspacePill} data-testid="canvas-terminal-node-workspace" title={workspaceLabel}>
                {workspaceLabel}
              </span>
            </div>
            <div
              style={styles.terminalStatusTitle}
              data-testid="canvas-terminal-node-header-title"
            >
              <span style={{ color: labelColor ?? "var(--text-primary)" }}>{terminalHeaderTitle}</span>
            </div>
            <div style={styles.terminalStatusGrid}>
              <div style={styles.terminalStatusField}>
                <span style={styles.terminalStatusFieldLabel}>Path</span>
                <span
                  style={styles.terminalStatusFieldValue}
                  data-testid="canvas-terminal-node-header-path"
                  title={terminalHeaderPath}
                >
                  {terminalHeaderPath}
                </span>
              </div>
              <div style={styles.terminalStatusField}>
                <span style={styles.terminalStatusFieldLabel}>{terminalHeaderHasUsefulNow ? "Now" : "Signal"}</span>
                <span
                  style={terminalHeaderHasUsefulNow ? styles.terminalStatusNow : styles.terminalStatusFieldValue}
                  data-testid="canvas-terminal-node-now"
                  title={terminalHeaderSummarySignal}
                >
                  {terminalHeaderSummarySignal}
                </span>
              </div>
            </div>
          </div>
        ) : (
          <span
            style={{ minWidth: 0, flex: 1 }}
            dir="auto"
            title="Double-click to rename"
            onDoubleClick={onRename}
          >
            <div
              style={styles.nodeTitle}
              data-testid={workstream?.kind === "agent" ? "canvas-agent-node-header-title" : "canvas-node-header-title"}
            >
              <span style={{ color: labelColor ?? "var(--text-primary)" }}>
                {agentHeaderTitle ?? (node.type === "terminal" ? terminalTitle : node.title)}
              </span>
            </div>
            {node.type === "terminal" && (
              <div
                style={styles.nodeTitleMeta}
                data-testid={workstream?.kind === "agent" ? "canvas-agent-node-header-meta" : "canvas-node-header-meta"}
              >
                {agentHeaderMeta ?? (linkedProject ? `${pathTail(liveTerminalRoot)} · ${linkedTab?.title ?? node.title}` : pathTail(liveTerminalRoot))}
              </div>
            )}
            {node.type === "preview" && node.previewUrl && (
              <div style={styles.nodeTitleMeta}>{node.previewUrl}</div>
            )}
          </span>
        )}
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
          <div style={styles.agentHeaderActions}>
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
              title={canReviewWorkstream ? "Mark run reviewed" : "Proof and handoff memory are required before review"}
              aria-label="Mark run reviewed"
              disabled={!canReviewWorkstream}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={onReviewWorkstream}
            >
              <CheckCircle2 size={13} strokeWidth={1.8} />
            </button>
            {workstream.isolationMode === "dedicated-worktree" && (
              <>
              <button
                style={{
                  ...styles.headerButton,
                  opacity: canRequestWorktreeCleanup ? undefined : 0.45,
                  cursor: canRequestWorktreeCleanup ? styles.headerButton.cursor : "default",
                }}
                title={canRequestWorktreeCleanup ? "Request worktree cleanup" : "Worktree cleanup already requested"}
                aria-label="Request worktree cleanup"
                disabled={!canRequestWorktreeCleanup}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={onRequestWorktreeCleanup}
              >
                <Trash2 size={13} strokeWidth={1.8} />
              </button>
              <button
                style={{
                  ...styles.headerButton,
                  opacity: canExecuteWorktreeCleanup ? undefined : 0.45,
                  cursor: canExecuteWorktreeCleanup ? styles.headerButton.cursor : "default",
                }}
                title={canExecuteWorktreeCleanup ? "Execute worktree cleanup" : "Worktree cleanup is complete"}
                aria-label="Execute worktree cleanup"
                disabled={!canExecuteWorktreeCleanup}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={onExecuteWorktreeCleanup}
              >
                <X size={13} strokeWidth={1.8} />
              </button>
              </>
            )}
            <button
              style={{
                ...styles.headerButton,
                opacity: cancellationPending ? 0.55 : undefined,
                cursor: cancellationPending ? "default" : styles.headerButton.cursor,
              }}
              title={cancellationPending ? "Cancellation already requested" : "Request graceful cancellation"}
              aria-label="Interrupt agent run"
              disabled={cancellationPending}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={onInterruptWorkstream}
            >
              <Ban size={13} strokeWidth={1.8} />
            </button>
            <button
              style={styles.headerButton}
              title="Stop agent run"
              aria-label="Stop agent run"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={onStopWorkstream}
            >
              <Square size={12} strokeWidth={1.8} />
            </button>
            <button
              style={styles.headerButton}
              title="Restart agent run"
              aria-label="Restart agent run"
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
          <button
            style={{ ...styles.closeButton, ...styles.headerButton }}
            title="Close terminal session"
            aria-label={linkedTab ? `Close ${linkedTab.title}` : "Remove node"}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              if (linkedTab) {
                closeTerminalSession(linkedTab.id);
                return;
              }
              removeCanvasNode(node.id);
            }}
          >
            <X size={13} strokeWidth={1.8} />
          </button>
          </div>
        )}
        {node.type !== "terminal" && (
          <button
          style={{ ...styles.closeButton, ...styles.headerButton }}
          title={node.type === "preview" ? "Close preview pane" : linkedTab ? "Close terminal session" : "Remove node"}
          aria-label={node.type === "preview" ? `Close ${node.title}` : linkedTab ? `Close ${linkedTab.title}` : "Remove node"}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            if (node.type === "preview") {
              if (linkedTab && node.previewPaneId) {
                closePane(linkedTab.id, node.previewPaneId);
                return;
              }
              removeCanvasNode(node.id);
              return;
            }
            if (linkedTab) {
              closeTerminalSession(linkedTab.id);
              return;
            }
            removeCanvasNode(node.id);
          }}
        >
          <X size={13} strokeWidth={1.8} />
          </button>
        )}
      </div>
      <div
        style={
          node.type === "terminal"
            ? styles.terminalBody
            : node.type === "note"
              ? styles.noteBody
              : styles.nodeBody
        }
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
                  <div style={styles.agentMissionLabel}>Task</div>
                  <div style={styles.agentMissionText} title={workstream.mission ?? workstream.prompt ?? "Supervised agent run"}>
                    {workstream.mission ?? workstream.prompt ?? "Supervised agent run"}
                  </div>
                </span>
                <span style={styles.agentStatusPill}>{workstream.phase ?? workstream.status}</span>
              </div>
              <div style={styles.agentDecisionRow} aria-label="Agent current activity">
                <div style={styles.agentDecisionCell} title={workstreamActivityText(workstream)}>
                  <span style={styles.agentProviderCellLabel}>Now</span>
                  <span style={styles.agentProviderCellValue}>{workstreamActivityText(workstream)}</span>
                </div>
                <div style={styles.agentDecisionCell} title={workstreamActivityMeta(workstream)}>
                  <span style={styles.agentProviderCellLabel}>Signal</span>
                  <span style={styles.agentProviderCellValue}>{workstreamActivityMeta(workstream)}</span>
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
              {latestMissionControlInput && (
                <div style={styles.agentDecisionRow} aria-label="Agent cockpit ask" data-testid="canvas-agent-cockpit-ask">
                  <div style={styles.agentDecisionCell} title={latestMissionControlInput.text}>
                    <span style={styles.agentProviderCellLabel}>Cockpit ask</span>
                    <span style={styles.agentProviderCellValue}>{latestMissionControlInput.text}</span>
                  </div>
                  <div
                    style={styles.agentDecisionCell}
                    title={latestMissionControlInput.sentAt ? "Mission-control ask was sent to the provider" : "Mission-control ask is queued for dispatch"}
                  >
                    <span style={styles.agentProviderCellLabel}>Ask state</span>
                    <span style={styles.agentProviderCellValue}>
                      {latestMissionControlInput.label ?? "Mission control"} · {latestMissionControlInput.sentAt ? "sent" : "queued"}
                    </span>
                  </div>
                </div>
              )}
              <div style={styles.agentDecisionRow} aria-label="Agent memory">
                <div style={styles.agentDecisionCell} title={workstream.memory ?? "No agent memory reported yet."}>
                  <span style={styles.agentProviderCellLabel}>Memory</span>
                  <span style={styles.agentProviderCellValue}>{workstream.memory ?? "No agent memory reported yet."}</span>
                </div>
              </div>
              <form style={styles.agentComposer} aria-label="Agent operator composer" onSubmit={onSubmitWorkstreamInput}>
                <textarea
                  ref={composerRef}
                  style={styles.agentComposerInput}
                  aria-label="Agent follow-up prompt"
                  placeholder="Prompt the agent..."
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
                  type="button"
                  style={{
                    ...styles.agentComposerButton,
                    display: canDraftProofRequest ? styles.agentComposerButton.display : "none",
                    background: "var(--surface-hover)",
                    color: "var(--text-primary)",
                  }}
                  aria-label="Draft proof request"
                  title="Draft proof request"
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={onDraftProofRequest}
                >
                  <FileText size={14} strokeWidth={2} />
                </button>
                <button
                  type="button"
                  style={{
                    ...styles.agentComposerButton,
                    display: canDraftStatusCheck ? styles.agentComposerButton.display : "none",
                    background: "var(--surface-hover)",
                    color: "var(--text-primary)",
                  }}
                  aria-label="Draft status check"
                  title="Draft status check"
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={onDraftStatusCheck}
                >
                  <NotebookText size={14} strokeWidth={2} />
                </button>
                <button
                  type="button"
                  style={{
                    ...styles.agentComposerButton,
                    background: "var(--surface-hover)",
                    color: "var(--text-primary)",
                    opacity: operatorDraft.trim() ? undefined : 0.45,
                    cursor: operatorDraft.trim() ? "pointer" : "default",
                  }}
                  aria-label="Save operator memory"
                  title="Save handoff memory"
                  disabled={!operatorDraft.trim()}
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={saveOperatorMemory}
                >
                  <ClipboardCopy size={14} strokeWidth={2} />
                </button>
                <button
                  type="submit"
                  style={{
                    ...styles.agentComposerButton,
                    opacity: operatorDraft.trim() ? undefined : 0.45,
                    cursor: operatorDraft.trim() ? "pointer" : "default",
                  }}
                  aria-label="Queue follow-up prompt"
                  title="Send prompt to agent"
                  disabled={!operatorDraft.trim()}
                  onMouseDown={(event) => event.stopPropagation()}
                >
                  <Bot size={14} strokeWidth={2} />
                </button>
              </form>
              <details style={styles.agentDetails}>
                <summary style={styles.agentDetailsSummary}>Details</summary>
                <div style={styles.agentDetailsBody}>
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
                  <div style={styles.agentDecisionRow} aria-label="Agent local context">
                    <div style={styles.agentDecisionCell} title={workstream.cwd ?? "No launch cwd recorded"}>
                      <span style={styles.agentProviderCellLabel}>Cwd</span>
                      <span style={styles.agentProviderCellValue}>{workstream.cwdLabel ?? "workspace root unknown"}</span>
                    </div>
                    <div style={styles.agentDecisionCell} title={workstream.gitRoot ?? "No git repository detected"}>
                      <span style={styles.agentProviderCellLabel}>Git</span>
                      <span style={styles.agentProviderCellValue}>{formatWorkstreamBranch(workstream)}</span>
                    </div>
                  </div>
                  <div style={styles.agentDecisionRow} aria-label="Agent workspace isolation">
                    <div style={styles.agentDecisionCell} title={workstream.worktreePath ?? "No worktree path recorded"}>
                      <span style={styles.agentProviderCellLabel}>Worktree</span>
                      <span style={styles.agentProviderCellValue}>{workstream.worktreePath ?? "unknown"}</span>
                    </div>
                    <div style={styles.agentDecisionCell} title={workstream.isolationNote ?? "Worktree isolation policy"}>
                      <span style={styles.agentProviderCellLabel}>Isolation</span>
                      <span style={styles.agentProviderCellValue}>{formatWorkstreamIsolation(workstream.isolationMode, workstream.isolationStatus)}</span>
                    </div>
                  </div>
                  <div style={styles.agentDecisionRow} aria-label="Agent worktree cleanup">
                    <div style={styles.agentDecisionCell} title={workstream.worktreeCleanupNote ?? "No cleanup status recorded"}>
                      <span style={styles.agentProviderCellLabel}>Cleanup</span>
                      <span style={styles.agentProviderCellValue}>{workstream.worktreeCleanupStatus ?? "unknown"}</span>
                    </div>
                    <div style={styles.agentDecisionCell} title={workstream.worktreeCleanupNote ?? "No cleanup note recorded"}>
                      <span style={styles.agentProviderCellLabel}>Cleanup note</span>
                      <span style={styles.agentProviderCellValue}>{workstream.worktreeCleanupNote ?? "pending"}</span>
                    </div>
                  </div>
                  <div style={styles.agentDecisionRow} aria-label="Agent output details">
                    <div style={styles.agentDecisionCell} title={workstream.evidence ?? "No evidence reported yet"}>
                      <span style={styles.agentProviderCellLabel}>Evidence</span>
                      <span style={styles.agentProviderCellValue}>{workstream.evidence ?? "pending"}</span>
                    </div>
                    <div style={styles.agentDecisionCell} title={workstream.artifact ?? "No artifact reported yet"}>
                      <span style={styles.agentProviderCellLabel}>Artifact</span>
                      <span style={styles.agentProviderCellValue}>{workstream.artifact ?? "pending"}</span>
                    </div>
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
                    <div style={styles.agentProviderCell} title={workstream.stage ?? "Provider has not reported a work stage"}>
                      <span style={styles.agentProviderCellLabel}>Stage</span>
                      <span style={styles.agentProviderCellValue}>{workstream.stage ?? "pending"}</span>
                    </div>
                    <div style={styles.agentProviderCell} title={workstream.confidence ?? "Provider has not reported confidence"}>
                      <span style={styles.agentProviderCellLabel}>Confidence</span>
                      <span style={styles.agentProviderCellValue}>{workstream.confidence ?? "pending"}</span>
                    </div>
                    <div style={styles.agentProviderCell} title={workstream.risk ?? "Provider has not reported risk"}>
                      <span style={styles.agentProviderCellLabel}>Risk</span>
                      <span style={styles.agentProviderCellValue}>{workstream.risk ?? "pending"}</span>
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
                  <div style={styles.agentTimeline} aria-label="Agent run timeline">
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
              </details>
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
  const selectCanvasNodes = useWorkspaceStore((state) => state.selectCanvasNodes);
  const openFiles = useWorkspaceStore((state) => state.openFiles);
  const shellRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<{ x: number; y: number; viewportX: number; viewportY: number } | null>(null);
  const [fileIndex, setFileIndex] = useState(0);
  const [terminalPreviews, setTerminalPreviews] = useState<Record<string, TerminalPreviewEntry>>({});
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
  const selectionStartRef = useRef<{ clientX: number; clientY: number; canvasX: number; canvasY: number } | null>(null);
  // Right-click "create here" menu. Screen coords place the menu; canvas coords
  // drop the new node where the cursor is.
  const [menu, setMenu] = useState<{ x: number; y: number; canvasX: number; canvasY: number } | null>(null);
  const [labelMenu, setLabelMenu] = useState<{ nodeId: string; x: number; y: number } | null>(null);
  const agentLane = summarizeAgentLane(tabs);
  const activeAgentWorkstreams = agentLane.workstreams.filter(({ workstream }) => isActiveAgentWorkstream(workstream));
  const restartableAgentWorkstreams = agentLane.workstreams.filter(({ workstream }) => isRestartableAgentWorkstream(workstream));
  const authRetryableAgentWorkstreams = agentLane.workstreams.filter(({ workstream }) => isAuthRetryableAgentWorkstream(workstream));
  const cleanupRequestableAgentWorkstreams = agentLane.workstreams.filter(({ workstream }) => isCleanupRequestableAgentWorkstream(workstream));
  const closeoutReadyReviewItems = agentLane.reviewItems.filter((item) => isReviewItemCloseoutReady(item));
  const proofRequestItems = agentLane.proofItems;
  const memoryRequestItems = agentLane.memoryRequestItems;
  const riskMitigationItems = agentLane.riskItems;
  const queueAgentLaneStatusSweep = useCallback(() => {
    const targets = activeAgentWorkstreams;
    if (targets.length === 0) return;
    const store = useWorkspaceStore.getState();
    for (const { tab, workstream } of targets) {
      store.queueWorkstreamInput(tab.id, statusCheckPromptForWorkstream(workstream), {
        source: "mission-control",
        label: "Status sweep",
      });
    }
    setActiveTab(targets[0].tab.id);
  }, [activeAgentWorkstreams, setActiveTab]);
  const interruptActiveAgentFleet = useCallback(() => {
    const targets = activeAgentWorkstreams;
    if (targets.length === 0) return;
    const store = useWorkspaceStore.getState();
    void Promise.all(targets.map(({ tab }) => store.interruptWorkstream(tab.id)));
    setActiveTab(targets[0].tab.id);
  }, [activeAgentWorkstreams, setActiveTab]);
  const restartRecoveryAgentFleet = useCallback(() => {
    const targets = restartableAgentWorkstreams;
    if (targets.length === 0) return;
    const store = useWorkspaceStore.getState();
    setActiveTab(targets[0].tab.id);
    void Promise.all(targets.map(({ tab }) => store.restartWorkstream(tab.id, {
      source: "mission-control",
      label: "Restart recovery",
    })));
  }, [restartableAgentWorkstreams, setActiveTab]);
  const retryAuthAgentFleet = useCallback(() => {
    const targets = authRetryableAgentWorkstreams;
    if (targets.length === 0) return;
    const store = useWorkspaceStore.getState();
    setActiveTab(targets[0].tab.id);
    void Promise.all(targets.map(({ tab }) => store.restartWorkstream(tab.id, {
      source: "mission-control",
      label: "Retry auth",
    })));
  }, [authRetryableAgentWorkstreams, setActiveTab]);
  const requestCleanupFromAgentFleet = useCallback(() => {
    const targets = cleanupRequestableAgentWorkstreams;
    if (targets.length === 0) return;
    const store = useWorkspaceStore.getState();
    for (const { tab } of targets) {
      store.requestWorktreeCleanup(tab.id, {
        source: "mission-control",
        label: "Request cleanup",
      });
    }
    setActiveTab(targets[0].tab.id);
  }, [cleanupRequestableAgentWorkstreams, setActiveTab]);
  const reviewReadyAgentCloseouts = useCallback(() => {
    const targets = closeoutReadyReviewItems;
    if (targets.length === 0) return;
    const store = useWorkspaceStore.getState();
    for (const item of targets) {
      store.reviewWorkstream(item.tabId, {
        source: "mission-control",
        label: "Review",
      });
    }
    setActiveTab(targets[0].tabId);
  }, [closeoutReadyReviewItems, setActiveTab]);
  const requestProofFromAgentFleet = useCallback(() => {
    const targets = proofRequestItems
      .map((item) => tabs.find((tab) => tab.id === item.tabId))
      .filter((tab): tab is Tab => Boolean(tab?.workstream));
    if (targets.length === 0) return;
    const store = useWorkspaceStore.getState();
    for (const tab of targets) {
      const workstream = tab.workstream;
      if (!workstream) continue;
      store.queueWorkstreamInput(tab.id, proofRequestPromptForWorkstream(workstream), {
        source: "mission-control",
        label: "Request proof",
      });
    }
    setActiveTab(targets[0].id);
  }, [proofRequestItems, setActiveTab, tabs]);
  const requestMemoryFromAgentFleet = useCallback(() => {
    const targets = memoryRequestItems
      .map((item) => tabs.find((tab) => tab.id === item.tabId))
      .filter((tab): tab is Tab => Boolean(tab?.workstream));
    if (targets.length === 0) return;
    const store = useWorkspaceStore.getState();
    for (const tab of targets) {
      const workstream = tab.workstream;
      if (!workstream) continue;
      store.queueWorkstreamInput(tab.id, handoffMemoryPromptForWorkstream(workstream), {
        source: "mission-control",
        label: "Request memory",
      });
    }
    setActiveTab(targets[0].id);
  }, [memoryRequestItems, setActiveTab, tabs]);
  const requestRiskMitigationFromAgentFleet = useCallback(() => {
    const targets = riskMitigationItems
      .map((item) => ({ item, tab: tabs.find((tab) => tab.id === item.tabId) }))
      .filter((target): target is { item: typeof riskMitigationItems[number]; tab: Tab } => Boolean(target.tab?.workstream));
    if (targets.length === 0) return;
    const store = useWorkspaceStore.getState();
    for (const { item, tab } of targets) {
      store.queueWorkstreamInput(tab.id, item.prompt, {
        source: "mission-control",
        label: "Mitigate risk",
      });
    }
    setActiveTab(targets[0].tab.id);
  }, [riskMitigationItems, setActiveTab, tabs]);

  const openCanvasMenu = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return; // only empty canvas background
    event.preventDefault();
    const rect = shellRef.current?.getBoundingClientRect();
    const viewport = canvasState.viewport;
    const canvasX = rect ? (event.clientX - rect.left - viewport.x) / viewport.zoom : 0;
    const canvasY = rect ? (event.clientY - rect.top - viewport.y) / viewport.zoom : 0;
    setMenu({ x: event.clientX, y: event.clientY, canvasX, canvasY });
  }, [canvasState.viewport]);

  const openNodeLabelMenu = useCallback((nodeId: string, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setMenu(null);
    setLabelMenu({ nodeId, x: event.clientX, y: event.clientY });
  }, []);

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
    const rect = shellRef.current?.getBoundingClientRect();
    const viewport = canvasState.viewport;
    if ((selectionMode || event.shiftKey) && rect) {
      const canvasRect = rect;
      const canvasX = (event.clientX - canvasRect.left - viewport.x) / viewport.zoom;
      const canvasY = (event.clientY - canvasRect.top - viewport.y) / viewport.zoom;
      selectionStartRef.current = { clientX: event.clientX, clientY: event.clientY, canvasX, canvasY };
      setSelectionBox({ left: event.clientX, top: event.clientY, width: 0, height: 0 });
      document.body.classList.add("no-select");

      function onSelectMove(moveEvent: MouseEvent) {
        const start = selectionStartRef.current;
        if (!start) return;
        setSelectionBox({
          left: Math.min(start.clientX, moveEvent.clientX),
          top: Math.min(start.clientY, moveEvent.clientY),
          width: Math.abs(moveEvent.clientX - start.clientX),
          height: Math.abs(moveEvent.clientY - start.clientY),
        });
      }

      function onSelectUp(upEvent: MouseEvent) {
        const start = selectionStartRef.current;
        selectionStartRef.current = null;
        setSelectionBox(null);
        document.body.classList.remove("no-select");
        document.removeEventListener("mousemove", onSelectMove);
        document.removeEventListener("mouseup", onSelectUp);
        if (!start) return;
        const endCanvasX = (upEvent.clientX - canvasRect.left - viewport.x) / viewport.zoom;
        const endCanvasY = (upEvent.clientY - canvasRect.top - viewport.y) / viewport.zoom;
        const selectionRect: CanvasRect = {
          minX: Math.min(start.canvasX, endCanvasX),
          minY: Math.min(start.canvasY, endCanvasY),
          maxX: Math.max(start.canvasX, endCanvasX),
          maxY: Math.max(start.canvasY, endCanvasY),
        };
        const selectedIds = useWorkspaceStore.getState().canvasState.nodes
          .filter((node) => node.type === "terminal")
          .filter((node) => rectsIntersect(selectionRect, {
            minX: node.x,
            minY: node.y,
            maxX: node.x + node.width,
            maxY: node.y + node.height,
          }))
          .map((node) => node.id);
        selectCanvasNodes(selectedIds);
      }

      document.addEventListener("mousemove", onSelectMove);
      document.addEventListener("mouseup", onSelectUp);
      return;
    }
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
  }, [canvasState.viewport, selectCanvasNodes, selectionMode, updateCanvasViewport]);

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
        <button
          className="magic-canvas-button"
          style={{
            ...styles.button,
            background: selectionMode ? "var(--surface-selected)" : styles.button.background,
            color: selectionMode ? "var(--text-primary)" : styles.button.color,
          }}
          title="Select terminals"
          aria-label="Select terminals"
          aria-pressed={selectionMode}
          onClick={() => setSelectionMode((enabled) => !enabled)}
        >
          <MousePointer2 size={14} strokeWidth={1.8} />
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
              Agent runs
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <button
                type="button"
                className="magic-canvas-button"
                style={{ ...styles.button, width: 24, height: 24 }}
                data-testid="canvas-agent-lane-status-sweep"
                title={agentLaneStatusSweepTitle(agentLane)}
                aria-label="Request active agent status sweep"
                disabled={activeAgentWorkstreams.length === 0}
                onClick={queueAgentLaneStatusSweep}
              >
                <RefreshCw size={13} strokeWidth={1.8} />
              </button>
              <button
                type="button"
                className="magic-canvas-button"
                style={{ ...styles.button, width: 24, height: 24 }}
                data-testid="canvas-agent-lane-interrupt-active"
                title={agentLaneInterruptTitle(agentLane)}
                aria-label="Interrupt active agent fleet"
                disabled={activeAgentWorkstreams.length === 0}
                onClick={interruptActiveAgentFleet}
              >
                <Ban size={13} strokeWidth={1.8} />
              </button>
              <button
                type="button"
                className="magic-canvas-button"
                style={{ ...styles.button, width: 24, height: 24 }}
                data-testid="canvas-agent-lane-restart-recovery"
                title={agentLaneRestartTitle(agentLane)}
                aria-label="Restart recovery agent fleet"
                disabled={restartableAgentWorkstreams.length === 0}
                onClick={restartRecoveryAgentFleet}
              >
                <RotateCcw size={13} strokeWidth={1.8} />
              </button>
              <button
                type="button"
                className="magic-canvas-button"
                style={{ ...styles.button, width: 24, height: 24 }}
                data-testid="canvas-agent-lane-retry-auth"
                title={agentLaneAuthRetryTitle(agentLane)}
                aria-label="Retry auth-blocked agent fleet"
                disabled={authRetryableAgentWorkstreams.length === 0}
                onClick={retryAuthAgentFleet}
              >
                <RefreshCw size={13} strokeWidth={1.8} />
              </button>
              <button
                type="button"
                className="magic-canvas-button"
                style={{ ...styles.button, width: 24, height: 24 }}
                data-testid="canvas-agent-lane-request-cleanup"
                title={agentLaneCleanupRequestTitle(agentLane)}
                aria-label="Request cleanup for cleanup-ready agent fleet"
                disabled={cleanupRequestableAgentWorkstreams.length === 0}
                onClick={requestCleanupFromAgentFleet}
              >
                <Trash2 size={13} strokeWidth={1.8} />
              </button>
              <button
                type="button"
                className="magic-canvas-button"
                style={{ ...styles.button, width: 24, height: 24 }}
                data-testid="canvas-agent-lane-request-proof"
                title={agentLaneProofRequestTitle(agentLane)}
                aria-label="Request proof from proof-needed agent fleet"
                disabled={proofRequestItems.length === 0}
                onClick={requestProofFromAgentFleet}
              >
                <FileText size={13} strokeWidth={1.8} />
              </button>
              <button
                type="button"
                className="magic-canvas-button"
                style={{ ...styles.button, width: 24, height: 24 }}
                data-testid="canvas-agent-lane-request-memory"
                title={agentLaneMemoryRequestTitle(agentLane)}
                aria-label="Request handoff memory from memory-needed agent fleet"
                disabled={memoryRequestItems.length === 0}
                onClick={requestMemoryFromAgentFleet}
              >
                <NotebookText size={13} strokeWidth={1.8} />
              </button>
              <button
                type="button"
                className="magic-canvas-button"
                style={{ ...styles.button, width: 24, height: 24 }}
                data-testid="canvas-agent-lane-mitigate-risk"
                title={agentLaneRiskMitigationTitle(agentLane)}
                aria-label="Request risk mitigation from risky agent fleet"
                disabled={riskMitigationItems.length === 0}
                onClick={requestRiskMitigationFromAgentFleet}
              >
                <Ban size={13} strokeWidth={1.8} />
              </button>
              <button
                type="button"
                className="magic-canvas-button"
                style={{ ...styles.button, width: 24, height: 24 }}
                data-testid="canvas-agent-lane-review-ready"
                title={agentLaneCloseoutTitle(agentLane)}
                aria-label="Review ready agent closeouts"
                disabled={closeoutReadyReviewItems.length === 0}
                onClick={reviewReadyAgentCloseouts}
              >
                <CheckCircle2 size={13} strokeWidth={1.8} />
              </button>
              <button
                type="button"
                className="magic-canvas-button"
                style={{ ...styles.button, width: 24, height: 24 }}
                data-testid="canvas-agent-lane-copy-mission"
                title="Copy mission control brief"
                aria-label="Copy mission control brief"
                onClick={() => {
                  if (navigator.clipboard?.writeText) {
                    void navigator.clipboard.writeText(formatAgentMissionControlBrief(agentLane));
                  }
                }}
              >
                <ListTodo size={13} strokeWidth={1.8} />
              </button>
              <button
                type="button"
                className="magic-canvas-button"
                style={{ ...styles.button, width: 24, height: 24 }}
                data-testid="canvas-agent-lane-copy-brief"
                title="Copy agent supervision brief"
                aria-label="Copy agent supervision brief"
                onClick={() => {
                  if (navigator.clipboard?.writeText) {
                    void navigator.clipboard.writeText(formatAgentLaneBrief(agentLane));
                  }
                }}
              >
                <ClipboardCopy size={13} strokeWidth={1.8} />
              </button>
              <span>{agentLane.total}</span>
            </span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            <span
              data-testid="canvas-agent-lane-status-sweep-plan"
              title={agentLaneStatusSweepTitle(agentLane)}
              style={styles.agentLaneChip}
            >
              {agentLaneStatusSweepText(agentLane)}
            </span>
            <span
              data-testid="canvas-agent-lane-interrupt-plan"
              title={agentLaneInterruptTitle(agentLane)}
              style={styles.agentLaneChip}
            >
              {agentLaneInterruptText(agentLane)}
            </span>
            <span
              data-testid="canvas-agent-lane-restart-plan"
              title={agentLaneRestartTitle(agentLane)}
              style={styles.agentLaneChip}
            >
              {agentLaneRestartText(agentLane)}
            </span>
            <span
              data-testid="canvas-agent-lane-auth-retry-plan"
              title={agentLaneAuthRetryTitle(agentLane)}
              style={styles.agentLaneChip}
            >
              {agentLaneAuthRetryText(agentLane)}
            </span>
            <span
              data-testid="canvas-agent-lane-cleanup-plan"
              title={agentLaneCleanupRequestTitle(agentLane)}
              style={styles.agentLaneChip}
            >
              {agentLaneCleanupRequestText(agentLane)}
            </span>
            <span
              data-testid="canvas-agent-lane-closeout-plan"
              title={agentLaneCloseoutTitle(agentLane)}
              style={styles.agentLaneChip}
            >
              {agentLaneCloseoutText(agentLane)}
            </span>
            <span
              data-testid="canvas-agent-lane-proof-plan"
              title={agentLaneProofRequestTitle(agentLane)}
              style={styles.agentLaneChip}
            >
              {agentLaneProofRequestText(agentLane)}
            </span>
            <span
              data-testid="canvas-agent-lane-memory-plan"
              title={agentLaneMemoryRequestTitle(agentLane)}
              style={styles.agentLaneChip}
            >
              {agentLaneMemoryRequestText(agentLane)}
            </span>
            <span
              data-testid="canvas-agent-lane-risk-plan"
              title={agentLaneRiskMitigationTitle(agentLane)}
              style={styles.agentLaneChip}
            >
              {agentLaneRiskMitigationText(agentLane)}
            </span>
          </div>
          <div style={styles.agentLaneStats}>
            <span style={styles.agentLaneChip} data-testid="canvas-agent-lane-total">{agentLane.total} agents</span>
            <span style={styles.agentLaneChip}>{agentLane.active} active</span>
            <span style={styles.agentLaneChip}>{agentLane.waiting} waiting</span>
            <span style={styles.agentLaneChip}>{agentLane.blocked} blocked</span>
            <span style={styles.agentLaneChip}>{agentLane.complete} complete</span>
            <span style={styles.agentLaneChip}>{agentLane.workspaceGroups.length} groups</span>
            <span style={styles.agentLaneChip}>{agentLane.missionItemCount} mission rows</span>
            <span style={styles.agentLaneChip}>{agentLane.missionActionCount} actions</span>
            {agentLane.hiddenMissionItemCount > 0 && (
              <span style={styles.agentLaneChip}>+{agentLane.hiddenMissionItemCount} hidden rows</span>
            )}
            {agentLane.hiddenMissionActionCount > 0 && (
              <span style={styles.agentLaneChip}>+{agentLane.hiddenMissionActionCount} hidden actions</span>
            )}
            <span style={styles.agentLaneChip}>{agentLane.promptCount} prompts</span>
            <span style={styles.agentLaneChip}>{agentLane.missionControlPromptCount} mission prompts</span>
            <span style={styles.agentLaneChip}>{agentLane.missionControlPromptSentCount} mission sent</span>
            <span style={styles.agentLaneChip}>{agentLane.outputCount} outputs</span>
            <span style={styles.agentLaneChip}>{agentLane.nextCount} next</span>
            <span style={styles.agentLaneChip}>{agentLane.memoryItems.length} memories</span>
            <span style={styles.agentLaneChip}>{agentLane.recentEvents.length} events</span>
            <span style={styles.agentLaneChip}>{agentLane.staleItems.length} stale</span>
            <span style={styles.agentLaneChip}>{agentLane.evidenceItems.length} evidence</span>
            <span style={styles.agentLaneChip}>{agentLane.proofItems.length} proof</span>
            <span style={styles.agentLaneChip}>{agentLane.authItems.length} auth</span>
            <span style={styles.agentLaneChip}>{agentLane.riskItems.length} risk</span>
            <span style={styles.agentLaneChip}>{agentLane.recoveryItems.length} recovery</span>
            <span style={styles.agentLaneChip}>{agentLane.reviewItems.length} review</span>
            <span style={styles.agentLaneChip}>{agentLane.reviewCloseoutReady} closeout ready</span>
            <span style={styles.agentLaneChip}>{agentLane.reviewCloseoutBlocked} closeout blocked</span>
            <span style={styles.agentLaneChip}>{agentLane.reviewReadyWithProof} proven</span>
            <span style={styles.agentLaneChip}>{agentLane.reviewNeedsProof} unproven</span>
            <span style={styles.agentLaneChip}>{agentLane.reviewReadyWithMemory} handoff ready</span>
            <span style={styles.agentLaneChip}>{agentLane.reviewNeedsMemory} handoff missing</span>
            <span style={styles.agentLaneChip}>{agentLane.attentionItems.length} queue</span>
            <span style={styles.agentLaneChip}>{agentLane.dedicated} dedicated</span>
            <span style={styles.agentLaneChip}>{agentLane.shared} shared</span>
            <span style={styles.agentLaneChip}>{agentLane.cleanupRequested} cleanup</span>
            <span style={styles.agentLaneChip}>{agentLane.attention} attention</span>
          </div>
          <div
            style={styles.agentLaneItem}
            data-testid="canvas-agent-lane-headline"
            aria-label="Agent cockpit headline"
            title={agentLane.cockpitHeadline.detail}
          >
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-primary)" }}>
              {agentLane.cockpitHeadline.label}
            </span>
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {agentLane.cockpitHeadline.detail}
            </span>
          </div>
          <div
            style={styles.agentLaneItem}
            data-testid="canvas-agent-lane-health"
            aria-label="Agent lane health"
            title={agentLaneHealthText(agentLane)}
          >
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-primary)" }}>
              Health
            </span>
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {agentLaneHealthText(agentLane)}
            </span>
          </div>
          {agentLane.missionBreakdown.length > 0 && (
            <div
              style={styles.agentLaneItem}
              data-testid="canvas-agent-lane-mission-breakdown"
              title={missionBreakdownText(agentLane)}
            >
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-primary)" }}>
                Mission mix
              </span>
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {missionBreakdownText(agentLane)}
              </span>
            </div>
          )}
          {agentLane.missionControlDispatchBreakdown.length > 0 && (
            <div
              style={styles.agentLaneItem}
              data-testid="canvas-agent-lane-dispatch-breakdown"
              title={missionControlDispatchBreakdownText(agentLane)}
            >
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-primary)" }}>
                Dispatch mix
              </span>
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {missionControlDispatchBreakdownText(agentLane)}
              </span>
            </div>
          )}
          {agentLane.providerBreakdown.length > 0 && (
            <div
              style={styles.agentLaneItem}
              data-testid="canvas-agent-lane-provider-breakdown"
              title={providerBreakdownText(agentLane)}
            >
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-primary)" }}>
                Provider mix
              </span>
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {providerBreakdownText(agentLane)}
              </span>
            </div>
          )}
          {agentLane.isolationBreakdown.length > 0 && (
            <div
              style={styles.agentLaneItem}
              data-testid="canvas-agent-lane-isolation-breakdown"
              title={isolationBreakdownText(agentLane)}
            >
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-primary)" }}>
                Isolation mix
              </span>
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {isolationBreakdownText(agentLane)}
              </span>
            </div>
          )}
          {agentLane.cleanupBreakdown.length > 0 && (
            <div
              style={styles.agentLaneItem}
              data-testid="canvas-agent-lane-cleanup-breakdown"
              title={cleanupBreakdownText(agentLane)}
            >
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-primary)" }}>
                Cleanup mix
              </span>
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {cleanupBreakdownText(agentLane)}
              </span>
            </div>
          )}
          {agentLane.readinessBreakdown.length > 0 && (
            <div
              style={styles.agentLaneItem}
              data-testid="canvas-agent-lane-readiness-breakdown"
              title={readinessBreakdownText(agentLane)}
            >
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-primary)" }}>
                Readiness mix
              </span>
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {readinessBreakdownText(agentLane)}
              </span>
            </div>
          )}
          {agentLane.attentionBreakdown.length > 0 && (
            <div
              style={styles.agentLaneItem}
              data-testid="canvas-agent-lane-attention-breakdown"
              title={attentionBreakdownText(agentLane)}
            >
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-primary)" }}>
                Attention mix
              </span>
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {attentionBreakdownText(agentLane)}
              </span>
            </div>
          )}
          {agentLane.riskBreakdown.length > 0 && (
            <div
              style={styles.agentLaneItem}
              data-testid="canvas-agent-lane-risk-breakdown"
              title={riskBreakdownText(agentLane)}
            >
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-primary)" }}>
                Risk mix
              </span>
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {riskBreakdownText(agentLane)}
              </span>
            </div>
          )}
          {agentLane.closeoutBreakdown.length > 0 && (
            <div
              style={styles.agentLaneItem}
              data-testid="canvas-agent-lane-closeout-breakdown"
              title={closeoutBreakdownText(agentLane)}
            >
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-primary)" }}>
                Closeout mix
              </span>
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {closeoutBreakdownText(agentLane)}
              </span>
            </div>
          )}
          {agentLane.supervisorItems.length > 0 && (
            <div style={styles.agentLaneList} aria-label="Agent mission control">
              {agentLane.supervisorItems.map((item) => {
                const node = canvasState.nodes.find((candidate) => candidate.terminalTabId === item.tabId);
                return (
                  <button
                    key={`${item.tabId}-${item.label}-${item.detail}`}
                    type="button"
                    className="magic-canvas-button"
                    style={{ ...styles.agentLaneItem, background: "transparent", border: "none", padding: "3px 0", textAlign: "left", cursor: node ? "pointer" : "default" }}
                    data-testid="canvas-agent-supervisor-item"
                    title={`${item.label} ${item.title}`}
                    onClick={() => {
                      setActiveTab(item.tabId);
                      if (item.action === "queue-prompt" && item.prompt) {
                        useWorkspaceStore.getState().queueWorkstreamInput(item.tabId, item.prompt, {
                          source: "mission-control",
                          label: item.label,
                        });
                      }
                      if (item.action === "review") {
                        useWorkspaceStore.getState().reviewWorkstream(item.tabId, {
                          source: "mission-control",
                          label: item.label,
                        });
                      }
                      if (node) centerNode(node, FOCUS_TERMINAL_ZOOM);
                    }}
                  >
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-primary)" }}>
                      {item.label}
                    </span>
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.title} · {item.runIdentity} · {item.workspaceIdentity} · Now: {item.activity} · Signal: {item.signalAge} · Source: {item.signalSource} · {item.detail}{missionControlAlternateText(item) ? ` · Also: ${missionControlAlternateText(item)}` : ""}
                    </span>
                  </button>
                );
              })}
              {agentLane.hiddenMissionItemCount > 0 && (
                <div
                  style={styles.agentLaneItem}
                  data-testid="canvas-agent-supervisor-overflow"
                  title={`${agentLane.hiddenMissionItemCount} mission rows and ${agentLane.hiddenMissionActionCount} actions hidden below the visible queue${agentLane.hiddenSupervisorItems[0] ? `: ${agentLane.hiddenSupervisorItems[0].title} · ${agentLane.hiddenSupervisorItems[0].label} · ${agentLane.hiddenSupervisorItems[0].detail}${missionControlAlternateText(agentLane.hiddenSupervisorItems[0]) ? ` · Also: ${missionControlAlternateText(agentLane.hiddenSupervisorItems[0])}` : ""}` : ""}`}
                >
                  <span style={{ color: "var(--text-primary)" }}>+{agentLane.hiddenMissionItemCount} rows · {agentLane.hiddenMissionActionCount} actions</span>
                  <span>
                    {agentLane.hiddenSupervisorItems[0]
                      ? `${agentLane.hiddenSupervisorItems[0].title} · ${agentLane.hiddenSupervisorItems[0].label} · ${agentLane.hiddenSupervisorItems[0].detail}${missionControlAlternateText(agentLane.hiddenSupervisorItems[0]) ? ` · Also: ${missionControlAlternateText(agentLane.hiddenSupervisorItems[0])}` : ""}`
                      : "Mission rows hidden below the visible queue"}
                  </span>
                </div>
              )}
            </div>
          )}
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
          {agentLane.attentionItems.length > 0 && (
            <div style={styles.agentLaneList} aria-label="Agent attention queue">
              {agentLane.attentionItems.slice(0, 3).map((item) => {
                const node = canvasState.nodes.find((candidate) => candidate.terminalTabId === item.tabId);
                return (
                  <button
                    key={item.tabId}
                    type="button"
                    className="magic-canvas-button"
                    style={{ ...styles.agentLaneItem, background: "transparent", border: "none", padding: "3px 0", textAlign: "left", cursor: node ? "pointer" : "default" }}
                    data-testid="canvas-agent-attention-item"
                    title={`Send status check to ${item.title}`}
                    onClick={() => {
                      setActiveTab(item.tabId);
                      if (node) centerNode(node, FOCUS_TERMINAL_ZOOM);
                    }}
                  >
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-primary)" }}>
                      {item.label}
                    </span>
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.title} · {item.detail}
                    </span>
                  </button>
                );
              })}
              {agentLane.attentionItems.length > 3 && (
                <div style={styles.agentLaneOverflow} data-testid="canvas-agent-attention-overflow">
                  +{agentLane.attentionItems.length - 3} more attention · {agentLane.attentionItems[3].label} · {agentLane.attentionItems[3].title} · {agentLane.attentionItems[3].detail}
                </div>
              )}
            </div>
          )}
          <div style={styles.agentLaneList} aria-label="Agent workspace groups">
            {agentLane.workspaceGroups.slice(0, 3).map((group) => {
              const node = canvasState.nodes.find((candidate) => candidate.terminalTabId === group.primaryTabId);
              const cleanupText = group.cleanupRequested > 0 ? ` · ${group.cleanupRequested} cleanup` : "";
              const attentionText = group.attention > 0 ? ` · ${group.attention} attention` : "";
              return (
                <button
                  key={group.id}
                  type="button"
                  className="magic-canvas-button"
                  style={{ ...styles.agentLaneItem, background: "transparent", border: "none", padding: "3px 0", textAlign: "left", cursor: node ? "pointer" : "default" }}
                  data-testid="canvas-agent-workspace-group"
                  title={`Copy workspace group ${group.label}`}
                  onClick={() => {
                    if (!group.primaryTabId) return;
                    setActiveTab(group.primaryTabId);
                    if (navigator.clipboard?.writeText) {
                      void navigator.clipboard.writeText(group.brief);
                    }
                    if (node) centerNode(node, FOCUS_TERMINAL_ZOOM);
                  }}
                >
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-primary)" }}>
                    {group.label}
                  </span>
                  <span>{group.total} agents · {group.active} active · {group.detail}{cleanupText}{attentionText}</span>
                </button>
              );
            })}
            {agentLane.workspaceGroups.length > 3 && (
              <div style={styles.agentLaneOverflow} data-testid="canvas-agent-workspace-group-overflow">
                +{agentLane.workspaceGroups.length - 3} more groups · {agentLane.workspaceGroups[3].label} · {agentLane.workspaceGroups[3].total} agents · {agentLane.workspaceGroups[3].active} active · {agentLane.workspaceGroups[3].detail}
              </div>
            )}
          </div>
          {agentLane.recentEvents.length > 0 && (
            <div style={styles.agentLaneList} aria-label="Agent recent events">
              {agentLane.recentEvents.slice(0, 3).map((item) => {
                const node = canvasState.nodes.find((candidate) => candidate.terminalTabId === item.tabId);
                return (
                  <button
                    key={`${item.tabId}-${item.at}-${item.label}`}
                    type="button"
                    className="magic-canvas-button"
                    style={{ ...styles.agentLaneItem, background: "transparent", border: "none", padding: "3px 0", textAlign: "left", cursor: node ? "pointer" : "default" }}
                    data-testid="canvas-agent-recent-event"
                    title={`Copy event for ${item.title}`}
                    onClick={() => {
                      setActiveTab(item.tabId);
                      if (navigator.clipboard?.writeText) {
                        void navigator.clipboard.writeText(item.brief);
                      }
                      if (node) centerNode(node, FOCUS_TERMINAL_ZOOM);
                    }}
                  >
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-primary)" }}>
                      Copy event
                    </span>
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.title} · {item.label}{item.detail ? ` · ${item.detail}` : ""}
                    </span>
                  </button>
                );
              })}
              {agentLane.recentEvents.length > 3 && (
                <div
                  style={styles.agentLaneItem}
                  data-testid="canvas-agent-recent-event-overflow"
                  title={`${agentLane.recentEvents.length - 3} recent events hidden below the visible event list`}
                >
                  <span style={{ color: "var(--text-primary)" }}>+{agentLane.recentEvents.length - 3} more events</span>
                  <span>
                    {agentLane.recentEvents[3].title} · {agentLane.recentEvents[3].label}{agentLane.recentEvents[3].detail ? ` · ${agentLane.recentEvents[3].detail}` : ""}
                  </span>
                </div>
              )}
            </div>
          )}
          {agentLane.inputItems.length > 0 && (
            <div style={styles.agentLaneList} aria-label="Agent operator prompts">
              {agentLane.inputItems.slice(0, 3).map((item) => {
                const node = canvasState.nodes.find((candidate) => candidate.terminalTabId === item.tabId);
                return (
                  <button
                    key={`${item.tabId}-${item.at}-${item.text}`}
                    type="button"
                    className="magic-canvas-button"
                    style={{ ...styles.agentLaneItem, background: "transparent", border: "none", padding: "3px 0", textAlign: "left", cursor: node ? "pointer" : "default" }}
                    data-testid="canvas-agent-input-item"
                    title={`Copy prompt for ${item.title}`}
                    onClick={() => {
                      setActiveTab(item.tabId);
                      if (navigator.clipboard?.writeText) {
                        void navigator.clipboard.writeText(item.brief);
                      }
                      if (node) centerNode(node, FOCUS_TERMINAL_ZOOM);
                    }}
                  >
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-primary)" }}>
                      Copy prompt
                    </span>
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.title} · {item.state} · {item.text}
                    </span>
                  </button>
                );
              })}
              {agentLane.inputItems.length > 3 && (
                <div
                  style={styles.agentLaneItem}
                  data-testid="canvas-agent-input-overflow"
                  title={`${agentLane.inputItems.length - 3} operator prompts hidden below the visible prompt list`}
                >
                  <span style={{ color: "var(--text-primary)" }}>+{agentLane.inputItems.length - 3} more prompts</span>
                  <span>
                    {agentLane.inputItems[3].title} · {agentLane.inputItems[3].state} · {agentLane.inputItems[3].text}
                  </span>
                </div>
              )}
            </div>
          )}
          {agentLane.outputItems.length > 0 && (
            <div style={styles.agentLaneList} aria-label="Agent terminal output">
              {agentLane.outputItems.slice(0, 3).map((item) => {
                const node = canvasState.nodes.find((candidate) => candidate.terminalTabId === item.tabId);
                return (
                  <button
                    key={`${item.tabId}-${item.at}-${item.output}`}
                    type="button"
                    className="magic-canvas-button"
                    style={{ ...styles.agentLaneItem, background: "transparent", border: "none", padding: "3px 0", textAlign: "left", cursor: node ? "pointer" : "default" }}
                    data-testid="canvas-agent-output-item"
                    title={`Copy terminal output for ${item.title}`}
                    onClick={() => {
                      setActiveTab(item.tabId);
                      if (navigator.clipboard?.writeText) {
                        void navigator.clipboard.writeText(item.brief);
                      }
                      if (node) centerNode(node, FOCUS_TERMINAL_ZOOM);
                    }}
                  >
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-primary)" }}>
                      Copy output
                    </span>
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.title} · {item.output}
                    </span>
                  </button>
                );
              })}
              {agentLane.outputItems.length > 3 && (
                <div
                  style={styles.agentLaneItem}
                  data-testid="canvas-agent-output-overflow"
                  title={`${agentLane.outputItems.length - 3} terminal outputs hidden below the visible output list`}
                >
                  <span style={{ color: "var(--text-primary)" }}>+{agentLane.outputItems.length - 3} more output</span>
                  <span>
                    {agentLane.outputItems[3].title} · {agentLane.outputItems[3].output}
                  </span>
                </div>
              )}
            </div>
          )}
          {agentLane.nextItems.length > 0 && (
            <div style={styles.agentLaneList} aria-label="Agent next actions">
              {agentLane.nextItems.slice(0, 3).map((item) => {
                const node = canvasState.nodes.find((candidate) => candidate.terminalTabId === item.tabId);
                return (
                  <button
                    key={`${item.tabId}-${item.at}-${item.nextAction}`}
                    type="button"
                    className="magic-canvas-button"
                    style={{ ...styles.agentLaneItem, background: "transparent", border: "none", padding: "3px 0", textAlign: "left", cursor: node ? "pointer" : "default" }}
                    data-testid="canvas-agent-next-item"
                    title={`Copy next action for ${item.title}`}
                    onClick={() => {
                      setActiveTab(item.tabId);
                      if (navigator.clipboard?.writeText) {
                        void navigator.clipboard.writeText(item.brief);
                      }
                      if (node) centerNode(node, FOCUS_TERMINAL_ZOOM);
                    }}
                  >
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-primary)" }}>
                      Copy next
                    </span>
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.title} · {item.nextAction}
                    </span>
                  </button>
                );
              })}
              {agentLane.nextItems.length > 3 && (
                <div
                  style={styles.agentLaneItem}
                  data-testid="canvas-agent-next-overflow"
                  title={`${agentLane.nextItems.length - 3} next actions hidden below the visible next-action list`}
                >
                  <span style={{ color: "var(--text-primary)" }}>+{agentLane.nextItems.length - 3} more next</span>
                  <span>
                    {agentLane.nextItems[3].title} · {agentLane.nextItems[3].nextAction}
                  </span>
                </div>
              )}
            </div>
          )}
          {agentLane.extractedItems.length > 0 && (
            <div style={styles.agentLaneList} aria-label="Extracted cockpit objects">
              {agentLane.extractedItems.slice(0, 4).map((item) => {
                const node = canvasState.nodes.find((candidate) => candidate.terminalTabId === item.tabId);
                return (
                  <button
                    key={`${item.tabId}-${item.kind}-${item.at}-${item.text}`}
                    type="button"
                    className="magic-canvas-button"
                    style={{ ...styles.agentLaneItem, background: "transparent", border: "none", padding: "3px 0", textAlign: "left", cursor: node ? "pointer" : "default" }}
                    data-testid="canvas-agent-extracted-item"
                    title={`${item.actionLabel} for ${item.title}`}
                    onClick={() => {
                      setActiveTab(item.tabId);
                      if (item.request) {
                        useWorkspaceStore.getState().queueWorkstreamInput(item.tabId, item.request, {
                          source: "mission-control",
                          label: "Request proof",
                        });
                      } else if (navigator.clipboard?.writeText) {
                        void navigator.clipboard.writeText(item.brief);
                      }
                      if (node) centerNode(node, FOCUS_TERMINAL_ZOOM);
                    }}
                  >
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-primary)" }}>
                      {item.actionLabel}
                    </span>
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.title} · {item.label} · {item.text} · {item.provenance}
                    </span>
                  </button>
                );
              })}
              {agentLane.extractedItems.length > 4 && (
                <div
                  style={styles.agentLaneItem}
                  data-testid="canvas-agent-extracted-overflow"
                  title={`${agentLane.extractedItems.length - 4} extracted cockpit objects hidden below the visible list`}
                >
                  <span style={{ color: "var(--text-primary)" }}>+{agentLane.extractedItems.length - 4} more extracted</span>
                  <span>
                    {agentLane.extractedItems[4].title} · {agentLane.extractedItems[4].label} · {agentLane.extractedItems[4].text}
                  </span>
                </div>
              )}
            </div>
          )}
          {agentLane.staleItems.length > 0 && (
            <div style={styles.agentLaneList} aria-label="Agent stale queue">
              {agentLane.staleItems.slice(0, 3).map((item) => {
                const node = canvasState.nodes.find((candidate) => candidate.terminalTabId === item.tabId);
                return (
                  <button
                    key={item.tabId}
                    type="button"
                    className="magic-canvas-button"
                    style={{ ...styles.agentLaneItem, background: "transparent", border: "none", padding: "3px 0", textAlign: "left", cursor: node ? "pointer" : "default" }}
                    data-testid="canvas-agent-stale-item"
                    title={`Focus ${item.title}`}
                    onClick={() => {
                      setActiveTab(item.tabId);
                      useWorkspaceStore.getState().queueWorkstreamInput(item.tabId, item.prompt, {
                        source: "mission-control",
                        label: "Check in",
                      });
                      if (node) centerNode(node, FOCUS_TERMINAL_ZOOM);
                    }}
                  >
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-primary)" }}>
                      Check in
                    </span>
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.title} · {item.detail}
                    </span>
                  </button>
                );
              })}
              {agentLane.staleItems.length > 3 && (
                <div style={styles.agentLaneOverflow} data-testid="canvas-agent-stale-overflow">
                  +{agentLane.staleItems.length - 3} more stale · {agentLane.staleItems[3].title} · {agentLane.staleItems[3].detail}
                </div>
              )}
            </div>
          )}
          {agentLane.riskItems.length > 0 && (
            <div style={styles.agentLaneList} aria-label="Agent risk queue">
              {agentLane.riskItems.slice(0, 3).map((item) => {
                const node = canvasState.nodes.find((candidate) => candidate.terminalTabId === item.tabId);
                return (
                  <button
                    key={item.tabId}
                    type="button"
                    className="magic-canvas-button"
                    style={{ ...styles.agentLaneItem, background: "transparent", border: "none", padding: "3px 0", textAlign: "left", cursor: node ? "pointer" : "default" }}
                    data-testid="canvas-agent-risk-item"
                    title={`Send risk mitigation prompt to ${item.title}`}
                    onClick={() => {
                      setActiveTab(item.tabId);
                      useWorkspaceStore.getState().queueWorkstreamInput(item.tabId, item.prompt, {
                        source: "mission-control",
                        label: "Mitigate risk",
                      });
                      if (node) centerNode(node, FOCUS_TERMINAL_ZOOM);
                    }}
                  >
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-primary)" }}>
                      Mitigate
                    </span>
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.title} · {item.detail}
                    </span>
                  </button>
                );
              })}
              {agentLane.riskItems.length > 3 && (
                <div style={styles.agentLaneOverflow} data-testid="canvas-agent-risk-overflow">
                  +{agentLane.riskItems.length - 3} more risk · {agentLane.riskItems[3].title} · {agentLane.riskItems[3].detail}
                </div>
              )}
            </div>
          )}
          {agentLane.authItems.length > 0 && (
            <div style={styles.agentLaneList} aria-label="Agent auth queue">
              {agentLane.authItems.slice(0, 3).map((item) => {
                const node = canvasState.nodes.find((candidate) => candidate.terminalTabId === item.tabId);
                return (
                  <button
                    key={item.tabId}
                    type="button"
                    className="magic-canvas-button"
                    style={{ ...styles.agentLaneItem, background: "transparent", border: "none", padding: "3px 0", textAlign: "left", cursor: node ? "pointer" : "default" }}
                    data-testid="canvas-agent-auth-item"
                    title={`Copy auth handoff for ${item.title}`}
                    onClick={() => {
                      setActiveTab(item.tabId);
                      if (navigator.clipboard?.writeText) {
                        void navigator.clipboard.writeText(item.brief);
                      }
                      if (node) centerNode(node, FOCUS_TERMINAL_ZOOM);
                    }}
                  >
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-primary)" }}>
                      Copy auth
                    </span>
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.title} · {item.reason} · {item.nextAction}
                    </span>
                  </button>
                );
              })}
              {agentLane.authItems.length > 3 && (
                <div
                  style={styles.agentLaneItem}
                  data-testid="canvas-agent-auth-overflow"
                  title={`${agentLane.authItems.length - 3} auth blockers hidden below the visible auth queue`}
                >
                  <span style={{ color: "var(--text-primary)" }}>+{agentLane.authItems.length - 3} more auth</span>
                  <span>
                    {agentLane.authItems[3].title} · {agentLane.authItems[3].reason} · {agentLane.authItems[3].nextAction}
                  </span>
                </div>
              )}
            </div>
          )}
          {agentLane.recoveryItems.length > 0 && (
            <div style={styles.agentLaneList} aria-label="Agent recovery queue">
              {agentLane.recoveryItems.slice(0, 3).map((item) => {
                const node = canvasState.nodes.find((candidate) => candidate.terminalTabId === item.tabId);
                return (
                  <button
                    key={item.tabId}
                    type="button"
                    className="magic-canvas-button"
                    style={{ ...styles.agentLaneItem, background: "transparent", border: "none", padding: "3px 0", textAlign: "left", cursor: node ? "pointer" : "default" }}
                    data-testid="canvas-agent-recovery-item"
                    title={`Send recovery prompt to ${item.title}`}
                    onClick={() => {
                      setActiveTab(item.tabId);
                      useWorkspaceStore.getState().queueWorkstreamInput(item.tabId, item.prompt, {
                        source: "mission-control",
                        label: "Recover",
                      });
                      if (node) centerNode(node, FOCUS_TERMINAL_ZOOM);
                    }}
                  >
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-primary)" }}>
                      Recover
                    </span>
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.title} · {item.reason} · {item.prompt}
                    </span>
                  </button>
                );
              })}
              {agentLane.recoveryItems.length > 3 && (
                <div style={styles.agentLaneOverflow} data-testid="canvas-agent-recovery-overflow">
                  +{agentLane.recoveryItems.length - 3} more recovery · {agentLane.recoveryItems[3].title} · {agentLane.recoveryItems[3].reason} · {agentLane.recoveryItems[3].prompt}
                </div>
              )}
            </div>
          )}
          {agentLane.proofItems.length > 0 && (
            <div style={styles.agentLaneList} aria-label="Agent proof needed queue">
              {agentLane.proofItems.slice(0, 3).map((item) => {
                const node = canvasState.nodes.find((candidate) => candidate.terminalTabId === item.tabId);
                return (
                  <button
                    key={item.tabId}
                    type="button"
                    className="magic-canvas-button"
                    style={{ ...styles.agentLaneItem, background: "transparent", border: "none", padding: "3px 0", textAlign: "left", cursor: node ? "pointer" : "default" }}
                    data-testid="canvas-agent-proof-item"
                    title={`Send proof request to ${item.title}`}
                    onClick={() => {
                      setActiveTab(item.tabId);
                      useWorkspaceStore.getState().queueWorkstreamInput(item.tabId, item.request, {
                        source: "mission-control",
                        label: "Request proof",
                      });
                      if (node) centerNode(node, FOCUS_TERMINAL_ZOOM);
                    }}
                  >
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-primary)" }}>
                      Request proof
                    </span>
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.title} · {item.summary} · {item.request}
                    </span>
                  </button>
                );
              })}
              {agentLane.proofItems.length > 3 && (
                <div
                  style={styles.agentLaneItem}
                  data-testid="canvas-agent-proof-overflow"
                  title={`${agentLane.proofItems.length - 3} proof requests hidden below the visible proof queue`}
                >
                  <span style={{ color: "var(--text-primary)" }}>+{agentLane.proofItems.length - 3} more proof</span>
                  <span>
                    {agentLane.proofItems[3].title} · {agentLane.proofItems[3].summary} · {agentLane.proofItems[3].request}
                  </span>
                </div>
              )}
            </div>
          )}
          {agentLane.evidenceItems.length > 0 && (
            <div style={styles.agentLaneList} aria-label="Agent evidence queue">
              {agentLane.evidenceItems.slice(0, 3).map((item) => {
                const node = canvasState.nodes.find((candidate) => candidate.terminalTabId === item.tabId);
                return (
                  <button
                    key={item.tabId}
                    type="button"
                    className="magic-canvas-button"
                    style={{ ...styles.agentLaneItem, background: "transparent", border: "none", padding: "3px 0", textAlign: "left", cursor: node ? "pointer" : "default" }}
                    data-testid="canvas-agent-evidence-item"
                    title={item.artifactPath ? `Open artifact for ${item.title}` : `Copy evidence for ${item.title}`}
                    onClick={() => {
                      setActiveTab(item.tabId);
                      if (item.artifactPath) {
                        useWorkspaceStore.getState().addOpenFile({
                          path: item.artifactPath,
                          name: item.artifactName ?? item.artifactPath,
                          dirty: false,
                        });
                      }
                      if (navigator.clipboard?.writeText) {
                        void navigator.clipboard.writeText(item.brief);
                      }
                      if (node) centerNode(node, FOCUS_TERMINAL_ZOOM);
                    }}
                  >
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-primary)" }}>
                      {item.artifactPath ? "Open proof" : "Copy proof"}
                    </span>
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.title} · {item.evidence}{item.artifact ? ` · ${item.artifact}` : ""}
                    </span>
                  </button>
                );
              })}
              {agentLane.evidenceItems.length > 3 && (
                <div
                  style={styles.agentLaneItem}
                  data-testid="canvas-agent-evidence-overflow"
                  title={`${agentLane.evidenceItems.length - 3} evidence rows hidden below the visible evidence queue`}
                >
                  <span style={{ color: "var(--text-primary)" }}>+{agentLane.evidenceItems.length - 3} more evidence</span>
                  <span>
                    {agentLane.evidenceItems[3].title} · {agentLane.evidenceItems[3].evidence}{agentLane.evidenceItems[3].artifact ? ` · ${agentLane.evidenceItems[3].artifact}` : ""}
                  </span>
                </div>
              )}
            </div>
          )}
          {agentLane.reviewItems.length > 0 && (
            <div style={styles.agentLaneList} aria-label="Agent review queue">
              {agentLane.reviewItems.slice(0, 3).map((item) => {
                const node = canvasState.nodes.find((candidate) => candidate.terminalTabId === item.tabId);
                const canCloseout = isReviewItemCloseoutReady(item);
                return (
                  <button
                    key={item.tabId}
                    type="button"
                    className="magic-canvas-button"
                    style={{ ...styles.agentLaneItem, background: "transparent", border: "none", padding: "3px 0", textAlign: "left", cursor: node ? "pointer" : "default" }}
                    data-testid="canvas-agent-review-item"
                    title={canCloseout ? `Mark ${item.title} reviewed` : `Review blocked for ${item.title} until proof and handoff memory are ready`}
                    onClick={() => {
                      setActiveTab(item.tabId);
                      if (node) centerNode(node, FOCUS_TERMINAL_ZOOM);
                      if (canCloseout) {
                        useWorkspaceStore.getState().reviewWorkstream(item.tabId, {
                          source: "mission-control",
                          label: "Review",
                        });
                      }
                    }}
                  >
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-primary)" }}>
                      {canCloseout ? "Review" : "Blocked review"}
                    </span>
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.title} · {item.proofStatus} · {item.handoffStatus} · {item.summary} · {item.detail}
                    </span>
                  </button>
                );
              })}
              {agentLane.reviewItems.length > 3 && (
                <div
                  style={styles.agentLaneItem}
                  data-testid="canvas-agent-review-overflow"
                  title={`${agentLane.reviewItems.length - 3} review items hidden below the visible review queue`}
                >
                  <span style={{ color: "var(--text-primary)" }}>+{agentLane.reviewItems.length - 3} more review</span>
                  <span>
                    {agentLane.reviewItems[3].title} · {agentLane.reviewItems[3].proofStatus} · {agentLane.reviewItems[3].handoffStatus} · {agentLane.reviewItems[3].summary}
                  </span>
                </div>
              )}
            </div>
          )}
          {agentLane.memoryItems.length > 0 && (
            <div style={styles.agentLaneList} aria-label="Agent lane memory">
              {agentLane.memoryItems.slice(0, 3).map((item) => {
                const node = canvasState.nodes.find((candidate) => candidate.terminalTabId === item.tabId);
                return (
                  <button
                    key={item.tabId}
                    type="button"
                    className="magic-canvas-button"
                    style={{ ...styles.agentLaneItem, background: "transparent", border: "none", padding: "3px 0", textAlign: "left", cursor: node ? "pointer" : "default" }}
                    data-testid="canvas-agent-lane-memory"
                    title={`Copy memory for ${item.title}`}
                    onClick={() => {
                      setActiveTab(item.tabId);
                      if (navigator.clipboard?.writeText) {
                        void navigator.clipboard.writeText(item.brief);
                      }
                      if (node) centerNode(node, FOCUS_TERMINAL_ZOOM);
                    }}
                  >
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-primary)" }}>
                      Copy memory
                    </span>
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.title} · {item.memory}
                    </span>
                  </button>
                );
              })}
              {agentLane.memoryItems.length > 3 && (
                <div
                  style={styles.agentLaneItem}
                  data-testid="canvas-agent-memory-overflow"
                  title={`${agentLane.memoryItems.length - 3} memory rows hidden below the visible handoff-memory list`}
                >
                  <span style={{ color: "var(--text-primary)" }}>+{agentLane.memoryItems.length - 3} more memory</span>
                  <span>
                    {agentLane.memoryItems[3].title} · {agentLane.memoryItems[3].memory}
                  </span>
                </div>
              )}
            </div>
          )}
          <div style={styles.agentLaneList}>
            {agentLane.workstreams.slice(0, 3).map(({ tab, workstream }) => {
              const node = canvasState.nodes.find((candidate) => candidate.terminalTabId === tab.id);
              const askText = latestMissionControlAskText(workstream);
              return (
                <button
                  key={tab.id}
                  type="button"
                  className="magic-canvas-button"
                  style={{ ...styles.agentLaneItem, background: "transparent", border: "none", padding: "3px 0", textAlign: "left", cursor: node ? "pointer" : "default" }}
                  data-testid="canvas-agent-run-item"
                  title={`Copy run brief for ${tab.title}`}
                  onClick={() => {
                    setActiveTab(tab.id);
                    if (navigator.clipboard?.writeText) {
                      void navigator.clipboard.writeText(formatAgentRunBrief(tab));
                    }
                    if (node) centerNode(node, FOCUS_TERMINAL_ZOOM);
                  }}
                >
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    Copy run
                  </span>
                  <span>
                    {workstreamLabel(workstream.provider)} · {workstream.phase ?? workstream.status} · {workstreamActivityText(workstream)} · {formatWorkstreamOpsContext(workstream)}
                    {askText ? ` · ${askText}` : ""}
                  </span>
                </button>
              );
            })}
            {agentLane.workstreams.length > 3 && (
              <div
                style={styles.agentLaneItem}
                data-testid="canvas-agent-run-overflow"
                title={`${agentLane.workstreams.length - 3} agent runs hidden below the visible run list`}
              >
                <span style={{ color: "var(--text-primary)" }}>+{agentLane.workstreams.length - 3} more agents</span>
                <span>
                  {workstreamLabel(agentLane.workstreams[3].workstream.provider)} · {agentLane.workstreams[3].workstream.phase ?? agentLane.workstreams[3].workstream.status} · {workstreamActivityText(agentLane.workstreams[3].workstream)} · {formatWorkstreamOpsContext(agentLane.workstreams[3].workstream)}
                  {latestMissionControlAskText(agentLane.workstreams[3].workstream) ? ` · ${latestMissionControlAskText(agentLane.workstreams[3].workstream)}` : ""}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {canvasState.nodes.length === 0 && (
        <div style={styles.empty}>Map is empty. Add a note, shell, or file node.</div>
      )}

      {selectionBox && (
        <div
          data-testid="canvas-selection-rect"
          style={{
            ...styles.selectionRect,
            left: selectionBox.left,
            top: selectionBox.top,
            width: selectionBox.width,
            height: selectionBox.height,
          }}
        />
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
            onOpenNodeLabelMenu={openNodeLabelMenu}
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
      {labelMenu && (
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 50 }}
            onMouseDown={() => setLabelMenu(null)}
            onContextMenu={(event) => {
              event.preventDefault();
              setLabelMenu(null);
            }}
          />
          <div
            role="menu"
            aria-label="Terminal label color"
            style={{
              position: "fixed",
              left: Math.min(labelMenu.x, window.innerWidth - 220),
              top: Math.min(labelMenu.y, window.innerHeight - 220),
              zIndex: 51,
              minWidth: 196,
              padding: 6,
              background: "var(--surface-raised)",
              borderRadius: "var(--radius-md)",
              boxShadow: "var(--shadow-menu)",
              border: "none",
            }}
          >
            {TERMINAL_LABEL_COLORS.map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                className="workspace-launch-config-item"
                aria-label={`Set terminal label color ${item.label}`}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  padding: "8px 9px",
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
                  updateCanvasNode(labelMenu.nodeId, { labelColor: item.value });
                  setLabelMenu(null);
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 13,
                    height: 13,
                    borderRadius: 4,
                    background: item.value ?? "var(--surface-base)",
                    boxShadow: item.value
                      ? "inset 0 0 0 1px color-mix(in srgb, #ffffff 20%, transparent)"
                      : "inset 0 0 0 1px var(--border-subtle)",
                  }}
                />
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
