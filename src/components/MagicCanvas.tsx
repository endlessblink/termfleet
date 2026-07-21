import { CSSProperties, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyStart,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyStart,
  ArrowUpRight,
  Ban,
  Bot,
  CheckCircle2,
  ClipboardCopy,
  Columns3,
  FileText,
  Globe,
  LocateFixed,
  Layers3,
  ListTodo,
  Maximize2,
  Minus,
  NotebookText,
  PanelRightClose,
  Plus,
  RefreshCw,
  RotateCcw,
  Rows3,
  Search,
  Square,
  StretchHorizontal,
  StretchVertical,
  TerminalSquare,
  Trash2,
  X,
} from "lucide-react";
import type { CanvasNode } from "../lib/types";
import { masterPlanPath, taskStatusColor, taskStatusLabel, type MasterPlanTask } from "../lib/masterPlanTasks";
import { useMasterPlanTasks } from "../hooks/useMasterPlanTasks";
import { pathTail, projectForTab, workspaceLabelFor } from "../lib/projectDisplay";
import { createNewTab, useWorkspaceStore } from "../stores/workspace";
import { TerminalComponent } from "./Terminal";
import { LocalhostPreview } from "./LocalhostPreview";
import type { GridSnapshot } from "../lib/gridSnapshot";
import type { Tab, TaskLineupItem, TerminalRuntimeStatus, WorkstreamStatusSummary } from "../lib/types";
import { agentLaneAuthRetryText, agentLaneAuthRetryTitle, agentLaneCleanupRequestText, agentLaneCleanupRequestTitle, agentLaneCloseoutText, agentLaneCloseoutTitle, agentLaneHealthText, agentLaneInterruptText, agentLaneInterruptTitle, agentLaneMemoryRequestText, agentLaneMemoryRequestTitle, agentLaneProofRequestText, agentLaneProofRequestTitle, agentLaneRestartText, agentLaneRestartTitle, agentLaneRiskMitigationText, agentLaneRiskMitigationTitle, agentLaneStatusSweepText, agentLaneStatusSweepTitle, agentLaneStatusText, attentionBreakdownText, cleanupBreakdownText, closeoutBreakdownText, formatAgentLaneBrief, formatAgentMissionControlBrief, formatAgentRunBrief, handoffMemoryPromptForWorkstream, isActiveAgentWorkstream, isAgentReviewCloseoutReady, isAuthRetryableAgentWorkstream, isCleanupRequestableAgentWorkstream, isRestartableAgentWorkstream, isReviewItemCloseoutReady, isStaleAgentWorkstream, isolationBreakdownText, latestMissionControlAskText, missionBreakdownText, missionControlAlternateText, missionControlDispatchBreakdownText, needsAgentProofRequest, proofRequestPromptForWorkstream, providerBreakdownText, readinessBreakdownText, riskBreakdownText, statusCheckPromptForWorkstream, summarizeAgentLane } from "../lib/agentWorkstreamLane";
import { agentStatusChipText, agentStatusSummaryFromWorkstream, getDisplaySummary } from "../lib/agentStatusSummary";
import { CockpitSnapshotProbe } from "./CockpitSnapshotProbe";
import { workstreamActivityMeta, workstreamActivityText } from "../lib/workstreamActivity";
import { formatWorkstreamBranch, formatWorkstreamIsolation, formatWorkstreamOpsContext } from "../lib/workstreamOpsContext";
import { snapshotPreviewRows } from "../lib/snapshotPreviewRows";
import { taskLineupNextLabel, taskLineupStats, terminalOutputClosesTaskLineup, visibleTaskLineup } from "../lib/taskLineup";
import { neutralHeaderTitle, normalizePersistedShellSummary, summaryFromDurableActivity, terminalPurposeFromContext, terminalTextLooksReadyPrompt } from "../lib/terminalHeaderDisplay";
import { buildTerminalHeaderState } from "../lib/terminalHeaderState";
import { activityAddsInfo } from "../lib/terminalHeaderViewModel";
import { badgeForAttention } from "../lib/terminalAttention";
import { paneBadgeAttention } from "../lib/sessionStatus";
import { stableHeader } from "../lib/stableHeader";
import { agentProviderIdentity } from "../lib/agentProviderIdentity";
import { AgentProviderIdentity } from "./AgentProviderIdentity";

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

type TerminalBodyTaskRow = {
  id: string;
  task: string;
  state: string;
  next: string;
  meta?: string;
};

type TerminalOverlayBounds = {
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

const TASK_STATUS_RANK: Record<MasterPlanTask["status"], number> = {
  "in-progress": 0,
  blocked: 1,
  todo: 2,
  unknown: 3,
  done: 4,
};

function normalizedTaskSearchText(task: MasterPlanTask) {
  return `${task.id} ${task.title} ${task.status} ${task.rawStatus}`.toLowerCase();
}

function taskSearchRank(task: MasterPlanTask, query: string) {
  const value = query.trim().toLowerCase();
  if (!value) return TASK_STATUS_RANK[task.status] * 1000;
  const id = task.id.toLowerCase();
  if (id === value) return -3000;
  if (id.startsWith(value)) return -2000 + TASK_STATUS_RANK[task.status];
  if (task.title.toLowerCase().startsWith(value)) return -1000 + TASK_STATUS_RANK[task.status];
  return TASK_STATUS_RANK[task.status] * 1000;
}

function visibleTaskOptions(tasks: MasterPlanTask[], query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  return tasks
    .filter((task) => !normalizedQuery || normalizedTaskSearchText(task).includes(normalizedQuery))
    .sort((a, b) => {
      const byRank = taskSearchRank(a, normalizedQuery) - taskSearchRank(b, normalizedQuery);
      if (byRank !== 0) return byRank;
      return a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: "base" });
    });
}

function firstTaskIdFromText(...values: Array<string | undefined | null>) {
  for (const value of values) {
    const match = value?.match(/\b[A-Za-z]+-\d+\b/);
    if (match) return match[0];
  }
  return undefined;
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
  toolbarDivider: {
    width: 1,
    height: 20,
    background: "var(--border-subtle)",
    margin: "0 2px",
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
  buttonDisabled: {
    opacity: 0.42,
    cursor: "default",
  },
  stage: {
    position: "absolute",
    inset: 0,
    transformOrigin: "0 0",
    backfaceVisibility: "hidden",
  },
  terminalOverlayLayer: {
    position: "absolute",
    inset: 0,
    zIndex: 12,
    pointerEvents: "none",
  },
  terminalOverlayPane: {
    position: "absolute",
    overflow: "hidden",
    pointerEvents: "auto",
    background: "var(--surface-sunken)",
  },
  node: {
    position: "absolute",
    display: "flex",
    flexDirection: "column",
    background: "var(--surface-raised)",
    border: "1px solid transparent",
    borderRadius: "var(--radius-md)",
    boxShadow: "var(--shadow-card)",
    overflow: "visible",
    transition: "border-color var(--motion-med), box-shadow var(--motion-med), transform var(--motion-fast)",
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
    overflow: "visible",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: 13,
    fontWeight: 500,
    color: "var(--text-primary)",
  },
  nodeTitleMeta: {
    overflow: "visible",
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
    gridColumn: "1 / -1",
    display: "grid",
    gap: 8,
    alignContent: "start",
  },
  terminalStatusLayout: {
    minWidth: 0,
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) minmax(240px, 30%)",
    gap: 10,
    alignItems: "start",
  },
  terminalStatusSummaryColumn: {
    minWidth: 0,
    display: "grid",
    gap: 9,
    alignContent: "start",
  },
  terminalStatusKicker: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    color: "color-mix(in srgb, var(--text-secondary) 78%, transparent)",
    fontSize: 12,
    fontWeight: 500,
    letterSpacing: 0,
  },
  attentionBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    height: 20,
    padding: "0 8px",
    borderRadius: 999,
    border: "1px solid transparent",
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: 0.2,
    whiteSpace: "nowrap",
  },
  attentionDot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    flexShrink: 0,
  },
  terminalTaskRow: {
    minWidth: 0,
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr)",
    alignItems: "baseline",
    gap: 6,
    color: "color-mix(in srgb, var(--text-secondary) 82%, transparent)",
    fontSize: 12,
    fontWeight: 500,
    letterSpacing: 0,
  },
  terminalTaskLabel: {
    color: "var(--text-tertiary)",
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: 0,
  },
  terminalTaskValue: {
    minWidth: 0,
    overflow: "visible",
    overflowWrap: "anywhere",
    whiteSpace: "normal",
    color: "var(--text-secondary)",
    fontSize: 12,
    fontWeight: 500,
  },
  workspacePill: {
    minWidth: 0,
    maxWidth: 200,
    height: 20,
    display: "inline-flex",
    alignItems: "center",
    padding: "0 6px",
    border: "1px solid var(--border-subtle)",
    borderRadius: "var(--radius-xs)",
    background: "color-mix(in srgb, var(--surface-base) 82%, transparent)",
    color: "var(--text-primary)",
    fontSize: 11,
    fontWeight: 500,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    textTransform: "none",
  },
  terminalStatusTitle: {
    minWidth: 0,
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr)",
    alignItems: "baseline",
    gap: 7,
    overflow: "hidden",
    color: "var(--text-primary)",
    fontSize: 19,
    fontWeight: 600,
    lineHeight: 1.18,
  },
  terminalNowActiveLabel: {
    color: "var(--text-tertiary)",
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: 0,
  },
  terminalNowActiveValue: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  renameInput: {
    width: "100%",
    minWidth: 0,
    height: 30,
    border: "1px solid var(--border-focus)",
    borderRadius: "var(--radius-sm)",
    background: "var(--surface-base)",
    color: "var(--text-primary)",
    fontFamily: "var(--font-ui)",
    fontSize: 15,
    fontWeight: 500,
    outline: "none",
    padding: "0 8px",
  },
  terminalStatusGrid: {
    minWidth: 0,
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr)",
    gap: 0,
    alignItems: "center",
  },
  terminalStatusField: {
    minWidth: 0,
    maxWidth: "100%",
    minHeight: 30,
    display: "grid",
    alignContent: "center",
    gap: 2,
    padding: 0,
    borderRadius: 0,
    border: "none",
    background: "transparent",
  },
  terminalStatusFieldLabel: {
    color: "color-mix(in srgb, var(--text-secondary) 62%, transparent)",
    fontSize: 10,
    fontWeight: 500,
    letterSpacing: 0,
  },
  terminalStatusFieldValue: {
    minWidth: 0,
    overflow: "visible",
    overflowWrap: "anywhere",
    whiteSpace: "normal",
    color: "var(--text-secondary)",
    fontSize: 12,
    lineHeight: 1.25,
  },
  terminalStatusNow: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: "var(--text-primary)",
    fontSize: 13,
    fontWeight: 500,
    lineHeight: 1.25,
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
  agentTaskPanel: {
    minWidth: 0,
    display: "grid",
    gap: 6,
    paddingTop: 7,
    borderTop: "1px solid var(--border-subtle)",
  },
  terminalTaskPanel: {
    minWidth: 0,
    display: "grid",
    gap: 6,
    paddingLeft: 10,
    borderLeft: "1px solid var(--border-subtle)",
  },
  agentTaskHeader: {
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    color: "var(--text-secondary)",
    fontSize: 10,
    fontWeight: 500,
    textTransform: "uppercase",
    letterSpacing: 0,
  },
  agentTaskRow: {
    minWidth: 0,
    display: "grid",
    gap: 3,
  },
  agentTaskTitle: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: "var(--text-primary)",
    fontSize: 12,
    fontWeight: 500,
  },
  agentTaskMeta: {
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    gap: 5,
    overflow: "hidden",
    color: "var(--text-secondary)",
    fontSize: 10,
  },
  agentTaskNext: {
    minWidth: 0,
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
  projectEmojiBadge: {
    width: 22,
    height: 22,
    flex: "0 0 auto",
    display: "grid",
    placeItems: "center",
    border: "1px solid var(--border-subtle)",
    borderRadius: "var(--radius-xs)",
    background: "color-mix(in srgb, var(--surface-base) 86%, transparent)",
    fontSize: 14,
    lineHeight: 1,
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
  },
  projectEmojiZoomBadge: {
    position: "absolute",
    left: 10,
    top: 42,
    zIndex: 5,
    width: 34,
    height: 34,
    display: "grid",
    placeItems: "center",
    border: "1px solid var(--border-subtle)",
    borderRadius: "var(--radius-sm)",
    background: "color-mix(in srgb, var(--surface-raised) 94%, transparent)",
    fontSize: 21,
    lineHeight: 1,
    pointerEvents: "none",
    boxShadow: "0 10px 28px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.05)",
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
  taskPickerScrim: {
    position: "fixed",
    inset: 0,
    zIndex: 60,
    background: "rgba(10, 13, 15, 0.42)",
    cursor: "default",
  },
  taskPicker: {
    position: "fixed",
    left: "50%",
    top: "50%",
    zIndex: 61,
    width: "min(680px, calc(100vw - 32px))",
    maxHeight: "min(680px, calc(100dvh - 56px))",
    display: "grid",
    gridTemplateRows: "auto auto minmax(0, 1fr) auto",
    gap: 10,
    padding: 12,
    border: "1px solid var(--border-subtle)",
    borderRadius: "var(--radius-md)",
    background: "color-mix(in srgb, var(--surface-raised) 97%, transparent)",
    boxShadow: "var(--shadow-menu), inset 0 1px 0 rgba(255,255,255,0.05)",
    transform: "translate(-50%, -50%)",
    animation: "workbench-popover-in var(--motion-med)",
    cursor: "default",
  },
  taskPickerHeader: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    gap: 10,
    alignItems: "start",
  },
  taskPickerTitle: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    color: "var(--text-primary)",
    fontSize: 14,
    fontWeight: 500,
  },
  taskPickerMeta: {
    marginTop: 5,
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    color: "var(--text-secondary)",
    fontSize: 11,
  },
  taskPickerPill: {
    minWidth: 0,
    maxWidth: 260,
    height: 20,
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "0 7px",
    border: "1px solid var(--border-subtle)",
    borderRadius: "var(--radius-xs)",
    background: "color-mix(in srgb, var(--surface-base) 86%, transparent)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  taskPickerSearchRow: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    gap: 8,
    alignItems: "center",
  },
  taskPickerSearch: {
    minWidth: 0,
    height: 34,
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "0 10px",
    border: "1px solid var(--border-subtle)",
    borderRadius: "var(--radius-sm)",
    background: "var(--surface-base)",
    color: "var(--text-secondary)",
  },
  taskPickerInput: {
    flex: 1,
    minWidth: 0,
    height: "100%",
    border: "none",
    outline: "none",
    background: "transparent",
    color: "var(--text-primary)",
    fontSize: 12,
  },
  taskPickerList: {
    minHeight: 170,
    display: "grid",
    alignContent: "start",
    gap: 6,
    paddingRight: 2,
    overflowY: "auto",
  },
  taskPickerRow: {
    width: "100%",
    minWidth: 0,
    display: "grid",
    gridTemplateColumns: "92px minmax(0, 1fr) auto",
    gap: 10,
    alignItems: "center",
    padding: "9px 10px",
    border: "1px solid var(--border-subtle)",
    borderRadius: "var(--radius-sm)",
    background: "color-mix(in srgb, var(--surface-base) 76%, transparent)",
    color: "var(--text-secondary)",
    textAlign: "left",
    cursor: "pointer",
  },
  taskPickerRowActive: {
    border: "1px solid color-mix(in srgb, var(--accent-live) 48%, var(--border-subtle))",
    background: "color-mix(in srgb, var(--accent-live) 10%, var(--surface-base))",
  },
  taskPickerTaskId: {
    color: "var(--text-primary)",
    fontFamily: "var(--font-mono)",
    fontSize: 12,
    letterSpacing: 0,
  },
  taskPickerTaskTitle: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: "var(--text-primary)",
    fontSize: 12,
    fontWeight: 500,
  },
  taskPickerTaskMeta: {
    minWidth: 0,
    marginTop: 3,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: "var(--text-secondary)",
    fontSize: 10,
  },
  taskPickerStatus: {
    height: 22,
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "0 7px",
    border: "1px solid var(--border-subtle)",
    borderRadius: "var(--radius-xs)",
    color: "var(--text-primary)",
    fontSize: 10,
    whiteSpace: "nowrap",
  },
  taskPickerFooter: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    gap: 8,
    alignItems: "end",
    paddingTop: 2,
    borderTop: "1px solid var(--border-subtle)",
  },
  taskPickerManualBlock: {
    display: "grid",
    gap: 5,
  },
  taskPickerLabel: {
    color: "var(--text-secondary)",
    fontSize: 10,
    fontWeight: 500,
    textTransform: "uppercase",
    letterSpacing: 0,
  },
  taskPickerManual: {
    height: 30,
    minWidth: 0,
    border: "1px solid var(--border-subtle)",
    borderRadius: "var(--radius-sm)",
    outline: "none",
    padding: "0 9px",
    background: "var(--surface-base)",
    color: "var(--text-primary)",
    fontSize: 12,
  },
  taskPickerActions: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 7,
  },
  taskPickerButton: {
    height: 30,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    padding: "0 10px",
    border: "1px solid var(--border-subtle)",
    borderRadius: "var(--radius-sm)",
    background: "var(--surface-base)",
    color: "var(--text-secondary)",
    fontSize: 12,
    cursor: "pointer",
  },
  taskPickerPrimaryButton: {
    border: "1px solid color-mix(in srgb, var(--accent-live) 52%, var(--border-subtle))",
    background: "color-mix(in srgb, var(--accent-live) 13%, var(--surface-base))",
    color: "var(--accent-live)",
  },
  taskPickerDangerButton: {
    border: "1px solid color-mix(in srgb, var(--accent-danger) 42%, var(--border-subtle))",
    color: "var(--accent-danger)",
  },
  taskPickerEmpty: {
    minHeight: 150,
    display: "grid",
    placeItems: "center",
    padding: 18,
    border: "1px dashed var(--border-subtle)",
    borderRadius: "var(--radius-sm)",
    color: "var(--text-secondary)",
    fontSize: 12,
    textAlign: "center",
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
  terminalBodyWithTasks: {
    // Grid columns + overflow are set inline at the body div (they depend on the
    // collapsed/expanded state): terminal (1fr) + task column (44px / 224px).
    flex: 1,
    minHeight: 0,
    display: "grid",
    background: "var(--surface-sunken)",
    position: "relative",
  },
  shellTerminalBody: {
    flex: 1,
    minHeight: 0,
    display: "grid",
    gridTemplateRows: "minmax(0, 1fr)",
    background: "var(--surface-sunken)",
    position: "relative",
  },
  terminalBodyTaskContent: {
    minWidth: 0,
    minHeight: 0,
    height: "100%",
    display: "grid",
    gridTemplateRows: "minmax(0, 1fr)",
    overflow: "hidden",
  },
  terminalBodyTaskSidebar: {
    // Float the expanded list just OUTSIDE the node to the right so it never
    // shrinks the terminal (content keeps full width). This only shows because the
    // node card AND the terminal body are overflow:visible; the inner
    // terminalBodyTaskContent stays overflow:hidden so the terminal itself is still
    // clipped. (Earlier the body was overflow:hidden, which clipped this sidebar to
    // nothing — brightPixels 0.)
    // In-flow second column of the card (sized by the body grid), NOT a floating
    // slab. The card owns the rounding + shadow; this is just the right zone, set
    // off from the terminal by a single 1px divider. One flat step up in surface so
    // it reads as part of the same card, recessed from the live terminal.
    minWidth: 0,
    minHeight: 0,
    height: "100%",
    display: "flex",
    flexDirection: "column",
    gap: 9,
    padding: "11px 11px 12px 13px",
    borderLeft: "1px solid var(--border-subtle)",
    background: "var(--surface-base)",
    color: "var(--text-secondary)",
    fontFamily: "var(--font-ui)",
    overflow: "hidden",
  },
  terminalBodyTaskRail: {
    // Collapsed affordance: a slim icon rail filling the card's 44px second column
    // (in-flow, not floated). Same surface + divider as the expanded panel.
    minWidth: 0,
    minHeight: 0,
    width: "100%",
    height: "100%",
    display: "grid",
    gridTemplateRows: "auto auto auto auto 1fr",
    justifyItems: "center",
    alignItems: "start",
    gap: 7,
    padding: "12px 6px",
    border: "none",
    borderLeft: "1px solid var(--border-subtle)",
    background: "var(--surface-base)",
    color: "var(--text-secondary)",
    fontFamily: "var(--font-ui)",
    cursor: "pointer",
    overflow: "hidden",
  },
  terminalBodyTaskRailText: {
    writingMode: "vertical-rl",
    textTransform: "uppercase",
    color: "var(--text-primary)",
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: 0,
  },
  terminalBodyTaskRailCount: {
    minWidth: 22,
    height: 22,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 6,
    background: "color-mix(in srgb, var(--accent-live) 16%, var(--surface-raised))",
    color: "var(--text-primary)",
    fontSize: 11,
    fontWeight: 600,
  },
  terminalBodyTaskRailMeta: {
    writingMode: "vertical-rl",
    color: "var(--text-tertiary)",
    fontSize: 9,
    lineHeight: 1,
    whiteSpace: "nowrap",
  },
  iconButtonSm: {
    width: 22,
    height: 22,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    border: "1px solid var(--border-subtle)",
    borderRadius: 6,
    background: "color-mix(in srgb, var(--surface-raised) 82%, transparent)",
    color: "var(--text-secondary)",
    cursor: "pointer",
  },
  terminalBodyTaskList: {
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    gap: 9,
    overflowY: "auto",
  },
  terminalBodyTaskRow: {
    minWidth: 0,
    display: "grid",
    gridTemplateColumns: "12px minmax(0, 1fr)",
    gap: 8,
    alignItems: "start",
  },
  terminalBodyTaskMarker: {
    width: 8,
    height: 8,
    marginTop: 4,
    borderRadius: 2,
    border: "1px solid color-mix(in srgb, var(--accent-live) 70%, var(--border-subtle))",
    background: "color-mix(in srgb, var(--accent-live) 16%, transparent)",
  },
  terminalBodyTaskTitle: {
    minWidth: 0,
    color: "var(--text-primary)",
    fontSize: 12,
    fontWeight: 500,
    lineHeight: 1.25,
  },
  terminalBodyTaskEyebrow: {
    minWidth: 0,
    marginBottom: 2,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: "color-mix(in srgb, var(--text-secondary) 70%, transparent)",
    fontSize: 9,
    fontWeight: 500,
  },
  liveTerminalBody: {
    flex: "1 1 auto",
    minHeight: 0,
    display: "grid",
    gridTemplateRows: "minmax(0, 1fr)",
  },
  liveTerminalOverlayPlaceholder: {
    height: "100%",
    minHeight: 0,
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
const MAP_TERMINAL_MAX_RENDER_SCALE = 2;
const MAP_LIVE_TERMINALS_ENABLED =
  (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_MAP_LIVE_TERMINALS !== "0";
// Viewport culling: cap how many terminal nodes mount a full live renderer at
// once. Off-screen / over-cap nodes fall back to the cheap DOM snapshot preview
// (TerminalMapPreview). A selected terminal wins over the active tab terminal
// so the cap remains a real ceiling instead of mounting both live renderers.
const MAX_LIVE_TERMINALS = 1;
// Inflate the visible rect (canvas-space px) so nodes warm up just before they
// scroll into view, avoiding a blank flash on pan.
const CULL_OVERSCAN_PX = 400;
// Max preview refresh rate per node (ms between flushes). A busy live terminal
// should not drive React map-state churn while the canvas itself is rendering.
const PREVIEW_THROTTLE_MS = 2000;

function mapTerminalRenderScaleForZoom(zoom: number) {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(MAP_TERMINAL_MAX_RENDER_SCALE, Math.max(1, zoom));
}

function workstreamLabel(provider?: string) {
  if (provider === "opencode") return "OpenCode";
  if (provider === "claude") return "Claude";
  if (provider === "shell") return "Shell";
  return "Codex";
}

function readableSnapshotText(snapshot?: GridSnapshot) {
  if (!snapshot?.cells.length) return undefined;
  const lines = snapshot.cells
    .map((row) => row.map((cell) => cell.c && cell.c !== "\u0000" ? cell.c : " ").join("").trimEnd())
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0);
  return lines.slice(-24).join("\n").slice(-1800) || undefined;
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

function activityAgo(at: number): string {
  if (!at) return "";
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.round(minutes / 60)}h`;
}

function TerminalBodyTaskSidebar({
  rows,
  testIdPrefix,
  ariaLabel,
  emptyText,
  recent,
  collapsed,
  onToggleCollapsed,
}: {
  rows: TerminalBodyTaskRow[];
  testIdPrefix: "canvas-terminal" | "canvas-agent";
  ariaLabel: string;
  emptyText: string;
  recent?: Array<{ text: string; at: number }>;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  const stats = taskLineupStats(rows.map((row) => ({
    id: row.id,
    content: row.task,
    status: row.state === "Done" ? "completed" : row.state === "Working" ? "in_progress" : "pending",
    source: "summary",
    updatedAt: 0,
  })));
  if (collapsed) {
    return (
      <button
        type="button"
        style={styles.terminalBodyTaskRail}
        data-testid={`${testIdPrefix}-task-rail`}
        aria-label={stats.total > 0
          ? `${ariaLabel}: ${stats.open} open, ${stats.done} done. Expand tasks.`
          : `${ariaLabel}: no task list captured for this run. Expand tasks.`}
        title={stats.total > 0 ? `${stats.open} open · ${stats.done} done` : "No task list captured"}
        onClick={(event) => {
          event.stopPropagation();
          onToggleCollapsed();
        }}
        onMouseDown={(event) => event.stopPropagation()}
        onWheel={(event) => event.stopPropagation()}
      >
        <ListTodo size={14} strokeWidth={1.8} />
        <span style={styles.terminalBodyTaskRailText}>Tasks</span>
        {stats.total > 0 ? (
          <>
            <span style={styles.terminalBodyTaskRailCount}>{stats.total}</span>
            <span style={styles.terminalBodyTaskRailMeta}>{stats.open} open</span>
            <span style={styles.terminalBodyTaskRailMeta}>{stats.done} done</span>
          </>
        ) : (
          <span style={styles.terminalBodyTaskRailMeta}>No list</span>
        )}
      </button>
    );
  }

  return (
    <aside
      style={styles.terminalBodyTaskSidebar}
      data-testid={`${testIdPrefix}-task-sidebar`}
      aria-label={ariaLabel}
      onWheel={(event) => event.stopPropagation()}
    >
      <div style={styles.agentTaskHeader}>
        <span>Tasks</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span>{rows.length > 0 ? rows.length : "No list"}</span>
          <button
            type="button"
            aria-label="Minimize tasks"
            title="Minimize tasks"
            style={styles.iconButtonSm}
            onClick={(event) => {
              event.stopPropagation();
              onToggleCollapsed();
            }}
          >
            <PanelRightClose size={13} strokeWidth={1.8} />
          </button>
        </span>
      </div>
      {rows.length === 0 ? (
        recent && recent.length > 0 ? (
          <div data-testid={`${testIdPrefix}-recent`} style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
            <div style={{ color: "var(--text-tertiary)", fontSize: 9, textTransform: "uppercase", letterSpacing: 0.4 }}>
              Recent activity
            </div>
            {[...recent].reverse().map((entry, index) => (
              <div
                key={`${entry.at}-${index}`}
                title={entry.text}
                style={{ display: "flex", justifyContent: "space-between", gap: 8, minWidth: 0, fontSize: 11, color: "var(--text-secondary)" }}
              >
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.text}</span>
                <span style={{ flexShrink: 0, color: "var(--text-tertiary)", fontSize: 9 }}>{activityAgo(entry.at)}</span>
              </div>
            ))}
          </div>
        ) : (
          <div
            data-testid={`${testIdPrefix}-task-empty`}
            style={{
              color: "var(--text-secondary)",
              fontSize: 11,
              lineHeight: 1.35,
            }}
          >
            {emptyText}
          </div>
        )
      ) : (
        <div style={styles.terminalBodyTaskList}>
          {rows.map((task) => {
            const done = task.state === "Done";
            return (
              <div
                key={task.id}
                style={{
                  ...styles.terminalBodyTaskRow,
                  opacity: done ? 0.62 : 1,
                }}
                data-testid={`${testIdPrefix}-task-row`}
                title={`${task.task} · ${task.state} · Next: ${task.next}`}
              >
                <span
                  style={{
                    ...styles.terminalBodyTaskMarker,
                    background: done
                      ? "var(--accent-live)"
                      : "color-mix(in srgb, var(--surface-base) 90%, transparent)",
                  }}
                  aria-hidden="true"
                />
                <span style={{ minWidth: 0 }}>
                  {task.meta && (
                    <div style={styles.terminalBodyTaskEyebrow}>
                      {task.meta}
                    </div>
                  )}
                  <div
                    style={{
                      ...styles.terminalBodyTaskTitle,
                      color: done ? "color-mix(in srgb, var(--text-secondary) 68%, transparent)" : styles.terminalBodyTaskTitle.color,
                      textDecoration: done ? "line-through" : "none",
                      textDecorationThickness: done ? 1 : undefined,
                      textDecorationColor: done ? "color-mix(in srgb, var(--text-tertiary) 48%, transparent)" : undefined,
                    }}
                  >
                    {task.task}
                  </div>
                  <div
                    style={{
                      ...styles.agentTaskMeta,
                      textDecoration: done ? "line-through" : "none",
                      textDecorationThickness: done ? 1 : undefined,
                      textDecorationColor: done ? "color-mix(in srgb, var(--text-tertiary) 42%, transparent)" : undefined,
                    }}
                  >
                    <span data-testid={`${testIdPrefix}-task-state`}>{task.state}</span>
                    <span style={{ color: "var(--text-tertiary)" }}>·</span>
                    <span style={styles.agentTaskNext} data-testid={`${testIdPrefix}-task-next`}>
                      Next: {task.next}
                    </span>
                  </div>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </aside>
  );
}

function currentLineupTaskRows(
  workstream: Tab["workstream"] | undefined,
  taskLineup: TaskLineupItem[] | undefined,
  summary: WorkstreamStatusSummary | undefined
): TerminalBodyTaskRow[] {
  void workstream;
  void summary;
  if (taskLineup?.length) {
    return taskLineup.map((item) => ({
      id: item.id,
      task: item.content,
      state: item.status === "completed"
        ? "Done"
        : item.status === "in_progress"
          ? "Working"
          : item.status === "cancelled"
          ? "Cancelled"
          : "Not done",
      next: taskLineupNextLabel(item),
    }));
  }

  return [];
}

function recoveryPromptFor(workstream?: Tab["workstream"]) {
  return `Recover ${workstreamLabel(workstream?.provider)} agent: inspect the failure output, summarize the root cause, and propose the next command.`;
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
          {/* The work activity ("Now: …") is shown once, in the node status block below;
              repeating it here was the duplicate header the cockpit showed. (TC-033) */}
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

function CanvasNodeViewImpl({
  node,
  live,
  terminalOverlayRoot,
  focusNode,
  terminalPreview,
  onTerminalSnapshot,
  onOpenNodeLabelMenu,
  onPanStart,
}: {
  node: CanvasNode;
  // Whether this terminal node mounts a full live renderer. When false (off
  // screen / over the live cap) it shows the cheap snapshot preview instead.
  // Computed once per render by the parent live-node set.
  live: boolean;
  terminalOverlayRoot: HTMLDivElement | null;
  focusNode: (node: CanvasNode, zoom: number) => void;
  terminalPreview?: TerminalPreviewEntry;
  onTerminalSnapshot: (nodeId: string, snapshot: GridSnapshot) => void;
  onOpenNodeLabelMenu: (nodeId: string, event: React.MouseEvent) => void;
  onPanStart: (event: React.MouseEvent) => void;
}) {
  const tabs = useWorkspaceStore((state) => state.tabs);
  const groups = useWorkspaceStore((state) => state.groups);
  const liveCwds = useWorkspaceStore((state) => state.liveCwds);
  const liveGitRoots = useWorkspaceStore((state) => state.liveGitRoots);
  const selectedNodeId = useWorkspaceStore((state) => state.canvasState.selectedNodeId);
  const storedSelectedNodeIds = useWorkspaceStore((state) => state.canvasState.selectedNodeIds);
  const zoom = useWorkspaceStore((state) => state.canvasState.viewport.zoom);
  const updateCanvasNode = useWorkspaceStore((state) => state.updateCanvasNode);
  const renameCanvasNode = useWorkspaceStore((state) => state.renameCanvasNode);
  const moveCanvasNodes = useWorkspaceStore((state) => state.moveCanvasNodes);
  const removeCanvasNode = useWorkspaceStore((state) => state.removeCanvasNode);
  const closeTerminalSession = useWorkspaceStore((state) => state.closeTerminalSession);
  const closePane = useWorkspaceStore((state) => state.closePane);
  const updatePreviewPaneUrl = useWorkspaceStore((state) => state.updatePreviewPaneUrl);
  const selectCanvasNode = useWorkspaceStore((state) => state.selectCanvasNode);
  const selectCanvasNodes = useWorkspaceStore((state) => state.selectCanvasNodes);
  const setActiveTab = useWorkspaceStore((state) => state.setActiveTab);
  const setActivePane = useWorkspaceStore((state) => state.setActivePane);
  const setActiveTerminal = useWorkspaceStore((state) => state.setActiveTerminal);
  const setWorkspaceMode = useWorkspaceStore((state) => state.setWorkspaceMode);
  const workspaceProjectRoot = useWorkspaceStore((state) => state.projectRoot);
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
  const terminalBodyRef = useRef<HTMLDivElement | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState(node.title);
  const [operatorDraft, setOperatorDraft] = useState("");
  const [taskPickerOpen, setTaskPickerOpen] = useState(false);
  const [taskPickerQuery, setTaskPickerQuery] = useState("");
  const [manualTaskId, setManualTaskId] = useState(node.taskBinding?.taskId ?? "");
  const [terminalOverlayBounds, setTerminalOverlayBounds] = useState<TerminalOverlayBounds | null>(null);
  const selectedNodeIds = storedSelectedNodeIds ?? (selectedNodeId ? [selectedNodeId] : []);
  const selected = selectedNodeIds.includes(node.id) || selectedNodeId === node.id;
  const labelColor = node.type === "terminal" ? node.labelColor : undefined;
  const labelStatusBlockStyle: CSSProperties | undefined = labelColor
    ? {
        padding: "8px 10px",
        border: `1px solid color-mix(in srgb, ${labelColor} 30%, var(--border-subtle))`,
        borderLeft: `3px solid ${labelColor}`,
        borderRadius: "var(--radius-sm)",
        background: `linear-gradient(90deg, color-mix(in srgb, ${labelColor} 15%, transparent), color-mix(in srgb, ${labelColor} 4%, transparent))`,
        boxShadow: "inset 0 1px 0 color-mix(in srgb, #ffffff 5%, transparent)",
      }
    : undefined;
  // Below readable zoom, show the cheap character preview. At readable zoom,
  // the parent live set decides whether the full renderer should mount.
  const showTerminalPreview = node.type === "terminal" && zoom < READABLE_TERMINAL_ZOOM;
  const shouldMountTerminal = node.type === "terminal" && live && !showTerminalPreview;
  const shouldOverlayTerminal = shouldMountTerminal && selected && terminalOverlayRoot !== null;

  const syncTerminalOverlayBounds = useCallback(() => {
    const body = terminalBodyRef.current;
    const root = terminalOverlayRoot;
    if (!body || !root || !shouldOverlayTerminal) {
      setTerminalOverlayBounds(null);
      return;
    }
    const bodyRect = body.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    const next: TerminalOverlayBounds = {
      left: bodyRect.left - rootRect.left,
      top: bodyRect.top - rootRect.top,
      width: bodyRect.width,
      height: bodyRect.height,
    };
    setTerminalOverlayBounds((current) => {
      if (
        current &&
        Math.abs(current.left - next.left) < 0.5 &&
        Math.abs(current.top - next.top) < 0.5 &&
        Math.abs(current.width - next.width) < 0.5 &&
        Math.abs(current.height - next.height) < 0.5
      ) {
        return current;
      }
      return next;
    });
  }, [shouldOverlayTerminal, terminalOverlayRoot]);

  useEffect(() => {
    if (!shouldOverlayTerminal) {
      setTerminalOverlayBounds(null);
      return;
    }
    const frame = requestAnimationFrame(syncTerminalOverlayBounds);
    const body = terminalBodyRef.current;
    const root = terminalOverlayRoot;
    const observer = typeof ResizeObserver === "function"
      ? new ResizeObserver(syncTerminalOverlayBounds)
      : null;
    if (body) observer?.observe(body);
    if (root) observer?.observe(root);
    window.addEventListener("resize", syncTerminalOverlayBounds);
    window.addEventListener("scroll", syncTerminalOverlayBounds, true);
    window.addEventListener("termfleet-map-terminal-overlay-sync", syncTerminalOverlayBounds);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", syncTerminalOverlayBounds);
      window.removeEventListener("scroll", syncTerminalOverlayBounds, true);
      window.removeEventListener("termfleet-map-terminal-overlay-sync", syncTerminalOverlayBounds);
    };
  }, [
    node.height,
    node.width,
    node.x,
    node.y,
    selected,
    shouldOverlayTerminal,
    syncTerminalOverlayBounds,
    terminalOverlayRoot,
    zoom,
  ]);

  useEffect(() => {
    if (!renaming) return;
    renameInputRef.current?.focus();
    renameInputRef.current?.select();
  }, [renaming]);

  const onMouseDown = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const currentCanvasState = useWorkspaceStore.getState().canvasState;
    const currentSelectedNodeIds = currentCanvasState.selectedNodeIds ??
      (currentCanvasState.selectedNodeId ? [currentCanvasState.selectedNodeId] : []);
    const clearSelectedPreviewOnClick =
      node.type === "preview" &&
      currentSelectedNodeIds.length === 1 &&
      currentSelectedNodeIds[0] === node.id &&
      !event.shiftKey &&
      !event.metaKey &&
      !event.ctrlKey;
    if (event.shiftKey || event.metaKey || event.ctrlKey) {
      const nextIds = currentSelectedNodeIds.includes(node.id)
        ? currentSelectedNodeIds.filter((id) => id !== node.id)
        : [...currentSelectedNodeIds, node.id];
      selectCanvasNodes(nextIds.length > 0 ? nextIds : [node.id]);
    } else if (!currentSelectedNodeIds.includes(node.id)) {
      selectCanvasNode(node.id);
    }
    const dragIds = currentSelectedNodeIds.includes(node.id) && currentSelectedNodeIds.length > 1
      ? currentSelectedNodeIds
      : [node.id];
    dragRef.current = {
      x: event.clientX,
      y: event.clientY,
      nodeX: node.x,
      nodeY: node.y,
      lastDeltaX: 0,
      lastDeltaY: 0,
    };
    let moved = false;

    function onMouseMove(moveEvent: MouseEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      if (Math.abs(moveEvent.clientX - drag.x) > 3 || Math.abs(moveEvent.clientY - drag.y) > 3) {
        moved = true;
      }
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
      if (clearSelectedPreviewOnClick && !moved) {
        selectCanvasNodes([]);
      }
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
        userSized: true,
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
    setRenameDraft(node.title);
    setRenaming(true);
  }, [node.title]);

  const commitRename = useCallback(() => {
    renameCanvasNode(node.id, renameDraft);
    setRenaming(false);
  }, [node.id, renameCanvasNode, renameDraft]);

  const cancelRename = useCallback(() => {
    setRenameDraft(node.title);
    setRenaming(false);
  }, [node.title]);

  const renameEditor = (
    <input
      ref={renameInputRef}
      aria-label={`Rename ${node.type}`}
      data-testid={node.type === "terminal" ? "canvas-terminal-rename-input" : "canvas-node-rename-input"}
      dir="auto"
      style={styles.renameInput}
      value={renameDraft}
      onChange={(event) => setRenameDraft(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onBlur={commitRename}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          commitRename();
        } else if (event.key === "Escape") {
          event.preventDefault();
          cancelRename();
        }
      }}
    />
  );

  const linkedTab = node.terminalTabId
    ? tabs.find((tab) => tab.id === node.terminalTabId)
    : undefined;
  const linkedProject = projectForTab(linkedTab, groups);
  const projectEmoji = linkedProject?.emoji;
  const workstream = linkedTab?.workstream;
  const terminalRoot = node.terminalCwd ?? linkedTab?.initialCwd;
  const taskRoot = linkedProject?.projectRoot ?? terminalRoot ?? workstream?.gitRoot ?? workstream?.cwd ?? workspaceProjectRoot;
  const normalizedTaskRoot = taskRoot?.replace(/\/+$/, "");
  const tasksByRoot = useMasterPlanTasks([normalizedTaskRoot]);
  const rootTasks = normalizedTaskRoot ? tasksByRoot[normalizedTaskRoot] ?? [] : [];
  const taskOptions = useMemo(() => visibleTaskOptions(rootTasks, taskPickerQuery), [rootTasks, taskPickerQuery]);
  const taskPlanPath = normalizedTaskRoot ? masterPlanPath(normalizedTaskRoot) : "No project root";
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
  const activateTerminalNode = useCallback(() => {
    selectCanvasNode(node.id);
    if (node.type === "terminal") {
      setActiveTab(terminalTabId);
      setActivePane(terminalTabId, terminalPaneId);
      setActiveTerminal(linkedTerminalId ?? `terminal-${terminalTabId}-${terminalPaneId}`);
    }
    if (node.type === "terminal" && zoom < READABLE_TERMINAL_ZOOM) {
      focusNode(node, FOCUS_TERMINAL_ZOOM);
    }
  }, [
    focusNode,
    linkedTerminalId,
    node,
    selectCanvasNode,
    setActivePane,
    setActiveTab,
    setActiveTerminal,
    terminalPaneId,
    terminalTabId,
    zoom,
  ]);
  const terminalActivity = linkedTerminal?.durableActivity?.title ?? linkedTerminal?.currentActivity;
  // Prefer the live cwd (polled from the PTY) over the initial cwd so the
  // breadcrumb tracks `cd`/`z`; falls back to the spawn cwd before the first poll.
  const liveTerminalRoot = (linkedTerminalId ? liveCwds[linkedTerminalId] : undefined) ?? terminalRoot;
  // The git toplevel of the live cwd — the authoritative project boundary used to
  // name the workspace pill when the stored project root is a shallow category
  // folder. Prefer the per-terminal resolved root, then the agent workstream's.
  const terminalGitRoot =
    (linkedTerminalId ? liveGitRoots[linkedTerminalId] : undefined) || workstream?.gitRoot || undefined;
  // Title a terminal node by what it actually points at: a named project wins,
  // otherwise the current directory's name (tracks cd/z via liveTerminalRoot).
  // A manual rename (title differs from the default) is respected.
  const terminalTitle = workspaceLabelFor({
    project: linkedProject,
    cwd: liveTerminalRoot,
    gitRoot: terminalGitRoot,
    tabTitle: linkedTab?.title,
    nodeTitle: node.title,
  });
  const terminalStatusSummary = linkedTerminal?.statusSummary;
  const terminalAgentProvider = workstream?.provider ?? linkedTerminal?.agentProvider ?? terminalStatusSummary?.provider;
  const terminalAgentLabel = agentProviderIdentity(terminalAgentProvider);
  const directlyBoundTask = node.taskBinding
    ? rootTasks.find((task) => task.id.toLowerCase() === node.taskBinding?.taskId.toLowerCase())
    : undefined;

  const terminalExtractedSummary = getDisplaySummary({
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
    terminalOutput: linkedTerminal?.terminalOutput,
    terminalVisibleText: linkedTerminal?.terminalVisibleText,
  }, terminalStatusSummary);
  const purposeTaskLineup = visibleTaskLineup(
    workstream?.taskLineup ?? linkedTerminal?.taskLineup,
    linkedTerminal?.activeRunId
  );
  const previewVisibleText = readableSnapshotText(terminalPreview?.snapshot);
  const terminalVisibleText =
    previewVisibleText && (!linkedTerminal?.terminalVisibleTextUpdatedAt || (terminalPreview?.updatedAt ?? 0) >= linkedTerminal.terminalVisibleTextUpdatedAt)
      ? previewVisibleText
      : linkedTerminal?.terminalVisibleText ?? previewVisibleText;
  const terminalPurposeOutput = terminalVisibleText || linkedTerminal?.terminalOutput || "";
  const terminalPurpose = terminalPurposeFromContext({
    stored: linkedTerminal?.purpose,
    workstreamTitle: workstream?.mission ?? workstream?.prompt,
    activeTaskTitle:
      purposeTaskLineup.find((item) => item.status === "in_progress")?.content ??
      purposeTaskLineup[0]?.content,
    terminalOutput:
      !linkedTerminal?.durableActivity ||
      /\bWorking\s+\(|\bImplement this plan\?|\bpress enter to confirm\b|\benter to select\b|\bcodex\s+resume\s+[0-9a-f-]{20,}|\bbackground terminal running\b|\b(?:systemctl|\.service|Loaded:\s+loaded|transient\/run-|--user|Hermes Desktop is running)\b/i.test(terminalPurposeOutput)
        ? terminalPurposeOutput
        : undefined,
  });
  const terminalOutputClosedRaw = terminalOutputClosesTaskLineup(linkedTerminal?.terminalOutput);
  const terminalWaitingForOperator =
    terminalExtractedSummary?.status === "waiting" &&
    terminalExtractedSummary.now === "Waiting for operator selection";
  const terminalAtReadyPrompt =
    terminalTextLooksReadyPrompt(linkedTerminal?.terminalVisibleText);
  const terminalActivityLive =
    linkedTerminal?.durableActivity?.status === "running";
  const terminalHasConcreteVisibleSummary = Boolean(
    terminalExtractedSummary?.provider === "shell" &&
      terminalExtractedSummary.confidence === "high" &&
      /^(?:Playwright test|Running daily regression hunt|Running Yahav scrape)$/i.test(terminalExtractedSummary.task),
  );
  const terminalDurableActivityUsable = Boolean(
    linkedTerminal?.durableActivity &&
    linkedTerminal.durableActivity.status === "running" &&
    terminalActivityLive
  );
  const terminalOutputClosed =
    terminalOutputClosedRaw &&
    !terminalDurableActivityUsable &&
    !terminalHasConcreteVisibleSummary &&
    !purposeTaskLineup.some((item) => item.source === "todo-write") &&
    !directlyBoundTask &&
    !node.taskBinding;
  const terminalReadyPromptCloses =
    terminalAtReadyPrompt &&
    !terminalActivityLive &&
    !terminalHasConcreteVisibleSummary &&
    !purposeTaskLineup.some((item) => item.source === "todo-write");
  const terminalClosedSummary: WorkstreamStatusSummary | null = terminalOutputClosed || terminalReadyPromptCloses
    ? {
        ...(terminalExtractedSummary ?? {}),
        task: "Idle",
        path: liveTerminalRoot ?? pathTail(liveTerminalRoot) ?? "workspace path unknown",
        now: "Idle",
        status: "idle",
        provider: "shell",
        confidence: "high",
        tasksFromTodoWrite: false,
      }
    : null;
  const terminalDisplaySummaryBaseRaw = terminalClosedSummary
    ? terminalClosedSummary
    : terminalDurableActivityUsable && linkedTerminal?.durableActivity
    ? summaryFromDurableActivity(
        linkedTerminal.durableActivity,
        liveTerminalRoot ?? pathTail(liveTerminalRoot) ?? "workspace path unknown",
        terminalExtractedSummary,
        undefined,
      )
    : normalizePersistedShellSummary(
        terminalExtractedSummary,
        liveTerminalRoot ?? pathTail(liveTerminalRoot) ?? "workspace path unknown",
        terminalPurpose,
      );
  const terminalDisplaySummaryBase = terminalDisplaySummaryBaseRaw;
  // The agent's real task list (sidecar) wins the title/now over heuristic
  // inference — see preferRealTaskSummary. (TC-033)
  // No real task → show the clean activity description ONLY while a command is actually
  // running (e.g. "building TypeScript and Vite production bundle"). A finished/stale
  // command (idle/success/error) must NOT linger as the title — fall to a clean status
  // word instead. The reliable "what's it working on" comes from the agent's TaskCreate
  // list; activity inference is a best-effort live indicator only. (TC-033)
  const terminalNeutralTitle =
    terminalDisplaySummaryBase.status === "working"
      ? neutralHeaderTitle(linkedTerminal?.status)
      : terminalDisplaySummaryBase.status === "blocked"
        ? "Needs attention"
        : terminalDisplaySummaryBase.status === "done" || terminalDisplaySummaryBase.status === "idle"
          ? "Idle"
          : neutralHeaderTitle(linkedTerminal?.status);
  const terminalStoredMainUserAskApplies = Boolean(
    linkedTerminal?.mainUserAsk &&
      (!linkedTerminal.mainUserAsk.runId ||
        !linkedTerminal.activeRunId ||
        linkedTerminal.mainUserAsk.runId === linkedTerminal.activeRunId),
  );
  const terminalHeaderTaskLineup: TaskLineupItem[] | undefined = directlyBoundTask
    ? [{
        id: directlyBoundTask.id,
        content: directlyBoundTask.title,
        status: directlyBoundTask.status === "done" ? "completed" : "in_progress",
        source: "todo-write",
        updatedAt: 0,
      }]
    : workstream?.taskLineup ?? linkedTerminal?.taskLineup;
  const terminalHeader = buildTerminalHeaderState({
    paneId: terminalPaneId,
    terminalId: linkedTerminalId ?? terminalPaneId,
    runId: linkedTerminal?.activeRunId,
    project: linkedProject,
    liveCwd: liveTerminalRoot,
    liveGitRoot: terminalGitRoot,
    terminalStatus: linkedTerminal?.status,
    taskLineup: terminalHeaderTaskLineup,
    activeRunId: linkedTerminal?.activeRunId,
    mainUserAsk: terminalStoredMainUserAskApplies ? linkedTerminal?.mainUserAsk : undefined,
    statusSummary: terminalStatusSummary,
    summary: terminalDisplaySummaryBase,
    neutralTitle: terminalActivityLive ? null : terminalNeutralTitle,
    contextPurposeTitle: terminalPurpose?.title,
    contextPurposeSource: terminalPurpose?.source,
    workstreamTitle: workstream?.mission ?? workstream?.prompt,
    activelyWorking:
      terminalActivityLive ||
      /\bWorking\s+\(|esc to interrupt\b/i.test(
        linkedTerminal?.terminalVisibleText ?? linkedTerminal?.terminalOutput ?? "",
      ),
    trustedActivitySummary:
      terminalDurableActivityUsable ||
      terminalDisplaySummaryBase.task === "Reviewing approval request" ||
      terminalDisplaySummaryBase.now === "Waiting for operator selection",
  });
  const workspaceLabel = terminalHeader.workspace;
  const terminalHeaderTaskDescription = terminalHeader.goalLabel;
  const terminalHeaderTitleRaw = terminalHeader.currentActivity;
  const terminalHeaderNowRaw =
    terminalDurableActivityUsable
      ? terminalDisplaySummaryBase.now
      : terminalHeader.sources.goal === "task-tool" &&
          terminalHeader.currentActivity === terminalHeader.goalLabel
        ? terminalNeutralTitle
        : terminalHeader.currentActivity;
  const terminalHeaderPath =
    terminalDurableActivityUsable &&
    !/\.(?:tsx?|jsx?|mjs|cjs|rs|md|json|sh|py)$/i.test(terminalDisplaySummaryBase.path ?? "")
      ? terminalDisplaySummaryBase.path
      : terminalHeader.fullPath;
  // Anti-flicker for real sidecar task summaries. Bound MASTER_PLAN tasks and heuristic
  // shell-output fallbacks are authoritative per render, so they bypass the hold. (TC-035)
  const stabilizedNodeHeader = stableHeader(
    `map:${terminalTabId}:${terminalPaneId}:${node.taskBinding?.taskId ?? "unbound"}`,
    {
      title: (terminalHeaderTitleRaw ?? "").toString(),
      now: terminalHeaderNowRaw,
    },
    {
      nowMs: Date.now(),
      bypass:
        terminalHeader.sources.goal === "task-tool" ||
        !terminalStatusSummary?.tasksFromTodoWrite ||
        Boolean(terminalHeader.debug.titleUsesDistinctActivity) ||
        Boolean(directlyBoundTask) ||
        linkedTerminal?.status === "failed" ||
        linkedTerminal?.status === "exited",
    },
  );
  const terminalHeaderTitle = stabilizedNodeHeader.title;
  const terminalHeaderAttentionState = paneBadgeAttention(
    linkedTerminal,
    terminalStatusSummary?.status,
  );
  // Only show a "Now Active" line when it adds something beyond the task; otherwise
  // the card collapses to the single honest Task line (no duplicate/placeholder row).
  const terminalHeaderNowActiveVisible = activityAddsInfo(
    terminalHeaderTaskDescription,
    terminalHeaderTitle,
    terminalHeaderAttentionState,
  );
  const terminalHeaderHasRealTask =
    !!terminalHeaderTaskDescription &&
    !/^Task not captured$/i.test(terminalHeaderTaskDescription.trim());
  // When there is no distinct activity, the task becomes the ONE prominent line —
  // shown big in the title slot instead of a tiny "Task:" label with nothing under it.
  const terminalHeaderPromoteTaskToBig =
    !terminalHeaderNowActiveVisible && terminalHeaderHasRealTask;
  // Does this terminal need the operator, is it busy, or idle? Orthogonal to the
  // task text; replaces the vague "Working" wording.
  // ONE pure render-time translation of the pane's stored status — identical in every
  // view, nothing stored separately that can be dropped and flicker.
  const terminalHeaderAttention = badgeForAttention(
    terminalHeaderAttentionState,
  );
  const terminalHeaderSummarySignal = stabilizedNodeHeader.now;
  const terminalHeaderHasUsefulSummary = terminalHeader.currentActivity !== "Ready";
  const terminalHeaderHasTrustedSummary =
    terminalHeaderHasUsefulSummary && terminalDisplaySummaryBase.confidence !== "low";
  const terminalHeaderNow = terminalHeaderSummarySignal || terminalHeaderTitle || terminalNeutralTitle;
  const detectedLaneTaskId = node.taskBinding?.taskId ?? firstTaskIdFromText(
    workstream?.mission,
    workstream?.prompt,
    workstream?.lastSummary,
    workstream?.nextAction,
    terminalStatusSummary?.task,
    terminalHeaderTitle,
    terminalHeaderSummarySignal,
    linkedTab?.title,
    node.title
  );
  const boundTask = directlyBoundTask ?? (detectedLaneTaskId
    ? rootTasks.find((task) => task.id.toLowerCase() === detectedLaneTaskId.toLowerCase())
    : undefined);
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
  const laneChecklistTasks = (boundTask?.checklist ?? []).map((item, index) => ({
    id: item.id,
    task: item.text,
    state: item.status === "done" ? "Done" : "Not done",
    next: item.status === "done" ? "Completed" : taskStatusLabel(item.status),
    meta: `Plan checklist ${index + 1}/${boundTask?.checklist?.length ?? 1}`,
  }));
  const canonicalTerminalTaskLineup = visibleTaskLineup(
    linkedTerminal?.taskLineup,
    linkedTerminal?.activeRunId
  );
  const canonicalWorkstreamTaskLineup = visibleTaskLineup(
    workstream?.taskLineup,
    linkedTerminal?.activeRunId
  );
  const currentLineupTasks = currentLineupTaskRows(
    workstream,
    canonicalWorkstreamTaskLineup?.length ? canonicalWorkstreamTaskLineup : canonicalTerminalTaskLineup,
    workstream?.kind === "agent" ? agentStatusSummary ?? undefined : undefined
  );
  const terminalBodyTasks = laneChecklistTasks.length > 0
    ? laneChecklistTasks
    : currentLineupTasks;
  const taskSidebarCollapsed = linkedTerminal?.taskSidebarCollapsed ?? node.taskSidebarCollapsed ?? terminalBodyTasks.length === 0;
  const terminalBodyTaskPrefix: "canvas-agent" | "canvas-terminal" =
    workstream?.kind === "agent" ? "canvas-agent" : "canvas-terminal";
  const nodeKind = workstream?.kind === "agent"
    ? "agent"
    : node.type === "terminal"
      ? "shell"
      : node.type === "preview"
        ? "preview"
        : node.type;
  // Keep map terminals live on desktop. The map is the primary cockpit surface,
  // so terminal cards must not degrade into split-pane activation cards.
  const shouldUseNativeSplitForInteraction = false;
  void isDesktopNativeRuntime;
  void terminalRendererMode;
  const openLinkedTerminal = useCallback(() => {
    if (!linkedTab) return;
    setActiveTab(linkedTab.id);
    setWorkspaceMode("split");
  }, [linkedTab, setActiveTab, setWorkspaceMode]);

  const toggleTaskSidebarCollapsed = useCallback(() => {
    if (!linkedTab) {
      updateCanvasNode(node.id, { taskSidebarCollapsed: !taskSidebarCollapsed });
      return;
    }
    useWorkspaceStore.getState().setTerminalTaskSidebarCollapsed(
      linkedTab.id,
      terminalPaneId,
      !taskSidebarCollapsed,
      node.id
    );
  }, [linkedTab, node.id, taskSidebarCollapsed, terminalPaneId, updateCanvasNode]);

  const onBindTask = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setManualTaskId(node.taskBinding?.taskId ?? "");
    setTaskPickerQuery("");
    setTaskPickerOpen(true);
  }, [node.taskBinding?.taskId]);

  const closeTaskPicker = useCallback(() => {
    setTaskPickerOpen(false);
  }, []);

  const bindTaskId = useCallback((taskId: string) => {
    if (!normalizedTaskRoot) {
      return;
    }

    const trimmed = taskId.trim();
    if (!trimmed) return;
    updateCanvasNode(node.id, {
      taskBinding: { taskId: trimmed, planPath: masterPlanPath(normalizedTaskRoot) },
    });
    setTaskPickerOpen(false);
  }, [node.id, normalizedTaskRoot, updateCanvasNode]);

  const clearTaskBinding = useCallback(() => {
    updateCanvasNode(node.id, { taskBinding: undefined });
    setManualTaskId("");
    setTaskPickerOpen(false);
  }, [node.id, updateCanvasNode]);

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

  const liveTerminalComponent = shouldMountTerminal ? (
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
      renderScale={shouldOverlayTerminal ? 1 : mapTerminalRenderScaleForZoom(zoom)}
      onSnapshot={(snapshot) => onTerminalSnapshot(node.id, snapshot)}
      // Preserve alternate-screen agent TUIs on the map so Claude/zellij-style
      // panes do not rewrap into corrupted fragments. Readability comes from
      // focusing the map at 100%, not by over-scaling a clipped canvas.
      mapProjection
    />
  ) : null;

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
    ) : shouldMountTerminal ? (
      shouldOverlayTerminal ? (
        <div
          data-testid="canvas-terminal-overlay-placeholder"
          style={styles.liveTerminalOverlayPlaceholder}
          aria-hidden="true"
        />
      ) : liveTerminalComponent
    ) : node.type === "terminal" ? (
      <TerminalMapPreview
        title={terminalTitle}
        meta={pathTail(liveTerminalRoot)}
        status={linkedTerminal?.status}
        ptyCount={linkedTab?.terminals.length ?? 0}
        preview={terminalPreview}
        onActivate={activateTerminalNode}
        onOpen={openLinkedTerminal}
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
        border: selected ? "1px solid var(--border-focus)" : styles.node.border,
        boxShadow: selected
          ? "0 0 0 1px rgba(217,154,69,0.36), 0 20px 54px rgba(0,0,0,0.52)"
          : styles.node.boxShadow,
      }}
      onMouseDown={(event) => {
        if (event.button === 1) {
          onPanStart(event);
          return;
        }
        if (event.button !== 0) return;
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
      {node.type === "terminal" && projectEmoji && zoom < READABLE_TERMINAL_ZOOM && (
        <span
          style={{
            ...styles.projectEmojiZoomBadge,
            transform: `scale(${Math.min(2.2, Math.max(1, 1 / Math.max(zoom, 0.35)))})`,
            transformOrigin: "top left",
          }}
          data-testid="canvas-terminal-project-emoji-zoom"
          title={workspaceLabel}
          aria-hidden="true"
        >
          {projectEmoji}
        </span>
      )}
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
        onMouseDown={(event) => {
          if (event.button === 1) {
            onPanStart(event);
            return;
          }
          if (event.button !== 0) return;
          onMouseDown(event);
        }}
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
        {node.type === "terminal" && projectEmoji && (
          <span
            style={styles.projectEmojiBadge}
            data-testid="canvas-terminal-project-emoji"
            title={workspaceLabel}
            aria-label={`${workspaceLabel} project emoji`}
          >
            {projectEmoji}
          </span>
        )}
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
            style={{ ...styles.agentStatusBlock, ...labelStatusBlockStyle }}
            data-testid="canvas-agent-status-block"
            dir="auto"
            title={`${workspaceLabel} · ${agentStatusSummary.task} · ${agentStatusSummary.path} · ${agentStatusSummary.now}`}
            onMouseDown={onMouseDown}
            onDoubleClick={onRename}
          >
            {renaming && renameEditor}
            <div style={styles.terminalStatusKicker}>
              <span>Workspace</span>
              <span style={styles.workspacePill} data-testid="canvas-agent-node-workspace" title={workspaceLabel}>
                {workspaceLabel}
              </span>
              {terminalAgentLabel && (
                <span style={styles.agentStatusChip} data-testid="canvas-terminal-agent-provider">
                  <AgentProviderIdentity provider={terminalAgentProvider} />
                </span>
              )}
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
            style={{ ...styles.terminalStatusBlock, ...labelStatusBlockStyle }}
            data-testid="canvas-terminal-status-block"
            data-pane-id={terminalHeader.paneId}
            data-run-id={terminalHeader.runId ?? ""}
            data-full-path={terminalHeader.fullPath}
            data-goal-source={terminalHeader.sources.goal}
            data-activity-source={terminalHeader.sources.activity}
            data-path-source={terminalHeader.sources.path}
            data-header-version={terminalHeader.version}
            data-header-workspace-source={terminalHeader.sources.workspace}
            data-header-task-source={terminalHeader.sources.goal}
            data-header-title-source={terminalHeader.sources.activity}
            data-header-now-source={terminalHeader.sources.activity}
            dir="auto"
            title={`${workspaceLabel} · ${terminalHeaderTaskDescription} · ${terminalHeaderTitle} · ${terminalHeaderPath}`}
            onMouseDown={onMouseDown}
            onDoubleClick={onRename}
          >
            <div style={styles.terminalStatusKicker}>
              <span>Workspace</span>
              <span style={styles.workspacePill} data-testid="canvas-terminal-node-workspace" title={workspaceLabel}>
                {workspaceLabel}
              </span>
              {terminalAgentLabel && (
                <span style={styles.agentStatusChip} data-testid="canvas-terminal-agent-provider">
                  <AgentProviderIdentity provider={terminalAgentProvider} />
                </span>
              )}
              <span
                style={{
                  ...styles.attentionBadge,
                  color: terminalHeaderAttention.color,
                  borderColor: `color-mix(in srgb, ${terminalHeaderAttention.color} 45%, transparent)`,
                  background: `color-mix(in srgb, ${terminalHeaderAttention.color} 14%, transparent)`,
                }}
                data-testid="canvas-terminal-node-attention"
                data-attention-state={terminalHeaderAttention.state}
                title={terminalHeaderAttention.label}
              >
                <span
                  style={{ ...styles.attentionDot, background: terminalHeaderAttention.color }}
                />
                {terminalHeaderAttention.label}
              </span>
            </div>
            {!terminalHeaderPromoteTaskToBig && (
            <div
              style={styles.terminalTaskRow}
              data-testid="canvas-terminal-node-task-row"
              title={`Task: ${terminalHeaderTaskDescription}`}
            >
              <span style={styles.terminalTaskLabel}>Task:</span>
              <span
                data-testid="canvas-terminal-node-description"
                title={terminalHeaderTaskDescription}
                style={styles.terminalTaskValue}
              >
                {terminalHeaderTaskDescription}
              </span>
            </div>
            )}
            <div
              style={styles.terminalStatusTitle}
              title={
                terminalHeaderPromoteTaskToBig
                  ? `Task: ${terminalHeaderTaskDescription}`
                  : `Now Active: ${terminalHeaderTitle}`
              }
            >
              {renaming ? (
                renameEditor
              ) : terminalHeaderPromoteTaskToBig ? (
                <>
                  <span style={styles.terminalNowActiveLabel}>Task:</span>
                  <span
                    data-testid="canvas-terminal-node-description"
                    style={{ ...styles.terminalNowActiveValue, color: labelColor ?? "var(--text-primary)" }}
                  >
                    {terminalHeaderTaskDescription}
                  </span>
                </>
              ) : terminalHeaderNowActiveVisible ? (
                <>
                  <span style={styles.terminalNowActiveLabel}>Now Active:</span>
                  <span
                    data-testid="canvas-terminal-node-header-title"
                    style={{ ...styles.terminalNowActiveValue, color: labelColor ?? "var(--text-primary)" }}
                  >
                    {terminalHeaderTitle}
                  </span>
                </>
              ) : null}
              {(workstream || linkedTerminal) && (
                <CockpitSnapshotProbe
                  entry={{
                    paneId: terminalPaneId,
                    terminalId: linkedTerminalId ?? undefined,
                    tabId: terminalTabId,
                    cwd: liveTerminalRoot ?? undefined,
                    path: terminalHeaderPath,
                    workspace: workspaceLabel,
                    previewTitle: terminalTitle,
                    projectEmoji,
                    kind: "shell",
                    task: terminalHeaderTaskDescription,
                    taskSource: terminalHeader.sources.goal,
                    title: terminalHeaderTitle,
                    titleSource: terminalHeader.sources.activity,
                    now: terminalHeaderNow ?? "",
                    nowSource: terminalHeader.sources.activity,
                    status: linkedTerminal?.status,
                    tasksFromTodoWrite: terminalStatusSummary?.tasksFromTodoWrite,
                    narration: terminalStatusSummary?.narration,
                    durableActivityTitle: linkedTerminal?.durableActivity?.title,
                    currentActivity: linkedTerminal?.currentActivity,
                    terminalOutput: linkedTerminal?.terminalOutput?.slice(-1800),
                    terminalVisibleText: terminalVisibleText?.slice(-1800),
                    terminalVisibleTextUpdatedAt: terminalPreview?.updatedAt ?? linkedTerminal?.terminalVisibleTextUpdatedAt,
                    statusSummarySource: linkedTerminal?.statusSummarySource,
                    statusSummaryError: linkedTerminal?.statusSummaryError,
                    statusSummaryUpdatedAt: linkedTerminal?.statusSummaryUpdatedAt,
                    statusSummaryNarration: (workstream?.statusSummary ?? linkedTerminal?.statusSummary)?.narration,
                    statusSummaryTask: terminalStatusSummary?.task,
                    statusSummaryNow: terminalStatusSummary?.now,
                    statusSummaryPath: terminalStatusSummary?.path,
                    taskLineup: canonicalTerminalTaskLineup.map((item) => ({ content: item.content, status: item.status })),
                    debug: {
                      ...terminalHeader.debug,
                      waitingForOperator: terminalWaitingForOperator,
                      previewVisibleTextUsed: terminalVisibleText === previewVisibleText,
                    },
                  }}
                />
              )}
            </div>
            <div style={terminalHeaderHasTrustedSummary ? styles.terminalStatusLayout : styles.terminalStatusSummaryColumn}>
              <div style={styles.terminalStatusSummaryColumn}>
                <div style={styles.terminalStatusGrid}>
                  <span
                    style={styles.terminalStatusFieldValue}
                    data-testid="canvas-terminal-node-header-path"
                    title={terminalHeaderPath}
                  >
                    {terminalHeaderPath}
                  </span>
                  <span
                    data-testid="canvas-terminal-node-now"
                    title={terminalHeaderNow}
                    style={{ display: "none" }}
                  >
                    {terminalHeaderNow}
                  </span>
                </div>
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
              {renaming ? (
                renameEditor
              ) : (
                <span style={{ color: labelColor ?? "var(--text-primary)" }}>
                  {agentHeaderTitle ?? (node.type === "terminal" ? terminalTitle : node.title)}
                </span>
              )}
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
      {taskPickerOpen && typeof document !== "undefined" && createPortal(
        <>
          <div
            data-testid="task-binding-picker-scrim"
            style={styles.taskPickerScrim}
            onMouseDown={closeTaskPicker}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Bind MASTER_PLAN task"
            data-testid="task-binding-picker"
            style={styles.taskPicker}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === "Escape") closeTaskPicker();
            }}
          >
            <div style={styles.taskPickerHeader}>
              <div style={{ minWidth: 0 }}>
                <div style={styles.taskPickerTitle}>
                  <ListTodo size={16} strokeWidth={1.8} />
                  <span>Bind MASTER_PLAN task</span>
                </div>
                <div style={styles.taskPickerMeta}>
                  <span style={styles.taskPickerPill} title={workspaceLabel}>
                    Workspace · {workspaceLabel}
                  </span>
                  <span style={styles.taskPickerPill} title={taskPlanPath}>
                    <FileText size={12} strokeWidth={1.8} />
                    {taskPlanPath}
                  </span>
                  {node.taskBinding && (
                    <span
                      style={styles.taskPickerPill}
                      title={boundTask ? boundTask.title : "Current binding is not present in parsed tasks"}
                    >
                      Current · {node.taskBinding.taskId}
                    </span>
                  )}
                </div>
              </div>
              <button
                type="button"
                style={styles.taskPickerButton}
                aria-label="Close task picker"
                onClick={closeTaskPicker}
              >
                <X size={14} strokeWidth={1.8} />
              </button>
            </div>

            <div style={styles.taskPickerSearchRow}>
              <label style={styles.taskPickerSearch}>
                <Search size={14} strokeWidth={1.8} />
                <input
                  data-testid="task-binding-search"
                  style={styles.taskPickerInput}
                  value={taskPickerQuery}
                  placeholder="Search task id, title, or status"
                  aria-label="Search MASTER_PLAN tasks"
                  autoFocus
                  onChange={(event) => setTaskPickerQuery(event.currentTarget.value)}
                />
              </label>
              <span style={{ color: "var(--text-secondary)", fontSize: 11 }}>
                {taskOptions.length} of {rootTasks.length}
              </span>
            </div>

            <div style={styles.taskPickerList} data-testid="task-binding-options">
              {!normalizedTaskRoot ? (
                <div style={styles.taskPickerEmpty}>
                  This terminal does not have a project root yet. Open it from a project workspace before binding a plan task.
                </div>
              ) : rootTasks.length === 0 ? (
                <div style={styles.taskPickerEmpty}>
                  No tasks were parsed from MASTER_PLAN.md. Use the manual task id field below if the task exists in another ledger format.
                </div>
              ) : taskOptions.length === 0 ? (
                <div style={styles.taskPickerEmpty}>
                  No tasks match this search. Try a task id, status, or a shorter phrase.
                </div>
              ) : (
                taskOptions.map((task) => {
                  const active = task.id.toLowerCase() === node.taskBinding?.taskId.toLowerCase();
                  return (
                    <button
                      key={task.id}
                      type="button"
                      data-testid="task-binding-option"
                      data-task-id={task.id}
                      style={{
                        ...styles.taskPickerRow,
                        ...(active ? styles.taskPickerRowActive : null),
                      }}
                      title={`${task.id} · ${taskStatusLabel(task.status)} · ${task.title}`}
                      onClick={() => bindTaskId(task.id)}
                    >
                      <span style={styles.taskPickerTaskId}>{task.id}</span>
                      <span style={{ minWidth: 0 }}>
                        <span style={styles.taskPickerTaskTitle}>{task.title}</span>
                        <span style={styles.taskPickerTaskMeta}>
                          {task.rawStatus || taskStatusLabel(task.status)}
                        </span>
                      </span>
                      <span
                        style={{
                          ...styles.taskPickerStatus,
                          background: `color-mix(in srgb, ${taskStatusColor(task.status)} 14%, var(--surface-base))`,
                        }}
                      >
                        <span style={{ ...styles.taskDot, background: taskStatusColor(task.status) }} />
                        {active ? "Bound" : taskStatusLabel(task.status)}
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            <div style={styles.taskPickerFooter}>
              <label style={styles.taskPickerManualBlock}>
                <span style={styles.taskPickerLabel}>Manual task id</span>
                <input
                  data-testid="task-binding-manual-input"
                  style={styles.taskPickerManual}
                  value={manualTaskId}
                  placeholder="TC-021"
                  aria-label="Manual task id"
                  onChange={(event) => setManualTaskId(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    bindTaskId(manualTaskId);
                  }}
                />
              </label>
              <div style={styles.taskPickerActions}>
                {node.taskBinding && (
                  <button
                    type="button"
                    data-testid="task-binding-clear"
                    style={{ ...styles.taskPickerButton, ...styles.taskPickerDangerButton }}
                    onClick={clearTaskBinding}
                  >
                    Clear binding
                  </button>
                )}
                <button
                  type="button"
                  style={styles.taskPickerButton}
                  onClick={closeTaskPicker}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  data-testid="task-binding-manual-bind"
                  style={{
                    ...styles.taskPickerButton,
                    ...styles.taskPickerPrimaryButton,
                    opacity: normalizedTaskRoot && manualTaskId.trim() ? 1 : 0.52,
                    cursor: normalizedTaskRoot && manualTaskId.trim() ? "pointer" : "default",
                  }}
                  disabled={!normalizedTaskRoot || !manualTaskId.trim()}
                  onClick={() => bindTaskId(manualTaskId)}
                >
                  Bind
                </button>
              </div>
            </div>
          </div>
        </>,
        document.body
      )}
      {shouldOverlayTerminal && terminalOverlayRoot && terminalOverlayBounds && liveTerminalComponent && createPortal(
        <div
          data-testid="canvas-terminal-live-overlay"
          data-node-id={node.id}
          style={{
            ...styles.terminalOverlayPane,
            left: terminalOverlayBounds.left,
            top: terminalOverlayBounds.top,
            width: terminalOverlayBounds.width,
            height: terminalOverlayBounds.height,
          }}
        >
          {liveTerminalComponent}
        </div>,
        terminalOverlayRoot
      )}
      <div
        style={
          node.type === "terminal"
            ? {
                ...(workstream?.kind === "agent"
                  ? styles.terminalBodyWithTasks
                  : styles.shellTerminalBody),
                ...styles.liveTerminalBody,
                // The task panel is a real second column INSIDE the card: a narrow
                // icon rail when collapsed, the full list when expanded. The terminal
                // (column 1) makes room for it, so the two read as one card with a
                // single divider — no detached floating slab, no gap. overflow:hidden
                // keeps everything clipped to the card.
                gridTemplateColumns: taskSidebarCollapsed
                  ? "minmax(0, 1fr) 44px"
                  : "minmax(0, 1fr) 224px",
                overflow: "hidden",
              }
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
        onWheel={node.type === "terminal" ? (event) => event.stopPropagation() : undefined}
      >
        {node.type === "terminal" ? (
          <div
            ref={terminalBodyRef}
            style={styles.terminalBodyTaskContent}
            data-testid="canvas-terminal-task-content"
          >
            {workstream?.kind === "agent" ? (
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
        ) : (
          body
        )}
        {node.type === "terminal" && (
          <TerminalBodyTaskSidebar
            rows={terminalBodyTasks}
            testIdPrefix={terminalBodyTaskPrefix}
            ariaLabel={workstream?.kind === "agent" ? "Agent terminal tasks" : "Terminal tasks"}
            recent={terminalDisplaySummaryBase.recent}
            collapsed={taskSidebarCollapsed}
            onToggleCollapsed={toggleTaskSidebarCollapsed}
            emptyText={detectedLaneTaskId
              ? `No checklist found for ${detectedLaneTaskId}. Add Acceptance bullets in MASTER_PLAN.md to show done and not-done tasks.`
              : workstream?.kind === "agent"
                ? "No structured task lineup has been created for this agent yet."
                : "No task list captured for this run."}
          />
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

// Memoized so one node's preview/state update (parent re-render + .map) does not
// re-render every other node. Props are referentially stable: the parent passes
// useCallback'd handlers and per-node `terminalPreview` entries that only change
// for the node whose preview actually updated.
const CanvasNodeView = memo(CanvasNodeViewImpl);

export function MagicCanvas() {
  const canvasState = useWorkspaceStore((state) => state.canvasState);
  const tabs = useWorkspaceStore((state) => state.tabs);
  const activeTabId = useWorkspaceStore((state) => state.activeTabId);
  const setActiveTab = useWorkspaceStore((state) => state.setActiveTab);
  const addCanvasNode = useWorkspaceStore((state) => state.addCanvasNode);
  const updateCanvasNode = useWorkspaceStore((state) => state.updateCanvasNode);
  const updateCanvasViewport = useWorkspaceStore((state) => state.updateCanvasViewport);
  const selectCanvasNodes = useWorkspaceStore((state) => state.selectCanvasNodes);
  const alignCanvasNodes = useWorkspaceStore((state) => state.alignCanvasNodes);
  const distributeCanvasNodes = useWorkspaceStore((state) => state.distributeCanvasNodes);
  const arrangeProjectTerminalRow = useWorkspaceStore((state) => state.arrangeProjectTerminalRow);
  const arrangeTerminalProjectLanes = useWorkspaceStore((state) => state.arrangeTerminalProjectLanes);
  const openFiles = useWorkspaceStore((state) => state.openFiles);
  const shellRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [terminalOverlayRoot, setTerminalOverlayRoot] = useState<HTMLDivElement | null>(null);
  const panRef = useRef<{
    x: number;
    y: number;
    viewportX: number;
    viewportY: number;
    zoom: number;
    nextX: number;
    nextY: number;
  } | null>(null);
  const panRafRef = useRef<number | null>(null);
  const [fileIndex, setFileIndex] = useState(0);
  const [terminalPreviews, setTerminalPreviews] = useState<Record<string, TerminalPreviewEntry>>({});
  // Per-node throttle state for preview updates (leading + trailing).
  const previewThrottleRef = useRef<
    Map<string, { lastFlush: number; timer: number | null; pending: GridSnapshot | null }>
  >(new Map());
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
  // --- Viewport culling: bound how many terminal nodes mount a live renderer ---
  // Measured size of the map viewport, used to project the visible canvas rect.
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  // Recency of last-live, per node id, for LRU/hysteresis when over the cap.
  const liveRecencyRef = useRef<Map<string, number>>(new Map());
  const liveTickRef = useRef(0);

  useEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    const apply = () =>
      setContainerSize({ width: el.clientWidth, height: el.clientHeight });
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Drop preview snapshots (and their throttle state) for nodes that no longer
  // exist. Previously entries were only ever added, so every closed terminal
  // leaked a full grid snapshot for the life of the session.
  useEffect(() => {
    const validIds = new Set(canvasState.nodes.map((n) => n.id));
    for (const id of previewThrottleRef.current.keys()) {
      if (!validIds.has(id)) {
        const entry = previewThrottleRef.current.get(id);
        if (entry?.timer != null) clearTimeout(entry.timer);
        previewThrottleRef.current.delete(id);
      }
    }
    setTerminalPreviews((current) => {
      let changed = false;
      const next: Record<string, TerminalPreviewEntry> = {};
      for (const [id, entry] of Object.entries(current)) {
        if (validIds.has(id)) next[id] = entry;
        else changed = true;
      }
      return changed ? next : current;
    });
  }, [canvasState.nodes]);

  // Clear any pending throttle timers on unmount.
  useEffect(() => {
    const throttle = previewThrottleRef.current;
    return () => {
      for (const entry of throttle.values()) {
        if (entry.timer != null) clearTimeout(entry.timer);
      }
      throttle.clear();
    };
  }, []);

  const { viewport, nodes, selectedNodeId, selectedNodeIds } = canvasState;
  const selectedCanvasNodeIds = selectedNodeIds ?? (selectedNodeId ? [selectedNodeId] : []);
  const selectedCanvasNodes = useMemo(
    () => selectedCanvasNodeIds
      .map((id) => nodes.find((node) => node.id === id))
      .filter((node): node is CanvasNode => Boolean(node)),
    [nodes, selectedCanvasNodeIds]
  );
  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId),
    [activeTabId, tabs]
  );
  const projectRowGroupId = useMemo(() => {
    const selectedTerminalTabId = selectedCanvasNodes.find((node) => node.type === "terminal")?.terminalTabId;
    const selectedTab = selectedTerminalTabId
      ? tabs.find((tab) => tab.id === selectedTerminalTabId)
      : undefined;
    return selectedTab?.groupId ?? activeTab?.groupId ?? null;
  }, [activeTab?.groupId, selectedCanvasNodes, tabs]);
  const projectRowTerminalCount = useMemo(() => {
    if (!projectRowGroupId) return 0;
    const tabIds = new Set(tabs.filter((tab) => tab.groupId === projectRowGroupId).map((tab) => tab.id));
    return nodes.filter((node) =>
      node.type === "terminal" &&
      node.terminalTabId &&
      tabIds.has(node.terminalTabId)
    ).length;
  }, [nodes, projectRowGroupId, tabs]);
  const canAlignCanvasNodes = selectedCanvasNodes.length >= 2;
  const canDistributeCanvasNodes = selectedCanvasNodes.length >= 3;
  const canArrangeProjectRow = Boolean(projectRowGroupId) && projectRowTerminalCount >= 2;
  const terminalProjectLaneCount = useMemo(() => {
    const tabGroupsById = new Map(tabs.map((tab) => [tab.id, tab.groupId ?? "unassigned"]));
    const laneIds = new Set<string>();
    for (const node of nodes) {
      if (node.type !== "terminal" || !node.terminalTabId) continue;
      const groupId = tabGroupsById.get(node.terminalTabId);
      if (groupId) laneIds.add(groupId);
    }
    return laneIds.size;
  }, [nodes, tabs]);
  const canArrangeTerminalProjectLanes = terminalProjectLaneCount >= 2;
  const liveNodeIds = useMemo(() => {
    const live = new Set<string>();
    if (!MAP_LIVE_TERMINALS_ENABLED) return live;
    // Below readable zoom every terminal already renders the cheap DOM preview,
    // so no live renderers are mounted regardless — nothing to cull.
    if (viewport.zoom < READABLE_TERMINAL_ZOOM) return live;

    const selectedIds = selectedNodeIds ?? (selectedNodeId ? [selectedNodeId] : []);
    const selectedTerminalNodeId = selectedIds.find((id) =>
      nodes.some((node) => node.id === id && node.type === "terminal")
    ) ?? null;
    const activeTabNodeId = activeTabId
      ? nodes.find((node) => node.type === "terminal" && node.terminalTabId === activeTabId)?.id ?? null
      : null;
    const primaryLiveNodeId = selectedTerminalNodeId ?? activeTabNodeId;
    const { x, y, zoom } = viewport;
    const { width: w, height: h } = containerSize;
    // Invert the stage transform to get the visible rect in canvas space, then
    // inflate by the overscan so nodes warm up just before scrolling into view.
    const viewLeft = -x / zoom - CULL_OVERSCAN_PX;
    const viewTop = -y / zoom - CULL_OVERSCAN_PX;
    const viewRight = (w - x) / zoom + CULL_OVERSCAN_PX;
    const viewBottom = (h - y) / zoom + CULL_OVERSCAN_PX;

    const recency = liveRecencyRef.current;
    const alwaysLive: string[] = [];
    const candidates: string[] = [];
    for (const node of nodes) {
      if (node.type !== "terminal") continue;
      // Keep exactly one primary work surface streaming even if off screen.
      const isAlwaysLive = node.id === primaryLiveNodeId;
      const intersects =
        w > 0 &&
        h > 0 &&
        node.x < viewRight &&
        node.x + node.width > viewLeft &&
        node.y < viewBottom &&
        node.y + node.height > viewTop;
      if (isAlwaysLive) alwaysLive.push(node.id);
      else if (intersects) candidates.push(node.id);
    }

    for (const id of alwaysLive) live.add(id);
    const remaining = Math.max(0, MAX_LIVE_TERMINALS - live.size);
    if (candidates.length <= remaining) {
      for (const id of candidates) live.add(id);
    } else {
      // Over the cap: keep the most-recently-live candidates (hysteresis avoids
      // dropping a node that just streamed while panning).
      candidates
        .sort((a, b) => (recency.get(b) ?? 0) - (recency.get(a) ?? 0))
        .slice(0, remaining)
        .forEach((id) => live.add(id));
    }
    return live;
  }, [nodes, viewport, containerSize, selectedNodeId, selectedNodeIds, activeTabId]);

  // Advance recency for currently-live nodes (used as hysteresis next compute).
  useEffect(() => {
    const recency = liveRecencyRef.current;
    for (const id of liveNodeIds) {
      liveTickRef.current += 1;
      recency.set(id, liveTickRef.current);
    }
  }, [liveNodeIds]);
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

  const flushTerminalPreview = useCallback((nodeId: string, snapshot: GridSnapshot) => {
    setTerminalPreviews((current) => ({
      ...current,
      [nodeId]: {
        // Shallow outer-array copy is sufficient: GridBuffer.apply() only ever
        // replaces whole row arrays by index (never mutates a stored row's
        // cells in place), so the captured row references stay frozen even as
        // the live buffer swaps slots on later frames. Avoids the O(rows×cols)
        // per-row deep copy that previously ran on every diff frame.
        snapshot: { ...snapshot, cells: snapshot.cells.slice() },
        updatedAt: Date.now(),
      },
    }));
  }, []);

  // Coalesce high-frequency snapshots (one per diff frame) so a busy terminal
  // does not drive a setState + map re-render on every frame. Leading-edge flush
  // keeps the preview responsive; a trailing timer delivers the final frame of a
  // burst.
  const updateTerminalPreview = useCallback((nodeId: string, snapshot: GridSnapshot) => {
    const map = previewThrottleRef.current;
    let entry = map.get(nodeId);
    if (!entry) {
      entry = { lastFlush: 0, timer: null, pending: null };
      map.set(nodeId, entry);
    }
    const now = Date.now();
    const elapsed = now - entry.lastFlush;
    if (elapsed >= PREVIEW_THROTTLE_MS) {
      entry.lastFlush = now;
      entry.pending = null;
      flushTerminalPreview(nodeId, snapshot);
      return;
    }
    entry.pending = snapshot;
    if (entry.timer === null) {
      entry.timer = window.setTimeout(() => {
        const e = map.get(nodeId);
        if (!e) return;
        e.timer = null;
        e.lastFlush = Date.now();
        if (e.pending) {
          const pending = e.pending;
          e.pending = null;
          flushTerminalPreview(nodeId, pending);
        }
      }, PREVIEW_THROTTLE_MS - elapsed);
    }
  }, [flushTerminalPreview]);

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

  const startCanvasPan = useCallback((event: React.MouseEvent, options?: { deselectOnClick?: boolean }) => {
    event.preventDefault();
    event.stopPropagation();
    let moved = false;
    panRef.current = {
      x: event.clientX,
      y: event.clientY,
      viewportX: canvasState.viewport.x,
      viewportY: canvasState.viewport.y,
      zoom: canvasState.viewport.zoom,
      nextX: canvasState.viewport.x,
      nextY: canvasState.viewport.y,
    };
    document.body.classList.add("no-select");
    if (shellRef.current) shellRef.current.style.cursor = "grabbing";

    // Drive the pan with direct, rAF-coalesced DOM writes instead of a store
    // write per mousemove. Writing canvasState.viewport on every move re-rendered
    // the whole canvas tree — and recomputed liveNodeIds (its memo depends on
    // viewport), churning every live terminal node — which is the pan lag. The
    // stage is a CSS-transformed container, so moving it pans all nodes for free
    // on the compositor. The store is committed once on mouseup.
    function applyPanToDom() {
      panRafRef.current = null;
      const pan = panRef.current;
      if (!pan) return;
      if (stageRef.current) {
        stageRef.current.style.transform =
          `translate(${pan.nextX}px, ${pan.nextY}px) scale(${pan.zoom})`;
      }
      if (shellRef.current) {
        shellRef.current.style.backgroundPosition = `${pan.nextX}px ${pan.nextY}px`;
      }
      window.dispatchEvent(new Event("termfleet-map-terminal-overlay-sync"));
    }

    function onMouseMove(moveEvent: MouseEvent) {
      const pan = panRef.current;
      if (!pan) return;
      if (Math.abs(moveEvent.clientX - pan.x) > 3 || Math.abs(moveEvent.clientY - pan.y) > 3) {
        moved = true;
      }
      pan.nextX = pan.viewportX + moveEvent.clientX - pan.x;
      pan.nextY = pan.viewportY + moveEvent.clientY - pan.y;
      if (panRafRef.current === null) {
        panRafRef.current = requestAnimationFrame(applyPanToDom);
      }
    }

    function onMouseUp() {
      const pan = panRef.current;
      panRef.current = null;
      if (panRafRef.current !== null) {
        cancelAnimationFrame(panRafRef.current);
        panRafRef.current = null;
      }
      document.body.classList.remove("no-select");
      if (shellRef.current) shellRef.current.style.cursor = "";
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      // Commit the final viewport to the store once (recomputes liveNodeIds,
      // persists layout). Only when actually panned — a plain click stays cheap.
      if (pan && moved) {
        updateCanvasViewport({ x: pan.nextX, y: pan.nextY });
      }
      if (options?.deselectOnClick && !moved) {
        selectCanvasNodes([]);
      }
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [canvasState.viewport.x, canvasState.viewport.y, canvasState.viewport.zoom, selectCanvasNodes, updateCanvasViewport]);

  const onCanvasMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.button !== 0 && event.button !== 1) return;
    event.preventDefault();
    const rect = shellRef.current?.getBoundingClientRect();
    const viewport = canvasState.viewport;
    if (event.button === 0 && event.shiftKey && rect) {
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
    startCanvasPan(event, { deselectOnClick: event.button === 0 });
  }, [canvasState.viewport, selectCanvasNodes, startCanvasPan]);

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
      tabIndex={0}
      aria-label="Operations map"
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
        <span style={styles.toolbarDivider} aria-hidden="true" />
        <button
          className="magic-canvas-button"
          style={{ ...styles.button, ...(!canAlignCanvasNodes ? styles.buttonDisabled : null) }}
          title="Align selected left"
          aria-label="Align selected left"
          disabled={!canAlignCanvasNodes}
          onClick={() => alignCanvasNodes(selectedCanvasNodeIds, "left")}
        >
          <AlignHorizontalJustifyStart size={14} strokeWidth={1.8} />
        </button>
        <button
          className="magic-canvas-button"
          style={{ ...styles.button, ...(!canAlignCanvasNodes ? styles.buttonDisabled : null) }}
          title="Align selected top"
          aria-label="Align selected top"
          disabled={!canAlignCanvasNodes}
          onClick={() => alignCanvasNodes(selectedCanvasNodeIds, "top")}
        >
          <AlignVerticalJustifyStart size={14} strokeWidth={1.8} />
        </button>
        <button
          className="magic-canvas-button"
          style={{ ...styles.button, ...(!canAlignCanvasNodes ? styles.buttonDisabled : null) }}
          title="Center selected horizontally"
          aria-label="Center selected horizontally"
          disabled={!canAlignCanvasNodes}
          onClick={() => alignCanvasNodes(selectedCanvasNodeIds, "center-x")}
        >
          <AlignHorizontalJustifyCenter size={14} strokeWidth={1.8} />
        </button>
        <button
          className="magic-canvas-button"
          style={{ ...styles.button, ...(!canAlignCanvasNodes ? styles.buttonDisabled : null) }}
          title="Center selected vertically"
          aria-label="Center selected vertically"
          disabled={!canAlignCanvasNodes}
          onClick={() => alignCanvasNodes(selectedCanvasNodeIds, "center-y")}
        >
          <AlignVerticalJustifyCenter size={14} strokeWidth={1.8} />
        </button>
        <button
          className="magic-canvas-button"
          style={{ ...styles.button, ...(!canDistributeCanvasNodes ? styles.buttonDisabled : null) }}
          title="Distribute selected horizontally"
          aria-label="Distribute selected horizontally"
          disabled={!canDistributeCanvasNodes}
          onClick={() => distributeCanvasNodes(selectedCanvasNodeIds, "horizontal")}
        >
          <StretchHorizontal size={14} strokeWidth={1.8} />
        </button>
        <button
          className="magic-canvas-button"
          style={{ ...styles.button, ...(!canDistributeCanvasNodes ? styles.buttonDisabled : null) }}
          title="Distribute selected vertically"
          aria-label="Distribute selected vertically"
          disabled={!canDistributeCanvasNodes}
          onClick={() => distributeCanvasNodes(selectedCanvasNodeIds, "vertical")}
        >
          <StretchVertical size={14} strokeWidth={1.8} />
        </button>
        <button
          className="magic-canvas-button"
          style={{ ...styles.button, ...(!canArrangeProjectRow ? styles.buttonDisabled : null) }}
          title="Arrange current project terminals in one row"
          aria-label="Arrange current project terminals in one row"
          disabled={!canArrangeProjectRow}
          onClick={() => {
            if (projectRowGroupId) arrangeProjectTerminalRow(projectRowGroupId);
          }}
        >
          <Rows3 size={14} strokeWidth={1.8} />
        </button>
        <button
          className="magic-canvas-button"
          style={{ ...styles.button, ...(!canArrangeTerminalProjectLanes ? styles.buttonDisabled : null) }}
          title="Compact terminal lanes"
          aria-label="Compact terminal lanes"
          disabled={!canArrangeTerminalProjectLanes}
          onClick={arrangeTerminalProjectLanes}
        >
          <Columns3 size={14} strokeWidth={1.8} />
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
                  <div
                    key={`${item.tabId}-${item.objectId}`}
                    style={{ ...styles.agentLaneItem, background: "transparent", border: "none", padding: "3px 0", gridTemplateColumns: "minmax(0, 1fr) auto" }}
                    data-testid="canvas-agent-extracted-item"
                    data-review-state={item.reviewState}
                    title={`${item.label} ${item.reviewState} for ${item.title}`}
                  >
                    <span style={{ minWidth: 0 }}>
                      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block", color: "var(--text-primary)" }}>
                        {item.label} · {item.reviewState}
                      </span>
                      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>
                        {item.title} · {item.text} · {item.source}
                      </span>
                    </span>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                      <button
                        type="button"
                        className="magic-canvas-button"
                        style={{ ...styles.agentLaneIconButton, width: "auto", minWidth: 42, padding: "0 6px" }}
                        title={`Focus ${item.title}`}
                        aria-label={`Focus ${item.label}`}
                        onClick={() => {
                          setActiveTab(item.tabId);
                          if (node) centerNode(node, FOCUS_TERMINAL_ZOOM);
                        }}
                      >
                        Focus
                      </button>
                      <button
                        type="button"
                        className="magic-canvas-button"
                        style={{ ...styles.agentLaneIconButton, width: "auto", minWidth: 40, padding: "0 6px" }}
                        title={item.request ? `Request proof for ${item.text}` : `Convert ${item.label} to prompt`}
                        aria-label={item.request ? `Request proof for ${item.label}` : `Convert ${item.label} to prompt`}
                        onClick={() => {
                          if (item.request) {
                            useWorkspaceStore.getState().queueWorkstreamInput(item.tabId, item.request, {
                              source: "mission-control",
                              label: "Request proof",
                            });
                            useWorkspaceStore.getState().reviewCockpitObject(item.tabId, item.objectId, "proof-requested");
                          } else {
                            useWorkspaceStore.getState().queueWorkstreamInput(item.tabId, item.prompt, {
                              source: "mission-control",
                              label: "Object prompt",
                            });
                            useWorkspaceStore.getState().reviewCockpitObject(item.tabId, item.objectId, "prompted");
                          }
                        }}
                      >
                        {item.request ? "Proof" : "Prompt"}
                      </button>
                      <button
                        type="button"
                        className="magic-canvas-button"
                        style={{ ...styles.agentLaneIconButton, width: "auto", minWidth: 40, padding: "0 6px" }}
                        title={`Copy ${item.label}`}
                        aria-label={`Copy ${item.label}`}
                        onClick={() => {
                          if (navigator.clipboard?.writeText) void navigator.clipboard.writeText(item.brief);
                        }}
                      >
                        Copy
                      </button>
                      <button
                        type="button"
                        className="magic-canvas-button"
                        style={{ ...styles.agentLaneIconButton, width: "auto", minWidth: 48, padding: "0 6px" }}
                        title={`Accept ${item.text}`}
                        aria-label={`Accept ${item.label}`}
                        onClick={() => useWorkspaceStore.getState().reviewCockpitObject(item.tabId, item.objectId, "accepted")}
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        className="magic-canvas-button"
                        style={{ ...styles.agentLaneIconButton, width: "auto", minWidth: 52, padding: "0 6px" }}
                        title={`Dismiss ${item.text}`}
                        aria-label={`Dismiss ${item.label}`}
                        onClick={() => useWorkspaceStore.getState().reviewCockpitObject(item.tabId, item.objectId, "dismissed")}
                      >
                        Dismiss
                      </button>
                    </span>
                  </div>
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
        ref={stageRef}
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
            live={liveNodeIds.has(node.id)}
            terminalOverlayRoot={terminalOverlayRoot}
            focusNode={centerNode}
            terminalPreview={terminalPreviews[node.id]}
            onTerminalSnapshot={updateTerminalPreview}
            onOpenNodeLabelMenu={openNodeLabelMenu}
            onPanStart={startCanvasPan}
          />
        ))}
      </div>

      <div
        ref={setTerminalOverlayRoot}
        data-testid="canvas-terminal-overlay-layer"
        style={styles.terminalOverlayLayer}
      />

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
          style={{ ...styles.button, ...(!canArrangeTerminalProjectLanes ? styles.buttonDisabled : null) }}
          onClick={arrangeTerminalProjectLanes}
          title="Compact terminal lanes"
          aria-label="Compact terminal lanes"
          disabled={!canArrangeTerminalProjectLanes}
        >
          <Columns3 size={14} strokeWidth={1.8} />
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
