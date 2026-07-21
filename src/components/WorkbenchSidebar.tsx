import { CSSProperties, Fragment, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowsClockwise,
  ArrowSquareOut,
  CheckCircle,
  Prohibit,
  CaretDoubleLeft,
  CaretDoubleRight,
  ClipboardText,
  Browser,
  CaretDown,
  CaretRight,
  Robot,
  FileText,
  FolderOpen,
  ListBullets,
  MapTrifold,
  MagnifyingGlass,
  Note,
  Palette,
  Plus,
  PushPin,
  Smiley,
  SquaresFour,
  TerminalWindow,
  TextT,
  Trash,
  TreeStructure,
  X,
} from "@phosphor-icons/react";
import { createAgentWorkstream, createAgentWorkstreamRunId, createNewTab, createTerminalTab, currentAgentWorkstreamCwd, splitActivePane, splitActivePreviewPane, useWorkspaceStore } from "../stores/workspace";
import { FolderPicker } from "./FolderPicker";
import { EmojiPicker } from "./EmojiPicker";
import type { CanvasNode, Group, Tab, TerminalState, TaskLineupItem, WorkstreamMetadata } from "../lib/types";
import { taskStatusColor, taskStatusLabel, type MasterPlanTask } from "../lib/masterPlanTasks";
import { useMasterPlanTasks } from "../hooks/useMasterPlanTasks";
import { pathTail, projectNameFor, workspaceLabelFor } from "../lib/projectDisplay";
import { buildTerminalHeaderState, type TerminalHeaderState } from "../lib/terminalHeaderState";
import { activityAddsInfo } from "../lib/terminalHeaderViewModel";
import { badgeForAttention } from "../lib/terminalAttention";
import { paneBadgeAttention } from "../lib/sessionStatus";
import { FileExplorer } from "./FileExplorer";
import { checkAgentProvider } from "../lib/agentProviders";
import { agentLaneAuthRetryText, agentLaneAuthRetryTitle, agentLaneCleanupRequestText, agentLaneCleanupRequestTitle, agentLaneCloseoutText, agentLaneCloseoutTitle, agentLaneHealthText, agentLaneInterruptText, agentLaneInterruptTitle, agentLaneMemoryRequestText, agentLaneMemoryRequestTitle, agentLaneProofRequestText, agentLaneProofRequestTitle, agentLaneRestartText, agentLaneRestartTitle, agentLaneRiskMitigationText, agentLaneRiskMitigationTitle, agentLaneStatusSweepText, agentLaneStatusSweepTitle, agentLaneStatusText, attentionBreakdownText, cleanupBreakdownText, closeoutBreakdownText, formatAgentLaneBrief, formatAgentMissionControlBrief, formatAgentRunBrief, handoffMemoryPromptForWorkstream, isActiveAgentWorkstream, isAuthRetryableAgentWorkstream, isCleanupRequestableAgentWorkstream, isRestartableAgentWorkstream, isReviewItemCloseoutReady, isolationBreakdownText, latestMissionControlAskText, missionBreakdownText, missionControlAlternateText, missionControlDispatchBreakdownText, proofRequestPromptForWorkstream, providerBreakdownText, readinessBreakdownText, riskBreakdownText, statusCheckPromptForWorkstream, summarizeAgentLane } from "../lib/agentWorkstreamLane";
import { workstreamActivityText } from "../lib/workstreamActivity";
import { formatWorkstreamOpsContext, promptWorkstreamIsolation, promptWorkstreamLaunchProfile, resolveWorkstreamOpsContext } from "../lib/workstreamOpsContext";
import { MAP_FILTERS, type MapFilter, nodeMatchesMapFilter } from "../lib/mapNodeFilters";
import { formatLocalServiceBrief, summarizeLocalServices, type LocalServiceSummary } from "../lib/localServices";
import { projectBucketsByCanvasPosition } from "../lib/mapNodeOrdering";
import { useFlipList } from "../hooks/useFlipList";
import { agentProviderIdentity } from "../lib/agentProviderIdentity";
import { AgentProviderIdentity } from "./AgentProviderIdentity";
import { buildProjectSidebarModel, type ProjectSidebarItem } from "../lib/projectSidebarModel";

const TERMINAL_COLORS = [
  "#d99a45",
  "#7fc681",
  "#7dbac3",
  "#6ea8fe",
  "#ad8fcb",
  "#ef6f72",
];
const TERMINAL_EMOJIS = ["💻", "⚙️", "🚀", "🧪", "🛠️", "📦", "🔧", "🧭"];

function workstreamLabel(provider?: string) {
  if (provider === "opencode") return "OpenCode";
  if (provider === "claude") return "Claude";
  if (provider === "shell") return "Shell";
  return "Codex";
}

function workstreamScanStatus(workstream: WorkstreamMetadata) {
  if (workstream.status === "done" || workstream.phase === "complete" || workstream.phase === "reviewed") return "done";
  if (workstream.status === "failed" || workstream.phase === "blocked" || workstream.readiness === "auth-required") return "blocked";
  if (workstream.status === "waiting" || workstream.phase === "needs-input" || workstream.activityKind === "waiting") return "waiting";
  if (workstream.status === "stopped" || workstream.phase === "interrupted") return "idle";
  if (workstream.status === "running" || workstream.phase === "active" || workstream.phase === "launching") return "working";
  return "idle";
}

function workstreamAttentionText(workstream: WorkstreamMetadata) {
  if (workstream.readiness === "auth-required") return "needs auth";
  if (workstream.status === "failed" || workstream.phase === "blocked") return "recovery";
  if (workstream.risk && !/^none$/i.test(workstream.risk)) return "risk";
  if (workstream.evidence) return "has evidence";
  if (workstream.phase === "reviewed") return "reviewed";
  if (workstream.status === "done" || workstream.phase === "complete") return "review ready";
  if (workstream.activityKind === "testing") return "needs proof";
  return workstream.nextAction ?? "watch";
}

function countLabel(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) {
    const label = value.trim();
    if (!label) continue;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([label, count]) => ({ label, count }));
}

function terminalForNode(node: CanvasNode, tab?: Tab) {
  if (!tab) return undefined;
  return tab.terminals.find((terminal) => terminal.paneId === tab.activePaneId) ??
    tab.terminals.find((terminal) => terminal.paneId === node.id) ??
    tab.terminals.find((terminal) => terminal.id === node.terminalPtyId) ??
    tab.terminals[0];
}

function terminalForTab(tab: Tab) {
  return tab.terminals.find((terminal) => terminal.paneId === tab.activePaneId) ?? tab.terminals[0];
}

function boundTaskLineup(task?: MasterPlanTask): TaskLineupItem[] | undefined {
  if (!task) return undefined;
  return [{
    id: task.id,
    content: task.title,
    status: task.status === "done" ? "completed" : "in_progress",
    source: "todo-write",
    updatedAt: 0,
  }];
}

function sidebarHeaderForTerminal(input: {
  tab: Tab;
  terminal?: TerminalState;
  project?: Group | null;
  liveCwd?: string | null;
  liveGitRoot?: string | null;
  spawnCwd?: string | null;
  boundTask?: MasterPlanTask;
}): TerminalHeaderState {
  const { tab, terminal, project, liveCwd, liveGitRoot, spawnCwd, boundTask } = input;
  const workstream = tab.workstream;
  const taskLineup = boundTaskLineup(boundTask) ?? workstream?.taskLineup ?? terminal?.taskLineup;
  const mainUserAskApplies = Boolean(
    terminal?.mainUserAsk &&
      (!terminal.mainUserAsk.runId ||
        !terminal.activeRunId ||
        terminal.mainUserAsk.runId === terminal.activeRunId),
  );
  const statusSummary = terminal?.statusSummary ?? workstream?.statusSummary;
  const liveActivity =
    terminal?.durableActivity?.title ??
    terminal?.currentActivity ??
    workstream?.currentActivity ??
    workstream?.lastSummary;
  const terminalOutput = terminal?.terminalVisibleText ?? terminal?.terminalOutput ?? workstream?.terminalOutput ?? "";

  return buildTerminalHeaderState({
    paneId: terminal?.paneId ?? tab.activePaneId,
    terminalId: terminal?.id ?? tab.activePaneId,
    runId: terminal?.activeRunId ?? workstream?.activeRunId ?? workstream?.runId,
    project,
    liveCwd: liveCwd ?? spawnCwd ?? tab.initialCwd,
    spawnCwd: spawnCwd ?? tab.initialCwd,
    liveGitRoot: liveGitRoot ?? workstream?.gitRoot,
    terminalStatus: terminal?.status,
    taskLineup,
    activeRunId: terminal?.activeRunId ?? workstream?.activeRunId,
    mainUserAsk: mainUserAskApplies ? terminal?.mainUserAsk : undefined,
    statusSummary,
    summary: statusSummary,
    neutralTitle: liveActivity ?? null,
    workstreamTitle: workstream?.mission ?? workstream?.prompt,
    activelyWorking:
      terminal?.durableActivity?.status === "running" ||
      workstream?.status === "running" ||
      workstream?.phase === "active" ||
      /\bWorking\s+\(|esc to interrupt\b/i.test(terminalOutput),
    trustedActivitySummary: terminal?.durableActivity?.status === "running",
  });
}

function summarizeMapNodes(nodes: CanvasNode[], tabs: Tab[], groups: Group[], liveCwds: Record<string, string>) {
  const workspaceValues: string[] = [];
  const branchValues: string[] = [];
  const roleValues: string[] = [];
  const serviceValues: string[] = [];

  for (const node of nodes) {
    const linkedTab = node.terminalTabId ? tabs.find((tab) => tab.id === node.terminalTabId) : undefined;
    const linkedProject = linkedTab?.groupId ? groups.find((group) => group.id === linkedTab.groupId) : null;
    const terminal = terminalForNode(node, linkedTab);
    const liveCwd = terminal?.id ? liveCwds[terminal.id] : undefined;
    workspaceValues.push(workspaceLabelFor({
      project: linkedProject,
      cwd: liveCwd ?? node.terminalCwd ?? linkedTab?.initialCwd,
      tabTitle: linkedTab?.title,
      nodeTitle: node.title,
    }));

    if (linkedTab?.workstream?.gitBranch) branchValues.push(linkedTab.workstream.gitBranch);
    if (node.type === "preview" || node.previewUrl || terminal?.previewUrl) serviceValues.push(node.previewUrl ?? terminal?.previewUrl ?? "localhost preview");

    if (node.type === "preview") {
      roleValues.push("preview");
    } else if (linkedTab?.workstream?.kind === "agent") {
      roleValues.push(linkedTab.workstream.role ?? `${workstreamLabel(linkedTab.workstream.provider)} agent`);
    } else if (node.type === "terminal") {
      roleValues.push("shell");
    } else {
      roleValues.push(node.type);
    }
  }

  const workspaces = countLabel(workspaceValues);
  const branches = countLabel(branchValues);
  const roles = countLabel(roleValues);
  const services = countLabel(serviceValues);
  const headline = [
    `${workspaces.length} workspace${workspaces.length === 1 ? "" : "s"}`,
    `${roles.length} role${roles.length === 1 ? "" : "s"}`,
    branches.length > 0 ? `${branches.length} branch${branches.length === 1 ? "" : "es"}` : null,
    services.length > 0 ? `${services.length} service${services.length === 1 ? "" : "s"}` : null,
  ].filter(Boolean).join(" · ");

  return { workspaces, branches, roles, services, headline };
}

type OperationsPanel = "sessions" | "map";

const panelIcons: Record<OperationsPanel, typeof TerminalWindow> = {
  sessions: ListBullets,
  map: MapTrifold,
};

const panelTitles: Record<OperationsPanel, string> = {
  sessions: "Sessions list",
  map: "Operations map",
};

const styles: Record<string, CSSProperties> = {
  shell: {
    height: "100%",
    display: "flex",
    background: "var(--surface-base)",
    borderRight: "1px solid var(--border-subtle)",
    color: "var(--text-primary)",
    userSelect: "none",
  },
  collapsed: {
    width: "var(--dock-collapsed-width)",
    minWidth: "var(--dock-collapsed-width)",
  },
  operationsPanel: {
    width: "var(--operations-sidebar-width)",
    minWidth: "var(--operations-sidebar-width)",
    height: "100%",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  filePanel: {
    width: "var(--file-explorer-width)",
    minWidth: "var(--file-explorer-width)",
    height: "100%",
    overflow: "hidden",
    borderLeft: "1px solid var(--border-strong)",
  },
  rail: {
    width: "var(--dock-collapsed-width)",
    minWidth: "var(--dock-collapsed-width)",
    height: "100%",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 8,
    padding: "12px 5px",
    borderRight: "1px solid var(--border-subtle)",
    background: "var(--surface-base)",
  },
  railButton: {
    width: 32,
    height: 30,
    border: "1px solid transparent",
    borderRadius: "var(--radius-sm)",
    background: "transparent",
    color: "var(--text-secondary)",
    display: "grid",
    placeItems: "center",
    cursor: "pointer",
    transition: "background var(--motion-fast), border-color var(--motion-fast), color var(--motion-fast), transform var(--motion-fast)",
  },
  railSeparator: {
    width: 24,
    height: 1,
    background: "var(--border-subtle)",
    margin: "2px 0",
    opacity: 0.9,
  },
  railSpacer: {
    flex: 1,
  },
  panel: {
    flex: 1,
    minWidth: 0,
    height: "100%",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    background: "var(--surface-base)",
  },
  header: {
    minHeight: 56,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    padding: "12px 16px",
    borderBottom: "1px solid var(--border-subtle)",
  },
  title: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
    color: "var(--text-primary)",
  },
  titleStack: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    gap: 1,
  },
  titleName: {
    fontSize: 16,
    fontWeight: 500,
    letterSpacing: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  titlePath: {
    fontSize: 12,
    fontWeight: 400,
    color: "var(--text-secondary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    maxWidth: 230,
  },
  onboard: {
    display: "grid",
    gap: 8,
    padding: "10px 8px 4px",
    justifyItems: "start",
  },
  onboardTitle: {
    fontSize: 13,
    fontWeight: 500,
    color: "var(--text-primary)",
  },
  onboardText: {
    fontSize: 12,
    lineHeight: 1.45,
    color: "var(--text-secondary)",
  },
  count: {
    color: "var(--text-secondary)",
    fontSize: 11,
  },
  headerActions: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
  },
  countPill: {
    height: 22,
    minWidth: 24,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "0 7px",
    border: "1px solid transparent",
    borderRadius: "var(--radius-xs)",
    background: "var(--surface-raised)",
    color: "var(--text-secondary)",
    fontSize: 11,
  },
  iconButton: {
    width: 30,
    height: 28,
    border: "1px solid transparent",
    borderRadius: 6,
    background: "var(--surface-base)",
    color: "var(--text-secondary)",
    display: "grid",
    placeItems: "center",
    cursor: "pointer",
  },
  list: {
    flex: 1,
    minHeight: 0,
    overflow: "auto",
    padding: 7,
    display: "flex",
    flexDirection: "column",
    gap: 3,
  },
  mapFilterBar: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: 4,
    padding: "8px",
    borderBottom: "1px solid var(--border-subtle)",
    overflow: "hidden",
  },
  mapFilterButton: {
    height: 28,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    padding: "0 6px",
    border: "1px solid transparent",
    borderRadius: "var(--radius-sm)",
    background: "var(--surface-base)",
    color: "var(--text-secondary)",
    fontFamily: "var(--font-ui)",
    fontSize: 11,
    fontWeight: 500,
    cursor: "pointer",
    whiteSpace: "nowrap",
    minWidth: 0,
  },
  mapFilterCount: {
    color: "var(--text-tertiary)",
    fontSize: 10,
    fontWeight: 500,
  },
  projectList: {
    padding: "6px 7px",
    borderBottom: "1px solid var(--border-subtle)",
    overflowX: "hidden",
  },
  projectBrowserToggle: {
    minWidth: 0,
    flex: 1,
    height: 28,
    display: "grid",
    gridTemplateColumns: "14px minmax(0, 1fr) auto",
    alignItems: "center",
    gap: 6,
    padding: "0 5px",
    border: "none",
    borderRadius: "var(--radius-xs)",
    background: "transparent",
    color: "var(--text-secondary)",
    fontFamily: "var(--font-ui)",
    fontSize: 11,
    fontWeight: 500,
    textAlign: "left",
    textTransform: "uppercase",
    cursor: "pointer",
  },
  projectBrowserContent: {
    maxHeight: "min(54vh, 490px)",
    overflowX: "hidden",
    overflowY: "auto",
    paddingTop: 4,
  },
  sectionLabel: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    margin: "2px 2px 7px",
    color: "var(--text-secondary)",
    fontSize: 11,
    fontWeight: 500,
    letterSpacing: 0,
    textTransform: "uppercase",
  },
  projectRow: {
    position: "relative",
    minWidth: 0,
    minHeight: 34,
    display: "grid",
    gridTemplateColumns: "24px minmax(0, 1fr) auto",
    gap: 8,
    alignItems: "center",
    padding: "5px 6px",
    border: "none",
    borderRadius: "var(--radius-sm)",
    background: "transparent",
    color: "var(--text-primary)",
    cursor: "pointer",
    transition: "background var(--motion-fast)",
  },
  activeProjectRow: {
    background: "var(--surface-selected)",
    borderColor: "transparent",
    boxShadow: "none",
  },
  projectDot: {
    width: 24,
    height: 24,
    borderRadius: 6,
    display: "grid",
    placeItems: "center",
    background: "var(--surface-raised)",
    border: "none",
  },
  projectGrid: {
    display: "grid",
    gap: 2,
  },
  projectSection: {
    display: "grid",
    gap: 2,
    marginTop: 7,
  },
  projectSectionToggle: {
    width: "100%",
    height: 28,
    display: "grid",
    gridTemplateColumns: "16px minmax(0, 1fr) auto",
    alignItems: "center",
    gap: 5,
    padding: "0 6px",
    border: "none",
    borderRadius: "var(--radius-xs)",
    background: "transparent",
    color: "var(--text-secondary)",
    fontFamily: "var(--font-ui)",
    fontSize: 11,
    fontWeight: 500,
    textAlign: "left",
    cursor: "pointer",
  },
  projectSectionCount: {
    color: "var(--text-tertiary)",
    fontSize: 10,
    fontWeight: 400,
  },
  projectSectionLabel: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    margin: "8px 6px 4px",
    color: "var(--text-tertiary)",
    fontSize: 10,
    fontWeight: 500,
    letterSpacing: 0,
    textTransform: "uppercase",
  },
  projectRailRow: {
    minWidth: 0,
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    alignItems: "center",
    borderRadius: "var(--radius-sm)",
  },
  projectRowTrailing: {
    display: "flex",
    alignItems: "center",
    gap: 2,
    paddingRight: 3,
  },
  projectSearch: {
    width: "100%",
    height: 30,
    marginBottom: 6,
    padding: "0 9px",
    border: "none",
    borderRadius: "var(--radius-sm)",
    background: "var(--surface-raised)",
    color: "var(--text-primary)",
    fontFamily: "var(--font-ui)",
    fontSize: 12,
    outline: "none",
  },
  projectHeaderActions: {
    display: "flex",
    alignItems: "center",
    gap: 2,
  },
  projectHeaderButton: {
    width: 24,
    height: 24,
    display: "grid",
    placeItems: "center",
    border: "none",
    borderRadius: "var(--radius-xs)",
    background: "transparent",
    color: "var(--text-secondary)",
    cursor: "pointer",
  },
  row: {
    position: "relative",
    height: 54,
    minHeight: 54,
    display: "grid",
    gridTemplateColumns: "30px minmax(0, 1fr)",
    gap: 9,
    alignItems: "center",
    padding: "6px 7px",
    border: "1px solid transparent",
    borderRadius: "var(--radius-sm)",
    background: "transparent",
    cursor: "pointer",
    color: "var(--text-primary)",
    outline: "none",
    boxShadow: "none",
    WebkitTapHighlightColor: "transparent",
    transition: "background var(--motion-fast), box-shadow var(--motion-fast)",
    overflow: "hidden",
  },
  mapNodeRow: {
    height: "auto",
    minWidth: 0,
    gridTemplateColumns: "30px minmax(0, 1fr) auto",
    alignItems: "start",
    padding: "8px 7px",
  },
  sessionContent: {
    minWidth: 0,
    display: "grid",
    gap: 3,
    transition: "padding-right var(--motion-fast)",
  },
  sessionSummary: {
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    gap: 5,
    overflow: "hidden",
    color: "var(--text-secondary)",
    fontSize: 11,
    lineHeight: 1.2,
    whiteSpace: "nowrap",
  },
  sessionSummaryText: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  sessionRowActions: {
    position: "absolute",
    right: 6,
    top: "50%",
    display: "flex",
    alignItems: "center",
    gap: 3,
    opacity: 0,
    transform: "translate(2px, -50%)",
    pointerEvents: "none",
    transition: "opacity var(--motion-fast), transform var(--motion-fast)",
  },
  activeRow: {
    background: "var(--surface-selected)",
    borderColor: "transparent",
    boxShadow: "none",
  },
  dragGhost: {
    minHeight: 36,
    margin: "2px 0",
    display: "flex",
    alignItems: "center",
    padding: "0 12px",
    border: "1px dashed var(--border-focus)",
    borderRadius: "var(--radius-sm)",
    background: "color-mix(in srgb, var(--border-focus) 12%, transparent)",
    color: "var(--text-secondary)",
    fontSize: 12,
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
  },
  hoverRow: {
    background: "var(--surface-hover)",
  },
  iconCell: {
    width: 30,
    height: 30,
    borderRadius: 8,
    display: "grid",
    placeItems: "center",
    background: "var(--surface-raised)",
    color: "var(--text-primary)",
  },
  projectEmojiCell: {
    width: 30,
    height: 30,
    border: "1px solid var(--border-subtle)",
    borderRadius: 8,
    display: "grid",
    placeItems: "center",
    background: "var(--surface-raised)",
    color: "var(--text-primary)",
    fontFamily: "var(--font-ui)",
    fontSize: 16,
    lineHeight: 1,
    cursor: "pointer",
    padding: 0,
  },
  rowTitle: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: 14,
    fontWeight: 500,
  },
  rowMeta: {
    marginTop: 2,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: "var(--text-secondary)",
    fontSize: 12,
  },
  sidebarHeaderLines: {
    display: "grid",
    gap: 7,
    minWidth: 0,
    marginTop: 6,
  },
  // A "Task | value" column left the value ~18 readable characters in this narrow
  // card. The label now sits above its value, so the text gets the full width.
  sidebarHeaderLine: {
    display: "grid",
    gap: 1,
    minWidth: 0,
  },
  sidebarHeaderLabel: {
    color: "var(--text-tertiary)",
    fontWeight: 500,
    fontSize: 9,
    letterSpacing: "0.07em",
    textTransform: "uppercase",
    whiteSpace: "nowrap",
  },
  sidebarHeaderTask: {
    minWidth: 0,
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
    overflowWrap: "anywhere",
    fontSize: 12,
    lineHeight: 1.35,
    color: "var(--text-secondary)",
  },
  sidebarHeaderNow: {
    minWidth: 0,
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
    overflowWrap: "anywhere",
    fontSize: 13,
    lineHeight: 1.35,
    color: "var(--text-primary)",
    fontWeight: 500,
  },
  // "Task not captured" is the ABSENCE of information. Painting it warning-orange
  // gave the emptiest cards the loudest voice; it recedes instead.
  sidebarHeaderWarning: {
    color: "var(--text-tertiary)",
    fontWeight: 400,
    fontStyle: "italic",
  },
  agentLanePanel: {
    display: "grid",
    gap: 8,
    margin: "0 0 8px",
    padding: "9px 10px",
    border: "1px solid var(--border-subtle)",
    borderRadius: "var(--radius-sm)",
    background: "color-mix(in srgb, var(--surface-raised) 78%, transparent)",
  },
  agentLaneHeader: {
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
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
  utilityPanel: {
    display: "grid",
    gap: 6,
    margin: "0 0 6px",
    padding: "7px 8px",
    border: "1px solid var(--border-subtle)",
    borderRadius: "var(--radius-sm)",
    background: "color-mix(in srgb, var(--surface-base) 82%, transparent)",
  },
  compactUtilityHeader: {
    minWidth: 0,
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto auto",
    gap: 8,
    alignItems: "center",
    color: "var(--text-primary)",
    fontSize: 11,
    fontWeight: 500,
  },
  compactUtilityMeta: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: "var(--text-secondary)",
    fontSize: 10,
  },
  compactToggle: {
    height: 20,
    minWidth: 34,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "0 7px",
    border: "1px solid transparent",
    borderRadius: "var(--radius-xs)",
    background: "var(--surface-raised)",
    color: "var(--text-secondary)",
    fontFamily: "var(--font-ui)",
    fontSize: 10,
    fontWeight: 500,
    cursor: "pointer",
  },
  servicePanel: {
    display: "grid",
    gap: 6,
    margin: "0 0 6px",
    padding: "7px 8px",
    border: "1px solid var(--border-subtle)",
    borderRadius: "var(--radius-sm)",
    background: "color-mix(in srgb, var(--surface-base) 82%, transparent)",
  },
  serviceRow: {
    minWidth: 0,
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    gap: 6,
    alignItems: "center",
    padding: "5px 6px",
    border: "1px solid transparent",
    borderRadius: "var(--radius-xs)",
    background: "var(--surface-raised)",
    color: "var(--text-primary)",
    textAlign: "left",
    cursor: "pointer",
  },
  serviceTitleRow: {
    minWidth: 0,
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    gap: 8,
    alignItems: "center",
  },
  serviceHost: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: "var(--text-primary)",
    fontSize: 11,
    fontWeight: 500,
  },
  servicePort: {
    height: 17,
    display: "inline-flex",
    alignItems: "center",
    padding: "0 6px",
    borderRadius: "var(--radius-xs)",
    background: "var(--surface-base)",
    color: "var(--text-secondary)",
    fontSize: 10,
    fontVariantNumeric: "tabular-nums",
  },
  serviceActions: {
    display: "inline-flex",
    alignItems: "center",
    gap: 3,
    justifySelf: "end",
  },
  serviceActionButton: {
    width: 24,
    height: 24,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    border: "1px solid transparent",
    borderRadius: "var(--radius-xs)",
    background: "var(--surface-base)",
    color: "var(--text-secondary)",
    fontFamily: "var(--font-ui)",
    fontSize: 10,
    fontWeight: 500,
    cursor: "pointer",
  },
  serviceActionStatus: {
    minHeight: 14,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: "var(--text-secondary)",
    fontSize: 10,
  },
  serviceMetaLine: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: "var(--text-secondary)",
    fontSize: 10,
  },
  agentLaneItem: {
    minWidth: 0,
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    gap: 8,
    alignItems: "center",
    padding: "5px 6px",
    border: "1px solid transparent",
    borderRadius: "var(--radius-xs)",
    background: "transparent",
    color: "var(--text-primary)",
    textAlign: "left",
    cursor: "pointer",
  },
  agentRunItem: {
    minWidth: 0,
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr)",
    gap: 2,
    alignItems: "center",
    padding: "6px 7px",
    border: "1px solid transparent",
    borderRadius: "var(--radius-xs)",
    background: "transparent",
    color: "var(--text-primary)",
    textAlign: "left",
    cursor: "pointer",
  },
  agentRunTitle: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: "var(--text-primary)",
    fontSize: 12,
    fontWeight: 500,
  },
  agentRunMeta: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: "var(--text-secondary)",
    fontSize: 11,
    fontWeight: 400,
  },
  agentLaneIconButton: {
    width: 24,
    height: 24,
    display: "inline-grid",
    placeItems: "center",
    border: "1px solid transparent",
    borderRadius: "var(--radius-xs)",
    background: "var(--surface-base)",
    color: "var(--text-secondary)",
    cursor: "pointer",
  },
  taskInlineBadge: {
    minWidth: 0,
    maxWidth: 156,
    height: 18,
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    marginTop: 5,
    padding: "0 6px",
    border: "1px solid var(--border-subtle)",
    borderRadius: "var(--radius-xs)",
    background: "var(--surface-raised)",
    color: "var(--text-secondary)",
    fontSize: 10,
  },
  taskDot: {
    width: 6,
    height: 6,
    borderRadius: 999,
    flexShrink: 0,
  },
  rowActions: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    opacity: 0,
    transform: "translateX(2px)",
    pointerEvents: "none",
    transition: "opacity var(--motion-fast), transform var(--motion-fast)",
  },
  rowActionButton: {
    width: 25,
    height: 24,
    border: "1px solid transparent",
    borderRadius: "var(--radius-sm)",
    background: "var(--surface-base)",
    color: "var(--text-secondary)",
    display: "grid",
    placeItems: "center",
    cursor: "pointer",
    transition: "background var(--motion-fast), border-color var(--motion-fast), color var(--motion-fast)",
  },
  headerNewTerminalButton: {
    width: 30,
    height: 28,
    border: "1px solid transparent",
    borderRadius: "var(--radius-sm)",
    background: "rgba(255, 255, 255, 0.06)",
    color: "var(--accent-live)",
    display: "grid",
    placeItems: "center",
    cursor: "pointer",
    boxShadow: "inset 0 0 0 1px rgba(217, 154, 69, 0.08)",
    transition: "background var(--motion-fast), border-color var(--motion-fast), transform var(--motion-fast)",
  },
  footer: {
    padding: 8,
    borderTop: "1px solid var(--border-subtle)",
  },
  primaryButton: {
    width: "100%",
    height: 42,
    border: "1px solid transparent",
    borderRadius: "var(--radius-sm)",
    background: "rgba(255, 255, 255, 0.06)",
    color: "var(--text-primary)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    fontFamily: "var(--font-ui)",
    fontSize: 13,
    fontWeight: 500,
    cursor: "pointer",
    transition: "background var(--motion-fast), border-color var(--motion-fast), color var(--motion-fast)",
  },
  empty: {
    color: "var(--text-secondary)",
    fontSize: 12,
    lineHeight: 1.45,
    padding: "8px 2px",
  },
  contextMenu: {
    position: "fixed",
    zIndex: 1000,
    width: 236,
    padding: 8,
    border: "1px solid transparent",
    borderRadius: "var(--radius-md)",
    background: "var(--surface-raised)",
    boxShadow: "var(--shadow-menu)",
    animation: "workbench-popover-in var(--motion-med)",
  },
  contextHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    minHeight: 26,
    marginBottom: 6,
    color: "var(--text-primary)",
    fontSize: 12,
    fontWeight: 500,
  },
  projectMenuEmoji: {
    width: 22,
    height: 22,
    display: "grid",
    placeItems: "center",
    borderRadius: 6,
    background: "var(--surface-base)",
    fontSize: 14,
    lineHeight: 1,
  },
  contextRow: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    marginTop: 9,
    color: "var(--text-secondary)",
    fontSize: 11,
    fontWeight: 500,
  },
  contextInput: {
    width: "100%",
    height: 28,
    marginTop: 5,
    border: "1px solid transparent",
    borderRadius: 4,
    background: "var(--surface-sunken)",
    color: "var(--text-primary)",
    fontFamily: "var(--font-ui)",
    fontSize: 13,
    padding: "0 8px",
    outline: "none",
    transition: "border-color var(--motion-fast), box-shadow var(--motion-fast)",
  },
  launcher: {
    margin: 8,
    padding: 8,
    border: "1px solid transparent",
    borderRadius: "var(--radius-sm)",
    background: "linear-gradient(180deg, var(--surface-wash), var(--surface-base))",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.025)",
    animation: "workbench-surface-in var(--motion-med)",
  },
  launcherHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 4,
  },
  launcherTitle: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    minWidth: 0,
    color: "var(--text-primary)",
    fontSize: 12,
    fontWeight: 500,
  },
  launcherHint: {
    color: "var(--text-secondary)",
    fontSize: 10,
    whiteSpace: "nowrap",
  },
  launcherLabel: {
    display: "block",
    marginTop: 8,
    marginBottom: 4,
    color: "var(--text-secondary)",
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 0,
  },
  launcherActions: {
    display: "flex",
    gap: 6,
    marginTop: 9,
  },
  secondaryButton: {
    flex: 1,
    height: 30,
    border: "1px solid transparent",
    borderRadius: 4,
    background: "var(--surface-base)",
    color: "var(--text-secondary)",
    fontFamily: "var(--font-ui)",
    fontSize: 13,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  colorGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(6, 1fr)",
    gap: 6,
    marginTop: 6,
  },
  colorSwatch: {
    width: "100%",
    height: 22,
    borderRadius: 4,
    border: "1px solid transparent",
    cursor: "pointer",
    transition: "border-color var(--motion-fast), transform var(--motion-fast), box-shadow var(--motion-fast)",
  },
  emojiGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(8, 1fr)",
    gap: 4,
    marginTop: 6,
  },
  emojiButton: {
    width: 22,
    height: 22,
    display: "grid",
    placeItems: "center",
    border: "1px solid transparent",
    borderRadius: 4,
    background: "var(--surface-base)",
    cursor: "pointer",
    fontSize: 13,
    transition: "background var(--motion-fast), border-color var(--motion-fast), transform var(--motion-fast)",
  },
};

function nodeIcon(node: CanvasNode) {
  if (node.type === "terminal") return <TerminalWindow size={13} weight="duotone" />;
  if (node.type === "preview") return <Browser size={13} weight="duotone" />;
  if (node.type === "file") return <FileText size={13} />;
  return <Note size={13} />;
}

function localServiceStatusText(service: LocalServiceSummary) {
  if (service.status === "live") return "live";
  if (service.status === "failed") return "failed";
  if (service.status === "waiting") return "waiting";
  if (service.status === "stopped") return "stopped";
  return "unknown";
}

function localServiceHostText(service: LocalServiceSummary) {
  try {
    return new URL(service.url).hostname;
  } catch {
    return service.url.replace(/^https?:\/\//, "").replace(/:\d+$/, "");
  }
}

function PanelButton({ panel }: { panel: OperationsPanel }) {
  const ui = useWorkspaceStore((state) => state.workspaceUiState);
  const updateUi = useWorkspaceStore((state) => state.updateWorkspaceUiState);
  const setWorkspaceMode = useWorkspaceStore((state) => state.setWorkspaceMode);
  const active = ui.primarySidebarPanel === panel && !ui.primarySidebarCollapsed;
  const Icon = panelIcons[panel];
  const title = panelTitles[panel];
  const label = panel === "sessions" ? "Sessions" : "Map";

  return (
    <button
      className="workspace-rail-button"
      data-active={active ? "true" : "false"}
      style={{
        ...styles.railButton,
        background: active ? "var(--surface-selected)" : "transparent",
        borderColor: active ? "var(--border-focus)" : "var(--border-subtle)",
        color: active ? "var(--accent-live)" : "var(--text-secondary)",
      }}
      title={title}
      aria-label={label}
      aria-pressed={active}
      onClick={() => {
        if (panel === "map") setWorkspaceMode("canvas");
        if (panel === "sessions") setWorkspaceMode("split");
        updateUi({
          primarySidebarCollapsed: false,
          primarySidebarPanel: panel,
        });
      }}
    >
      <Icon size={15} weight="duotone" />
    </button>
  );
}

function FileTreeButton() {
  const ui = useWorkspaceStore((state) => state.workspaceUiState);
  const updateUi = useWorkspaceStore((state) => state.updateWorkspaceUiState);
  const active = !ui.fileExplorerCollapsed;

  return (
    <button
      className="workspace-rail-button"
      data-active={active ? "true" : "false"}
      style={{
        ...styles.railButton,
        background: active ? "var(--surface-selected)" : "transparent",
        borderColor: active ? "var(--border-focus)" : "var(--border-subtle)",
        color: active ? "var(--accent-live)" : "var(--text-secondary)",
      }}
      title={active ? "Hide files panel" : "Show files panel"}
      aria-label="Files"
      aria-pressed={active}
      onClick={() => updateUi({ fileExplorerCollapsed: !ui.fileExplorerCollapsed })}
    >
      <FolderOpen size={15} weight="duotone" />
    </button>
  );
}

function PreviewButton() {
  const activeTabId = useWorkspaceStore((state) => state.activeTabId);
  const activeTab = useWorkspaceStore((state) => state.tabs.find((tab) => tab.id === activeTabId));
  const workspaceMode = useWorkspaceStore((state) => state.workspaceUiState.workspaceMode);
  const mapPreviewActive = useWorkspaceStore((state) => state.canvasState.nodes.some((node) =>
    node.type === "preview" && node.terminalTabId === activeTabId
  ));
  const active = workspaceMode === "canvas"
    ? mapPreviewActive
    : activeTab ? JSON.stringify(activeTab.splitLayout).includes('"type":"preview"') : false;
  const activePanePreviewUrl = activeTab?.terminals.find((terminal) => terminal.paneId === activeTab.activePaneId)?.previewUrl;
  const hasPreviewUrl = Boolean(activePanePreviewUrl ?? activeTab?.terminals.find((terminal) => terminal.previewUrl)?.previewUrl);

  return (
    <button
      className="workspace-rail-button"
      data-active={active ? "true" : "false"}
      style={{
        ...styles.railButton,
        background: active ? "var(--surface-selected)" : "transparent",
        borderColor: active ? "var(--border-focus)" : hasPreviewUrl ? "var(--border-subtle)" : "transparent",
        color: active ? "var(--accent-live)" : "var(--text-secondary)",
        cursor: hasPreviewUrl ? "pointer" : "not-allowed",
        opacity: hasPreviewUrl ? 1 : 0.44,
      }}
      title={hasPreviewUrl
        ? workspaceMode === "canvas" ? "Open preview on map for active terminal" : "Open preview pane for active terminal"
        : "Preview unavailable until the active terminal prints a localhost URL"}
      aria-label="Preview"
      aria-pressed={active}
      onClick={() => splitActivePreviewPane()}
      disabled={!hasPreviewUrl}
    >
      <Browser size={15} weight="duotone" />
    </button>
  );
}

function SidebarRail({ collapsed }: { collapsed: boolean }) {
  const updateUi = useWorkspaceStore((state) => state.updateWorkspaceUiState);

  return (
    <nav
      style={{
        ...styles.rail,
        borderRight: collapsed ? "none" : styles.rail.borderRight,
      }}
      aria-label="Operations rail"
    >
      <FileTreeButton />
      <div style={styles.railSeparator} aria-hidden="true" />
      <PanelButton panel="sessions" />
      <PanelButton panel="map" />
      <PreviewButton />
      <div style={styles.railSpacer} aria-hidden="true" />
      <button
        className="workspace-rail-button"
        style={styles.railButton}
        title={collapsed ? "Open sidebar" : "Collapse sidebar"}
        aria-label={collapsed ? "Open sidebar" : "Collapse sidebar"}
        onClick={() => updateUi({ primarySidebarCollapsed: !collapsed })}
      >
        {collapsed ? (
          <CaretDoubleRight size={15} weight="bold" />
        ) : (
          <CaretDoubleLeft size={15} weight="bold" />
        )}
      </button>
    </nav>
  );
}

function TerminalAvatar({ tab, active }: { tab: Tab; active: boolean }) {
  const hasEmoji = tab.emoji && tab.emoji !== "⬛";

  return (
    <span
      style={{
        ...styles.iconCell,
        color: active ? "var(--accent-live)" : "var(--text-primary)",
        border: `1px solid ${tab.color ?? "var(--border-subtle)"}`,
      }}
    >
      {hasEmoji ? tab.emoji : <TerminalWindow size={13} weight="duotone" />}
    </span>
  );
}

function TerminalContextMenu({
  tab,
  x,
  y,
  onClose,
}: {
  tab: Tab;
  x: number;
  y: number;
  onClose: () => void;
}) {
  const updateTab = useWorkspaceStore((state) => state.updateTab);
  const [title, setTitle] = useState(tab.title);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    }

    document.addEventListener("mousedown", onPointerDown, true);
    return () => document.removeEventListener("mousedown", onPointerDown, true);
  }, [onClose]);

  const commitTitle = () => {
    const trimmed = title.trim();
    if (trimmed && trimmed !== tab.title) updateTab(tab.id, { title: trimmed });
  };

  return (
    <div
      ref={ref}
      className="workspace-terminal-settings-menu"
      style={{
        ...styles.contextMenu,
        left: Math.min(x, window.innerWidth - 240),
        top: Math.min(y, window.innerHeight - 260),
      }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div style={styles.contextHeader}>
        <TerminalWindow size={14} weight="duotone" />
        <span style={{ minWidth: 0, display: "grid", gap: 1 }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            Terminal settings
          </span>
          <span style={{ color: "var(--text-secondary)", fontSize: 10, fontWeight: 400 }}>
            Rename, color, and session glyph
          </span>
        </span>
      </div>

      <label>
        <div style={styles.contextRow}>
          <TextT size={13} />
          <span>Rename</span>
        </div>
        <input
          className="workspace-terminal-settings-input"
          style={styles.contextInput}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={commitTitle}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              commitTitle();
              onClose();
            }
            if (event.key === "Escape") onClose();
          }}
        />
      </label>

      <div style={styles.contextRow}>
        <Palette size={13} />
        <span>Color</span>
      </div>
      <div style={styles.colorGrid}>
        {TERMINAL_COLORS.map((color) => (
          <button
            key={color}
            className="workspace-terminal-color-swatch"
            data-selected={tab.color === color ? "true" : "false"}
            style={{
              ...styles.colorSwatch,
              background: color,
              outline: "none",
              boxShadow: tab.color === color ? "inset 0 0 0 2px var(--text-primary)" : "none",
            }}
            title={color}
            aria-label={`Set terminal color ${color}`}
            onClick={() => updateTab(tab.id, { color })}
          />
        ))}
      </div>

      <div style={styles.contextRow}>
        <Smiley size={13} />
        <span>Emoji</span>
      </div>
      <div style={{ ...styles.emojiGrid, position: "relative" }}>
        {TERMINAL_EMOJIS.map((emoji) => (
          <button
            key={emoji}
            className="workspace-terminal-emoji-button"
            data-selected={tab.emoji === emoji ? "true" : "false"}
            style={{
              ...styles.emojiButton,
              borderColor: tab.emoji === emoji ? "var(--border-focus)" : "var(--border-subtle)",
              background: tab.emoji === emoji ? "var(--surface-selected)" : "var(--surface-base)",
              color: tab.emoji === emoji ? "var(--accent-live)" : "var(--text-primary)",
              outline: "none",
            }}
            title={emoji}
            aria-label={`Set terminal emoji ${emoji}`}
            onClick={() => updateTab(tab.id, { emoji })}
          >
            {emoji}
          </button>
        ))}
        {/* Quick emojis stay inline; this opens the full searchable picker. */}
        <button
          type="button"
          className="workspace-terminal-emoji-button"
          aria-label="Open full emoji picker"
          title="More emoji…"
          style={{ ...styles.emojiButton, borderColor: "var(--border-subtle)", outline: "none" }}
          onClick={() => setShowEmojiPicker((open) => !open)}
        >
          <Smiley size={14} weight="duotone" />
        </button>
        {showEmojiPicker && (
          <div style={{ position: "absolute", top: "100%", left: 0, marginTop: 4 }}>
            <EmojiPicker
              selected={tab.emoji}
              onSelect={(picked) => updateTab(tab.id, { emoji: picked })}
              onClose={() => setShowEmojiPicker(false)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function ProjectContextMenu({
  id,
  name,
  emoji,
  x,
  y,
  onClose,
}: {
  id: string;
  name: string;
  emoji?: string;
  x: number;
  y: number;
  onClose: () => void;
}) {
  const updateGroup = useWorkspaceStore((state) => state.updateGroup);
  const removeGroup = useWorkspaceStore((state) => state.removeGroup);
  const pinnedProjects = useWorkspaceStore((state) => state.pinnedProjects);
  const pinProject = useWorkspaceStore((state) => state.pinProject);
  const unpinProject = useWorkspaceStore((state) => state.unpinProject);
  const currentGroup = useWorkspaceStore((state) => state.groups.find((group) => group.id === id));
  const [value, setValue] = useState(name);
  const ref = useRef<HTMLDivElement>(null);
  const selectedEmoji = currentGroup?.emoji ?? emoji;
  const projectRoot = currentGroup?.projectRoot;
  const pinned = Boolean(projectRoot && pinnedProjects.includes(projectRoot));

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    }
    document.addEventListener("mousedown", onPointerDown, true);
    return () => document.removeEventListener("mousedown", onPointerDown, true);
  }, [onClose]);

  useEffect(() => {
    const input = ref.current?.querySelector("input");
    input?.focus();
    input?.select();
  }, []);

  const commit = () => {
    const trimmed = value.trim();
    if (trimmed && trimmed !== name) updateGroup(id, { name: trimmed });
  };

  return (
    <div
      ref={ref}
      className="workspace-terminal-settings-menu"
      style={{
        ...styles.contextMenu,
        left: Math.min(x, window.innerWidth - 252),
        top: Math.min(y, window.innerHeight - 322),
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div style={styles.contextHeader}>
        <span style={styles.projectMenuEmoji} aria-hidden="true">{selectedEmoji ?? "💻"}</span>
        <span style={{ minWidth: 0, display: "grid", gap: 1 }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Project</span>
          <span style={{ color: "var(--text-secondary)", fontSize: 10, fontWeight: 400 }}>Rename or set project emoji</span>
        </span>
      </div>

      <label>
        <div style={styles.contextRow}>
          <TextT size={13} />
          <span>Rename</span>
        </div>
        <input
          className="workspace-terminal-settings-input"
          style={styles.contextInput}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              commit();
              onClose();
            }
            if (event.key === "Escape") onClose();
          }}
        />
      </label>

      <div style={styles.contextRow}>
        <Smiley size={13} />
        <span>Project emoji</span>
      </div>
      <div data-testid="project-emoji-picker">
        <EmojiPicker
          embedded
          selected={selectedEmoji}
          onSelect={(picked) => updateGroup(id, { emoji: picked, emojiSource: "user" })}
        />
      </div>

      {projectRoot && (
        <button
          type="button"
          className="workspace-explorer-context-item"
          style={{
            width: "100%",
            marginTop: 6,
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px",
            border: "none",
            borderRadius: "var(--radius-sm)",
            background: "transparent",
            color: "var(--text-primary)",
            cursor: "pointer",
            fontFamily: "var(--font-ui)",
            fontSize: 13,
            textAlign: "left",
          }}
          onClick={() => {
            if (pinned) unpinProject(projectRoot);
            else pinProject(projectRoot);
            onClose();
          }}
        >
          <PushPin size={13} weight={pinned ? "fill" : "regular"} />
          <span>{pinned ? "Unpin project" : "Pin project"}</span>
        </button>
      )}

      <button
        type="button"
        className="workspace-explorer-context-item workspace-explorer-context-item--danger"
        style={{
          width: "100%",
          marginTop: 6,
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 8px",
          border: "none",
          borderRadius: "var(--radius-sm)",
          background: "transparent",
          color: "var(--accent-danger)",
          cursor: "pointer",
          fontFamily: "var(--font-ui)",
          fontSize: 13,
          textAlign: "left",
        }}
        onClick={() => {
          removeGroup(id);
          onClose();
        }}
      >
        <Trash size={13} />
        <span>Remove project</span>
      </button>
    </div>
  );
}

function NewTerminalLaunchMenu({
  x,
  y,
  onClose,
  onProjectLauncher,
  onAgentWorkstream,
}: {
  x: number;
  y: number;
  onClose: () => void;
  onProjectLauncher: () => void;
  onAgentWorkstream: () => void;
}) {
  const activeTabId = useWorkspaceStore((state) => state.activeTabId);
  const activeTab = useWorkspaceStore((state) => state.tabs.find((tab) => tab.id === activeTabId));
  const setWorkspaceMode = useWorkspaceStore((state) => state.setWorkspaceMode);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    }

    document.addEventListener("mousedown", onPointerDown, true);
    return () => document.removeEventListener("mousedown", onPointerDown, true);
  }, [onClose]);

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>(".workspace-launch-config-item")?.focus();
  }, []);

  function MenuItem({
    label,
    detail,
    icon,
    onClick,
  }: {
    label: string;
    detail: string;
    icon: ReactNode;
    onClick: () => void;
  }) {
    return (
      <button
        type="button"
        role="menuitem"
        className="workspace-launch-config-item"
        style={{
          width: "100%",
          minHeight: 42,
          display: "grid",
          gridTemplateColumns: "24px minmax(0, 1fr)",
          alignItems: "center",
          gap: 8,
          padding: "6px 7px",
          border: "1px solid transparent",
          borderRadius: "var(--radius-sm)",
          background: "transparent",
          color: "var(--text-primary)",
          cursor: "pointer",
          textAlign: "left",
        }}
        onClick={() => {
          onClick();
          onClose();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <span style={styles.iconCell}>{icon}</span>
        <span style={{ minWidth: 0, display: "grid", gap: 2 }}>
          <span style={{ ...styles.rowTitle, display: "block" }}>{label}</span>
          <span style={{ ...styles.rowMeta, display: "block", marginTop: 0 }}>{detail}</span>
        </span>
      </button>
    );
  }

  return (
    <div
      ref={ref}
      id="new-terminal-launch-menu"
      role="menu"
      aria-label="New terminal launch configurations"
      className="workspace-launch-config-menu"
      style={{
        ...styles.contextMenu,
        width: 286,
        left: Math.min(x, window.innerWidth - 292),
        top: Math.min(y, window.innerHeight - 214),
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div style={styles.contextHeader}>
        <Plus size={14} weight="bold" color="var(--accent-live)" />
        <span style={{ minWidth: 0, display: "grid", gap: 1 }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            New terminal
          </span>
          <span style={{ color: "var(--text-secondary)", fontSize: 10, fontWeight: 400 }}>
            Launch configurations
          </span>
        </span>
      </div>
      <MenuItem
        icon={<TerminalWindow size={13} weight="duotone" />}
        label="New terminal"
        detail="Inherit active session context"
        onClick={() => {
          createNewTab();
          setWorkspaceMode("split");
        }}
      />
      <MenuItem
        icon={<FolderOpen size={13} weight="duotone" />}
        label="Project shell"
        detail={activeTab?.initialCwd ? pathTail(activeTab.initialCwd) : "Fresh project terminal"}
        onClick={() => {
          createTerminalTab(activeTab?.initialCwd);
          setWorkspaceMode("split");
        }}
      />
      <MenuItem
        icon={<SquaresFour size={13} weight="duotone" />}
        label="Split workbench"
        detail="Open a side-by-side pane"
        onClick={() => {
          splitActivePane("horizontal");
          setWorkspaceMode("split");
        }}
      />
      <MenuItem
        icon={<Browser size={13} weight="duotone" />}
        label="Localhost preview"
        detail="Open beside the active terminal"
        onClick={() => {
          if (splitActivePreviewPane()) setWorkspaceMode("split");
        }}
      />
      <MenuItem
        icon={<Robot size={13} weight="duotone" />}
        label="Codex agent"
        detail="Track a supervised agent terminal"
        onClick={onAgentWorkstream}
      />
      <div style={{ borderTop: "1px solid var(--border-subtle)", margin: "6px 2px" }} />
      <MenuItem
        icon={<TreeStructure size={13} weight="duotone" />}
        label="Project launcher"
        detail="Create a named project session"
        onClick={onProjectLauncher}
      />
    </div>
  );
}

function ProjectRailRow({
  project,
  onSwitch,
  onContextMenu,
  onTogglePin,
}: {
  project: ProjectSidebarItem;
  onSwitch: () => void;
  onContextMenu: (event: React.MouseEvent) => void;
  onTogglePin: () => void;
}) {
  return (
    <div
      className="workspace-sidebar-row project-rail-row"
      data-testid="project-row"
      data-active={project.current ? "true" : "false"}
      style={styles.projectRailRow}
    >
      <button
        type="button"
        className="project-rail-main"
        style={styles.projectRow}
        title={`Switch to ${project.name}${project.projectRoot ? ` · ${project.projectRoot}` : ""}`}
        aria-label={`Switch to ${project.name}`}
        aria-current={project.current ? "page" : undefined}
        onClick={onSwitch}
        onContextMenu={onContextMenu}
      >
        <span style={styles.projectDot}>
          <span data-testid="project-row-emoji" aria-hidden="true">{project.emoji ?? "💻"}</span>
        </span>
        <span style={{ ...styles.rowTitle, color: project.current ? "var(--text-primary)" : "var(--text-secondary)" }}>
          {project.name}
        </span>
        {project.count > 0 && (
          <span style={{ ...styles.rowMeta, marginTop: 0 }} aria-hidden="true">{project.count}</span>
        )}
      </button>
      <span style={styles.projectRowTrailing}>
        <span
          className="workspace-sidebar-actions"
          style={{
            ...styles.rowActions,
            opacity: project.pinned ? 1 : 0,
            transform: "translateX(0)",
            pointerEvents: project.pinned ? "auto" : "none",
          }}
        >
          <button
            type="button"
            className="workspace-sidebar-action"
            data-testid="project-pin"
            style={{ ...styles.rowActionButton, width: 24, height: 24, background: "transparent" }}
            title={project.pinned ? `Unpin ${project.name}` : `Pin ${project.name}`}
            aria-label={project.pinned ? `Unpin ${project.name}` : `Pin ${project.name}`}
            aria-pressed={project.pinned}
            onClick={(event) => {
              event.stopPropagation();
              onTogglePin();
            }}
          >
            <PushPin size={12} weight={project.pinned ? "fill" : "regular"} />
          </button>
        </span>
      </span>
    </div>
  );
}

function SessionsPanel({
  onOpenTerminalMenu,
  onOpenProjectMenu,
}: {
  onOpenTerminalMenu: (event: React.MouseEvent, tab: Tab) => void;
  onOpenProjectMenu: (event: React.MouseEvent, project: { id: string; name: string; emoji?: string }) => void;
}) {
  const tabs = useWorkspaceStore((state) => state.tabs);
  const groups = useWorkspaceStore((state) => state.groups);
  const pinnedProjects = useWorkspaceStore((state) => state.pinnedProjects);
  const activeGroupFilter = useWorkspaceStore((state) => state.activeGroupFilter);
  const projectRoot = useWorkspaceStore((state) => state.projectRoot);
  const liveCwds = useWorkspaceStore((state) => state.liveCwds);
  const liveGitRoots = useWorkspaceStore((state) => state.liveGitRoots);
  const activeTabId = useWorkspaceStore((state) => state.activeTabId);
  const canvasState = useWorkspaceStore((state) => state.canvasState);
  const addTab = useWorkspaceStore((state) => state.addTab);
  const addGroup = useWorkspaceStore((state) => state.addGroup);
  const switchProject = useWorkspaceStore((state) => state.switchProject);
  const setActiveTab = useWorkspaceStore((state) => state.setActiveTab);
  const setWorkspaceMode = useWorkspaceStore((state) => state.setWorkspaceMode);
  const selectCanvasNode = useWorkspaceStore((state) => state.selectCanvasNode);
  const updateCanvasViewport = useWorkspaceStore((state) => state.updateCanvasViewport);
  const addCanvasNode = useWorkspaceStore((state) => state.addCanvasNode);
  const closeTerminalSession = useWorkspaceStore((state) => state.closeTerminalSession);
  const pinProject = useWorkspaceStore((state) => state.pinProject);
  const unpinProject = useWorkspaceStore((state) => state.unpinProject);
  const updateWorkspaceUiState = useWorkspaceStore((state) => state.updateWorkspaceUiState);
  const expandedProjectSections = useWorkspaceStore((state) => state.workspaceUiState.projectSidebarExpandedSections);
  const [showLauncher, setShowLauncher] = useState(false);
  const [newTerminalMenu, setNewTerminalMenu] = useState<{ x: number; y: number } | null>(null);
  const [projectName, setProjectName] = useState("");
  const [projectPath, setProjectPath] = useState(projectRoot ?? "");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [projectBrowserOpen, setProjectBrowserOpen] = useState(false);
  const [projectSearchOpen, setProjectSearchOpen] = useState(false);
  const [projectQuery, setProjectQuery] = useState("");
  const visibleTabs =
    activeGroupFilter === null
      ? tabs
      : tabs.filter((tab) => tab.groupId === activeGroupFilter);
  const activeProjectName = projectNameFor(activeGroupFilter, groups);
  const activeProjectRoot =
    activeGroupFilter !== null
      ? groups.find((group) => group.id === activeGroupFilter)?.projectRoot ?? null
      : null;
  const hasProjects = groups.length > 0;
  const projectModel = useMemo(() => buildProjectSidebarModel({
    groups,
    tabs,
    activeGroupFilter,
    pinnedProjects,
    query: projectQuery,
  }), [activeGroupFilter, groups, pinnedProjects, projectQuery, tabs]);
  const agentLane = summarizeAgentLane(visibleTabs);
  const activeAgentWorkstreams = agentLane.workstreams.filter(({ workstream }) => isActiveAgentWorkstream(workstream));
  const restartableAgentWorkstreams = agentLane.workstreams.filter(({ workstream }) => isRestartableAgentWorkstream(workstream));
  const authRetryableAgentWorkstreams = agentLane.workstreams.filter(({ workstream }) => isAuthRetryableAgentWorkstream(workstream));
  const cleanupRequestableAgentWorkstreams = agentLane.workstreams.filter(({ workstream }) => isCleanupRequestableAgentWorkstream(workstream));
  const closeoutReadyReviewItems = agentLane.reviewItems.filter((item) => isReviewItemCloseoutReady(item));
  const proofRequestItems = agentLane.proofItems;
  const memoryRequestItems = agentLane.memoryRequestItems;
  const riskMitigationItems = agentLane.riskItems;
  const queueAgentLaneStatusSweep = () => {
    if (activeAgentWorkstreams.length === 0) return;
    const store = useWorkspaceStore.getState();
    for (const { tab, workstream } of activeAgentWorkstreams) {
      store.queueWorkstreamInput(tab.id, statusCheckPromptForWorkstream(workstream), {
        source: "mission-control",
        label: "Status sweep",
      });
    }
    focusTabOnMap(activeAgentWorkstreams[0].tab);
  };
  const interruptActiveAgentFleet = () => {
    if (activeAgentWorkstreams.length === 0) return;
    const store = useWorkspaceStore.getState();
    void Promise.all(activeAgentWorkstreams.map(({ tab }) => store.interruptWorkstream(tab.id)));
    focusTabOnMap(activeAgentWorkstreams[0].tab);
  };
  const restartRecoveryAgentFleet = () => {
    if (restartableAgentWorkstreams.length === 0) return;
    const store = useWorkspaceStore.getState();
    void Promise.all(restartableAgentWorkstreams.map(({ tab }) => store.restartWorkstream(tab.id, {
      source: "mission-control",
      label: "Restart recovery",
    })));
    focusTabOnMap(restartableAgentWorkstreams[0].tab);
  };
  const retryAuthAgentFleet = () => {
    if (authRetryableAgentWorkstreams.length === 0) return;
    const store = useWorkspaceStore.getState();
    void Promise.all(authRetryableAgentWorkstreams.map(({ tab }) => store.restartWorkstream(tab.id, {
      source: "mission-control",
      label: "Retry auth",
    })));
    focusTabOnMap(authRetryableAgentWorkstreams[0].tab);
  };
  const requestCleanupFromAgentFleet = () => {
    if (cleanupRequestableAgentWorkstreams.length === 0) return;
    const store = useWorkspaceStore.getState();
    for (const { tab } of cleanupRequestableAgentWorkstreams) {
      store.requestWorktreeCleanup(tab.id, {
        source: "mission-control",
        label: "Request cleanup",
      });
    }
    focusTabOnMap(cleanupRequestableAgentWorkstreams[0].tab);
  };
  const reviewReadyAgentCloseouts = () => {
    if (closeoutReadyReviewItems.length === 0) return;
    const store = useWorkspaceStore.getState();
    for (const item of closeoutReadyReviewItems) {
      store.reviewWorkstream(item.tabId, {
        source: "mission-control",
        label: "Review",
      });
    }
    const firstTab = visibleTabs.find((tab) => tab.id === closeoutReadyReviewItems[0].tabId);
    if (firstTab) focusTabOnMap(firstTab);
  };
  const requestProofFromAgentFleet = () => {
    const targets = proofRequestItems
      .map((item) => visibleTabs.find((tab) => tab.id === item.tabId))
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
    focusTabOnMap(targets[0]);
  };
  const requestMemoryFromAgentFleet = () => {
    const targets = memoryRequestItems
      .map((item) => visibleTabs.find((tab) => tab.id === item.tabId))
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
    focusTabOnMap(targets[0]);
  };
  const requestRiskMitigationFromAgentFleet = () => {
    const targets = riskMitigationItems
      .map((item) => ({ item, tab: visibleTabs.find((tab) => tab.id === item.tabId) }))
      .filter((target): target is { item: typeof riskMitigationItems[number]; tab: Tab } => Boolean(target.tab?.workstream));
    if (targets.length === 0) return;
    const store = useWorkspaceStore.getState();
    for (const { item, tab } of targets) {
      store.queueWorkstreamInput(tab.id, item.prompt, {
        source: "mission-control",
        label: "Mitigate risk",
      });
    }
    focusTabOnMap(targets[0].tab);
  };

  useEffect(() => {
    if (projectRoot) {
      setProjectPath(projectRoot);
      return;
    }
    if (!showLauncher) setProjectPath("");
  }, [projectRoot, showLauncher]);

  // Apply a folder chosen in the themed in-app picker to the launcher fields.
  const applyPickedPath = (selected: string) => {
    setProjectPath(selected);
    if (!projectName.trim()) {
      setProjectName(selected.split("/").filter(Boolean).pop() ?? selected);
    }
    setPickerOpen(false);
  };

  const openProjectLauncher = () => {
    setShowLauncher(true);
    setPickerOpen(true);
  };

  const createProjectSession = () => {
    const cwd = projectPath.trim();
    if (!cwd) {
      // Nothing chosen yet — open the picker instead of failing silently.
      setPickerOpen(true);
      return;
    }

    const name = projectName.trim() || cwd.split("/").filter(Boolean).pop() || "Project";
    const groupId = addGroup(name, undefined, cwd);
    addTab({
      title: name,
      emoji: "\u{1F4C1}",
      initialCwd: cwd,
      groupId,
    });
    switchProject(groupId);
    setWorkspaceMode("split");
    setShowLauncher(false);
    setProjectName("");
  };

  useEffect(() => {
    function openLauncherFromHeader() {
      setShowLauncher(true);
      setProjectPath(projectRoot ?? "");
      setWorkspaceMode("split");
    }
    window.addEventListener("terminal-workspace:open-project-launcher", openLauncherFromHeader);
    return () => window.removeEventListener("terminal-workspace:open-project-launcher", openLauncherFromHeader);
  }, [projectRoot, setWorkspaceMode]);

  const focusTabOnMap = (tab: Tab) => {
    const terminalNodeCount = canvasState.nodes.filter((candidate) => candidate.type === "terminal").length;
    const node =
      canvasState.nodes.find((candidate) => candidate.terminalTabId === tab.id) ?? {
        id: `terminal-map-${tab.id}`,
        type: "terminal" as const,
        title: tab.title,
        x: 120 + (terminalNodeCount % 3) * 700,
        y: 100 + Math.floor(terminalNodeCount / 3) * 430,
        width: 820,
        height: 460,
        terminalTabId: tab.id,
        terminalCwd: tab.initialCwd,
      };
    setActiveTab(tab.id);
    setWorkspaceMode("canvas");
    if (!canvasState.nodes.some((candidate) => candidate.id === node.id)) {
      addCanvasNode(node);
    }
    const zoom = 1;
    const nextX = 445 - (node.x + node.width / 2) * zoom;
    const nextY = 330 - (node.y + node.height / 2) * zoom;
    selectCanvasNode(node.id);
    updateCanvasViewport({
      zoom,
      x: Math.round(nextX),
      y: Math.round(nextY),
    });
  };

  const createAgentWorkstreamOnMap = async () => {
    const availability = await checkAgentProvider("codex");
    const mission = window.prompt(`Task for ${availability.label} agent`, "Supervised workstream");
    if (mission === null) return;
    const isolationMode = promptWorkstreamIsolation(availability.label);
    if (isolationMode === null) return;
    const launchProfile = promptWorkstreamLaunchProfile(availability.label);
    if (launchProfile === null) return;
    const createdAt = Date.now();
    const runId = createAgentWorkstreamRunId("codex", createdAt);
    const opsContext = await resolveWorkstreamOpsContext(currentAgentWorkstreamCwd(), isolationMode, runId, createdAt);
    createAgentWorkstream("codex", mission, availability, opsContext, launchProfile);
    requestAnimationFrame(() => {
      const nextTab = useWorkspaceStore.getState().getActiveTab();
      if (nextTab) focusTabOnMap(nextTab);
    });
  };

  const toggleProjectSection = (sectionId: string) => {
    const nextSections = expandedProjectSections.includes(sectionId)
      ? expandedProjectSections.filter((candidate) => candidate !== sectionId)
      : [...expandedProjectSections, sectionId];
    updateWorkspaceUiState({ projectSidebarExpandedSections: nextSections });
  };

  const renderProjectRow = (project: ProjectSidebarItem) => (
    <ProjectRailRow
      key={project.id}
      project={project}
      onSwitch={() => {
        switchProject(project.id);
        setProjectBrowserOpen(false);
        setProjectSearchOpen(false);
        setProjectQuery("");
      }}
      onContextMenu={(event) => onOpenProjectMenu(event, {
        id: project.id,
        name: project.name,
        emoji: project.emoji,
      })}
      onTogglePin={() => {
        if (!project.projectRoot) return;
        if (project.pinned) unpinProject(project.projectRoot);
        else pinProject(project.projectRoot);
      }}
    />
  );

  return (
    <>
      <div style={styles.header}>
        <div style={styles.title}>
          <TerminalWindow size={14} weight="duotone" />
          <span style={styles.titleStack}>
            <span style={styles.titleName}>{activeProjectName}</span>
            <span
              style={styles.titlePath}
              title={activeProjectRoot ?? (hasProjects ? undefined : "No project path set")}
              dir="auto"
            >
              {activeProjectRoot
                ? pathTail(activeProjectRoot, 3)
                : hasProjects
                  ? "all sessions"
                  : "no project set"}
            </span>
          </span>
        </div>
        <span style={styles.headerActions}>
          <span style={styles.countPill} title={`${visibleTabs.length} visible sessions`}>
            {visibleTabs.length}
          </span>
          <button
            className="workspace-header-create-button"
            data-menu-open={newTerminalMenu ? "true" : "false"}
            style={styles.headerNewTerminalButton}
            title="New terminal session (Ctrl+Shift+T). Right-click for launch configurations."
            aria-label="New terminal"
            aria-haspopup="menu"
            aria-expanded={newTerminalMenu ? "true" : "false"}
            aria-controls={newTerminalMenu ? "new-terminal-launch-menu" : undefined}
            onClick={() => {
              createNewTab();
              setWorkspaceMode("split");
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              setNewTerminalMenu({ x: event.clientX, y: event.clientY });
            }}
            onKeyDown={(event) => {
              const opensMenu =
                event.key === "ArrowDown" ||
                event.key === "ContextMenu" ||
                (event.shiftKey && event.key === "F10");
              if (!opensMenu) return;
              event.preventDefault();
              const rect = event.currentTarget.getBoundingClientRect();
              setNewTerminalMenu({ x: rect.left, y: rect.bottom + 4 });
            }}
          >
            <Plus size={13} weight="bold" />
          </button>
        </span>
      </div>
      {newTerminalMenu && (
        <NewTerminalLaunchMenu
          x={newTerminalMenu.x}
          y={newTerminalMenu.y}
          onClose={() => setNewTerminalMenu(null)}
          onProjectLauncher={() => {
            openProjectLauncher();
            setNewTerminalMenu(null);
          }}
          onAgentWorkstream={createAgentWorkstreamOnMap}
        />
      )}
      {showLauncher && (
        <div className="workspace-launcher" style={styles.launcher}>
          <div style={styles.launcherHeader}>
            <span style={styles.launcherTitle}>
              <TerminalWindow size={13} weight="duotone" color="var(--accent-live)" />
              Launch config
            </span>
            <span style={styles.launcherHint}>Enter to create</span>
          </div>
          <label>
            <span style={styles.launcherLabel}>Project name</span>
            <input
              className="workspace-launcher-input"
              style={styles.contextInput}
              value={projectName}
              placeholder="FlowState, Botson, Inner Dialogue..."
              onChange={(event) => setProjectName(event.target.value)}
            />
          </label>
          <label>
            <span style={styles.launcherLabel}>Project path</span>
            <input
              className="workspace-launcher-input"
              style={styles.contextInput}
              dir="auto"
              value={projectPath}
              placeholder="/media/.../project"
              onChange={(event) => setProjectPath(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") createProjectSession();
                if (event.key === "Escape") setShowLauncher(false);
              }}
            />
          </label>
          <div style={styles.launcherActions}>
            <button className="workspace-secondary-button" style={styles.secondaryButton} onClick={() => setPickerOpen(true)}>
              <FolderOpen size={14} />
              Browse
            </button>
            <button className="workspace-secondary-button" style={styles.secondaryButton} onClick={() => setShowLauncher(false)}>
              Cancel
            </button>
            <button className="workspace-primary-button" style={styles.primaryButton} onClick={createProjectSession}>
              <Plus size={14} />
              Create
            </button>
          </div>
        </div>
      )}
      <div style={styles.projectList} data-testid="project-rail">
        <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
          <button
            type="button"
            style={styles.projectBrowserToggle}
            aria-label="Projects"
            aria-expanded={projectBrowserOpen}
            onClick={() => {
              setProjectBrowserOpen((open) => !open);
              if (projectBrowserOpen) {
                setProjectSearchOpen(false);
                setProjectQuery("");
              }
            }}
          >
            {projectBrowserOpen ? <CaretDown size={12} /> : <CaretRight size={12} />}
            <span>Projects</span>
            <span style={styles.projectSectionCount}>{projectModel.total}</span>
          </button>
          <span style={styles.projectHeaderActions}>
            {projectBrowserOpen && hasProjects && (
              <button
              type="button"
              style={styles.projectHeaderButton}
              title={projectSearchOpen ? "Close project search" : "Search projects"}
              aria-label={projectSearchOpen ? "Close project search" : "Search projects"}
              aria-pressed={projectSearchOpen}
              onClick={() => {
                setProjectSearchOpen((open) => !open);
                if (projectSearchOpen) setProjectQuery("");
              }}
            >
              <MagnifyingGlass size={13} />
              </button>
            )}
            <button
              type="button"
              style={styles.projectHeaderButton}
              title="Open a project"
              aria-label="Project"
              onClick={openProjectLauncher}
            >
              <Plus size={13} weight="bold" />
            </button>
          </span>
        </div>
        {projectBrowserOpen && (
        <div style={styles.projectBrowserContent}>
        {projectSearchOpen && (
          <input
            autoFocus
            data-testid="project-search"
            style={styles.projectSearch}
            value={projectQuery}
            placeholder="Search projects"
            aria-label="Search projects"
            onChange={(event) => setProjectQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              setProjectQuery("");
              setProjectSearchOpen(false);
            }}
          />
        )}
        {!hasProjects ? (
          <div style={styles.onboard}>
            <span style={styles.onboardTitle}>No project open</span>
            <span style={styles.onboardText}>
              Open a folder to set your project path. New terminals will start there instead of your home directory.
            </span>
            <button className="workspace-primary-button" style={styles.primaryButton} onClick={openProjectLauncher}>
              <FolderOpen size={14} />
              Open a project
            </button>
          </div>
        ) : projectQuery.trim() ? (
          <div style={styles.projectGrid} aria-label="Project search results">
            <div style={styles.projectSectionLabel}>
              <span>Results</span>
              <span>{projectModel.searchResults.length}</span>
            </div>
            {projectModel.searchResults.length > 0
              ? projectModel.searchResults.map(renderProjectRow)
              : <span style={{ ...styles.onboardText, padding: "8px 6px 10px" }}>No matching projects</span>}
          </div>
        ) : (
          <div style={styles.projectGrid}>
            {projectModel.inUse.length > 0 && (
              <section aria-labelledby="project-section-in-use">
                <div id="project-section-in-use" style={styles.projectSectionLabel}>
                  <span>In use</span>
                  <span>{projectModel.inUse.length}</span>
                </div>
                <div style={styles.projectGrid}>{projectModel.inUse.map(renderProjectRow)}</div>
              </section>
            )}
            {projectModel.sections.map((section) => {
              const expanded = expandedProjectSections.includes(section.id);
              const contentId = `project-section-${section.id}`;
              return (
                <section key={section.id} style={styles.projectSection} data-testid={contentId}>
                  <button
                    type="button"
                    data-testid="project-section-toggle"
                    style={styles.projectSectionToggle}
                    aria-expanded={expanded}
                    aria-controls={contentId}
                    onClick={() => toggleProjectSection(section.id)}
                  >
                    {expanded ? <CaretDown size={12} /> : <CaretRight size={12} />}
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{section.label}</span>
                    <span style={styles.projectSectionCount}>{section.projects.length}</span>
                  </button>
                  {expanded && (
                    <div id={contentId} style={styles.projectGrid}>
                      {section.projects.map(renderProjectRow)}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
        </div>
        )}
      </div>
      <div style={styles.list}>
        <div style={styles.sectionLabel}>
          <span>Sessions</span>
          <span>{activeProjectName}</span>
        </div>
        {agentLane.total > 0 && (
          <div
            style={styles.agentLanePanel}
            data-testid="sidebar-agent-lane-summary"
            aria-label={agentLaneStatusText(agentLane)}
          >
            <div style={styles.agentLaneHeader}>
              <span>Agent runs</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <button
                  type="button"
                  style={styles.agentLaneIconButton}
                  data-testid="sidebar-agent-lane-status-sweep"
                  title={agentLaneStatusSweepTitle(agentLane)}
                  aria-label="Request active agent status sweep"
                  disabled={activeAgentWorkstreams.length === 0}
                  onClick={queueAgentLaneStatusSweep}
                >
                  <ArrowsClockwise size={13} weight="duotone" />
                </button>
                <span
                  data-testid="sidebar-agent-lane-status-sweep-plan"
                  title={agentLaneStatusSweepTitle(agentLane)}
                  style={{ ...styles.rowMeta, marginTop: 0 }}
                >
                  {agentLaneStatusSweepText(agentLane)}
                </span>
                <button
                  type="button"
                  style={styles.agentLaneIconButton}
                  data-testid="sidebar-agent-lane-interrupt-active"
                  title={agentLaneInterruptTitle(agentLane)}
                  aria-label="Interrupt active agent fleet"
                  disabled={activeAgentWorkstreams.length === 0}
                  onClick={interruptActiveAgentFleet}
                >
                  <Prohibit size={13} weight="duotone" />
                </button>
                <span
                  data-testid="sidebar-agent-lane-interrupt-plan"
                  title={agentLaneInterruptTitle(agentLane)}
                  style={{ ...styles.rowMeta, marginTop: 0 }}
                >
                  {agentLaneInterruptText(agentLane)}
                </span>
                <button
                  type="button"
                  style={styles.agentLaneIconButton}
                  data-testid="sidebar-agent-lane-restart-recovery"
                  title={agentLaneRestartTitle(agentLane)}
                  aria-label="Restart recovery agent fleet"
                  disabled={restartableAgentWorkstreams.length === 0}
                  onClick={restartRecoveryAgentFleet}
                >
                  <ArrowsClockwise size={13} weight="duotone" />
                </button>
                <button
                  type="button"
                  style={styles.agentLaneIconButton}
                  data-testid="sidebar-agent-lane-retry-auth"
                  title={agentLaneAuthRetryTitle(agentLane)}
                  aria-label="Retry auth-blocked agent fleet"
                  disabled={authRetryableAgentWorkstreams.length === 0}
                  onClick={retryAuthAgentFleet}
                >
                  <ArrowsClockwise size={13} weight="duotone" />
                </button>
                <button
                  type="button"
                  style={styles.agentLaneIconButton}
                  data-testid="sidebar-agent-lane-request-cleanup"
                  title={agentLaneCleanupRequestTitle(agentLane)}
                  aria-label="Request cleanup for cleanup-ready agent fleet"
                  disabled={cleanupRequestableAgentWorkstreams.length === 0}
                  onClick={requestCleanupFromAgentFleet}
                >
                  <Trash size={13} weight="duotone" />
                </button>
                <span
                  data-testid="sidebar-agent-lane-restart-plan"
                  title={agentLaneRestartTitle(agentLane)}
                  style={{ ...styles.rowMeta, marginTop: 0 }}
                >
                  {agentLaneRestartText(agentLane)}
                </span>
                <span
                  data-testid="sidebar-agent-lane-auth-retry-plan"
                  title={agentLaneAuthRetryTitle(agentLane)}
                  style={{ ...styles.rowMeta, marginTop: 0 }}
                >
                  {agentLaneAuthRetryText(agentLane)}
                </span>
                <span
                  data-testid="sidebar-agent-lane-cleanup-plan"
                  title={agentLaneCleanupRequestTitle(agentLane)}
                  style={{ ...styles.rowMeta, marginTop: 0 }}
                >
                  {agentLaneCleanupRequestText(agentLane)}
                </span>
                <button
                  type="button"
                  style={styles.agentLaneIconButton}
                  data-testid="sidebar-agent-lane-review-ready"
                  title={agentLaneCloseoutTitle(agentLane)}
                  aria-label="Review ready agent closeouts"
                  disabled={closeoutReadyReviewItems.length === 0}
                  onClick={reviewReadyAgentCloseouts}
                >
                  <CheckCircle size={13} weight="duotone" />
                </button>
                <span
                  data-testid="sidebar-agent-lane-closeout-plan"
                  title={agentLaneCloseoutTitle(agentLane)}
                  style={{ ...styles.rowMeta, marginTop: 0 }}
                >
                  {agentLaneCloseoutText(agentLane)}
                </span>
                <button
                  type="button"
                  style={styles.agentLaneIconButton}
                  data-testid="sidebar-agent-lane-request-proof"
                  title={agentLaneProofRequestTitle(agentLane)}
                  aria-label="Request proof from proof-needed agent fleet"
                  disabled={proofRequestItems.length === 0}
                  onClick={requestProofFromAgentFleet}
                >
                  <FileText size={13} weight="duotone" />
                </button>
                <button
                  type="button"
                  style={styles.agentLaneIconButton}
                  data-testid="sidebar-agent-lane-request-memory"
                  title={agentLaneMemoryRequestTitle(agentLane)}
                  aria-label="Request handoff memory from memory-needed agent fleet"
                  disabled={memoryRequestItems.length === 0}
                  onClick={requestMemoryFromAgentFleet}
                >
                  <Note size={13} weight="duotone" />
                </button>
                <button
                  type="button"
                  style={styles.agentLaneIconButton}
                  data-testid="sidebar-agent-lane-mitigate-risk"
                  title={agentLaneRiskMitigationTitle(agentLane)}
                  aria-label="Request risk mitigation from risky agent fleet"
                  disabled={riskMitigationItems.length === 0}
                  onClick={requestRiskMitigationFromAgentFleet}
                >
                  <Prohibit size={13} weight="duotone" />
                </button>
                <span
                  data-testid="sidebar-agent-lane-risk-plan"
                  title={agentLaneRiskMitigationTitle(agentLane)}
                  style={{ ...styles.rowMeta, marginTop: 0 }}
                >
                  {agentLaneRiskMitigationText(agentLane)}
                </span>
                <span
                  data-testid="sidebar-agent-lane-memory-plan"
                  title={agentLaneMemoryRequestTitle(agentLane)}
                  style={{ ...styles.rowMeta, marginTop: 0 }}
                >
                  {agentLaneMemoryRequestText(agentLane)}
                </span>
                <span
                  data-testid="sidebar-agent-lane-proof-plan"
                  title={agentLaneProofRequestTitle(agentLane)}
                  style={{ ...styles.rowMeta, marginTop: 0 }}
                >
                  {agentLaneProofRequestText(agentLane)}
                </span>
                <button
                  type="button"
                  style={styles.agentLaneIconButton}
                  data-testid="sidebar-agent-lane-copy-mission"
                  title="Copy mission control brief"
                  aria-label="Copy mission control brief"
                  onClick={() => {
                    if (navigator.clipboard?.writeText) {
                      void navigator.clipboard.writeText(formatAgentMissionControlBrief(agentLane));
                    }
                  }}
                >
                  <ClipboardText size={13} weight="duotone" />
                </button>
                <button
                  type="button"
                  style={styles.agentLaneIconButton}
                  data-testid="sidebar-agent-lane-copy-brief"
                  title="Copy agent supervision brief"
                  aria-label="Copy agent supervision brief"
                  onClick={() => {
                    if (navigator.clipboard?.writeText) {
                      void navigator.clipboard.writeText(formatAgentLaneBrief(agentLane));
                    }
                  }}
                >
                  <ClipboardText size={13} weight="duotone" />
                </button>
                <span>{agentLane.total}</span>
              </span>
            </div>
            <div style={styles.agentLaneStats}>
              <span style={styles.agentLaneChip} data-testid="sidebar-agent-lane-total">{agentLane.total} agents</span>
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
              data-testid="sidebar-agent-lane-headline"
              aria-label="Agent cockpit headline"
              title={agentLane.cockpitHeadline.detail}
            >
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {agentLane.cockpitHeadline.label}
              </span>
              <span style={{ ...styles.rowMeta, marginTop: 0 }}>
                {agentLane.cockpitHeadline.detail}
              </span>
            </div>
            <div
              style={styles.agentLaneItem}
              data-testid="sidebar-agent-lane-health"
              aria-label="Agent lane health"
              title={agentLaneHealthText(agentLane)}
            >
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                Health
              </span>
              <span style={{ ...styles.rowMeta, marginTop: 0 }}>
                {agentLaneHealthText(agentLane)}
              </span>
            </div>
            {agentLane.missionBreakdown.length > 0 && (
              <div
                style={styles.agentLaneItem}
                data-testid="sidebar-agent-lane-mission-breakdown"
                title={missionBreakdownText(agentLane)}
              >
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  Mission mix
                </span>
                <span style={{ ...styles.rowMeta, marginTop: 0 }}>
                  {missionBreakdownText(agentLane)}
                </span>
              </div>
            )}
            {agentLane.missionControlDispatchBreakdown.length > 0 && (
              <div
                style={styles.agentLaneItem}
                data-testid="sidebar-agent-lane-dispatch-breakdown"
                title={missionControlDispatchBreakdownText(agentLane)}
              >
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  Dispatch mix
                </span>
                <span style={{ ...styles.rowMeta, marginTop: 0 }}>
                  {missionControlDispatchBreakdownText(agentLane)}
                </span>
              </div>
            )}
            {agentLane.providerBreakdown.length > 0 && (
              <div
                style={styles.agentLaneItem}
                data-testid="sidebar-agent-lane-provider-breakdown"
                title={providerBreakdownText(agentLane)}
              >
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  Provider mix
                </span>
                <span style={{ ...styles.rowMeta, marginTop: 0 }}>
                  {providerBreakdownText(agentLane)}
                </span>
              </div>
            )}
            {agentLane.isolationBreakdown.length > 0 && (
              <div
                style={styles.agentLaneItem}
                data-testid="sidebar-agent-lane-isolation-breakdown"
                title={isolationBreakdownText(agentLane)}
              >
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  Isolation mix
                </span>
                <span style={{ ...styles.rowMeta, marginTop: 0 }}>
                  {isolationBreakdownText(agentLane)}
                </span>
              </div>
            )}
            {agentLane.cleanupBreakdown.length > 0 && (
              <div
                style={styles.agentLaneItem}
                data-testid="sidebar-agent-lane-cleanup-breakdown"
                title={cleanupBreakdownText(agentLane)}
              >
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  Cleanup mix
                </span>
                <span style={{ ...styles.rowMeta, marginTop: 0 }}>
                  {cleanupBreakdownText(agentLane)}
                </span>
              </div>
            )}
            {agentLane.readinessBreakdown.length > 0 && (
              <div
                style={styles.agentLaneItem}
                data-testid="sidebar-agent-lane-readiness-breakdown"
                title={readinessBreakdownText(agentLane)}
              >
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  Readiness mix
                </span>
                <span style={{ ...styles.rowMeta, marginTop: 0 }}>
                  {readinessBreakdownText(agentLane)}
                </span>
              </div>
            )}
            {agentLane.attentionBreakdown.length > 0 && (
              <div
                style={styles.agentLaneItem}
                data-testid="sidebar-agent-lane-attention-breakdown"
                title={attentionBreakdownText(agentLane)}
              >
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  Attention mix
                </span>
                <span style={{ ...styles.rowMeta, marginTop: 0 }}>
                  {attentionBreakdownText(agentLane)}
                </span>
              </div>
            )}
            {agentLane.riskBreakdown.length > 0 && (
              <div
                style={styles.agentLaneItem}
                data-testid="sidebar-agent-lane-risk-breakdown"
                title={riskBreakdownText(agentLane)}
              >
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  Risk mix
                </span>
                <span style={{ ...styles.rowMeta, marginTop: 0 }}>
                  {riskBreakdownText(agentLane)}
                </span>
              </div>
            )}
            {agentLane.closeoutBreakdown.length > 0 && (
              <div
                style={styles.agentLaneItem}
                data-testid="sidebar-agent-lane-closeout-breakdown"
                title={closeoutBreakdownText(agentLane)}
              >
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  Closeout mix
                </span>
                <span style={{ ...styles.rowMeta, marginTop: 0 }}>
                  {closeoutBreakdownText(agentLane)}
                </span>
              </div>
            )}
            {agentLane.supervisorItems.length > 0 && (
              <div style={styles.agentLaneList} aria-label="Agent mission control">
                {agentLane.supervisorItems.map((item) => (
                  <button
                    key={`${item.tabId}-${item.label}-${item.detail}`}
                    type="button"
                    style={styles.agentLaneItem}
                    data-testid="sidebar-agent-supervisor-item"
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
                      setWorkspaceMode("split");
                    }}
                  >
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.label}
                    </span>
                    <span style={{ ...styles.rowMeta, marginTop: 0 }}>
                      {item.title} · {item.runIdentity} · {item.workspaceIdentity} · Now: {item.activity} · Signal: {item.signalAge} · Source: {item.signalSource} · {item.detail}{missionControlAlternateText(item) ? ` · Also: ${missionControlAlternateText(item)}` : ""}
                    </span>
                  </button>
                ))}
                {agentLane.hiddenMissionItemCount > 0 && (
                  <div
                    style={styles.agentLaneItem}
                    data-testid="sidebar-agent-supervisor-overflow"
                    title={`${agentLane.hiddenMissionItemCount} mission rows and ${agentLane.hiddenMissionActionCount} actions hidden below the visible queue${agentLane.hiddenSupervisorItems[0] ? `: ${agentLane.hiddenSupervisorItems[0].title} · ${agentLane.hiddenSupervisorItems[0].label} · ${agentLane.hiddenSupervisorItems[0].detail}${missionControlAlternateText(agentLane.hiddenSupervisorItems[0]) ? ` · Also: ${missionControlAlternateText(agentLane.hiddenSupervisorItems[0])}` : ""}` : ""}`}
                  >
                    <span>+{agentLane.hiddenMissionItemCount} rows · {agentLane.hiddenMissionActionCount} actions</span>
                    <span style={{ ...styles.rowMeta, marginTop: 0 }}>
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
                style={styles.agentLaneItem}
                data-testid="sidebar-agent-lane-attention"
                title={`Open ${agentLane.primaryAttention.title}`}
                onClick={() => {
                  setActiveTab(agentLane.primaryAttention!.tabId);
                  setWorkspaceMode("split");
                }}
              >
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {agentLane.primaryAttention.label}
                </span>
                <span style={{ ...styles.rowMeta, marginTop: 0 }}>
                  {agentLane.primaryAttention.title} · {agentLane.primaryAttention.detail}
                </span>
              </button>
            )}
            {agentLane.attentionItems.length > 0 && (
              <div style={styles.agentLaneList} aria-label="Agent attention queue">
                {agentLane.attentionItems.slice(0, 3).map((item) => (
                  <button
                    key={item.tabId}
                    type="button"
                    style={styles.agentLaneItem}
                    data-testid="sidebar-agent-attention-item"
                    title={`Open ${item.title}`}
                    onClick={() => {
                      setActiveTab(item.tabId);
                      setWorkspaceMode("split");
                    }}
                  >
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.label}
                    </span>
                    <span style={{ ...styles.rowMeta, marginTop: 0 }}>
                      {item.title} · {item.detail}
                    </span>
                  </button>
                ))}
                {agentLane.attentionItems.length > 3 && (
                  <div style={styles.agentLaneOverflow} data-testid="sidebar-agent-attention-overflow">
                    +{agentLane.attentionItems.length - 3} more attention · {agentLane.attentionItems[3].label} · {agentLane.attentionItems[3].title} · {agentLane.attentionItems[3].detail}
                  </div>
                )}
              </div>
            )}
            <div style={styles.agentLaneList} aria-label="Agent workspace groups">
              {agentLane.workspaceGroups.slice(0, 3).map((group) => {
                const cleanupText = group.cleanupRequested > 0 ? ` · ${group.cleanupRequested} cleanup` : "";
                const attentionText = group.attention > 0 ? ` · ${group.attention} attention` : "";
                return (
                  <button
                    key={group.id}
                    type="button"
                    style={styles.agentLaneItem}
                    data-testid="sidebar-agent-workspace-group"
                    title={`Copy workspace group ${group.label}`}
                    onClick={() => {
                      if (!group.primaryTabId) return;
                      setActiveTab(group.primaryTabId);
                      if (navigator.clipboard?.writeText) {
                        void navigator.clipboard.writeText(group.brief);
                      }
                      setWorkspaceMode("split");
                    }}
                  >
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {group.label}
                    </span>
                    <span style={{ ...styles.rowMeta, marginTop: 0 }}>
                      {group.total} agents · {group.active} active · {group.detail}{cleanupText}{attentionText}
                    </span>
                  </button>
                );
              })}
              {agentLane.workspaceGroups.length > 3 && (
                <div style={styles.agentLaneOverflow} data-testid="sidebar-agent-workspace-group-overflow">
                  +{agentLane.workspaceGroups.length - 3} more groups · {agentLane.workspaceGroups[3].label} · {agentLane.workspaceGroups[3].total} agents · {agentLane.workspaceGroups[3].active} active · {agentLane.workspaceGroups[3].detail}
                </div>
              )}
            </div>
            {agentLane.recentEvents.length > 0 && (
              <div style={styles.agentLaneList} aria-label="Agent recent events">
                {agentLane.recentEvents.slice(0, 3).map((item) => (
                  <button
                    key={`${item.tabId}-${item.at}-${item.label}`}
                    type="button"
                    style={styles.agentLaneItem}
                    data-testid="sidebar-agent-recent-event"
                    title={`Copy event for ${item.title}`}
                    onClick={() => {
                      setActiveTab(item.tabId);
                      if (navigator.clipboard?.writeText) {
                        void navigator.clipboard.writeText(item.brief);
                      }
                      setWorkspaceMode("split");
                    }}
                  >
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      Copy event
                    </span>
                    <span style={{ ...styles.rowMeta, marginTop: 0 }}>
                      {item.title} · {item.label}{item.detail ? ` · ${item.detail}` : ""}
                    </span>
                  </button>
                ))}
                {agentLane.recentEvents.length > 3 && (
                  <div
                    style={styles.agentLaneItem}
                    data-testid="sidebar-agent-recent-event-overflow"
                    title={`${agentLane.recentEvents.length - 3} recent events hidden below the visible event list`}
                  >
                    <span>+{agentLane.recentEvents.length - 3} more events</span>
                    <span style={{ ...styles.rowMeta, marginTop: 0 }}>
                      {agentLane.recentEvents[3].title} · {agentLane.recentEvents[3].label}{agentLane.recentEvents[3].detail ? ` · ${agentLane.recentEvents[3].detail}` : ""}
                    </span>
                  </div>
                )}
              </div>
            )}
            {agentLane.inputItems.length > 0 && (
              <div style={styles.agentLaneList} aria-label="Agent operator prompts">
                {agentLane.inputItems.slice(0, 3).map((item) => (
                  <button
                    key={`${item.tabId}-${item.at}-${item.text}`}
                    type="button"
                    style={styles.agentLaneItem}
                    data-testid="sidebar-agent-input-item"
                    title={`Copy prompt for ${item.title}`}
                    onClick={() => {
                      setActiveTab(item.tabId);
                      if (navigator.clipboard?.writeText) {
                        void navigator.clipboard.writeText(item.brief);
                      }
                      setWorkspaceMode("split");
                    }}
                  >
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      Copy prompt
                    </span>
                    <span style={{ ...styles.rowMeta, marginTop: 0 }}>
                      {item.title} · {item.state} · {item.text}
                    </span>
                  </button>
                ))}
                {agentLane.inputItems.length > 3 && (
                  <div
                    style={styles.agentLaneItem}
                    data-testid="sidebar-agent-input-overflow"
                    title={`${agentLane.inputItems.length - 3} operator prompts hidden below the visible prompt list`}
                  >
                    <span>+{agentLane.inputItems.length - 3} more prompts</span>
                    <span style={{ ...styles.rowMeta, marginTop: 0 }}>
                      {agentLane.inputItems[3].title} · {agentLane.inputItems[3].state} · {agentLane.inputItems[3].text}
                    </span>
                  </div>
                )}
              </div>
            )}
            {agentLane.outputItems.length > 0 && (
              <div style={styles.agentLaneList} aria-label="Agent terminal output">
                {agentLane.outputItems.slice(0, 3).map((item) => (
                  <button
                    key={`${item.tabId}-${item.at}-${item.output}`}
                    type="button"
                    style={styles.agentLaneItem}
                    data-testid="sidebar-agent-output-item"
                    title={`Copy terminal output for ${item.title}`}
                    onClick={() => {
                      setActiveTab(item.tabId);
                      if (navigator.clipboard?.writeText) {
                        void navigator.clipboard.writeText(item.brief);
                      }
                      setWorkspaceMode("split");
                    }}
                  >
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      Copy output
                    </span>
                    <span style={{ ...styles.rowMeta, marginTop: 0 }}>
                      {item.title} · {item.output}
                    </span>
                  </button>
                ))}
                {agentLane.outputItems.length > 3 && (
                  <div
                    style={styles.agentLaneItem}
                    data-testid="sidebar-agent-output-overflow"
                    title={`${agentLane.outputItems.length - 3} terminal outputs hidden below the visible output list`}
                  >
                    <span>+{agentLane.outputItems.length - 3} more output</span>
                    <span style={{ ...styles.rowMeta, marginTop: 0 }}>
                      {agentLane.outputItems[3].title} · {agentLane.outputItems[3].output}
                    </span>
                  </div>
                )}
              </div>
            )}
            {agentLane.nextItems.length > 0 && (
              <div style={styles.agentLaneList} aria-label="Agent next actions">
                {agentLane.nextItems.slice(0, 3).map((item) => (
                  <button
                    key={`${item.tabId}-${item.at}-${item.nextAction}`}
                    type="button"
                    style={styles.agentLaneItem}
                    data-testid="sidebar-agent-next-item"
                    title={`Copy next action for ${item.title}`}
                    onClick={() => {
                      setActiveTab(item.tabId);
                      if (navigator.clipboard?.writeText) {
                        void navigator.clipboard.writeText(item.brief);
                      }
                      setWorkspaceMode("split");
                    }}
                  >
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      Copy next
                    </span>
                    <span style={{ ...styles.rowMeta, marginTop: 0 }}>
                      {item.title} · {item.nextAction}
                    </span>
                  </button>
                ))}
                {agentLane.nextItems.length > 3 && (
                  <div
                    style={styles.agentLaneItem}
                    data-testid="sidebar-agent-next-overflow"
                    title={`${agentLane.nextItems.length - 3} next actions hidden below the visible next-action list`}
                  >
                    <span>+{agentLane.nextItems.length - 3} more next</span>
                    <span style={{ ...styles.rowMeta, marginTop: 0 }}>
                      {agentLane.nextItems[3].title} · {agentLane.nextItems[3].nextAction}
                    </span>
                  </div>
                )}
              </div>
            )}
            {agentLane.extractedItems.length > 0 && (
              <div style={styles.agentLaneList} aria-label="Extracted cockpit objects">
                {agentLane.extractedItems.slice(0, 4).map((item) => (
                  <div
                    key={`${item.tabId}-${item.objectId}`}
                    style={{ ...styles.agentLaneItem, gridTemplateColumns: "minmax(0, 1fr) auto", cursor: "default" }}
                    data-testid="sidebar-agent-extracted-item"
                    data-review-state={item.reviewState}
                    title={`${item.label} ${item.reviewState} for ${item.title}`}
                  >
                    <span style={{ minWidth: 0 }}>
                      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>
                        {item.label} · {item.reviewState}
                      </span>
                      <span style={{ ...styles.rowMeta, marginTop: 0 }}>
                        {item.title} · {item.text} · {item.source}
                      </span>
                    </span>
                    <span style={styles.serviceActions}>
                      <button
                        type="button"
                        style={{ ...styles.serviceActionButton, width: "auto", minWidth: 42, padding: "0 6px" }}
                        title={`Focus ${item.title}`}
                        aria-label={`Focus ${item.label}`}
                        onClick={() => {
                          setActiveTab(item.tabId);
                          setWorkspaceMode("split");
                        }}
                      >
                        Focus
                      </button>
                      <button
                        type="button"
                        style={{ ...styles.serviceActionButton, width: "auto", minWidth: 40, padding: "0 6px" }}
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
                        style={{ ...styles.serviceActionButton, width: "auto", minWidth: 40, padding: "0 6px" }}
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
                        style={{ ...styles.serviceActionButton, width: "auto", minWidth: 48, padding: "0 6px" }}
                        title={`Accept ${item.text}`}
                        aria-label={`Accept ${item.label}`}
                        onClick={() => useWorkspaceStore.getState().reviewCockpitObject(item.tabId, item.objectId, "accepted")}
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        style={{ ...styles.serviceActionButton, width: "auto", minWidth: 52, padding: "0 6px" }}
                        title={`Dismiss ${item.text}`}
                        aria-label={`Dismiss ${item.label}`}
                        onClick={() => useWorkspaceStore.getState().reviewCockpitObject(item.tabId, item.objectId, "dismissed")}
                      >
                        Dismiss
                      </button>
                    </span>
                  </div>
                ))}
                {agentLane.extractedItems.length > 4 && (
                  <div
                    style={styles.agentLaneItem}
                    data-testid="sidebar-agent-extracted-overflow"
                    title={`${agentLane.extractedItems.length - 4} extracted cockpit objects hidden below the visible list`}
                  >
                    <span>+{agentLane.extractedItems.length - 4} more extracted</span>
                    <span style={{ ...styles.rowMeta, marginTop: 0 }}>
                      {agentLane.extractedItems[4].title} · {agentLane.extractedItems[4].label} · {agentLane.extractedItems[4].text}
                    </span>
                  </div>
                )}
              </div>
            )}
            {agentLane.staleItems.length > 0 && (
              <div style={styles.agentLaneList} aria-label="Agent stale queue">
                {agentLane.staleItems.slice(0, 3).map((item) => (
                  <button
                    key={item.tabId}
                    type="button"
                    style={styles.agentLaneItem}
                    data-testid="sidebar-agent-stale-item"
                    title={`Send status check to ${item.title}`}
                    onClick={() => {
                      setActiveTab(item.tabId);
                      useWorkspaceStore.getState().queueWorkstreamInput(item.tabId, item.prompt, {
                        source: "mission-control",
                        label: "Check in",
                      });
                      setWorkspaceMode("split");
                    }}
                  >
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      Check in
                    </span>
                    <span style={{ ...styles.rowMeta, marginTop: 0 }}>
                      {item.title} · {item.detail}
                    </span>
                  </button>
                ))}
                {agentLane.staleItems.length > 3 && (
                  <div style={styles.agentLaneOverflow} data-testid="sidebar-agent-stale-overflow">
                    +{agentLane.staleItems.length - 3} more stale · {agentLane.staleItems[3].title} · {agentLane.staleItems[3].detail}
                  </div>
                )}
              </div>
            )}
            {agentLane.riskItems.length > 0 && (
              <div style={styles.agentLaneList} aria-label="Agent risk queue">
                {agentLane.riskItems.slice(0, 3).map((item) => (
                  <button
                    key={item.tabId}
                    type="button"
                    style={styles.agentLaneItem}
                    data-testid="sidebar-agent-risk-item"
                    title={`Send risk mitigation prompt to ${item.title}`}
                    onClick={() => {
                      setActiveTab(item.tabId);
                      useWorkspaceStore.getState().queueWorkstreamInput(item.tabId, item.prompt, {
                        source: "mission-control",
                        label: "Mitigate risk",
                      });
                      setWorkspaceMode("split");
                    }}
                  >
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      Mitigate
                    </span>
                    <span style={{ ...styles.rowMeta, marginTop: 0 }}>
                      {item.title} · {item.detail}
                    </span>
                  </button>
                ))}
                {agentLane.riskItems.length > 3 && (
                  <div style={styles.agentLaneOverflow} data-testid="sidebar-agent-risk-overflow">
                    +{agentLane.riskItems.length - 3} more risk · {agentLane.riskItems[3].title} · {agentLane.riskItems[3].detail}
                  </div>
                )}
              </div>
            )}
            {agentLane.authItems.length > 0 && (
              <div style={styles.agentLaneList} aria-label="Agent auth queue">
                {agentLane.authItems.slice(0, 3).map((item) => (
                  <button
                    key={item.tabId}
                    type="button"
                    style={styles.agentLaneItem}
                    data-testid="sidebar-agent-auth-item"
                    title={`Copy auth handoff for ${item.title}`}
                    onClick={() => {
                      setActiveTab(item.tabId);
                      if (navigator.clipboard?.writeText) {
                        void navigator.clipboard.writeText(item.brief);
                      }
                      setWorkspaceMode("split");
                    }}
                  >
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      Copy auth
                    </span>
                    <span style={{ ...styles.rowMeta, marginTop: 0 }}>
                      {item.title} · {item.reason} · {item.nextAction}
                    </span>
                  </button>
                ))}
                {agentLane.authItems.length > 3 && (
                  <div
                    style={styles.agentLaneItem}
                    data-testid="sidebar-agent-auth-overflow"
                    title={`${agentLane.authItems.length - 3} auth blockers hidden below the visible auth queue`}
                  >
                    <span>+{agentLane.authItems.length - 3} more auth</span>
                    <span style={{ ...styles.rowMeta, marginTop: 0 }}>
                      {agentLane.authItems[3].title} · {agentLane.authItems[3].reason} · {agentLane.authItems[3].nextAction}
                    </span>
                  </div>
                )}
              </div>
            )}
            {agentLane.recoveryItems.length > 0 && (
              <div style={styles.agentLaneList} aria-label="Agent recovery queue">
                {agentLane.recoveryItems.slice(0, 3).map((item) => (
                  <button
                    key={item.tabId}
                    type="button"
                    style={styles.agentLaneItem}
                    data-testid="sidebar-agent-recovery-item"
                    title={`Send recovery prompt to ${item.title}`}
                    onClick={() => {
                      setActiveTab(item.tabId);
                      useWorkspaceStore.getState().queueWorkstreamInput(item.tabId, item.prompt, {
                        source: "mission-control",
                        label: "Recover",
                      });
                      setWorkspaceMode("split");
                    }}
                  >
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      Recover
                    </span>
                    <span style={{ ...styles.rowMeta, marginTop: 0 }}>
                      {item.title} · {item.reason} · {item.prompt}
                    </span>
                  </button>
                ))}
                {agentLane.recoveryItems.length > 3 && (
                  <div style={styles.agentLaneOverflow} data-testid="sidebar-agent-recovery-overflow">
                    +{agentLane.recoveryItems.length - 3} more recovery · {agentLane.recoveryItems[3].title} · {agentLane.recoveryItems[3].reason} · {agentLane.recoveryItems[3].prompt}
                  </div>
                )}
              </div>
            )}
            {agentLane.proofItems.length > 0 && (
              <div style={styles.agentLaneList} aria-label="Agent proof needed queue">
                {agentLane.proofItems.slice(0, 3).map((item) => (
                  <button
                    key={item.tabId}
                    type="button"
                    style={styles.agentLaneItem}
                    data-testid="sidebar-agent-proof-item"
                    title={`Send proof request to ${item.title}`}
                    onClick={() => {
                      setActiveTab(item.tabId);
                      useWorkspaceStore.getState().queueWorkstreamInput(item.tabId, item.request, {
                        source: "mission-control",
                        label: "Request proof",
                      });
                      setWorkspaceMode("split");
                    }}
                  >
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      Request proof
                    </span>
                    <span style={{ ...styles.rowMeta, marginTop: 0 }}>
                      {item.title} · {item.summary} · {item.request}
                    </span>
                  </button>
                ))}
                {agentLane.proofItems.length > 3 && (
                  <div
                    style={styles.agentLaneItem}
                    data-testid="sidebar-agent-proof-overflow"
                    title={`${agentLane.proofItems.length - 3} proof requests hidden below the visible proof queue`}
                  >
                    <span>+{agentLane.proofItems.length - 3} more proof</span>
                    <span style={{ ...styles.rowMeta, marginTop: 0 }}>
                      {agentLane.proofItems[3].title} · {agentLane.proofItems[3].summary} · {agentLane.proofItems[3].request}
                    </span>
                  </div>
                )}
              </div>
            )}
            {agentLane.evidenceItems.length > 0 && (
              <div style={styles.agentLaneList} aria-label="Agent evidence queue">
                {agentLane.evidenceItems.slice(0, 3).map((item) => (
                  <button
                    key={item.tabId}
                    type="button"
                    style={styles.agentLaneItem}
                    data-testid="sidebar-agent-evidence-item"
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
                      setWorkspaceMode("split");
                    }}
                  >
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.artifactPath ? "Open proof" : "Copy proof"}
                    </span>
                    <span style={{ ...styles.rowMeta, marginTop: 0 }}>
                      {item.title} · {item.evidence}{item.artifact ? ` · ${item.artifact}` : ""}
                    </span>
                  </button>
                ))}
                {agentLane.evidenceItems.length > 3 && (
                  <div
                    style={styles.agentLaneItem}
                    data-testid="sidebar-agent-evidence-overflow"
                    title={`${agentLane.evidenceItems.length - 3} evidence rows hidden below the visible evidence queue`}
                  >
                    <span>+{agentLane.evidenceItems.length - 3} more evidence</span>
                    <span style={{ ...styles.rowMeta, marginTop: 0 }}>
                      {agentLane.evidenceItems[3].title} · {agentLane.evidenceItems[3].evidence}{agentLane.evidenceItems[3].artifact ? ` · ${agentLane.evidenceItems[3].artifact}` : ""}
                    </span>
                  </div>
                )}
              </div>
            )}
            {agentLane.reviewItems.length > 0 && (
              <div style={styles.agentLaneList} aria-label="Agent review queue">
                {agentLane.reviewItems.slice(0, 3).map((item) => {
                  const canCloseout = isReviewItemCloseoutReady(item);
                  return (
                    <button
                      key={item.tabId}
                      type="button"
                      style={styles.agentLaneItem}
                      data-testid="sidebar-agent-review-item"
                      title={canCloseout ? `Mark ${item.title} reviewed` : `Review blocked for ${item.title} until proof and handoff memory are ready`}
                      onClick={() => {
                        setActiveTab(item.tabId);
                        setWorkspaceMode("split");
                        if (canCloseout) {
                          useWorkspaceStore.getState().reviewWorkstream(item.tabId, {
                            source: "mission-control",
                            label: "Review",
                          });
                        }
                      }}
                    >
                      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {canCloseout ? "Review" : "Blocked review"}
                      </span>
                      <span style={{ ...styles.rowMeta, marginTop: 0 }}>
                        {item.title} · {item.proofStatus} · {item.handoffStatus} · {item.summary} · {item.detail}
                      </span>
                    </button>
                  );
                })}
                {agentLane.reviewItems.length > 3 && (
                  <div
                    style={styles.agentLaneItem}
                    data-testid="sidebar-agent-review-overflow"
                    title={`${agentLane.reviewItems.length - 3} review items hidden below the visible review queue`}
                  >
                    <span>+{agentLane.reviewItems.length - 3} more review</span>
                    <span style={{ ...styles.rowMeta, marginTop: 0 }}>
                      {agentLane.reviewItems[3].title} · {agentLane.reviewItems[3].proofStatus} · {agentLane.reviewItems[3].handoffStatus} · {agentLane.reviewItems[3].summary}
                    </span>
                  </div>
                )}
              </div>
            )}
            {agentLane.memoryItems.length > 0 && (
              <div style={styles.agentLaneList} aria-label="Agent lane memory">
                {agentLane.memoryItems.slice(0, 3).map((item) => (
                  <button
                    key={item.tabId}
                    type="button"
                    style={styles.agentLaneItem}
                    data-testid="sidebar-agent-lane-memory"
                    title={`Copy memory for ${item.title}`}
                    onClick={() => {
                      setActiveTab(item.tabId);
                      if (navigator.clipboard?.writeText) {
                        void navigator.clipboard.writeText(item.brief);
                      }
                      setWorkspaceMode("split");
                    }}
                  >
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      Copy memory
                    </span>
                    <span style={{ ...styles.rowMeta, marginTop: 0 }}>
                      {item.title} · {item.memory}
                    </span>
                  </button>
                ))}
                {agentLane.memoryItems.length > 3 && (
                  <div
                    style={styles.agentLaneItem}
                    data-testid="sidebar-agent-memory-overflow"
                    title={`${agentLane.memoryItems.length - 3} memory rows hidden below the visible handoff-memory list`}
                  >
                    <span>+{agentLane.memoryItems.length - 3} more memory</span>
                    <span style={{ ...styles.rowMeta, marginTop: 0 }}>
                      {agentLane.memoryItems[3].title} · {agentLane.memoryItems[3].memory}
                    </span>
                  </div>
                )}
              </div>
            )}
            <div style={styles.agentLaneList}>
              {agentLane.workstreams.slice(0, 3).map(({ tab, workstream }) => {
                const askText = latestMissionControlAskText(workstream);
                const title = workstream.mission ?? workstream.prompt ?? tab.title;
                const scanStatus = workstreamScanStatus(workstream);
                const attention = workstreamAttentionText(workstream);
                return (
                  <button
                    key={tab.id}
                    type="button"
                    style={styles.agentRunItem}
                    data-testid="sidebar-agent-run-item"
                    title={`Focus ${title}`}
                    onClick={() => {
                      setActiveTab(tab.id);
                      if (navigator.clipboard?.writeText) {
                        void navigator.clipboard.writeText(formatAgentRunBrief(tab));
                      }
                      setWorkspaceMode("split");
                    }}
                  >
                    <span style={styles.agentRunTitle} data-testid="sidebar-agent-run-title">
                      {title}
                    </span>
                    <span style={styles.agentRunMeta} data-testid="sidebar-agent-run-status">
                      {scanStatus} · {workstreamLabel(workstream.provider).toLowerCase()} · {workstreamActivityText(workstream)} · {attention} · {formatWorkstreamOpsContext(workstream)}
                      {askText ? ` · ${askText}` : ""}
                    </span>
                  </button>
                );
              })}
              {agentLane.workstreams.length > 3 && (
                <div
                  style={styles.agentLaneItem}
                  data-testid="sidebar-agent-run-overflow"
                  title={`${agentLane.workstreams.length - 3} agent runs hidden below the visible run list`}
                >
                  <span>+{agentLane.workstreams.length - 3} more agents</span>
                  <span style={{ ...styles.rowMeta, marginTop: 0 }}>
                    {workstreamScanStatus(agentLane.workstreams[3].workstream)} · {workstreamLabel(agentLane.workstreams[3].workstream.provider).toLowerCase()} · {workstreamActivityText(agentLane.workstreams[3].workstream)} · {workstreamAttentionText(agentLane.workstreams[3].workstream)} · {formatWorkstreamOpsContext(agentLane.workstreams[3].workstream)}
                    {latestMissionControlAskText(agentLane.workstreams[3].workstream) ? ` · ${latestMissionControlAskText(agentLane.workstreams[3].workstream)}` : ""}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
        {visibleTabs.length === 0 ? (
          <div style={{ ...styles.empty, display: "grid", gap: 8, justifyItems: "center" }}>
            <span>No terminals in this project yet.</span>
            <button
              className="workspace-primary-button"
              style={styles.primaryButton}
              onClick={() => {
                addTab({
                  title: activeGroupFilter === null ? "Terminal" : activeProjectName,
                  emoji: "\u{1F4C1}",
                  initialCwd: projectRoot ?? undefined,
                  groupId: activeGroupFilter,
                });
                setWorkspaceMode("split");
              }}
            >
              <Plus size={14} />
              New terminal in project
            </button>
          </div>
        ) : visibleTabs.map((tab) => {
          const active = tab.id === activeTabId;
          const group = tab.groupId ? groups.find((candidate) => candidate.id === tab.groupId) : null;
          const terminal = terminalForTab(tab);
          const liveCwd = terminal?.id ? liveCwds[terminal.id] : undefined;
          const liveGitRoot = terminal?.id ? liveGitRoots[terminal.id] : undefined;
          const header = sidebarHeaderForTerminal({
            tab,
            terminal,
            project: group,
            liveCwd,
            liveGitRoot,
            spawnCwd: tab.initialCwd,
          });
          const taskMissing = header.sources.goal === "missing" || header.sources.goal === "none";
          const activityMissing = header.sources.activity === "missing";
          const sessionSummary = taskMissing && !activityMissing ? header.currentActivity : header.goalLabel;
          const agentProvider = tab.workstream?.provider ?? terminal?.agentProvider ?? terminal?.statusSummary?.provider;
          const agentLabel = agentProviderIdentity(agentProvider);
          return (
            <div
              key={tab.id}
              className="workspace-sidebar-row session-sidebar-row"
              role="button"
              tabIndex={0}
              aria-label={`Open session ${tab.title}`}
              aria-current={active ? "true" : undefined}
              data-active={active ? "true" : "false"}
              data-pane-id={header.paneId}
              data-terminal-id={header.terminalId}
              data-goal-source={header.sources.goal}
              data-activity-source={header.sources.activity}
              data-header-version={header.version}
              style={{
                ...styles.row,
                ...(active ? styles.activeRow : null),
              }}
              title={`${header.workspace} · Task: ${header.goalLabel} · Now Active: ${header.currentActivity} · ${header.fullPath}`}
              onClick={() => {
                setActiveTab(tab.id);
                setWorkspaceMode("split");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setActiveTab(tab.id);
                  setWorkspaceMode("split");
                }
              }}
              onMouseDown={(event) => event.preventDefault()}
              onContextMenu={(event) => onOpenTerminalMenu(event, tab)}
            >
              <TerminalAvatar tab={tab} active={active} />
              <span className="session-sidebar-content" style={styles.sessionContent}>
                <div style={{ ...styles.rowTitle, color: active ? "var(--text-primary)" : "var(--text-secondary)" }}>
                  {header.workspace}
                </div>
                <div style={styles.sessionSummary} data-testid="sidebar-session-summary">
                  <span
                    data-testid="sidebar-session-attention"
                    data-attention-state={badgeForAttention(paneBadgeAttention(terminal)).state}
                    style={{ color: badgeForAttention(paneBadgeAttention(terminal)).color, fontWeight: 500, flexShrink: 0 }}
                  >
                    <span
                      style={{
                        display: "inline-block",
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: badgeForAttention(paneBadgeAttention(terminal)).color,
                        marginInlineEnd: 5,
                        verticalAlign: "middle",
                      }}
                    />
                    {badgeForAttention(paneBadgeAttention(terminal)).label}
                  </span>
                  {agentLabel && (
                    <span data-testid="sidebar-session-agent-provider"> · <AgentProviderIdentity provider={agentProvider} /></span>
                  )}
                  <span aria-hidden="true" style={{ color: "var(--text-tertiary)", flexShrink: 0 }}>·</span>
                  <span style={styles.sessionSummaryText} title={sessionSummary}>{sessionSummary}</span>
                </div>
              </span>
              <span className="workspace-sidebar-actions" style={styles.sessionRowActions}>
                <button
                  className="workspace-sidebar-action"
                  style={{
                    ...styles.rowActionButton,
                    color: active ? "var(--accent-live)" : "var(--text-secondary)",
                  }}
                  title="Open terminal surface"
                  aria-label={`Open ${tab.title} terminal surface`}
                  onClick={(event) => {
                    event.stopPropagation();
                    setActiveTab(tab.id);
                    setWorkspaceMode("split");
                  }}
                >
                  <TerminalWindow size={13} weight="duotone" />
                </button>
                <button
                  className="workspace-sidebar-action"
                  style={styles.rowActionButton}
                  title="Show same terminal on map"
                  aria-label={`Show ${tab.title} on map`}
                  onClick={(event) => {
                    event.stopPropagation();
                    focusTabOnMap(tab);
                  }}
                >
                  <MapTrifold size={13} weight="duotone" />
                </button>
                <button
                  className="workspace-sidebar-action workspace-sidebar-action--danger"
                  style={styles.rowActionButton}
                  title="Close terminal session"
                  aria-label={`Close ${tab.title} terminal session`}
                  onClick={(event) => {
                    event.stopPropagation();
                    closeTerminalSession(tab.id);
                  }}
                >
                  <X size={13} />
                </button>
              </span>
            </div>
          );
        })}
      </div>
      {pickerOpen && (
        <FolderPicker
          initialPath={projectPath || projectRoot || null}
          onSelect={applyPickedPath}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </>
  );
}

function MapPanel({
  onOpenTerminalMenu,
  onOpenProjectMenu,
}: {
  onOpenTerminalMenu: (event: React.MouseEvent, tab: Tab) => void;
  onOpenProjectMenu: (event: React.MouseEvent, project: { id: string; name: string; emoji?: string }) => void;
}) {
  const [mapFilter, setMapFilter] = useState<MapFilter>("all");
  const [serviceActionStatus, setServiceActionStatus] = useState("");
  const [servicesCollapsed, setServicesCollapsed] = useState(false);
  const [scopeCollapsed, setScopeCollapsed] = useState(true);
  const tabs = useWorkspaceStore((state) => state.tabs);
  const groups = useWorkspaceStore((state) => state.groups);
  const liveCwds = useWorkspaceStore((state) => state.liveCwds);
  const liveGitRoots = useWorkspaceStore((state) => state.liveGitRoots);
  const canvasState = useWorkspaceStore((state) => state.canvasState);
  const setActiveTab = useWorkspaceStore((state) => state.setActiveTab);
  const setWorkspaceMode = useWorkspaceStore((state) => state.setWorkspaceMode);
  const selectCanvasNode = useWorkspaceStore((state) => state.selectCanvasNode);
  const updateCanvasViewport = useWorkspaceStore((state) => state.updateCanvasViewport);
  const addCanvasNode = useWorkspaceStore((state) => state.addCanvasNode);
  const removeCanvasNode = useWorkspaceStore((state) => state.removeCanvasNode);
  const closeTerminalSession = useWorkspaceStore((state) => state.closeTerminalSession);
  const closePane = useWorkspaceStore((state) => state.closePane);
  const reorderCanvasNodes = useWorkspaceStore((state) => state.reorderCanvasNodes);
  const updateWorkspaceUiState = useWorkspaceStore((state) => state.updateWorkspaceUiState);
  const sortMode = useWorkspaceStore((state) => state.workspaceUiState.canvasSidebarSortMode);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; place: "before" | "after" } | null>(null);

  const focusCanvasNode = (node: CanvasNode) => {
    const zoom = node.type === "terminal" ? 1 : canvasState.viewport.zoom;
    selectCanvasNode(node.id);
    const nextX = node.type === "terminal" ? 18 - node.x * zoom : 320 - node.x * zoom;
    const nextY = 120 - node.y * zoom;
    updateCanvasViewport({
      zoom,
      x: node.type === "terminal" && zoom === 1 ? Math.round(nextX) : nextX,
      y: node.type === "terminal" && zoom === 1 ? Math.round(nextY) : nextY,
    });
  };

  const groupVisibleNodes = canvasState.nodes;
  const nodeTab = (node: CanvasNode) =>
    node.terminalTabId ? tabs.find((tab) => tab.id === node.terminalTabId) : undefined;
  const filterCounts = useMemo(() => Object.fromEntries(
    MAP_FILTERS.map((filter) => [
      filter.id,
      groupVisibleNodes.filter((node) => nodeMatchesMapFilter(node, nodeTab(node), filter.id)).length,
    ])
  ) as Record<MapFilter, number>, [groupVisibleNodes, tabs]);
  const visibleNodes = groupVisibleNodes.filter((node) => nodeMatchesMapFilter(node, nodeTab(node), mapFilter));
  const visibleTabs = tabs;
  const localServices = useMemo(
    () => summarizeLocalServices(visibleTabs, groupVisibleNodes),
    [visibleTabs, groupVisibleNodes]
  );
  const mapSummary = useMemo(
    () => summarizeMapNodes(visibleNodes, tabs, groups, liveCwds),
    [visibleNodes, tabs, groups, liveCwds]
  );
  const agentLane = summarizeAgentLane(visibleTabs);
  const activeAgentWorkstreams = agentLane.workstreams.filter(({ workstream }) => isActiveAgentWorkstream(workstream));
  const restartableAgentWorkstreams = agentLane.workstreams.filter(({ workstream }) => isRestartableAgentWorkstream(workstream));
  const authRetryableAgentWorkstreams = agentLane.workstreams.filter(({ workstream }) => isAuthRetryableAgentWorkstream(workstream));
  const cleanupRequestableAgentWorkstreams = agentLane.workstreams.filter(({ workstream }) => isCleanupRequestableAgentWorkstream(workstream));
  const closeoutReadyReviewItems = agentLane.reviewItems.filter((item) => isReviewItemCloseoutReady(item));
  const proofRequestItems = agentLane.proofItems;
  const memoryRequestItems = agentLane.memoryRequestItems;
  const riskMitigationItems = agentLane.riskItems;
  const queueAgentLaneStatusSweep = () => {
    if (activeAgentWorkstreams.length === 0) return;
    const store = useWorkspaceStore.getState();
    for (const { tab, workstream } of activeAgentWorkstreams) {
      store.queueWorkstreamInput(tab.id, statusCheckPromptForWorkstream(workstream), {
        source: "mission-control",
        label: "Status sweep",
      });
    }
    const firstTarget = activeAgentWorkstreams[0].tab;
    setActiveTab(firstTarget.id);
    const linkedNode = canvasState.nodes.find((node) => node.terminalTabId === firstTarget.id);
    if (linkedNode) focusCanvasNode(linkedNode);
  };
  const restartRecoveryAgentFleet = () => {
    if (restartableAgentWorkstreams.length === 0) return;
    const store = useWorkspaceStore.getState();
    void Promise.all(restartableAgentWorkstreams.map(({ tab }) => store.restartWorkstream(tab.id, {
      source: "mission-control",
      label: "Restart recovery",
    })));
    const firstTarget = restartableAgentWorkstreams[0].tab;
    setActiveTab(firstTarget.id);
    const linkedNode = canvasState.nodes.find((node) => node.terminalTabId === firstTarget.id);
    if (linkedNode) focusCanvasNode(linkedNode);
  };
  const retryAuthAgentFleet = () => {
    if (authRetryableAgentWorkstreams.length === 0) return;
    const store = useWorkspaceStore.getState();
    void Promise.all(authRetryableAgentWorkstreams.map(({ tab }) => store.restartWorkstream(tab.id, {
      source: "mission-control",
      label: "Retry auth",
    })));
    const firstTarget = authRetryableAgentWorkstreams[0].tab;
    setActiveTab(firstTarget.id);
    const linkedNode = canvasState.nodes.find((node) => node.terminalTabId === firstTarget.id);
    if (linkedNode) focusCanvasNode(linkedNode);
  };
  const requestCleanupFromAgentFleet = () => {
    if (cleanupRequestableAgentWorkstreams.length === 0) return;
    const store = useWorkspaceStore.getState();
    for (const { tab } of cleanupRequestableAgentWorkstreams) {
      store.requestWorktreeCleanup(tab.id, {
        source: "mission-control",
        label: "Request cleanup",
      });
    }
    const firstTarget = cleanupRequestableAgentWorkstreams[0].tab;
    setActiveTab(firstTarget.id);
    const linkedNode = canvasState.nodes.find((node) => node.terminalTabId === firstTarget.id);
    if (linkedNode) focusCanvasNode(linkedNode);
  };
  const reviewReadyAgentCloseouts = () => {
    if (closeoutReadyReviewItems.length === 0) return;
    const store = useWorkspaceStore.getState();
    for (const item of closeoutReadyReviewItems) {
      store.reviewWorkstream(item.tabId, {
        source: "mission-control",
        label: "Review",
      });
    }
    const firstTarget = visibleTabs.find((tab) => tab.id === closeoutReadyReviewItems[0].tabId);
    if (!firstTarget) return;
    setActiveTab(firstTarget.id);
    const linkedNode = canvasState.nodes.find((node) => node.terminalTabId === firstTarget.id);
    if (linkedNode) focusCanvasNode(linkedNode);
  };
  const requestProofFromAgentFleet = () => {
    const targets = proofRequestItems
      .map((item) => visibleTabs.find((tab) => tab.id === item.tabId))
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
    const firstTarget = targets[0];
    setActiveTab(firstTarget.id);
    const linkedNode = canvasState.nodes.find((node) => node.terminalTabId === firstTarget.id);
    if (linkedNode) focusCanvasNode(linkedNode);
  };
  const requestMemoryFromAgentFleet = () => {
    const targets = memoryRequestItems
      .map((item) => visibleTabs.find((tab) => tab.id === item.tabId))
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
    const firstTarget = targets[0];
    setActiveTab(firstTarget.id);
    const linkedNode = canvasState.nodes.find((node) => node.terminalTabId === firstTarget.id);
    if (linkedNode) focusCanvasNode(linkedNode);
  };
  const requestRiskMitigationFromAgentFleet = () => {
    const targets = riskMitigationItems
      .map((item) => ({ item, tab: visibleTabs.find((tab) => tab.id === item.tabId) }))
      .filter((target): target is { item: typeof riskMitigationItems[number]; tab: Tab } => Boolean(target.tab?.workstream));
    if (targets.length === 0) return;
    const store = useWorkspaceStore.getState();
    for (const { item, tab } of targets) {
      store.queueWorkstreamInput(tab.id, item.prompt, {
        source: "mission-control",
        label: "Mitigate risk",
      });
    }
    const firstTarget = targets[0].tab;
    setActiveTab(firstTarget.id);
    const linkedNode = canvasState.nodes.find((node) => node.terminalTabId === firstTarget.id);
    if (linkedNode) focusCanvasNode(linkedNode);
  };
  const interruptActiveAgentFleet = () => {
    if (activeAgentWorkstreams.length === 0) return;
    const store = useWorkspaceStore.getState();
    void Promise.all(activeAgentWorkstreams.map(({ tab }) => store.interruptWorkstream(tab.id)));
    const firstTarget = activeAgentWorkstreams[0].tab;
    setActiveTab(firstTarget.id);
    const linkedNode = canvasState.nodes.find((node) => node.terminalTabId === firstTarget.id);
    if (linkedNode) focusCanvasNode(linkedNode);
  };
  const copyServiceText = async (text: string, label: string) => {
    if (!navigator.clipboard?.writeText) {
      setServiceActionStatus("Clipboard unavailable");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setServiceActionStatus(`${label} copied`);
    } catch {
      setServiceActionStatus(`${label} copy failed`);
    }
  };
  const openServiceOnMap = (service: LocalServiceSummary) => {
    const existingPreviewNode = service.previewNodeId
      ? canvasState.nodes.find((node) => node.id === service.previewNodeId)
      : canvasState.nodes.find((node) => node.type === "preview" && node.previewUrl === service.url);
    if (existingPreviewNode) {
      setWorkspaceMode("canvas");
      focusCanvasNode(existingPreviewNode);
      setServiceActionStatus("Map window focused");
      return;
    }

    const terminalNode = service.terminalNodeId
      ? canvasState.nodes.find((node) => node.id === service.terminalNodeId)
      : canvasState.nodes.find((node) => node.terminalTabId === service.ownerTabId && node.type === "terminal");
    const previewNode: CanvasNode = {
      id: `service-preview-${(service.ownerTabId ?? "local").replace(/[^a-z0-9_-]/gi, "-")}-${service.port}`,
      type: "preview",
      title: `Preview ${localServiceHostText(service)}:${service.port}`,
      x: (terminalNode?.x ?? 120) + (terminalNode?.width ?? 620) + 36,
      y: terminalNode?.y ?? 90,
      width: 620,
      height: 420,
      terminalTabId: service.ownerTabId,
      previewUrl: service.url,
      linkedTerminalPaneId: service.terminalPaneId,
    };
    addCanvasNode(previewNode);
    setWorkspaceMode("canvas");
    focusCanvasNode(previewNode);
    setServiceActionStatus("Map window opened");
  };
  const taskRoots = visibleNodes.map((node) => {
    const linkedTab = node.terminalTabId
      ? tabs.find((tab) => tab.id === node.terminalTabId)
      : undefined;
    const linkedProjectRoot = linkedTab?.groupId
      ? groups.find((group) => group.id === linkedTab.groupId)?.projectRoot
      : undefined;
    return linkedProjectRoot ?? node.terminalCwd ?? linkedTab?.initialCwd;
  });
  const tasksByRoot = useMasterPlanTasks(taskRoots);

  const draggable = sortMode === "manual";
  const clearDrag = () => {
    setDraggingId(null);
    setDropTarget(null);
  };
  const handleDragStart = (node: CanvasNode, event: React.DragEvent) => {
    setDraggingId(node.id);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", node.id);
  };
  const handleDragOver = (node: CanvasNode, event: React.DragEvent) => {
    if (!draggingId || draggingId === node.id) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const rect = event.currentTarget.getBoundingClientRect();
    const place: "before" | "after" = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
    setDropTarget((prev) => (prev?.id === node.id && prev.place === place ? prev : { id: node.id, place }));
  };
  const handleDrop = (node: CanvasNode, event: React.DragEvent) => {
    event.preventDefault();
    const place = dropTarget?.id === node.id ? dropTarget.place : "before";
    if (draggingId && draggingId !== node.id) reorderCanvasNodes(draggingId, node.id, place);
    clearDrag();
  };

  // By-project view follows the map's visual reading order: left-to-right first,
  // then top-to-bottom. Moving a node changes display order without changing its
  // project membership or the persisted node array.
  const projectBuckets = useMemo(() => {
    return projectBucketsByCanvasPosition(visibleNodes, tabs, groups, { unassignedLabel: "Unassigned" });
  }, [visibleNodes, tabs, groups]);

  type MapListItem =
    | { kind: "header"; key: string; label: string }
    | { kind: "node"; node: CanvasNode };
  const mapListItems: MapListItem[] = sortMode === "project"
    ? projectBuckets.flatMap((bucket) => [
        { kind: "header" as const, key: `header-${bucket.key}`, label: bucket.label },
        ...bucket.nodes.map((node) => ({ kind: "node" as const, node })),
      ])
    : visibleNodes.map((node) => ({ kind: "node" as const, node }));
  const mapListOrderKey = mapListItems
    .map((item) => item.kind === "header" ? item.key : item.node.id)
    .join("|");
  const mapNodeListRef = useFlipList<HTMLDivElement>(mapListOrderKey);

  const draggedNode = draggingId ? visibleNodes.find((node) => node.id === draggingId) : undefined;
  const draggedGhostLabel = (() => {
    if (!draggedNode) return "";
    const tab = draggedNode.terminalTabId ? tabs.find((t) => t.id === draggedNode.terminalTabId) : undefined;
    return tab?.title || draggedNode.title || "Terminal";
  })();
  const dragGhost = (
    <div style={styles.dragGhost} data-testid="map-drag-ghost">
      Move “{draggedGhostLabel}” here
    </div>
  );

  return (
    <>
      <div style={styles.header}>
        <div style={styles.title}>
          <MapTrifold size={14} weight="duotone" />
          <span>Map</span>
        </div>
        <span style={styles.count}>{visibleNodes.length}</span>
      </div>
      <div style={styles.mapFilterBar} aria-label="Arrange terminals">
        {([
          { id: "manual", label: "Manual" },
          { id: "project", label: "By project" },
        ] as const).map((mode) => {
          const active = sortMode === mode.id;
          return (
            <button
              key={mode.id}
              type="button"
              data-testid={`map-sort-${mode.id}`}
              aria-pressed={active}
              style={{
                ...styles.mapFilterButton,
                background: active ? "var(--surface-selected)" : "var(--surface-base)",
                color: active ? "var(--text-primary)" : "var(--text-secondary)",
                borderColor: active ? "var(--border-strong)" : "transparent",
              }}
              onClick={() => updateWorkspaceUiState({ canvasSidebarSortMode: mode.id })}
            >
              <span>{mode.label}</span>
            </button>
          );
        })}
      </div>
      <div style={styles.mapFilterBar} aria-label="Map filters">
        {MAP_FILTERS.map((filter) => {
          const active = mapFilter === filter.id;
          return (
            <button
              key={filter.id}
              type="button"
              data-testid={`map-filter-${filter.id}`}
              aria-pressed={active}
              style={{
                ...styles.mapFilterButton,
                background: active ? "var(--surface-selected)" : "var(--surface-base)",
                color: active ? "var(--text-primary)" : "var(--text-secondary)",
                borderColor: active ? "var(--border-strong)" : "transparent",
              }}
              onClick={() => setMapFilter(filter.id)}
            >
              <span>{filter.label}</span>
              <span style={styles.mapFilterCount}>{filterCounts[filter.id]}</span>
            </button>
          );
        })}
      </div>
      <div style={styles.list}>
        {localServices.length > 0 && (
          <div
            style={{ ...styles.servicePanel, order: 2 }}
            data-testid="map-local-services"
            aria-label="Local services"
            title={`${localServices.length} local service${localServices.length === 1 ? "" : "s"}`}
          >
            <div style={styles.compactUtilityHeader}>
              <span>Services</span>
              <span style={styles.compactUtilityMeta}>{localServices.length} detected</span>
              <button
                type="button"
                style={styles.compactToggle}
                data-testid="map-local-services-toggle"
                aria-expanded={!servicesCollapsed}
                aria-label={servicesCollapsed ? "Show local services" : "Hide local services"}
                onClick={() => setServicesCollapsed((collapsed) => !collapsed)}
              >
                {servicesCollapsed ? "Show" : "Hide"}
              </button>
            </div>
            {!servicesCollapsed && (
              <>
                <div style={styles.serviceActionStatus} data-testid="map-local-service-action-status">
                  {serviceActionStatus || "Ready"}
                </div>
                <div style={styles.agentLaneList}>
                  {localServices.slice(0, 3).map((service) => {
                    const focusNode = canvasState.nodes.find((node) => node.id === service.previewNodeId) ??
                      canvasState.nodes.find((node) => node.id === service.terminalNodeId) ??
                      canvasState.nodes.find((node) => node.terminalTabId === service.ownerTabId);
                    return (
                      <div
                        key={service.id}
                        style={styles.serviceRow}
                        data-testid="map-local-service-row"
                        title={`Focus ${service.url}`}
                        onClick={() => {
                          if (service.ownerTabId) setActiveTab(service.ownerTabId);
                          setWorkspaceMode("canvas");
                          if (focusNode) focusCanvasNode(focusNode);
                        }}
                      >
                        <span style={{ minWidth: 0, display: "block" }}>
                          <span style={styles.serviceTitleRow}>
                            <span style={styles.serviceHost}>{localServiceHostText(service)}</span>
                            <span style={styles.servicePort}>:{service.port}</span>
                          </span>
                          <span style={styles.serviceMetaLine}>
                            {localServiceStatusText(service)} · {service.ownerTitle}
                          </span>
                        </span>
                        <span style={styles.serviceActions}>
                          <button
                            type="button"
                            style={styles.serviceActionButton}
                            title={`Copy ${service.url}`}
                            aria-label={`Copy ${service.url}`}
                            onMouseDown={(event) => event.stopPropagation()}
                            onClick={(event) => {
                              event.stopPropagation();
                              void copyServiceText(service.url, "URL");
                            }}
                          >
                            <ClipboardText size={13} />
                          </button>
                          <button
                            type="button"
                            style={styles.serviceActionButton}
                            title={`Copy logs for ${service.url}`}
                            aria-label={`Copy logs for ${service.url}`}
                            onMouseDown={(event) => event.stopPropagation()}
                            onClick={(event) => {
                              event.stopPropagation();
                              void copyServiceText(formatLocalServiceBrief(service), "Logs");
                            }}
                          >
                            <Note size={13} />
                          </button>
                          <button
                            type="button"
                            style={styles.serviceActionButton}
                            title={`Open ${service.url} on map`}
                            aria-label={`Open ${service.url} on map`}
                            onMouseDown={(event) => event.stopPropagation()}
                            onClick={(event) => {
                              event.stopPropagation();
                              openServiceOnMap(service);
                            }}
                          >
                            <ArrowSquareOut size={13} />
                          </button>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}
        {visibleNodes.length > 0 && (
          <div
            style={{ ...styles.utilityPanel, order: 3 }}
            data-testid="map-workspace-summary"
            aria-label="Map workspace grouping summary"
            title={mapSummary.headline}
          >
            <div style={styles.compactUtilityHeader}>
              <span>Scope</span>
              <span style={styles.compactUtilityMeta}>{mapSummary.headline}</span>
              <button
                type="button"
                style={styles.compactToggle}
                data-testid="map-workspace-summary-toggle"
                aria-expanded={!scopeCollapsed}
                aria-label={scopeCollapsed ? "Show map scope summary" : "Hide map scope summary"}
                onClick={() => setScopeCollapsed((collapsed) => !collapsed)}
              >
                {scopeCollapsed ? "Show" : "Hide"}
              </button>
            </div>
            {!scopeCollapsed && (
              <>
                <div style={styles.agentLaneStats}>
                  <span style={styles.agentLaneChip} data-testid="map-workspace-group-count">
                    {mapSummary.workspaces.length} workspace{mapSummary.workspaces.length === 1 ? "" : "s"}
                  </span>
                  <span style={styles.agentLaneChip}>{mapSummary.roles.length} role{mapSummary.roles.length === 1 ? "" : "s"}</span>
                  <span style={styles.agentLaneChip}>{mapSummary.branches.length} branch{mapSummary.branches.length === 1 ? "" : "es"}</span>
                  <span style={styles.agentLaneChip}>{mapSummary.services.length} service{mapSummary.services.length === 1 ? "" : "s"}</span>
                </div>
                <div style={{ ...styles.agentLaneStats, display: "none" }} aria-label="Map workspace groups">
                  {mapSummary.workspaces.slice(0, 4).map((workspace) => (
                    <div
                      key={workspace.label}
                      style={{ ...styles.agentLaneItem, cursor: "default" }}
                      data-testid="map-workspace-group"
                      title={`${workspace.label}: ${workspace.count} node${workspace.count === 1 ? "" : "s"}`}
                    >
                      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {workspace.label}
                      </span>
                      <span style={{ ...styles.rowMeta, marginTop: 0 }}>{workspace.count} node{workspace.count === 1 ? "" : "s"}</span>
                    </div>
                  ))}
                </div>
                <div style={styles.agentLaneStats} data-testid="map-workspace-summary-facets">
                  {mapSummary.branches.slice(0, 3).map((branch) => (
                    <span key={`branch-${branch.label}`} style={styles.agentLaneChip}>{branch.label} · {branch.count}</span>
                  ))}
                  {mapSummary.roles.slice(0, 3).map((role) => (
                    <span key={`role-${role.label}`} style={styles.agentLaneChip}>{role.label} · {role.count}</span>
                  ))}
                  {mapSummary.services.slice(0, 2).map((service) => (
                    <span key={`service-${service.label}`} style={styles.agentLaneChip}>{service.label} · {service.count}</span>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
        {agentLane.total > 0 && (
          <div
            style={{ ...styles.agentLanePanel, order: 4 }}
            data-testid="map-agent-lane-summary"
            aria-label={agentLaneStatusText(agentLane)}
          >
            <div style={styles.agentLaneHeader}>
              <span>Agent runs</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <button
                  type="button"
                  style={styles.agentLaneIconButton}
                  data-testid="map-agent-lane-status-sweep"
                  title={agentLaneStatusSweepTitle(agentLane)}
                  aria-label="Request active agent status sweep"
                  disabled={activeAgentWorkstreams.length === 0}
                  onClick={queueAgentLaneStatusSweep}
                >
                  <ArrowsClockwise size={13} weight="duotone" />
                </button>
                <span
                  data-testid="map-agent-lane-status-sweep-plan"
                  title={agentLaneStatusSweepTitle(agentLane)}
                  style={{ ...styles.rowMeta, marginTop: 0 }}
                >
                  {agentLaneStatusSweepText(agentLane)}
                </span>
                <button
                  type="button"
                  style={styles.agentLaneIconButton}
                  data-testid="map-agent-lane-interrupt-active"
                  title={agentLaneInterruptTitle(agentLane)}
                  aria-label="Interrupt active agent fleet"
                  disabled={activeAgentWorkstreams.length === 0}
                  onClick={interruptActiveAgentFleet}
                >
                  <Prohibit size={13} weight="duotone" />
                </button>
                <span
                  data-testid="map-agent-lane-interrupt-plan"
                  title={agentLaneInterruptTitle(agentLane)}
                  style={{ ...styles.rowMeta, marginTop: 0 }}
                >
                  {agentLaneInterruptText(agentLane)}
                </span>
                <button
                  type="button"
                  style={styles.agentLaneIconButton}
                  data-testid="map-agent-lane-restart-recovery"
                  title={agentLaneRestartTitle(agentLane)}
                  aria-label="Restart recovery agent fleet"
                  disabled={restartableAgentWorkstreams.length === 0}
                  onClick={restartRecoveryAgentFleet}
                >
                  <ArrowsClockwise size={13} weight="duotone" />
                </button>
                <span
                  data-testid="map-agent-lane-restart-plan"
                  title={agentLaneRestartTitle(agentLane)}
                  style={{ ...styles.rowMeta, marginTop: 0 }}
                >
                  {agentLaneRestartText(agentLane)}
                </span>
                <button
                  type="button"
                  style={styles.agentLaneIconButton}
                  data-testid="map-agent-lane-retry-auth"
                  title={agentLaneAuthRetryTitle(agentLane)}
                  aria-label="Retry auth-blocked agent fleet"
                  disabled={authRetryableAgentWorkstreams.length === 0}
                  onClick={retryAuthAgentFleet}
                >
                  <ArrowsClockwise size={13} weight="duotone" />
                </button>
                <span
                  data-testid="map-agent-lane-auth-retry-plan"
                  title={agentLaneAuthRetryTitle(agentLane)}
                  style={{ ...styles.rowMeta, marginTop: 0 }}
                >
                  {agentLaneAuthRetryText(agentLane)}
                </span>
                <button
                  type="button"
                  style={styles.agentLaneIconButton}
                  data-testid="map-agent-lane-request-cleanup"
                  title={agentLaneCleanupRequestTitle(agentLane)}
                  aria-label="Request cleanup for cleanup-ready agent fleet"
                  disabled={cleanupRequestableAgentWorkstreams.length === 0}
                  onClick={requestCleanupFromAgentFleet}
                >
                  <Trash size={13} weight="duotone" />
                </button>
                <span
                  data-testid="map-agent-lane-cleanup-plan"
                  title={agentLaneCleanupRequestTitle(agentLane)}
                  style={{ ...styles.rowMeta, marginTop: 0 }}
                >
                  {agentLaneCleanupRequestText(agentLane)}
                </span>
                <button
                  type="button"
                  style={styles.agentLaneIconButton}
                  data-testid="map-agent-lane-review-ready"
                  title={agentLaneCloseoutTitle(agentLane)}
                  aria-label="Review ready agent closeouts"
                  disabled={closeoutReadyReviewItems.length === 0}
                  onClick={reviewReadyAgentCloseouts}
                >
                  <CheckCircle size={13} weight="duotone" />
                </button>
                <span
                  data-testid="map-agent-lane-closeout-plan"
                  title={agentLaneCloseoutTitle(agentLane)}
                  style={{ ...styles.rowMeta, marginTop: 0 }}
                >
                  {agentLaneCloseoutText(agentLane)}
                </span>
                <button
                  type="button"
                  style={styles.agentLaneIconButton}
                  data-testid="map-agent-lane-request-proof"
                  title={agentLaneProofRequestTitle(agentLane)}
                  aria-label="Request proof from proof-needed agent fleet"
                  disabled={proofRequestItems.length === 0}
                  onClick={requestProofFromAgentFleet}
                >
                  <FileText size={13} weight="duotone" />
                </button>
                <button
                  type="button"
                  style={styles.agentLaneIconButton}
                  data-testid="map-agent-lane-request-memory"
                  title={agentLaneMemoryRequestTitle(agentLane)}
                  aria-label="Request handoff memory from memory-needed agent fleet"
                  disabled={memoryRequestItems.length === 0}
                  onClick={requestMemoryFromAgentFleet}
                >
                  <Note size={13} weight="duotone" />
                </button>
                <button
                  type="button"
                  style={styles.agentLaneIconButton}
                  data-testid="map-agent-lane-mitigate-risk"
                  title={agentLaneRiskMitigationTitle(agentLane)}
                  aria-label="Request risk mitigation from risky agent fleet"
                  disabled={riskMitigationItems.length === 0}
                  onClick={requestRiskMitigationFromAgentFleet}
                >
                  <Prohibit size={13} weight="duotone" />
                </button>
                <span
                  data-testid="map-agent-lane-risk-plan"
                  title={agentLaneRiskMitigationTitle(agentLane)}
                  style={{ ...styles.rowMeta, marginTop: 0 }}
                >
                  {agentLaneRiskMitigationText(agentLane)}
                </span>
                <span
                  data-testid="map-agent-lane-memory-plan"
                  title={agentLaneMemoryRequestTitle(agentLane)}
                  style={{ ...styles.rowMeta, marginTop: 0 }}
                >
                  {agentLaneMemoryRequestText(agentLane)}
                </span>
                <span
                  data-testid="map-agent-lane-proof-plan"
                  title={agentLaneProofRequestTitle(agentLane)}
                  style={{ ...styles.rowMeta, marginTop: 0 }}
                >
                  {agentLaneProofRequestText(agentLane)}
                </span>
                <button
                  type="button"
                  style={styles.agentLaneIconButton}
                  data-testid="map-agent-lane-copy-mission"
                  title="Copy mission control brief"
                  aria-label="Copy mission control brief"
                  onClick={() => {
                    if (navigator.clipboard?.writeText) {
                      void navigator.clipboard.writeText(formatAgentMissionControlBrief(agentLane));
                    }
                  }}
                >
                  <ClipboardText size={13} weight="duotone" />
                </button>
                <button
                  type="button"
                  style={styles.agentLaneIconButton}
                  data-testid="map-agent-lane-copy-brief"
                  title="Copy agent supervision brief"
                  aria-label="Copy agent supervision brief"
                  onClick={() => {
                    if (navigator.clipboard?.writeText) {
                      void navigator.clipboard.writeText(formatAgentLaneBrief(agentLane));
                    }
                  }}
                >
                  <ClipboardText size={13} weight="duotone" />
                </button>
                <span>{agentLane.total}</span>
              </span>
            </div>
            <div style={styles.agentLaneStats}>
              <span style={styles.agentLaneChip} data-testid="map-agent-lane-total">{agentLane.total} agents</span>
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
              data-testid="map-agent-lane-headline"
              aria-label="Agent cockpit headline"
              title={agentLane.cockpitHeadline.detail}
            >
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {agentLane.cockpitHeadline.label}
              </span>
              <span style={{ ...styles.rowMeta, marginTop: 0 }}>
                {agentLane.cockpitHeadline.detail}
              </span>
            </div>
            <div
              style={styles.agentLaneItem}
              data-testid="map-agent-lane-health"
              aria-label="Agent lane health"
              title={agentLaneHealthText(agentLane)}
            >
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                Health
              </span>
              <span style={{ ...styles.rowMeta, marginTop: 0 }}>
                {agentLaneHealthText(agentLane)}
              </span>
            </div>
            {agentLane.missionBreakdown.length > 0 && (
              <div
                style={styles.agentLaneItem}
                data-testid="map-agent-lane-mission-breakdown"
                title={missionBreakdownText(agentLane)}
              >
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  Mission mix
                </span>
                <span style={{ ...styles.rowMeta, marginTop: 0 }}>
                  {missionBreakdownText(agentLane)}
                </span>
              </div>
            )}
            {agentLane.missionControlDispatchBreakdown.length > 0 && (
              <div
                style={styles.agentLaneItem}
                data-testid="map-agent-lane-dispatch-breakdown"
                title={missionControlDispatchBreakdownText(agentLane)}
              >
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  Dispatch mix
                </span>
                <span style={{ ...styles.rowMeta, marginTop: 0 }}>
                  {missionControlDispatchBreakdownText(agentLane)}
                </span>
              </div>
            )}
            {agentLane.providerBreakdown.length > 0 && (
              <div
                style={styles.agentLaneItem}
                data-testid="map-agent-lane-provider-breakdown"
                title={providerBreakdownText(agentLane)}
              >
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  Provider mix
                </span>
                <span style={{ ...styles.rowMeta, marginTop: 0 }}>
                  {providerBreakdownText(agentLane)}
                </span>
              </div>
            )}
            {agentLane.isolationBreakdown.length > 0 && (
              <div
                style={styles.agentLaneItem}
                data-testid="map-agent-lane-isolation-breakdown"
                title={isolationBreakdownText(agentLane)}
              >
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  Isolation mix
                </span>
                <span style={{ ...styles.rowMeta, marginTop: 0 }}>
                  {isolationBreakdownText(agentLane)}
                </span>
              </div>
            )}
            {agentLane.cleanupBreakdown.length > 0 && (
              <div
                style={styles.agentLaneItem}
                data-testid="map-agent-lane-cleanup-breakdown"
                title={cleanupBreakdownText(agentLane)}
              >
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  Cleanup mix
                </span>
                <span style={{ ...styles.rowMeta, marginTop: 0 }}>
                  {cleanupBreakdownText(agentLane)}
                </span>
              </div>
            )}
            {agentLane.readinessBreakdown.length > 0 && (
              <div
                style={styles.agentLaneItem}
                data-testid="map-agent-lane-readiness-breakdown"
                title={readinessBreakdownText(agentLane)}
              >
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  Readiness mix
                </span>
                <span style={{ ...styles.rowMeta, marginTop: 0 }}>
                  {readinessBreakdownText(agentLane)}
                </span>
              </div>
            )}
            {agentLane.attentionBreakdown.length > 0 && (
              <div
                style={styles.agentLaneItem}
                data-testid="map-agent-lane-attention-breakdown"
                title={attentionBreakdownText(agentLane)}
              >
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  Attention mix
                </span>
                <span style={{ ...styles.rowMeta, marginTop: 0 }}>
                  {attentionBreakdownText(agentLane)}
                </span>
              </div>
            )}
            {agentLane.riskBreakdown.length > 0 && (
              <div
                style={styles.agentLaneItem}
                data-testid="map-agent-lane-risk-breakdown"
                title={riskBreakdownText(agentLane)}
              >
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  Risk mix
                </span>
                <span style={{ ...styles.rowMeta, marginTop: 0 }}>
                  {riskBreakdownText(agentLane)}
                </span>
              </div>
            )}
            {agentLane.closeoutBreakdown.length > 0 && (
              <div
                style={styles.agentLaneItem}
                data-testid="map-agent-lane-closeout-breakdown"
                title={closeoutBreakdownText(agentLane)}
              >
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  Closeout mix
                </span>
                <span style={{ ...styles.rowMeta, marginTop: 0 }}>
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
                      style={styles.agentLaneItem}
                      data-testid="map-agent-supervisor-item"
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
                        setWorkspaceMode("canvas");
                        if (node) focusCanvasNode(node);
                      }}
                    >
                      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {item.label}
                      </span>
                      <span style={{ ...styles.rowMeta, marginTop: 0 }}>
                        {item.title} · {item.runIdentity} · {item.workspaceIdentity} · Now: {item.activity} · Signal: {item.signalAge} · Source: {item.signalSource} · {item.detail}{missionControlAlternateText(item) ? ` · Also: ${missionControlAlternateText(item)}` : ""}
                      </span>
                    </button>
                  );
                })}
                {agentLane.hiddenMissionItemCount > 0 && (
                  <div
                    style={styles.agentLaneItem}
                    data-testid="map-agent-supervisor-overflow"
                    title={`${agentLane.hiddenMissionItemCount} mission rows and ${agentLane.hiddenMissionActionCount} actions hidden below the visible queue${agentLane.hiddenSupervisorItems[0] ? `: ${agentLane.hiddenSupervisorItems[0].title} · ${agentLane.hiddenSupervisorItems[0].label} · ${agentLane.hiddenSupervisorItems[0].detail}${missionControlAlternateText(agentLane.hiddenSupervisorItems[0]) ? ` · Also: ${missionControlAlternateText(agentLane.hiddenSupervisorItems[0])}` : ""}` : ""}`}
                  >
                    <span>+{agentLane.hiddenMissionItemCount} rows · {agentLane.hiddenMissionActionCount} actions</span>
                    <span style={{ ...styles.rowMeta, marginTop: 0 }}>
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
                style={styles.agentLaneItem}
                data-testid="map-agent-lane-attention"
                title={`Focus ${agentLane.primaryAttention.title}`}
                onClick={() => {
                  const node = canvasState.nodes.find((candidate) => candidate.terminalTabId === agentLane.primaryAttention?.tabId);
                  setActiveTab(agentLane.primaryAttention!.tabId);
                  setWorkspaceMode("canvas");
                  if (node) focusCanvasNode(node);
                }}
              >
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {agentLane.primaryAttention.label}
                </span>
                <span style={{ ...styles.rowMeta, marginTop: 0 }}>
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
                      style={styles.agentLaneItem}
                      data-testid="map-agent-attention-item"
                      title={`Focus ${item.title}`}
                      onClick={() => {
                        setActiveTab(item.tabId);
                        setWorkspaceMode("canvas");
                        if (node) focusCanvasNode(node);
                      }}
                    >
                      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {item.label}
                      </span>
                      <span style={{ ...styles.rowMeta, marginTop: 0 }}>
                        {item.title} · {item.detail}
                      </span>
                    </button>
                  );
                })}
                {agentLane.attentionItems.length > 3 && (
                  <div style={styles.agentLaneOverflow} data-testid="map-agent-attention-overflow">
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
                    style={styles.agentLaneItem}
                    data-testid="map-agent-workspace-group"
                    title={`Copy workspace group ${group.label}`}
                    onClick={() => {
                      if (!group.primaryTabId) return;
                      setActiveTab(group.primaryTabId);
                      if (navigator.clipboard?.writeText) {
                        void navigator.clipboard.writeText(group.brief);
                      }
                      setWorkspaceMode("canvas");
                      if (node) focusCanvasNode(node);
                    }}
                  >
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {group.label}
                    </span>
                    <span style={{ ...styles.rowMeta, marginTop: 0 }}>
                      {group.total} agents · {group.active} active · {group.detail}{cleanupText}{attentionText}
                    </span>
                  </button>
                );
              })}
              {agentLane.workspaceGroups.length > 3 && (
                <div style={styles.agentLaneOverflow} data-testid="map-agent-workspace-group-overflow">
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
                      style={styles.agentLaneItem}
                      data-testid="map-agent-recent-event"
                      title={`Copy event for ${item.title}`}
                      onClick={() => {
                        setActiveTab(item.tabId);
                        if (navigator.clipboard?.writeText) {
                          void navigator.clipboard.writeText(item.brief);
                        }
                        setWorkspaceMode("canvas");
                        if (node) focusCanvasNode(node);
                      }}
                    >
                      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        Copy event
                      </span>
                      <span style={{ ...styles.rowMeta, marginTop: 0 }}>
                        {item.title} · {item.label}{item.detail ? ` · ${item.detail}` : ""}
                      </span>
                    </button>
                  );
                })}
                {agentLane.recentEvents.length > 3 && (
                  <div
                    style={styles.agentLaneItem}
                    data-testid="map-agent-recent-event-overflow"
                    title={`${agentLane.recentEvents.length - 3} recent events hidden below the visible event list`}
                  >
                    <span>+{agentLane.recentEvents.length - 3} more events</span>
                    <span style={{ ...styles.rowMeta, marginTop: 0 }}>
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
                      style={styles.agentLaneItem}
                      data-testid="map-agent-input-item"
                      title={`Copy prompt for ${item.title}`}
                      onClick={() => {
                        setActiveTab(item.tabId);
                        if (navigator.clipboard?.writeText) {
                          void navigator.clipboard.writeText(item.brief);
                        }
                        setWorkspaceMode("canvas");
                        if (node) focusCanvasNode(node);
                      }}
                    >
                      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        Copy prompt
                      </span>
                      <span style={{ ...styles.rowMeta, marginTop: 0 }}>
                        {item.title} · {item.state} · {item.text}
                      </span>
                    </button>
                  );
                })}
                {agentLane.inputItems.length > 3 && (
                  <div
                    style={styles.agentLaneItem}
                    data-testid="map-agent-input-overflow"
                    title={`${agentLane.inputItems.length - 3} operator prompts hidden below the visible prompt list`}
                  >
                    <span>+{agentLane.inputItems.length - 3} more prompts</span>
                    <span style={{ ...styles.rowMeta, marginTop: 0 }}>
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
                      style={styles.agentLaneItem}
                      data-testid="map-agent-output-item"
                      title={`Copy terminal output for ${item.title}`}
                      onClick={() => {
                        setActiveTab(item.tabId);
                        if (navigator.clipboard?.writeText) {
                          void navigator.clipboard.writeText(item.brief);
                        }
                        setWorkspaceMode("canvas");
                        if (node) focusCanvasNode(node);
                      }}
                    >
                      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        Copy output
                      </span>
                      <span style={{ ...styles.rowMeta, marginTop: 0 }}>
                        {item.title} · {item.output}
                      </span>
                    </button>
                  );
                })}
                {agentLane.outputItems.length > 3 && (
                  <div
                    style={styles.agentLaneItem}
                    data-testid="map-agent-output-overflow"
                    title={`${agentLane.outputItems.length - 3} terminal outputs hidden below the visible output list`}
                  >
                    <span>+{agentLane.outputItems.length - 3} more output</span>
                    <span style={{ ...styles.rowMeta, marginTop: 0 }}>
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
                      style={styles.agentLaneItem}
                      data-testid="map-agent-next-item"
                      title={`Copy next action for ${item.title}`}
                      onClick={() => {
                        setActiveTab(item.tabId);
                        if (navigator.clipboard?.writeText) {
                          void navigator.clipboard.writeText(item.brief);
                        }
                        setWorkspaceMode("canvas");
                        if (node) focusCanvasNode(node);
                      }}
                    >
                      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        Copy next
                      </span>
                      <span style={{ ...styles.rowMeta, marginTop: 0 }}>
                        {item.title} · {item.nextAction}
                      </span>
                    </button>
                  );
                })}
                {agentLane.nextItems.length > 3 && (
                  <div
                    style={styles.agentLaneItem}
                    data-testid="map-agent-next-overflow"
                    title={`${agentLane.nextItems.length - 3} next actions hidden below the visible next-action list`}
                  >
                    <span>+{agentLane.nextItems.length - 3} more next</span>
                    <span style={{ ...styles.rowMeta, marginTop: 0 }}>
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
                      style={{ ...styles.agentLaneItem, gridTemplateColumns: "minmax(0, 1fr) auto", cursor: "default" }}
                      data-testid="map-agent-extracted-item"
                      data-review-state={item.reviewState}
                      title={`${item.label} ${item.reviewState} for ${item.title}`}
                    >
                      <span style={{ minWidth: 0 }}>
                        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>
                          {item.label} · {item.reviewState}
                        </span>
                        <span style={{ ...styles.rowMeta, marginTop: 0 }}>
                          {item.title} · {item.text} · {item.source}
                        </span>
                      </span>
                      <span style={styles.serviceActions}>
                        <button
                          type="button"
                          style={{ ...styles.serviceActionButton, width: "auto", minWidth: 42, padding: "0 6px" }}
                          title={`Focus ${item.title}`}
                          aria-label={`Focus ${item.label}`}
                          onClick={() => {
                            setActiveTab(item.tabId);
                            setWorkspaceMode("canvas");
                            if (node) focusCanvasNode(node);
                          }}
                        >
                          Focus
                        </button>
                        <button
                          type="button"
                          style={{ ...styles.serviceActionButton, width: "auto", minWidth: 40, padding: "0 6px" }}
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
                          style={{ ...styles.serviceActionButton, width: "auto", minWidth: 40, padding: "0 6px" }}
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
                          style={{ ...styles.serviceActionButton, width: "auto", minWidth: 48, padding: "0 6px" }}
                          title={`Accept ${item.text}`}
                          aria-label={`Accept ${item.label}`}
                          onClick={() => useWorkspaceStore.getState().reviewCockpitObject(item.tabId, item.objectId, "accepted")}
                        >
                          Accept
                        </button>
                        <button
                          type="button"
                          style={{ ...styles.serviceActionButton, width: "auto", minWidth: 52, padding: "0 6px" }}
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
                    data-testid="map-agent-extracted-overflow"
                    title={`${agentLane.extractedItems.length - 4} extracted cockpit objects hidden below the visible list`}
                  >
                    <span>+{agentLane.extractedItems.length - 4} more extracted</span>
                    <span style={{ ...styles.rowMeta, marginTop: 0 }}>
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
                      style={styles.agentLaneItem}
                      data-testid="map-agent-stale-item"
                      title={`Send status check to ${item.title}`}
                      onClick={() => {
                        setActiveTab(item.tabId);
                        useWorkspaceStore.getState().queueWorkstreamInput(item.tabId, item.prompt, {
                          source: "mission-control",
                          label: "Check in",
                        });
                        setWorkspaceMode("canvas");
                        if (node) focusCanvasNode(node);
                      }}
                    >
                      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        Check in
                      </span>
                      <span style={{ ...styles.rowMeta, marginTop: 0 }}>
                        {item.title} · {item.detail}
                      </span>
                    </button>
                  );
                })}
                {agentLane.staleItems.length > 3 && (
                  <div style={styles.agentLaneOverflow} data-testid="map-agent-stale-overflow">
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
                      style={styles.agentLaneItem}
                      data-testid="map-agent-risk-item"
                      title={`Send risk mitigation prompt to ${item.title}`}
                      onClick={() => {
                        setActiveTab(item.tabId);
                        useWorkspaceStore.getState().queueWorkstreamInput(item.tabId, item.prompt, {
                          source: "mission-control",
                          label: "Mitigate risk",
                        });
                        setWorkspaceMode("canvas");
                        if (node) focusCanvasNode(node);
                      }}
                    >
                      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        Mitigate
                      </span>
                      <span style={{ ...styles.rowMeta, marginTop: 0 }}>
                        {item.title} · {item.detail}
                      </span>
                    </button>
                  );
                })}
                {agentLane.riskItems.length > 3 && (
                  <div style={styles.agentLaneOverflow} data-testid="map-agent-risk-overflow">
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
                      style={styles.agentLaneItem}
                      data-testid="map-agent-auth-item"
                      title={`Copy auth handoff for ${item.title}`}
                      onClick={() => {
                        setActiveTab(item.tabId);
                        if (navigator.clipboard?.writeText) {
                          void navigator.clipboard.writeText(item.brief);
                        }
                        setWorkspaceMode("canvas");
                        if (node) focusCanvasNode(node);
                      }}
                    >
                      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        Copy auth
                      </span>
                      <span style={{ ...styles.rowMeta, marginTop: 0 }}>
                        {item.title} · {item.reason} · {item.nextAction}
                      </span>
                    </button>
                  );
                })}
                {agentLane.authItems.length > 3 && (
                  <div
                    style={styles.agentLaneItem}
                    data-testid="map-agent-auth-overflow"
                    title={`${agentLane.authItems.length - 3} auth blockers hidden below the visible auth queue`}
                  >
                    <span>+{agentLane.authItems.length - 3} more auth</span>
                    <span style={{ ...styles.rowMeta, marginTop: 0 }}>
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
                      style={styles.agentLaneItem}
                      data-testid="map-agent-recovery-item"
                      title={`Send recovery prompt to ${item.title}`}
                      onClick={() => {
                        setActiveTab(item.tabId);
                        useWorkspaceStore.getState().queueWorkstreamInput(item.tabId, item.prompt, {
                          source: "mission-control",
                          label: "Recover",
                        });
                        setWorkspaceMode("canvas");
                        if (node) focusCanvasNode(node);
                      }}
                    >
                      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        Recover
                      </span>
                      <span style={{ ...styles.rowMeta, marginTop: 0 }}>
                        {item.title} · {item.reason} · {item.prompt}
                      </span>
                    </button>
                  );
                })}
                {agentLane.recoveryItems.length > 3 && (
                  <div style={styles.agentLaneOverflow} data-testid="map-agent-recovery-overflow">
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
                      style={styles.agentLaneItem}
                      data-testid="map-agent-proof-item"
                      title={`Send proof request to ${item.title}`}
                      onClick={() => {
                        setActiveTab(item.tabId);
                        useWorkspaceStore.getState().queueWorkstreamInput(item.tabId, item.request, {
                          source: "mission-control",
                          label: "Request proof",
                        });
                        setWorkspaceMode("canvas");
                        if (node) focusCanvasNode(node);
                      }}
                    >
                      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        Request proof
                      </span>
                      <span style={{ ...styles.rowMeta, marginTop: 0 }}>
                        {item.title} · {item.summary} · {item.request}
                      </span>
                    </button>
                  );
                })}
                {agentLane.proofItems.length > 3 && (
                  <div
                    style={styles.agentLaneItem}
                    data-testid="map-agent-proof-overflow"
                    title={`${agentLane.proofItems.length - 3} proof requests hidden below the visible proof queue`}
                  >
                    <span>+{agentLane.proofItems.length - 3} more proof</span>
                    <span style={{ ...styles.rowMeta, marginTop: 0 }}>
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
                      style={styles.agentLaneItem}
                      data-testid="map-agent-evidence-item"
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
                        setWorkspaceMode("canvas");
                        if (node) focusCanvasNode(node);
                      }}
                    >
                      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {item.artifactPath ? "Open proof" : "Copy proof"}
                      </span>
                      <span style={{ ...styles.rowMeta, marginTop: 0 }}>
                        {item.title} · {item.evidence}{item.artifact ? ` · ${item.artifact}` : ""}
                      </span>
                    </button>
                  );
                })}
                {agentLane.evidenceItems.length > 3 && (
                  <div
                    style={styles.agentLaneItem}
                    data-testid="map-agent-evidence-overflow"
                    title={`${agentLane.evidenceItems.length - 3} evidence rows hidden below the visible evidence queue`}
                  >
                    <span>+{agentLane.evidenceItems.length - 3} more evidence</span>
                    <span style={{ ...styles.rowMeta, marginTop: 0 }}>
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
                      style={styles.agentLaneItem}
                      data-testid="map-agent-review-item"
                      title={canCloseout ? `Mark ${item.title} reviewed` : `Review blocked for ${item.title} until proof and handoff memory are ready`}
                      onClick={() => {
                        setActiveTab(item.tabId);
                        setWorkspaceMode("canvas");
                        if (node) focusCanvasNode(node);
                        if (canCloseout) {
                          useWorkspaceStore.getState().reviewWorkstream(item.tabId, {
                            source: "mission-control",
                            label: "Review",
                          });
                        }
                      }}
                    >
                      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {canCloseout ? "Review" : "Blocked review"}
                      </span>
                      <span style={{ ...styles.rowMeta, marginTop: 0 }}>
                        {item.title} · {item.proofStatus} · {item.handoffStatus} · {item.summary} · {item.detail}
                      </span>
                    </button>
                  );
                })}
                {agentLane.reviewItems.length > 3 && (
                  <div
                    style={styles.agentLaneItem}
                    data-testid="map-agent-review-overflow"
                    title={`${agentLane.reviewItems.length - 3} review items hidden below the visible review queue`}
                  >
                    <span>+{agentLane.reviewItems.length - 3} more review</span>
                    <span style={{ ...styles.rowMeta, marginTop: 0 }}>
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
                      style={styles.agentLaneItem}
                      data-testid="map-agent-lane-memory"
                      title={`Copy memory for ${item.title}`}
                      onClick={() => {
                        setActiveTab(item.tabId);
                        if (navigator.clipboard?.writeText) {
                          void navigator.clipboard.writeText(item.brief);
                        }
                        setWorkspaceMode("canvas");
                        if (node) focusCanvasNode(node);
                      }}
                    >
                      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        Copy memory
                      </span>
                      <span style={{ ...styles.rowMeta, marginTop: 0 }}>
                        {item.title} · {item.memory}
                      </span>
                    </button>
                  );
                })}
                {agentLane.memoryItems.length > 3 && (
                  <div
                    style={styles.agentLaneItem}
                    data-testid="map-agent-memory-overflow"
                    title={`${agentLane.memoryItems.length - 3} memory rows hidden below the visible handoff-memory list`}
                  >
                    <span>+{agentLane.memoryItems.length - 3} more memory</span>
                    <span style={{ ...styles.rowMeta, marginTop: 0 }}>
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
                const title = workstream.mission ?? workstream.prompt ?? tab.title;
                const scanStatus = workstreamScanStatus(workstream);
                const attention = workstreamAttentionText(workstream);
                return (
                  <button
                    key={tab.id}
                    type="button"
                    style={styles.agentRunItem}
                    data-testid="map-agent-run-item"
                    title={`Focus ${title}`}
                    onClick={() => {
                      setActiveTab(tab.id);
                      if (navigator.clipboard?.writeText) {
                        void navigator.clipboard.writeText(formatAgentRunBrief(tab));
                      }
                      setWorkspaceMode("canvas");
                      if (node) focusCanvasNode(node);
                    }}
                  >
                    <span style={styles.agentRunTitle} data-testid="map-agent-run-title">
                      {title}
                    </span>
                    <span style={styles.agentRunMeta} data-testid="map-agent-run-status">
                      {scanStatus} · {workstreamLabel(workstream.provider).toLowerCase()} · {workstreamActivityText(workstream)} · {attention} · {formatWorkstreamOpsContext(workstream)}
                      {askText ? ` · ${askText}` : ""}
                    </span>
                  </button>
                );
              })}
              {agentLane.workstreams.length > 3 && (
                <div
                  style={styles.agentLaneItem}
                  data-testid="map-agent-run-overflow"
                  title={`${agentLane.workstreams.length - 3} agent runs hidden below the visible run list`}
                >
                  <span>+{agentLane.workstreams.length - 3} more agents</span>
                  <span style={{ ...styles.rowMeta, marginTop: 0 }}>
                    {workstreamScanStatus(agentLane.workstreams[3].workstream)} · {workstreamLabel(agentLane.workstreams[3].workstream.provider).toLowerCase()} · {workstreamActivityText(agentLane.workstreams[3].workstream)} · {workstreamAttentionText(agentLane.workstreams[3].workstream)} · {formatWorkstreamOpsContext(agentLane.workstreams[3].workstream)}
                    {latestMissionControlAskText(agentLane.workstreams[3].workstream) ? ` · ${latestMissionControlAskText(agentLane.workstreams[3].workstream)}` : ""}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
        {visibleNodes.length === 0 ? (
          <div style={{ ...styles.empty, order: 1 }} data-testid="map-node-empty">
            {mapFilter === "all" ? "No map nodes yet." : "No map nodes match this filter."}
          </div>
        ) : (
          <div data-testid="map-node-list" ref={mapNodeListRef} style={{ order: 1 }}>
          {mapListItems.map((item) => {
            if (item.kind === "header") {
              return (
                <div key={item.key} data-flip-key={item.key} style={styles.sectionLabel} data-testid="map-project-group-header">
                  {item.label}
                </div>
              );
            }
            const node = item.node;
            const linkedTab = node.terminalTabId
              ? tabs.find((tab) => tab.id === node.terminalTabId)
              : undefined;
            const liveTermId =
              linkedTab?.terminals.find((t) => t.paneId === linkedTab.activePaneId)?.id ??
              node.terminalPtyId ??
              linkedTab?.terminals[0]?.id;
            const liveNodeCwd = liveTermId ? liveCwds[liveTermId] : undefined;
            // Title the row by what the node actually points at — a named project
            // wins, otherwise the tab's own name (or its current directory). Only
            // say "Unassigned" when there is genuinely nothing to name it by, so an
            // opened-folder tab reads as e.g. "arthouse", not "Unassigned".
            const linkedCwdName = (liveNodeCwd ?? node.terminalCwd ?? linkedTab?.initialCwd)
              ?.split("/")
              .filter(Boolean)
              .pop();
            const isDefaultTitle = !linkedTab?.title || linkedTab.title === "Terminal";
            const linkedProjectName = linkedTab?.groupId
              ? projectNameFor(linkedTab.groupId, groups)
              : (isDefaultTitle ? linkedCwdName : linkedTab?.title) ?? linkedCwdName ?? "Unassigned";
            const linkedProject = linkedTab?.groupId
              ? groups.find((group) => group.id === linkedTab.groupId)
              : undefined;
            const taskRoot = (
              linkedTab?.groupId
                ? groups.find((group) => group.id === linkedTab.groupId)?.projectRoot
                : undefined
            ) ?? node.terminalCwd ?? linkedTab?.initialCwd;
            const normalizedTaskRoot = taskRoot?.replace(/\/+$/, "");
            const boundTask = node.taskBinding && normalizedTaskRoot
              ? (tasksByRoot[normalizedTaskRoot] ?? []).find((task) =>
                  task.id.toLowerCase() === node.taskBinding?.taskId.toLowerCase()
                )
              : undefined;
            const liveTerminal = linkedTab ? terminalForNode(node, linkedTab) : undefined;
            const header = linkedTab && node.type !== "preview"
              ? sidebarHeaderForTerminal({
                  tab: linkedTab,
                  terminal: liveTerminal,
                  project: linkedProject,
                  liveCwd: liveNodeCwd,
                  liveGitRoot: liveTerminal?.id ? liveGitRoots[liveTerminal.id] : undefined,
                  spawnCwd: node.terminalCwd ?? linkedTab.initialCwd,
                  boundTask,
                })
              : null;
            const taskMissing = header
              ? header.sources.goal === "missing" || header.sources.goal === "none"
              : false;
            const activityMissing = header ? header.sources.activity === "missing" : false;
            const agentProvider = linkedTab?.workstream?.provider ?? liveTerminal?.agentProvider ?? liveTerminal?.statusSummary?.provider;
            const agentLabel = agentProviderIdentity(agentProvider);
            const showGhost = draggable && dropTarget?.id === node.id && draggingId !== node.id;
            return (
              <Fragment key={node.id}>
              {showGhost && dropTarget?.place === "before" && dragGhost}
              <div
                className="workspace-sidebar-row"
                data-flip-key={node.id}
                data-active={node.id === canvasState.selectedNodeId ? "true" : "false"}
                data-pane-id={header?.paneId}
                data-terminal-id={header?.terminalId}
                data-goal-source={header?.sources.goal}
                data-activity-source={header?.sources.activity}
                data-header-version={header?.version}
                draggable={draggable}
                style={{
                  ...styles.row,
                  ...styles.mapNodeRow,
                  ...(node.id === canvasState.selectedNodeId ? styles.activeRow : null),
                  ...(draggingId === node.id ? { opacity: 0.45 } : null),
                  ...(draggable ? { cursor: "grab" } : null),
                }}
                onDragStart={(event) => handleDragStart(node, event)}
                onDragOver={(event) => handleDragOver(node, event)}
                onDrop={(event) => handleDrop(node, event)}
                onDragEnd={clearDrag}
                onMouseDown={(event) => {
                  if (!draggable) event.preventDefault();
                }}
                onClick={() => {
                  if (node.terminalTabId && linkedTab) setActiveTab(linkedTab.id);
                  setWorkspaceMode("canvas");
                  focusCanvasNode(node);
                }}
                onDoubleClick={() => {
                  if (!node.terminalTabId || !linkedTab) return;
                  setActiveTab(linkedTab.id);
                  setWorkspaceMode("split");
                }}
                onContextMenu={(event) => {
                  if (!linkedTab) return;
                  onOpenTerminalMenu(event, linkedTab);
                }}
                title={header
                  ? `${header.workspace} · Task: ${header.goalLabel} · Now Active: ${header.currentActivity} · ${header.fullPath}`
                  : undefined}
              >
                {linkedProject && node.type !== "preview" ? (
                  <button
                    type="button"
                    style={styles.projectEmojiCell}
                    data-testid="map-node-project-emoji"
                    title={`Set ${linkedProject.name} project emoji`}
                    aria-label={`Set ${linkedProject.name} project emoji`}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenProjectMenu(event, {
                        id: linkedProject.id,
                        name: linkedProject.name,
                        emoji: linkedProject.emoji,
                      });
                    }}
                  >
                    {linkedProject.emoji ?? "💻"}
                  </button>
                ) : linkedTab && node.type !== "preview" ? (
                  <TerminalAvatar
                    tab={linkedTab}
                    active={node.id === canvasState.selectedNodeId}
                  />
                ) : (
                  <span style={styles.iconCell}>{nodeIcon(node)}</span>
                )}
                <span style={{ minWidth: 0 }}>
                  <div style={styles.rowTitle}>
                    {node.type === "preview" ? node.title : header ? header.workspace : linkedTab ? linkedProjectName : node.title}
                  </div>
                  <div style={styles.rowMeta}>
                    {header ? (
                      <>
                        <span
                          data-testid="sidebar-map-node-attention"
                          data-attention-state={badgeForAttention(paneBadgeAttention(liveTerminal)).state}
                          style={{ color: badgeForAttention(paneBadgeAttention(liveTerminal)).color, fontWeight: 600 }}
                        >
                          <span
                            style={{
                              display: "inline-block",
                              width: 6,
                              height: 6,
                              borderRadius: "50%",
                              background: badgeForAttention(paneBadgeAttention(liveTerminal)).color,
                              marginInlineEnd: 5,
                              verticalAlign: "middle",
                            }}
                          />
                          {badgeForAttention(paneBadgeAttention(liveTerminal)).label}
                        </span>
                        {agentLabel && (
                          <span data-testid="sidebar-map-node-agent-provider"> · <AgentProviderIdentity provider={agentProvider} /></span>
                        )}
                        {" · "}{pathTail(header.fullPath)}
                      </>
                    ) : node.type === "preview" ? (
                      node.previewUrl ?? "Localhost preview"
                    ) : node.terminalTabId && linkedTab ? (
                      `${pathTail(liveNodeCwd ?? node.terminalCwd ?? linkedTab.initialCwd)} · ${linkedTab.title}`
                    ) : (
                      `${Math.round(node.width)} x ${Math.round(node.height)}`
                    )}
                  </div>
                  {header && (
                    <div style={styles.sidebarHeaderLines}>
                      <div
                        style={styles.sidebarHeaderLine}
                        data-testid="sidebar-map-node-task-row"
                        title={`Task: ${header.goalLabel}`}
                      >
                        <span style={styles.sidebarHeaderLabel}>Task</span>
                        <span
                          style={{
                            ...styles.sidebarHeaderTask,
                            ...(taskMissing ? styles.sidebarHeaderWarning : null),
                          }}
                        >
                          {header.goalLabel}
                        </span>
                      </div>
                      {activityAddsInfo(header.goalLabel, header.currentActivity, paneBadgeAttention(liveTerminal)) && (
                      <div
                        style={styles.sidebarHeaderLine}
                        data-testid="sidebar-map-node-now-row"
                        title={`Now Active: ${header.currentActivity}`}
                      >
                        <span style={styles.sidebarHeaderLabel}>Now</span>
                        <span
                          style={{
                            ...styles.sidebarHeaderNow,
                            ...(activityMissing ? styles.sidebarHeaderWarning : null),
                          }}
                        >
                          {header.currentActivity}
                        </span>
                      </div>
                      )}
                    </div>
                  )}
                  {node.taskBinding && (
                    <div style={styles.taskInlineBadge} title={boundTask?.title ?? "Task not found in MASTER_PLAN.md"}>
                      <span
                        style={{
                          ...styles.taskDot,
                          background: taskStatusColor(boundTask?.status ?? "unknown"),
                        }}
                      />
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {node.taskBinding.taskId} · {taskStatusLabel(boundTask?.status ?? "unknown")}
                      </span>
                    </div>
                  )}
                </span>
                <span className="workspace-sidebar-actions" style={styles.rowActions}>
                  <button
                    className="workspace-sidebar-action workspace-sidebar-action--danger"
                    style={styles.rowActionButton}
                    title={node.type === "preview" ? "Close preview pane" : linkedTab ? "Close terminal session" : "Remove map node"}
                    aria-label={node.type === "preview" ? `Close ${node.title}` : linkedTab ? `Close ${linkedTab.title}` : `Remove ${node.title}`}
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
                    <X size={13} />
                  </button>
                </span>
              </div>
              {showGhost && dropTarget?.place === "after" && dragGhost}
              </Fragment>
            );
          })}
          </div>
        )}
      </div>
    </>
  );
}

export function WorkbenchSidebar() {
  const ui = useWorkspaceStore((state) => state.workspaceUiState);
  const operationsCollapsed = ui.primarySidebarCollapsed;
  const filesCollapsed = ui.fileExplorerCollapsed;
  const [terminalMenu, setTerminalMenu] = useState<{ tab: Tab; x: number; y: number } | null>(null);
  const [projectMenu, setProjectMenu] = useState<{ id: string; name: string; emoji?: string; x: number; y: number } | null>(null);

  const openTerminalMenu = (event: React.MouseEvent, tab: Tab) => {
    event.preventDefault();
    event.stopPropagation();
    setTerminalMenu({ tab, x: event.clientX, y: event.clientY });
  };

  const openProjectMenu = (event: React.MouseEvent, project: { id: string; name: string; emoji?: string }) => {
    event.preventDefault();
    event.stopPropagation();
    setProjectMenu({ id: project.id, name: project.name, emoji: project.emoji, x: event.clientX, y: event.clientY });
  };

  if (operationsCollapsed && filesCollapsed) {
    return (
      <aside style={{ ...styles.shell, ...styles.collapsed }} aria-label="Workspace sidebar">
        <SidebarRail collapsed />
      </aside>
    );
  }

  return (
    <aside style={styles.shell} aria-label="Workspace sidebar">
      <SidebarRail collapsed={operationsCollapsed} />
      {!operationsCollapsed && (
        <div style={{ ...styles.panel, ...styles.operationsPanel }} aria-label="Operations panel">
        {ui.primarySidebarPanel === "sessions" && (
          <SessionsPanel onOpenTerminalMenu={openTerminalMenu} onOpenProjectMenu={openProjectMenu} />
        )}
        {ui.primarySidebarPanel === "map" && (
          <MapPanel onOpenTerminalMenu={openTerminalMenu} onOpenProjectMenu={openProjectMenu} />
        )}
        </div>
      )}
      {!filesCollapsed && (
        <div style={styles.filePanel} aria-label="Files panel">
          <FileExplorer />
        </div>
      )}
      {terminalMenu && (
        <TerminalContextMenu
          tab={terminalMenu.tab}
          x={terminalMenu.x}
          y={terminalMenu.y}
          onClose={() => setTerminalMenu(null)}
        />
      )}
      {projectMenu && (
        <ProjectContextMenu
          id={projectMenu.id}
          name={projectMenu.name}
          emoji={projectMenu.emoji}
          x={projectMenu.x}
          y={projectMenu.y}
          onClose={() => setProjectMenu(null)}
        />
      )}
    </aside>
  );
}
