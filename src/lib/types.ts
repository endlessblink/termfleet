export type TerminalRuntimeStatus = "starting" | "running" | "reconnected" | "stale" | "failed";

export interface TerminalState {
  id: string;      // PTY ID
  paneId: string;  // Which split pane this belongs to
  cols: number;
  rows: number;
  status?: TerminalRuntimeStatus;
  reused?: boolean;
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
  type: "terminal" | "split";
  direction?: "horizontal" | "vertical";
  children?: SplitNode[];
  sizes?: number[]; // percentage for each child (should sum to 100)
  cwd?: string;     // initial CWD for terminal nodes
}

export interface Tab {
  id: string;
  title: string;
  emoji: string;
  color: string;
  groupId: string | null;
  terminals: TerminalState[];
  initialCwd?: string;
  splitLayout: SplitNode;
  activePaneId: string;
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
export type TerminalRendererMode = "auto" | "web-xterm" | "native-vte" | "native-gpu";

export interface WorkspaceUiState {
  workspaceMode: WorkspaceMode;
  terminalRendererMode: TerminalRendererMode;
  fileExplorerWidth: number;
  fileExplorerCollapsed: boolean;
  canvasSidebarCollapsed: boolean;
  terminalSidebarCollapsed: boolean;
  primarySidebarCollapsed: boolean;
  primarySidebarPanel: "sessions" | "map";
}

export type CanvasNodeType = "terminal" | "file" | "note";

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
