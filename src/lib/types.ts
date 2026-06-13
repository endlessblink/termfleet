export type TerminalRuntimeStatus = "starting" | "running" | "reconnected" | "stale" | "failed";

export interface TerminalState {
  id: string;      // PTY ID
  paneId: string;  // Which split pane this belongs to
  cols: number;
  rows: number;
  status?: TerminalRuntimeStatus;
  reused?: boolean;
  previewUrl?: string;
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
  cwd?: string;     // initial CWD for terminal nodes
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
export type WorkstreamStatus = "ready" | "running" | "waiting" | "failed" | "done" | "stopped";
export type WorkstreamEventKind = "created" | "provider" | "prompt" | "sent" | "status" | "control" | "signal";
export type WorkstreamPhase = "queued" | "launching" | "active" | "needs-input" | "complete" | "reviewed" | "cancelling" | "interrupted" | "blocked";
export type WorkstreamReadiness = "path-checked" | "provider-ready" | "auth-required" | "unknown";

export interface WorkstreamMetadata {
  kind: WorkstreamKind;
  provider?: AgentProvider;
  providerAvailable?: boolean;
  providerAvailabilityMessage?: string;
  role?: string;
  mission?: string;
  prompt?: string;
  startupCommand?: string;
  phase?: WorkstreamPhase;
  launchMode?: string;
  readinessCheck?: string;
  authCheck?: string;
  readiness?: WorkstreamReadiness;
  stopBehavior?: string;
  controlProtocol?: string;
  structuredStatus?: boolean;
  lastSummary?: string;
  nextAction?: string;
  evidence?: string;
  stage?: string;
  artifact?: string;
  confidence?: string;
  risk?: string;
  promptCount?: number;
  sentCount?: number;
  signalCount?: number;
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

export type MasterPlanTaskStatus = "todo" | "in-progress" | "blocked" | "done" | "unknown";

export interface CanvasTaskBinding {
  taskId: string;
  planPath?: string;
}

export interface CanvasNode {
  id: string;
  type: CanvasNodeType;
  title: string;
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
}

export interface CanvasState {
  nodes: CanvasNode[];
  selectedNodeId: string | null;
  viewport: {
    x: number;
    y: number;
    zoom: number;
  };
}
