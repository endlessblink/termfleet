export type TerminalRuntimeStatus =
  | "starting"
  | "running"
  | "reconnected"
  | "stale"
  | "failed"
  | "exited";
export type TerminalActivityStatus =
  | "idle"
  | "running"
  | "success"
  | "error"
  | "cancelled";
export type TerminalActivitySource =
  | "shell-integration"
  | "command"
  | "output"
  | "system";
export type TaskLineupStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "cancelled";
export type TaskLineupPriority = "high" | "medium" | "low";
export type TaskLineupSource =
  | "todo-write"
  | "structured-signal"
  | "summary"
  | "lane-checklist"
  | "operator";

export interface TaskLineupItem {
  id: string;
  runId?: string;
  content: string;
  status: TaskLineupStatus;
  priority?: TaskLineupPriority;
  source: TaskLineupSource;
  updatedAt: number;
}

export interface TerminalActivitySummary {
  title: string;
  subtitle?: string;
  targetPath?: string;
  status: TerminalActivityStatus;
  progress?: number;
  command?: string;
  startedAt?: number;
  completedAt?: number;
  exitCode?: number;
  source: TerminalActivitySource;
  updatedAt: number;
}

export type TerminalPurposeSource =
  | "task-binding"
  | "workstream"
  | "manual"
  | "inferred"
  | "missing";

export interface TerminalPurpose {
  title: string;
  source: TerminalPurposeSource;
  updatedAt?: number;
}

export interface TerminalState {
  id: string; // PTY ID
  paneId: string; // Which split pane this belongs to
  cols: number;
  rows: number;
  status?: TerminalRuntimeStatus;
  reused?: boolean;
  previewUrl?: string;
  currentActivity?: string;
  activityKind?: WorkstreamActivityKind;
  activityUpdatedAt?: number;
  durableActivity?: TerminalActivitySummary;
  activeRunId?: string;
  runClosed?: boolean;
  taskLineup?: TaskLineupItem[];
  purpose?: TerminalPurpose;
  taskSidebarCollapsed?: boolean;
  terminalOutput?: string;
  statusSummary?: WorkstreamStatusSummary;
  statusSummaryUpdatedAt?: number;
  statusSummarySource?: WorkstreamStatusSummarySource;
  statusSummaryError?: string;
  lastStatusAt?: number;
  lastError?: string;
}

export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  isHidden: boolean;
}

export interface SplitNode {
  id: string;
  type: "terminal" | "preview" | "split";
  direction?: "horizontal" | "vertical";
  children?: SplitNode[];
  sizes?: number[]; // percentage for each child (should sum to 100)
  cwd?: string; // initial CWD for terminal nodes
  previewUrl?: string;
  linkedTerminalPaneId?: string;
}

export interface Tab {
  id: string;
  title: string;
  emoji: string;
  color: string;
  groupId: string | null;
  workstream?: WorkstreamMetadata;
  terminals: TerminalState[];
  initialCwd?: string;
  splitLayout: SplitNode;
  activePaneId: string;
}

export type WorkstreamKind = "terminal" | "agent";
export type AgentProvider = "codex" | "claude" | "opencode" | "shell";
export type WorkstreamStatus =
  | "ready"
  | "running"
  | "waiting"
  | "failed"
  | "done"
  | "stopped";
export type WorkstreamEventKind =
  | "created"
  | "provider"
  | "prompt"
  | "sent"
  | "status"
  | "control"
  | "signal";
export type WorkstreamPhase =
  | "queued"
  | "launching"
  | "active"
  | "needs-input"
  | "complete"
  | "reviewed"
  | "cancelling"
  | "interrupted"
  | "blocked";
export type WorkstreamReadiness =
  | "path-checked"
  | "provider-ready"
  | "auth-required"
  | "unknown";
export type WorkstreamActivityKind =
  | "starting"
  | "running"
  | "thinking"
  | "testing"
  | "editing"
  | "waiting"
  | "blocked"
  | "complete"
  | "idle";
export type WorkstreamActivitySource =
  | "structured"
  | "terminal"
  | "operator"
  | "system";
export type WorkstreamIsolationMode =
  | "shared-worktree"
  | "dedicated-worktree"
  | "unknown";
export type WorkstreamIsolationStatus =
  | "shared"
  | "requested"
  | "ready"
  | "unavailable"
  | "unknown";
export type WorktreeCleanupStatus =
  | "not-needed"
  | "available"
  | "requested"
  | "manual"
  | "removed"
  | "blocked";
export type WorkstreamLaunchProfile = "terminal" | "headless";
export type WorkstreamStatusSummaryLifecycle =
  | "working"
  | "idle"
  | "waiting"
  | "blocked"
  | "stopped"
  | "done";
export type WorkstreamStatusSummaryConfidence = "low" | "medium" | "high";
export type WorkstreamStatusSummarySource = "fallback" | "process";
export type WorkstreamExtractionProvenance =
  | "terminal-output"
  | "structured-signal"
  | "operator-prompt"
  | "summary";
export type WorkstreamCockpitObjectKind =
  | "task"
  | "blocker"
  | "evidence"
  | "next-action";
export type WorkstreamCockpitObjectStatus = "open" | "accepted" | "dismissed";
export type WorkstreamCockpitObjectReviewState =
  | "new"
  | "accepted"
  | "dismissed"
  | "prompted"
  | "proof-requested";

export interface WorkstreamExtractedItem {
  id: string;
  text: string;
  provenance: WorkstreamExtractionProvenance;
  at: number;
  excerpt: string;
  sourceHash: string;
}

export interface WorkstreamCockpitObject {
  id: string;
  kind: WorkstreamCockpitObjectKind;
  text: string;
  status: WorkstreamCockpitObjectStatus;
  reviewState: WorkstreamCockpitObjectReviewState;
  source: WorkstreamExtractionProvenance;
  sourceExcerpt: string;
  sourceHash: string;
  ownerTabId: string;
  createdAt: number;
  updatedAt: number;
  resolvedAt?: number;
}

export interface WorkstreamStatusSummary {
  task: string;
  path: string;
  now: string;
  status: WorkstreamStatusSummaryLifecycle;
  provider?: AgentProvider;
  confidence?: WorkstreamStatusSummaryConfidence;
  proof?: string;
  blocker?: string;
  tasks?: WorkstreamExtractedItem[];
  blockers?: WorkstreamExtractedItem[];
  evidence?: WorkstreamExtractedItem[];
  nextActions?: WorkstreamExtractedItem[];
  // True when `tasks` is the agent's real Claude TodoWrite list (from the status
  // sidecar), not heuristic summary extraction → render as the `todo-write` source.
  tasksFromTodoWrite?: boolean;
  // Rolling log of the agent's recent actions (what it actually did), newest last.
  // Shown when there's no task list — reliable, not inferred.
  recent?: Array<{ text: string; at: number }>;
  // The agent's own last words (captured by the Stop hook from the turn transcript).
  // Used as the header title when there's no task list — what the model SAID it's doing,
  // not a heuristic scrape of terminal output.
  narration?: string;
}

export interface WorkstreamMetadata {
  kind: WorkstreamKind;
  provider?: AgentProvider;
  providerAvailable?: boolean;
  providerAvailabilityMessage?: string;
  role?: string;
  mission?: string;
  prompt?: string;
  cwd?: string;
  cwdLabel?: string;
  gitRoot?: string;
  gitBranch?: string;
  gitDirty?: boolean;
  worktreePath?: string;
  isolationMode?: WorkstreamIsolationMode;
  isolationStatus?: WorkstreamIsolationStatus;
  isolationNote?: string;
  worktreeCleanupStatus?: WorktreeCleanupStatus;
  worktreeCleanupNote?: string;
  startupCommand?: string;
  launchProfile?: WorkstreamLaunchProfile;
  phase?: WorkstreamPhase;
  launchMode?: string;
  readinessCheck?: string;
  authCheck?: string;
  readiness?: WorkstreamReadiness;
  stopBehavior?: string;
  controlProtocol?: string;
  structuredStatus?: boolean;
  currentActivity?: string;
  activityKind?: WorkstreamActivityKind;
  activitySource?: WorkstreamActivitySource;
  activityUpdatedAt?: number;
  lastSummary?: string;
  nextAction?: string;
  evidence?: string;
  memory?: string;
  stage?: string;
  artifact?: string;
  confidence?: string;
  risk?: string;
  terminalOutput?: string;
  terminalOutputUpdatedAt?: number;
  statusSummary?: WorkstreamStatusSummary;
  statusSummaryUpdatedAt?: number;
  statusSummarySource?: WorkstreamStatusSummarySource;
  statusSummaryError?: string;
  taskLineup?: TaskLineupItem[];
  activeRunId?: string;
  extractedTasks?: WorkstreamExtractedItem[];
  extractedBlockers?: WorkstreamExtractedItem[];
  extractedEvidence?: WorkstreamExtractedItem[];
  extractedNextActions?: WorkstreamExtractedItem[];
  cockpitObjects?: WorkstreamCockpitObject[];
  promptCount?: number;
  sentCount?: number;
  signalCount?: number;
  processedStructuredSignals?: string[];
  controlCount?: number;
  outcome?: string;
  runId?: string;
  exitCode?: number;
  inputQueue?: WorkstreamInput[];
  events?: WorkstreamEvent[];
  generation?: number;
  status: WorkstreamStatus;
  createdAt: number;
  completedAt?: number;
  reviewedAt?: number;
  lastActivityAt?: number;
}

export interface WorkstreamInput {
  id: string;
  text: string;
  createdAt: number;
  sentAt?: number;
  source?: "operator" | "mission-control";
  label?: string;
}

export interface WorkstreamEvent {
  id: string;
  kind: WorkstreamEventKind;
  label: string;
  detail?: string;
  status?: WorkstreamStatus;
  at: number;
}

export interface Group {
  id: string;
  name: string;
  color: string;
  emoji?: string;
  projectRoot?: string;
  lastActiveTabId?: string;
}

export interface OpenFile {
  path: string;
  name: string;
  dirty: boolean;
}

export type WorkspaceMode = "canvas" | "split" | "graph";
export type TerminalRendererMode =
  | "auto"
  | "web-xterm"
  | "native-vte"
  | "native-gpu"
  | "canvas2d";

export interface WorkspaceUiState {
  workspaceMode: WorkspaceMode;
  terminalRendererMode: TerminalRendererMode;
  immersiveTerminal: {
    enabled: boolean;
    tabId: string | null;
    paneId: string | null;
  };
  fileExplorerWidth: number;
  fileExplorerCollapsed: boolean;
  canvasSidebarCollapsed: boolean;
  terminalSidebarCollapsed: boolean;
  primarySidebarCollapsed: boolean;
  primarySidebarPanel: "sessions" | "map";
  previewUrl: string;
}

export type CanvasNodeType = "terminal" | "file" | "note" | "preview";

export type MasterPlanTaskStatus =
  | "todo"
  | "in-progress"
  | "blocked"
  | "done"
  | "unknown";

export interface CanvasTaskBinding {
  taskId: string;
  planPath?: string;
}

export interface CanvasNode {
  id: string;
  type: CanvasNodeType;
  title: string;
  labelColor?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  filePath?: string;
  terminalTabId?: string;
  terminalPtyId?: string;
  content?: string;
  terminalCwd?: string;
  previewUrl?: string;
  previewPaneId?: string;
  linkedTerminalPaneId?: string;
  taskBinding?: CanvasTaskBinding;
  taskSidebarCollapsed?: boolean;
}

export interface CanvasState {
  nodes: CanvasNode[];
  selectedNodeId: string | null;
  selectedNodeIds?: string[];
  viewport: {
    x: number;
    y: number;
    zoom: number;
  };
}
