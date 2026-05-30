import { create } from "zustand";
import type {
  CanvasNode,
  CanvasState,
  Tab,
  Group,
  OpenFile,
  TerminalState,
  WorkspaceMode,
  WorkspaceUiState,
} from "../lib/types";
import {
  splitNodeInTree,
  removeNodeFromTree,
  updateSizesInTree,
  getAllLeafIds,
  updatePaneCwdInTree,
} from "../lib/splitUtils";
import { destroyBrowserPtys } from "../hooks/usePty";

const GROUP_COLORS = [
  "#7aa2f7",
  "#9ece6a",
  "#bb9af7",
  "#f7768e",
  "#e0af68",
  "#7dcfff",
  "#ff9e64",
];

const DEFAULT_TAB_EMOJI = "\u2B1B";
const DEFAULT_TAB_TITLE = "Terminal";
const DEFAULT_TAB_COLOR = "#7aa2f7";
export const WORKSPACE_STORAGE_KEY = "terminal-workspace.v1";

function configuredTerminalRendererMode(): WorkspaceUiState["terminalRendererMode"] | null {
  const mode = import.meta.env.VITE_TERMINAL_RENDERER_MODE;
  return mode === "web-xterm" ||
    mode === "native-vte" ||
    mode === "native-gpu" ||
    mode === "canvas2d"
    ? mode
    : null;
}

function configuredWorkspaceMode(): WorkspaceUiState["workspaceMode"] | null {
  const mode = import.meta.env.VITE_WORKSPACE_MODE;
  return mode === "split" || mode === "canvas" || mode === "graph" ? mode : null;
}

function configuredWorkspaceResetState(): boolean {
  return import.meta.env.VITE_WORKSPACE_RESET_STATE === "1";
}

const FORCED_TERMINAL_RENDERER_MODE = configuredTerminalRendererMode();
const FORCED_WORKSPACE_MODE = configuredWorkspaceMode();
const FORCE_WORKSPACE_RESET_STATE = configuredWorkspaceResetState();
const DEFAULT_UI_STATE: WorkspaceUiState = {
  workspaceMode: FORCED_WORKSPACE_MODE ?? "split",
  terminalRendererMode: FORCED_TERMINAL_RENDERER_MODE ?? "auto",
  fileExplorerWidth: 260,
  fileExplorerCollapsed: false,
  canvasSidebarCollapsed: false,
  terminalSidebarCollapsed: false,
  primarySidebarCollapsed: false,
  primarySidebarPanel: "sessions",
};
const DEFAULT_CANVAS_STATE: CanvasState = {
  nodes: [
    {
      id: "welcome-canvas-node",
      type: "note",
      title: "Workspace Map",
      x: 120,
      y: 90,
      width: 320,
      height: 190,
      content: "Map the project, active shells, and files that matter to the current run.",
    },
  ],
  selectedNodeId: "welcome-canvas-node",
  viewport: { x: 0, y: 0, zoom: 1 },
};
const TERMINAL_MAP_NODE_SIZE = { width: 640, height: 360 };
const CANVAS_NODE_MIN_SIZE: Record<CanvasNode["type"], { width: number; height: number }> = {
  terminal: TERMINAL_MAP_NODE_SIZE,
  file: { width: 260, height: 120 },
  note: { width: 220, height: 120 },
};

function createDefaultTab(overrides: Partial<Tab> = {}): Tab {
  const paneId = crypto.randomUUID();
  return {
    id: crypto.randomUUID(),
    title: DEFAULT_TAB_TITLE,
    emoji: DEFAULT_TAB_EMOJI,
    color: DEFAULT_TAB_COLOR,
    groupId: null,
    terminals: [],
    splitLayout: { id: paneId, type: "terminal" as const },
    activePaneId: paneId,
    ...overrides,
  };
}

interface WorkspaceState {
  tabs: Tab[];
  groups: Group[];
  terminalGroups: Group[];
  openFiles: OpenFile[];
  activeTabId: string | null;
  activeTerminalId: string | null;
  activeGroupId: string | null;
  activeGroupFilter: string | null;
  projectRoot: string | null;
  workspaceUiState: WorkspaceUiState;
  canvasState: CanvasState;

  // Tab actions
  addTab: (tab?: Partial<Tab>) => void;
  removeTab: (id: string) => void;
  closeTerminalSession: (id: string) => Promise<void>;
  setActiveTab: (id: string) => void;
  updateTab: (id: string, updates: Partial<Tab>) => void;
  reorderTabs: (fromIndex: number, toIndex: number) => void;

  // Group actions
  addGroup: (name: string, color?: string, projectRoot?: string) => string;
  removeGroup: (id: string) => void;
  updateGroup: (id: string, updates: Partial<Group>) => void;
  setGroupFilter: (groupId: string | null) => void;
  switchProject: (groupId: string | null) => void;
  setProjectRoot: (path: string | null, syncTerminal?: boolean) => void;
  setActiveTerminal: (id: string | null) => void;
  addOpenFile: (file: OpenFile) => void;
  removeOpenFile: (path: string) => void;
  setWorkspaceMode: (mode: WorkspaceMode) => void;
  reconcileCanvasState: () => void;
  updateWorkspaceUiState: (updates: Partial<WorkspaceUiState>) => void;
  addCanvasNode: (node: Omit<CanvasNode, "id"> & { id?: string }) => void;
  updateCanvasNode: (id: string, updates: Partial<CanvasNode>) => void;
  removeCanvasNode: (id: string) => void;
  selectCanvasNode: (id: string | null) => void;
  updateCanvasViewport: (viewport: Partial<CanvasState["viewport"]>) => void;

  // Split pane actions
  splitPane: (tabId: string, paneId: string, direction: "horizontal" | "vertical", cwd?: string) => string;
  closePane: (tabId: string, paneId: string) => void;
  setActivePane: (tabId: string, paneId: string) => void;
  updateSplitSizes: (tabId: string, splitNodeId: string, sizes: number[]) => void;

  // Computed
  getFilteredTabs: () => Tab[];
  getActiveTab: () => Tab | undefined;
}

const initialTab = createDefaultTab();

interface PersistedWorkspace {
  tabs?: Tab[];
  groups?: Group[];
  openFiles?: OpenFile[];
  activeTabId?: string | null;
  activeTerminalId?: string | null;
  activeGroupId?: string | null;
  activeGroupFilter?: string | null;
  projectRoot?: string | null;
  workspaceUiState?: Partial<WorkspaceUiState>;
  canvasState?: CanvasState;
}

function persistedTerminalSnapshot(terminal: TerminalState): TerminalState {
  return {
    id: terminal.id,
    paneId: terminal.paneId,
    cols: terminal.cols,
    rows: terminal.rows,
    status: "stale",
    reused: false,
    lastStatusAt: Date.now(),
    lastError: "Session will reconnect if the backend is still running; otherwise it will restart.",
  };
}

function withRestartableTerminals(tab: Tab): Tab {
  const leafIds = new Set(getAllLeafIds(tab.splitLayout));
  return {
    ...tab,
    terminals: tab.terminals
      .filter((terminal) => leafIds.has(terminal.paneId))
      .map((terminal) => ({
        ...terminal,
        status: "stale",
        reused: false,
        lastError: "Session was restored from workspace metadata.",
      })),
  };
}

function normalizeWorkspaceUiState(uiState: Partial<WorkspaceUiState> | undefined): WorkspaceUiState {
  const terminalRendererMode =
    FORCED_TERMINAL_RENDERER_MODE ??
    (uiState?.terminalRendererMode === "web-xterm" ||
    uiState?.terminalRendererMode === "native-vte" ||
    uiState?.terminalRendererMode === "native-gpu"
      ? uiState.terminalRendererMode
      : "auto");

  return {
    ...DEFAULT_UI_STATE,
    ...uiState,
    workspaceMode: FORCED_WORKSPACE_MODE ?? uiState?.workspaceMode ?? DEFAULT_UI_STATE.workspaceMode,
    terminalRendererMode,
    primarySidebarPanel: uiState?.primarySidebarPanel === "map" ? "map" : "sessions",
  };
}

function terminalNodePosition(index: number) {
  return {
    x: 120 + (index % 3) * 700,
    y: 100 + Math.floor(index / 3) * 430,
  };
}

function terminalNodeForTab(tab: Tab, index: number): CanvasNode {
  const position = terminalNodePosition(index);
  return {
    id: `terminal-map-${tab.id}`,
    type: "terminal",
    title: tab.title,
    x: position.x,
    y: position.y,
    width: TERMINAL_MAP_NODE_SIZE.width,
    height: TERMINAL_MAP_NODE_SIZE.height,
    terminalTabId: tab.id,
    terminalCwd: tab.initialCwd,
  };
}

function normalizeCanvasState(canvasState: CanvasState | undefined, tabs: Tab[]): CanvasState {
  const source = canvasState ?? DEFAULT_CANVAS_STATE;
  const tabIds = new Set(tabs.map((tab) => tab.id));
  const liveTerminalIds = new Set(tabs.flatMap((tab) => tab.terminals.map((terminal) => terminal.id)));
  const seenNodeIds = new Set<string>();
  const seenTerminalTabIds = new Set<string>();
  const normalizedNodes: CanvasNode[] = [];

  for (const node of source.nodes) {
    if (seenNodeIds.has(node.id)) continue;
    if (node.id.startsWith("terminal-node-")) continue;
    if (node.type === "terminal" && node.terminalTabId) {
      if (!tabIds.has(node.terminalTabId)) continue;
      if (seenTerminalTabIds.has(node.terminalTabId)) continue;
      seenTerminalTabIds.add(node.terminalTabId);
    }

    const min = CANVAS_NODE_MIN_SIZE[node.type];
    if (node.type === "terminal") {
      normalizedNodes.push({
        ...node,
        terminalPtyId: node.terminalPtyId && liveTerminalIds.has(node.terminalPtyId)
          ? node.terminalPtyId
          : undefined,
        width: TERMINAL_MAP_NODE_SIZE.width,
        height: TERMINAL_MAP_NODE_SIZE.height,
      });
    } else {
      normalizedNodes.push({
        ...node,
        width: Math.max(node.width, min.width),
        height: Math.max(node.height, min.height),
      });
    }

    seenNodeIds.add(node.id);
  }

  const missingTerminalNodes = tabs
    .filter((tab) => !seenTerminalTabIds.has(tab.id))
    .map((tab, index) => terminalNodeForTab(tab, seenTerminalTabIds.size + index));
  const nodes = [...normalizedNodes, ...missingTerminalNodes];
  const selectedNodeId =
    nodes.some((node) => node.id === source.selectedNodeId)
      ? source.selectedNodeId
      : nodes[0]?.id ?? null;

  return {
    ...DEFAULT_CANVAS_STATE,
    ...source,
    nodes,
    selectedNodeId,
    viewport: {
      ...DEFAULT_CANVAS_STATE.viewport,
      ...source.viewport,
    },
  };
}

function loadPersistedWorkspace(): PersistedWorkspace {
  if (FORCE_WORKSPACE_RESET_STATE) {
    localStorage.removeItem(WORKSPACE_STORAGE_KEY);
    return {};
  }

  try {
    const raw = localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as PersistedWorkspace;
  } catch (error) {
    console.warn("Could not restore workspace state:", error);
    return {};
  }
}

export function resetPersistedWorkspace() {
  localStorage.removeItem(WORKSPACE_STORAGE_KEY);
}

const persisted = loadPersistedWorkspace();
const restoredTabs =
  persisted.tabs && persisted.tabs.length > 0
    ? persisted.tabs.map(withRestartableTerminals)
    : [initialTab];
const restoredActiveTabId =
  restoredTabs.find((tab) => tab.id === persisted.activeTabId)?.id ?? restoredTabs[0].id;

/** Create a new tab in the active project, opening at the project root when one is selected. */
export async function createNewTab() {
  const { invoke } = await import("@tauri-apps/api/core");
  const store = useWorkspaceStore.getState();
  const activeTab = store.tabs.find((t) => t.id === store.activeTabId);

  // The new tab belongs to the active project filter (falling back to the active tab's project).
  const groupId = store.activeGroupFilter ?? activeTab?.groupId ?? null;
  const targetGroup = groupId ? store.groups.find((group) => group.id === groupId) : null;

  let cwd: string | undefined;

  if (targetGroup?.projectRoot) {
    // A project is selected: its root is authoritative so the terminal reflects the project.
    cwd = targetGroup.projectRoot;
  } else if (activeTab && activeTab.terminals.length > 0) {
    // No project context: inherit the live cwd of the active terminal (transport-aware).
    const activeTerminal =
      activeTab.terminals.find((terminal) => terminal.paneId === activeTab.activePaneId) ??
      activeTab.terminals[0];
    try {
      cwd = await getPtyCwd(activeTerminal.id, invoke);
    } catch (e) {
      console.warn("Could not get CWD from active terminal:", e);
      cwd = activeTab.initialCwd ?? store.projectRoot ?? undefined;
    }
  } else {
    cwd = activeTab?.initialCwd ?? store.projectRoot ?? undefined;
  }

  store.addTab({ initialCwd: cwd, groupId });
}

export function createTerminalTab(cwd?: string) {
  const store = useWorkspaceStore.getState();
  const groupId = store.activeGroupFilter ?? store.activeGroupId;
  const targetGroup = groupId ? store.groups.find((group) => group.id === groupId) : null;
  const resolvedCwd = cwd ?? targetGroup?.projectRoot ?? store.projectRoot ?? undefined;
  const name = resolvedCwd ? resolvedCwd.split("/").filter(Boolean).pop() ?? resolvedCwd : DEFAULT_TAB_TITLE;
  store.addTab({
    title: name,
    emoji: "\u{1F4C1}",
    initialCwd: resolvedCwd,
    groupId,
  });
}

/** Split the active pane, inheriting CWD */
export async function splitActivePane(direction: "horizontal" | "vertical") {
  const { invoke } = await import("@tauri-apps/api/core");
  const store = useWorkspaceStore.getState();
  const tab = store.tabs.find((t) => t.id === store.activeTabId);
  if (!tab) return;

  const paneTerminal = tab.terminals.find((t) => t.paneId === tab.activePaneId);
  let cwd: string | undefined;
  if (paneTerminal) {
    try {
      cwd = await getPtyCwd(paneTerminal.id, invoke);
    } catch (e) {
      console.warn("Could not get CWD for split:", e);
    }
  }

  store.splitPane(tab.id, tab.activePaneId, direction, cwd);
}

/** Close the active pane */
export async function closeActivePane() {
  const { invoke } = await import("@tauri-apps/api/core");
  const store = useWorkspaceStore.getState();
  const tab = store.tabs.find((t) => t.id === store.activeTabId);
  if (!tab) return;

  // If only one pane, close the entire tab instead
  const leaves = getAllLeafIds(tab.splitLayout);
  if (leaves.length <= 1) {
    await store.closeTerminalSession(tab.id);
    return;
  }

  // Kill the PTY for this pane
  const paneTerminal = tab.terminals.find((t) => t.paneId === tab.activePaneId);
  if (paneTerminal) {
    try {
      await killPty(paneTerminal.id, invoke);
    } catch (e) {
      console.warn("Could not kill PTY:", e);
    }
  }

  store.closePane(tab.id, tab.activePaneId);
}

async function isDaemonReachable(invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>) {
  try {
    const status = await invoke<{ reachable: boolean; mode: string }>("daemon_status");
    return status.reachable && status.mode === "externalDaemon";
  } catch {
    return false;
  }
}

async function getPtyCwd(
  id: string,
  invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>
) {
  if (await isDaemonReachable(invoke)) {
    return invoke<string>("daemon_get_session_cwd", { id });
  }
  return invoke<string>("pty_get_cwd", { id });
}

async function killPty(
  id: string,
  invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>
) {
  if (await isDaemonReachable(invoke)) {
    return invoke("daemon_kill_session", { id });
  }
  return invoke("pty_kill", { id });
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

async function writePty(
  id: string,
  data: string,
  invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>
) {
  if (await isDaemonReachable(invoke)) {
    return invoke("daemon_write_session", { id, data });
  }
  return invoke("pty_write", { id, data });
}

async function syncActiveTerminalCwd(path: string) {
  const state = useWorkspaceStore.getState();
  const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId);
  const activeTerminal = activeTab?.terminals.find((terminal) =>
    terminal.paneId === activeTab.activePaneId
  );
  if (!activeTerminal) return;

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const current = await getPtyCwd(activeTerminal.id, invoke).catch(() => null);
    if (current === path) return;
    await writePty(activeTerminal.id, `cd -- ${shellQuote(path)}\r`, invoke);
  } catch (error) {
    console.warn("Could not sync terminal CWD to project root:", error);
  }
}

export async function refreshProjectRootFromActiveTerminal() {
  const state = useWorkspaceStore.getState();
  const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId);
  const activeTerminal = activeTab?.terminals.find((terminal) =>
    terminal.paneId === activeTab.activePaneId
  );
  if (!activeTerminal) return;

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const cwd = await getPtyCwd(activeTerminal.id, invoke);
    if (!cwd || cwd === state.projectRoot) return;
    useWorkspaceStore.getState().setProjectRoot(cwd, false);
  } catch (error) {
    console.warn("Could not refresh project root from terminal CWD:", error);
  }
}

async function killPtys(ptyIds: string[]) {
  if (ptyIds.length === 0) return;
  destroyBrowserPtys(ptyIds);

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await Promise.all(
      ptyIds.map(async (id) => {
        try {
          await killPty(id, invoke);
        } catch (error) {
          console.warn("Could not kill PTY:", id, error);
        }
      })
    );
  } catch (error) {
    console.warn("Could not reach Tauri PTY bridge:", error);
  }
}

function selectNodeAfterRemovingTerminalTab({
  state,
  remainingNodes,
  removedTabId,
  nextTabId,
  followNextTab,
}: {
  state: WorkspaceState;
  remainingNodes: CanvasNode[];
  removedTabId: string;
  nextTabId: string | null;
  followNextTab: boolean;
}) {
  if (followNextTab && nextTabId) {
    return remainingNodes.find((node) => node.terminalTabId === nextTabId)?.id ?? null;
  }

  const selectedNode = state.canvasState.selectedNodeId
    ? state.canvasState.nodes.find((node) => node.id === state.canvasState.selectedNodeId)
    : undefined;

  if (selectedNode?.terminalTabId !== removedTabId) {
    return state.canvasState.selectedNodeId;
  }

  if (!nextTabId) return null;

  return remainingNodes.find((node) => node.terminalTabId === nextTabId)?.id ?? null;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  tabs: restoredTabs,
  groups: persisted.groups ?? [],
  terminalGroups: persisted.groups ?? [],
  openFiles: persisted.openFiles ?? [],
  activeTabId: restoredActiveTabId,
  activeTerminalId: null,
  activeGroupId: persisted.activeGroupId ?? persisted.activeGroupFilter ?? null,
  activeGroupFilter: persisted.activeGroupFilter ?? persisted.activeGroupId ?? null,
  projectRoot: persisted.projectRoot ?? null,
  workspaceUiState: normalizeWorkspaceUiState(persisted.workspaceUiState),
  canvasState: normalizeCanvasState(persisted.canvasState, restoredTabs),

  // --- Tab actions ---

  addTab: (overrides?: Partial<Tab>) => {
    const newTab = createDefaultTab(overrides);
    set((state) => ({
      tabs: [...state.tabs, newTab],
      activeTabId: newTab.id,
      groups: newTab.groupId
        ? state.groups.map((group) =>
            group.id === newTab.groupId ? { ...group, lastActiveTabId: newTab.id } : group
          )
        : state.groups,
      terminalGroups: newTab.groupId
        ? state.terminalGroups.map((group) =>
            group.id === newTab.groupId ? { ...group, lastActiveTabId: newTab.id } : group
          )
        : state.terminalGroups,
      canvasState: normalizeCanvasState(
        {
          ...state.canvasState,
          nodes: [...state.canvasState.nodes, terminalNodeForTab(newTab, state.tabs.length)],
          selectedNodeId: `terminal-map-${newTab.id}`,
        },
        [...state.tabs, newTab]
      ),
    }));
  },

  removeTab: (id: string) => {
    set((state) => {
      const index = state.tabs.findIndex((t) => t.id === id);
      if (index === -1) return state;

      const remainingTabs = state.tabs.filter((t) => t.id !== id);
      const remainingNodes = state.canvasState.nodes.filter((node) => node.terminalTabId !== id);

      // If last tab was removed, create a fresh default tab
      if (remainingTabs.length === 0) {
        const replacement = createDefaultTab();
        const replacementCanvasState = normalizeCanvasState(
          {
            ...state.canvasState,
            nodes: remainingNodes,
          },
          [replacement]
        );
        return {
          tabs: [replacement],
          activeTabId: replacement.id,
          activeTerminalId: null,
          canvasState: {
            ...replacementCanvasState,
            selectedNodeId: replacementCanvasState.nodes.find((node) => node.terminalTabId === replacement.id)?.id ?? replacementCanvasState.nodes[0]?.id ?? null,
          },
        };
      }

      // Only update activeTabId if the removed tab was active
      if (state.activeTabId !== id) {
        return {
          tabs: remainingTabs,
          activeTerminalId: state.tabs
            .find((tab) => tab.id === id)
            ?.terminals.some((terminal) => terminal.id === state.activeTerminalId)
            ? null
            : state.activeTerminalId,
          canvasState: {
            ...state.canvasState,
            nodes: remainingNodes,
            selectedNodeId: selectNodeAfterRemovingTerminalTab({
              state,
              remainingNodes,
              removedTabId: id,
              nextTabId: null,
              followNextTab: false,
            }),
          },
        };
      }

      // Switch to adjacent tab: prefer next, fall back to previous
      const nextTab = remainingTabs[index] ?? remainingTabs[index - 1];

      return {
        tabs: remainingTabs,
        activeTabId: nextTab.id,
        activeTerminalId: null,
        canvasState: {
          ...state.canvasState,
          nodes: remainingNodes,
          selectedNodeId: selectNodeAfterRemovingTerminalTab({
            state,
            remainingNodes,
            removedTabId: id,
            nextTabId: nextTab.id,
            followNextTab: true,
          }),
        },
      };
    });
  },

  closeTerminalSession: async (id: string) => {
    const tab = get().tabs.find((candidate) => candidate.id === id);
    if (!tab) return;

    await killPtys(tab.terminals.map((terminal) => terminal.id));
    get().removeTab(id);
  },

  setActiveTab: (id: string) => {
    set((state) => {
      const activeTab = state.tabs.find((tab) => tab.id === id);
      const linkedNode = state.canvasState.nodes.find((node) => node.terminalTabId === id);
      return {
        activeTabId: id,
        groups: activeTab?.groupId
          ? state.groups.map((group) =>
              group.id === activeTab.groupId ? { ...group, lastActiveTabId: id } : group
            )
          : state.groups,
        terminalGroups: activeTab?.groupId
          ? state.terminalGroups.map((group) =>
              group.id === activeTab.groupId ? { ...group, lastActiveTabId: id } : group
            )
          : state.terminalGroups,
        canvasState: {
          ...state.canvasState,
          selectedNodeId: linkedNode?.id ?? state.canvasState.selectedNodeId,
        },
      };
    });
  },

  updateTab: (id: string, updates: Partial<Tab>) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === id ? { ...t, ...updates } : t
      ),
      canvasState: {
        ...state.canvasState,
        nodes: state.canvasState.nodes.map((node) =>
          node.terminalTabId === id
            ? {
                ...node,
                title: updates.title ?? node.title,
                terminalCwd: updates.initialCwd ?? node.terminalCwd,
              }
            : node
        ),
      },
    }));
  },

  reorderTabs: (fromIndex: number, toIndex: number) => {
    set((state) => {
      const tabs = [...state.tabs];
      const [moved] = tabs.splice(fromIndex, 1);
      tabs.splice(toIndex, 0, moved);
      return { tabs };
    });
  },

  // --- Group actions ---

  addGroup: (name: string, color?: string, projectRoot?: string) => {
    const { groups } = get();
    const resolvedColor =
      color ?? GROUP_COLORS[groups.length % GROUP_COLORS.length];
    const newGroup: Group = {
      id: crypto.randomUUID(),
      name,
      color: resolvedColor,
      projectRoot,
    };
    set((state) => ({
      groups: [...state.groups, newGroup],
      terminalGroups: [...state.groups, newGroup],
    }));
    return newGroup.id;
  },

  removeGroup: (id: string) => {
    set((state) => ({
      groups: state.groups.filter((g) => g.id !== id),
      terminalGroups: state.groups.filter((g) => g.id !== id),
      tabs: state.tabs.map((t) =>
        t.groupId === id ? { ...t, groupId: null } : t
      ),
      activeGroupFilter:
        state.activeGroupFilter === id ? null : state.activeGroupFilter,
      activeGroupId: state.activeGroupId === id ? null : state.activeGroupId,
    }));
  },

  updateGroup: (id: string, updates: Partial<Group>) => {
    set((state) => ({
      groups: state.groups.map((g) =>
        g.id === id ? { ...g, ...updates } : g
      ),
      terminalGroups: state.groups.map((g) =>
        g.id === id ? { ...g, ...updates } : g
      ),
    }));
  },

  setGroupFilter: (groupId: string | null) => {
    set({ activeGroupFilter: groupId, activeGroupId: groupId });
  },

  switchProject: (groupId: string | null) => {
    set((state) => {
      const project = groupId ? state.groups.find((group) => group.id === groupId) : null;
      const projectTabs = groupId === null
        ? state.tabs
        : state.tabs.filter((tab) => tab.groupId === groupId);
      const rememberedTab =
        project?.lastActiveTabId
          ? projectTabs.find((tab) => tab.id === project.lastActiveTabId)
          : undefined;
      const nextTab = rememberedTab ?? projectTabs[0] ?? null;
      const linkedNode = nextTab
        ? state.canvasState.nodes.find((node) => node.terminalTabId === nextTab.id)
        : undefined;
      const nextRoot =
        groupId === null
          ? nextTab?.initialCwd ?? null
          : project?.projectRoot ?? nextTab?.initialCwd ?? null;
      const nextZoom = linkedNode ? Math.min(state.canvasState.viewport.zoom, 0.9) : state.canvasState.viewport.zoom;

      return {
        activeGroupFilter: groupId,
        activeGroupId: groupId,
        activeTabId: nextTab?.id ?? state.activeTabId,
        activeTerminalId: null,
        projectRoot: nextRoot,
        canvasState: linkedNode
          ? {
              ...state.canvasState,
              selectedNodeId: linkedNode.id,
              viewport: {
                ...state.canvasState.viewport,
                zoom: nextZoom,
                x: 306 - (linkedNode.x + linkedNode.width / 2) * nextZoom,
                y: 220 - (linkedNode.y + linkedNode.height / 2) * nextZoom,
              },
            }
          : state.canvasState,
      };
    });
  },

  setProjectRoot: (path: string | null, syncTerminal = true) => {
    set((state) => ({
      projectRoot: path,
      tabs: path && state.activeTabId
        ? state.tabs.map((tab) =>
            tab.id === state.activeTabId
              ? {
                  ...tab,
                  initialCwd: path,
                  splitLayout: updatePaneCwdInTree(tab.splitLayout, tab.activePaneId, path),
                }
              : tab
          )
        : state.tabs,
      canvasState: path && state.activeTabId
        ? {
            ...state.canvasState,
            nodes: state.canvasState.nodes.map((node) =>
              node.terminalTabId === state.activeTabId
                ? { ...node, terminalCwd: path }
                : node
            ),
          }
        : state.canvasState,
      groups: state.activeGroupFilter
        ? state.groups.map((group) =>
            group.id === state.activeGroupFilter
              ? { ...group, projectRoot: path ?? undefined }
              : group
          )
        : state.groups,
      terminalGroups: state.activeGroupFilter
        ? state.terminalGroups.map((group) =>
            group.id === state.activeGroupFilter
              ? { ...group, projectRoot: path ?? undefined }
              : group
          )
        : state.terminalGroups,
    }));
    if (path && syncTerminal) void syncActiveTerminalCwd(path);
  },

  setActiveTerminal: (id: string | null) => {
    set({ activeTerminalId: id });
  },

  addOpenFile: (file: OpenFile) => {
    set((state) => ({
      openFiles: [
        file,
        ...state.openFiles.filter((openFile) => openFile.path !== file.path),
      ],
    }));
  },

  removeOpenFile: (path: string) => {
    set((state) => ({
      openFiles: state.openFiles.filter((file) => file.path !== path),
    }));
  },

  setWorkspaceMode: (mode: WorkspaceMode) => {
    set((state) => ({
      workspaceUiState: {
        ...state.workspaceUiState,
        workspaceMode: mode,
      },
      canvasState: normalizeCanvasState(state.canvasState, state.tabs),
    }));
  },

  reconcileCanvasState: () => {
    set((state) => ({
      canvasState: normalizeCanvasState(state.canvasState, state.tabs),
    }));
  },

  updateWorkspaceUiState: (updates: Partial<WorkspaceUiState>) => {
    set((state) => ({
      workspaceUiState: {
        ...state.workspaceUiState,
        ...updates,
      },
    }));
  },

  addCanvasNode: (node) => {
    const id = node.id ?? crypto.randomUUID();
    set((state) => ({
      canvasState: {
        ...state.canvasState,
        nodes: [
          ...state.canvasState.nodes.filter((candidate) =>
            candidate.id !== id &&
            (!node.terminalTabId || candidate.terminalTabId !== node.terminalTabId)
          ),
          { ...node, id },
        ],
        selectedNodeId: id,
      },
    }));
  },

  updateCanvasNode: (id: string, updates: Partial<CanvasNode>) => {
    set((state) => ({
      canvasState: {
        ...state.canvasState,
        nodes: state.canvasState.nodes.map((node) =>
          node.id === id ? { ...node, ...updates } : node
        ),
      },
    }));
  },

  removeCanvasNode: (id: string) => {
    set((state) => ({
      canvasState: {
        ...state.canvasState,
        nodes: state.canvasState.nodes.filter((node) => node.id !== id),
        selectedNodeId:
          state.canvasState.selectedNodeId === id
            ? null
            : state.canvasState.selectedNodeId,
      },
    }));
  },

  selectCanvasNode: (id: string | null) => {
    set((state) => {
      const node = id ? state.canvasState.nodes.find((candidate) => candidate.id === id) : undefined;
      return {
        activeTabId: node?.terminalTabId ?? state.activeTabId,
        canvasState: {
          ...state.canvasState,
          selectedNodeId: id,
        },
      };
    });
  },

  updateCanvasViewport: (viewport: Partial<CanvasState["viewport"]>) => {
    set((state) => ({
      canvasState: {
        ...state.canvasState,
        viewport: {
          ...state.canvasState.viewport,
          ...viewport,
        },
      },
    }));
  },

  // --- Split pane actions ---

  splitPane: (tabId: string, paneId: string, direction: "horizontal" | "vertical", cwd?: string) => {
    const newPaneId = crypto.randomUUID();
    set((state) => ({
      tabs: state.tabs.map((t) => {
        if (t.id !== tabId) return t;
        const newLayout = splitNodeInTree(t.splitLayout, paneId, direction, newPaneId, cwd);
        return {
          ...t,
          splitLayout: newLayout,
          activePaneId: newPaneId,
        };
      }),
    }));
    return newPaneId;
  },

  closePane: (tabId: string, paneId: string) => {
    set((state) => ({
      tabs: state.tabs.map((t) => {
        if (t.id !== tabId) return t;

        const newLayout = removeNodeFromTree(t.splitLayout, paneId);
        if (!newLayout) return t; // shouldn't happen if we guard in closeActivePane

        // Remove PTY entry for this pane
        const newTerminals = t.terminals.filter((term) => term.paneId !== paneId);

        // If the closed pane was active, pick another
        const leaves = getAllLeafIds(newLayout);
        const newActivePaneId =
          t.activePaneId === paneId
            ? leaves[0] ?? t.activePaneId
            : t.activePaneId;

        return {
          ...t,
          splitLayout: newLayout,
          terminals: newTerminals,
          activePaneId: newActivePaneId,
        };
      }),
    }));
  },

  setActivePane: (tabId: string, paneId: string) => {
    set((state) => {
      const linkedNode = state.canvasState.nodes.find((node) => node.terminalTabId === tabId);
      return {
        tabs: state.tabs.map((t) =>
          t.id === tabId ? { ...t, activePaneId: paneId } : t
        ),
        canvasState: {
          ...state.canvasState,
          selectedNodeId: linkedNode?.id ?? state.canvasState.selectedNodeId,
        },
      };
    });
  },

  updateSplitSizes: (tabId: string, splitNodeId: string, sizes: number[]) => {
    set((state) => ({
      tabs: state.tabs.map((t) => {
        if (t.id !== tabId) return t;
        return {
          ...t,
          splitLayout: updateSizesInTree(t.splitLayout, splitNodeId, sizes),
        };
      }),
    }));
  },

  // --- Computed ---

  getFilteredTabs: () => {
    const { tabs, activeGroupFilter } = get();
    if (activeGroupFilter === null) return tabs;
    return tabs.filter((t) => t.groupId === activeGroupFilter);
  },

  getActiveTab: () => {
    const { tabs, activeTabId } = get();
    return tabs.find((t) => t.id === activeTabId);
  },
}));

let pendingPersist: ReturnType<typeof window.setTimeout> | null = null;
let pendingSnapshot: PersistedWorkspace | null = null;
let lastPersistedSnapshot = "";

function persistWorkspaceSnapshot(snapshot: PersistedWorkspace) {
  try {
    const serialized = JSON.stringify(snapshot);
    if (serialized === lastPersistedSnapshot) return;
    localStorage.setItem(WORKSPACE_STORAGE_KEY, serialized);
    lastPersistedSnapshot = serialized;
  } catch (error) {
    console.warn("Could not persist workspace state:", error);
  }
}

function scheduleWorkspacePersistence(snapshot: PersistedWorkspace) {
  pendingSnapshot = snapshot;
  if (pendingPersist) return;

  pendingPersist = window.setTimeout(() => {
    pendingPersist = null;
    if (!pendingSnapshot) return;
    const snapshotToPersist = pendingSnapshot;
    pendingSnapshot = null;
    persistWorkspaceSnapshot(snapshotToPersist);
  }, 250);
}

window.addEventListener("beforeunload", () => {
  if (pendingPersist) {
    clearTimeout(pendingPersist);
    pendingPersist = null;
  }
  if (pendingSnapshot) {
    persistWorkspaceSnapshot(pendingSnapshot);
    pendingSnapshot = null;
  }
});

useWorkspaceStore.subscribe((state) => {
  if (FORCE_WORKSPACE_RESET_STATE) {
    return;
  }

  const snapshot: PersistedWorkspace = {
    tabs: state.tabs.map((tab) => ({
      ...tab,
      terminals: tab.terminals.map(persistedTerminalSnapshot),
    })),
    groups: state.groups,
    openFiles: state.openFiles,
    activeTabId: state.activeTabId,
    activeTerminalId: state.activeTerminalId,
    activeGroupId: state.activeGroupId,
    activeGroupFilter: state.activeGroupFilter,
    projectRoot: state.projectRoot,
    workspaceUiState: state.workspaceUiState,
    canvasState: state.canvasState,
  };

  scheduleWorkspacePersistence(snapshot);
});
