import { create } from "zustand";
import type {
  CanvasNode,
  CanvasState,
  AgentProvider,
  WorkstreamEvent,
  WorkstreamEventKind,
  WorkstreamStatus,
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
  updatePanePreviewUrlInTree,
} from "../lib/splitUtils";
import { destroyBrowserPtys, writeBrowserPtys } from "../hooks/usePty";
import type { AgentProviderAvailability } from "../lib/agentProviders";
import { providerDefinition } from "../lib/agentProviders";

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

// Reset/verify runs (VITE_WORKSPACE_RESET_STATE=1) clear and re-persist the
// workspace on load. They run on the SAME origin as the real app, so if they
// shared this key a verify run would wipe the user's actual tabs/projects.
// Namespace the key under reset mode so test runs only ever touch a throwaway
// key and can never read, clear, or overwrite production state.
export const WORKSPACE_STORAGE_KEY = FORCE_WORKSPACE_RESET_STATE
  ? "terminal-workspace.test"
  : "terminal-workspace.v1";

type WorkstreamEventInput = {
  kind: WorkstreamEventKind;
  label: string;
  detail?: string;
  status?: WorkstreamStatus;
};

function createWorkstreamEvent(input: WorkstreamEventInput): WorkstreamEvent {
  return {
    id: crypto.randomUUID(),
    at: Date.now(),
    ...input,
  };
}

function appendWorkstreamEvent(events: WorkstreamEvent[] | undefined, input: WorkstreamEventInput) {
  return [...(events ?? []), createWorkstreamEvent(input)].slice(-12);
}

function createRunId(provider: AgentProvider, createdAt: number) {
  const suffix = crypto.randomUUID().slice(0, 6);
  return `${provider}-${createdAt.toString(36)}-${suffix}`;
}

const DEFAULT_UI_STATE: WorkspaceUiState = {
  workspaceMode: FORCED_WORKSPACE_MODE ?? "split",
  terminalRendererMode: FORCED_TERMINAL_RENDERER_MODE ?? "auto",
  immersiveTerminal: {
    enabled: false,
    tabId: null,
    paneId: null,
  },
  fileExplorerWidth: 260,
  // Explorer is a toggle, not a permanent third column — terminal-first tools
  // keep the file tree hidden until summoned. Distill pass: rail + sessions +
  // the work surface by default; open files from the dock rail when needed.
  fileExplorerCollapsed: true,
  canvasSidebarCollapsed: false,
  terminalSidebarCollapsed: false,
  primarySidebarCollapsed: false,
  primarySidebarPanel: "sessions",
  previewUrl: "http://127.0.0.1:3000",
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
const TERMINAL_MAP_NODE_SIZE = { width: 820, height: 460 };
const CANVAS_NODE_MIN_SIZE: Record<CanvasNode["type"], { width: number; height: number }> = {
  terminal: TERMINAL_MAP_NODE_SIZE,
  preview: { width: 620, height: 420 },
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
  pinnedProjects: string[];
  // Live cwd per PTY id (from /proc/<pid>/cwd), polled while a terminal is
  // mounted. Display-only — NOT persisted and NOT the session's project
  // identity, so a `cd`/`z` shows where you are without renaming the project.
  liveCwds: Record<string, string>;
  workspaceUiState: WorkspaceUiState;
  canvasState: CanvasState;
  // True while the durable on-disk layout is being loaded (only when
  // localStorage was empty/reset). Terminals must not mount until this clears,
  // or they would spawn against the default tab's id and then be swapped out.
  hydrating: boolean;

  // Tab actions
  addTab: (tab?: Partial<Tab>) => void;
  /** Replace the restored tab set after async disk-hydration + orphan reconcile. */
  hydrateRestoredWorkspace: (payload: { tabs: Tab[]; activeTabId: string | null }) => void;
  removeTab: (id: string) => void;
  closeTerminalSession: (id: string) => Promise<void>;
  setActiveTab: (id: string) => void;
  updateTab: (id: string, updates: Partial<Tab>) => void;
  queueWorkstreamInput: (tabId: string, text: string) => string | null;
  markWorkstreamInputSent: (tabId: string, inputId: string) => void;
  recordWorkstreamEvent: (tabId: string, event: WorkstreamEventInput) => void;
  interruptWorkstream: (tabId: string) => Promise<void>;
  stopWorkstream: (tabId: string) => Promise<void>;
  restartWorkstream: (tabId: string) => Promise<void>;
  reviewWorkstream: (tabId: string) => void;
  reorderTabs: (fromIndex: number, toIndex: number) => void;

  // Group actions
  addGroup: (name: string, color?: string, projectRoot?: string) => string;
  removeGroup: (id: string) => void;
  updateGroup: (id: string, updates: Partial<Group>) => void;
  setGroupFilter: (groupId: string | null) => void;
  switchProject: (groupId: string | null) => void;
  setProjectRoot: (path: string | null, syncTerminal?: boolean) => void;
  pinProject: (path: string) => void;
  unpinProject: (path: string) => void;
  setActiveTerminal: (id: string | null) => void;
  setLiveCwd: (id: string, cwd: string) => void;
  refreshLiveCwd: (id: string) => Promise<void>;
  addOpenFile: (file: OpenFile) => void;
  removeOpenFile: (path: string) => void;
  setWorkspaceMode: (mode: WorkspaceMode) => void;
  reconcileCanvasState: () => void;
  updateWorkspaceUiState: (updates: Partial<WorkspaceUiState>) => void;
  enterImmersiveTerminal: (tabId: string, paneId: string) => void;
  exitImmersiveTerminal: () => void;
  toggleImmersiveTerminal: (tabId: string, paneId: string) => void;
  addCanvasNode: (node: Omit<CanvasNode, "id"> & { id?: string }) => void;
  updateCanvasNode: (id: string, updates: Partial<CanvasNode>) => void;
  removeCanvasNode: (id: string) => void;
  selectCanvasNode: (id: string | null) => void;
  updateCanvasViewport: (viewport: Partial<CanvasState["viewport"]>) => void;

  // Split pane actions
  splitPane: (
    tabId: string,
    paneId: string,
    direction: "horizontal" | "vertical",
    cwd?: string,
    paneType?: "terminal" | "preview",
    previewUrl?: string,
    linkedTerminalPaneId?: string,
  ) => string;
  updatePreviewPaneUrl: (tabId: string, paneId: string, previewUrl: string) => void;
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
  pinnedProjects?: string[];
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
    previewUrl: terminal.previewUrl,
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
        previewUrl: terminal.previewUrl,
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
  const immersiveTerminal =
    uiState?.immersiveTerminal?.enabled &&
    typeof uiState.immersiveTerminal.tabId === "string" &&
    typeof uiState.immersiveTerminal.paneId === "string"
      ? uiState.immersiveTerminal
      : DEFAULT_UI_STATE.immersiveTerminal;

  return {
    ...DEFAULT_UI_STATE,
    ...uiState,
    workspaceMode:
      FORCED_WORKSPACE_MODE ??
      (uiState?.workspaceMode === "split" ||
      uiState?.workspaceMode === "canvas" ||
      uiState?.workspaceMode === "graph"
        ? uiState.workspaceMode
        : DEFAULT_UI_STATE.workspaceMode),
    terminalRendererMode,
    immersiveTerminal,
    primarySidebarPanel: uiState?.primarySidebarPanel === "map" ? "map" : "sessions",
    previewUrl: typeof uiState?.previewUrl === "string" && uiState.previewUrl.trim()
      ? uiState.previewUrl
      : DEFAULT_UI_STATE.previewUrl,
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
    if ((node.type === "terminal" || node.type === "preview") && node.terminalTabId) {
      if (!tabIds.has(node.terminalTabId)) continue;
      if (node.type === "terminal") {
        if (seenTerminalTabIds.has(node.terminalTabId)) continue;
        seenTerminalTabIds.add(node.terminalTabId);
      }
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
    } else if (node.type === "preview") {
      normalizedNodes.push({
        ...node,
        width: Math.max(node.width, min.width),
        height: Math.max(node.height, min.height),
        previewUrl: node.previewUrl ?? DEFAULT_UI_STATE.previewUrl,
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

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

// Only gate the first render (to load the durable disk layout) when localStorage
// gave us nothing AND we're in the desktop app. The happy path (localStorage had
// tabs) is untouched, so there is no flash or double-spawn there.
const needsDiskHydration =
  isTauriRuntime() &&
  !FORCE_WORKSPACE_RESET_STATE &&
  (!persisted.tabs || persisted.tabs.length === 0);

interface PersistedSessionSummary {
  id: string;
  cwd: string | null;
  scrollbackBytes: number;
}

// Sessions below this are just a fresh prompt / empty shell — not worth recovering.
const ORPHAN_MIN_BYTES = 256;

/** Build a single-pane tab whose derived session id (`terminal-<tabId>-<paneId>`)
 *  matches an orphaned on-disk session, so mounting it replays that content. */
function tabFromOrphanedSession(session: PersistedSessionSummary): Tab | null {
  const prefix = "terminal-";
  if (!session.id.startsWith(prefix)) return null;
  const body = session.id.slice(prefix.length);
  const tabId = body.slice(0, 36);
  const paneId = body.slice(37);
  // Skip map-node sessions — the same tab's real pane carries the content.
  if (!paneId || paneId.startsWith("terminal-map-")) return null;
  const cwd = session.cwd ?? undefined;
  const title = cwd ? cwd.split("/").filter(Boolean).pop() ?? DEFAULT_TAB_TITLE : "Recovered";
  return createDefaultTab({
    id: tabId,
    title,
    initialCwd: cwd,
    splitLayout: { id: paneId, type: "terminal" as const },
    activePaneId: paneId,
  });
}

/**
 * Restore the durable workspace after mount: load the on-disk layout when
 * localStorage was empty/reset, then reconcile any orphaned on-disk session
 * content back into tabs. Runs once from App. Clears the `hydrating` gate.
 */
export async function hydrateWorkspace() {
  const store = useWorkspaceStore.getState();
  const clearGate = () => {
    const s = useWorkspaceStore.getState();
    if (s.hydrating) s.hydrateRestoredWorkspace({ tabs: s.tabs, activeTabId: s.activeTabId });
  };

  if (!isTauriRuntime() || FORCE_WORKSPACE_RESET_STATE) {
    clearGate();
    return;
  }

  try {
    const { invoke } = await import("@tauri-apps/api/core");

    // 1. localStorage gave us nothing → load the durable disk layout.
    let baseTabs = store.tabs;
    let baseActive = store.activeTabId;
    if (store.hydrating) {
      const raw = await invoke<string | null>("workspace_layout_load");
      if (raw) {
        try {
          const disk = JSON.parse(raw) as PersistedWorkspace;
          if (disk.tabs && disk.tabs.length > 0) {
            baseTabs = disk.tabs.map(withRestartableTerminals);
            baseActive = disk.activeTabId ?? baseTabs[0].id;
          }
        } catch (error) {
          console.warn("Could not parse on-disk workspace layout:", error);
        }
      }
    }

    // 2. Reconcile orphaned content: any saved session with real scrollback whose
    //    tab isn't present gets re-added (self-heals a wiped/never-saved layout).
    let sessions: PersistedSessionSummary[] = [];
    try {
      sessions = await invoke<PersistedSessionSummary[]>("workspace_persisted_sessions");
    } catch (error) {
      console.warn("Could not list persisted sessions:", error);
    }

    const seen = new Set(baseTabs.map((tab) => tab.id));
    const recovered: Tab[] = [];
    for (const session of [...sessions].sort((a, b) => b.scrollbackBytes - a.scrollbackBytes)) {
      // Require a saved cwd: a restored session is a *clean* shell (dead content
      // can't be replayed without garbling), so its value is reopening the right
      // directory. A cwd-less orphan would just be a home-shell — clutter, skip it.
      if (session.scrollbackBytes < ORPHAN_MIN_BYTES || !session.cwd) continue;
      const tab = tabFromOrphanedSession(session);
      if (!tab || seen.has(tab.id)) continue;
      seen.add(tab.id);
      recovered.push(tab);
    }

    if (!store.hydrating && recovered.length === 0) return; // happy path, nothing to do
    store.hydrateRestoredWorkspace({ tabs: [...baseTabs, ...recovered], activeTabId: baseActive });
  } catch (error) {
    console.warn("Workspace hydration failed:", error);
    clearGate();
  }
}

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

export function createAgentWorkstream(
  provider: AgentProvider = "codex",
  prompt?: string,
  availability?: AgentProviderAvailability
) {
  const store = useWorkspaceStore.getState();
  const activeTab = store.tabs.find((tab) => tab.id === store.activeTabId);
  const groupId = store.activeGroupFilter ?? activeTab?.groupId ?? store.activeGroupId;
  const targetGroup = groupId ? store.groups.find((group) => group.id === groupId) : null;
  const resolvedCwd = targetGroup?.projectRoot ?? activeTab?.initialCwd ?? store.projectRoot ?? undefined;
  const providerInfo = availability ?? {
    ...providerDefinition(provider),
    available: provider === "shell",
    message: provider === "shell" ? "Built-in shell workstream" : "Provider availability was not checked.",
  };
  const providerLabel = providerInfo.label;
  const mission = prompt?.trim() || "Supervised workstream";
  const startupCommand = providerInfo.available ? providerInfo.command : undefined;
  const createdAt = Date.now();
  const runId = createRunId(provider, createdAt);
  const initialStatus = providerInfo.available ? "ready" : "failed";
  const initialPhase = providerInfo.available ? "queued" : "blocked";
  const initialInput = {
    id: crypto.randomUUID(),
    text: mission,
    createdAt,
  };

  store.addTab({
    title: `${providerLabel} workstream`,
    emoji: "\u25C6",
    color: "#d99a45",
    initialCwd: resolvedCwd,
    groupId,
    workstream: {
      kind: "agent",
      provider,
      providerAvailable: providerInfo.available,
      providerAvailabilityMessage: providerInfo.message,
      role: providerLabel,
      mission,
      prompt: mission,
      startupCommand,
      phase: initialPhase,
      launchMode: providerInfo.launchMode,
      readinessCheck: providerInfo.readinessCheck,
      authCheck: providerInfo.authCheck,
      readiness: providerInfo.available ? "path-checked" : "unknown",
      stopBehavior: providerInfo.stopBehavior,
      controlProtocol: providerInfo.controlProtocol,
      structuredStatus: providerInfo.structuredStatus,
      lastSummary: providerInfo.available
        ? `${providerLabel} launch queued`
        : `${providerLabel} provider unavailable`,
      nextAction: providerInfo.available
        ? "Watch provider startup"
        : "Install or configure the provider CLI",
      promptCount: 1,
      sentCount: 0,
      signalCount: 0,
      controlCount: 0,
      outcome: providerInfo.available ? "Launch queued" : "Provider unavailable",
      runId,
      inputQueue: [initialInput],
      events: [
        {
          id: crypto.randomUUID(),
          kind: "created",
          label: "Mission created",
          detail: mission,
          status: initialStatus,
          at: createdAt,
        },
        {
          id: crypto.randomUUID(),
          kind: "provider",
          label: providerInfo.available ? `${providerLabel} ready` : `${providerLabel} unavailable`,
          detail: `${providerInfo.message} · ${providerInfo.readinessCheck}`,
          status: initialStatus,
          at: createdAt,
        },
        {
          id: crypto.randomUUID(),
          kind: "prompt",
          label: "Launch prompt queued",
          detail: mission,
          status: initialStatus,
          at: createdAt,
        },
      ],
      generation: 0,
      status: initialStatus,
      createdAt,
    },
  });
}

function titleForPreviewUrl(url: string) {
  try {
    const parsed = new URL(url);
    return `Preview ${parsed.host}`;
  } catch {
    return "Local preview";
  }
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

export function splitActivePreviewPane(previewUrl?: string) {
  const store = useWorkspaceStore.getState();
  const tab = store.tabs.find((t) => t.id === store.activeTabId);
  if (!tab) return false;
  const activeTerminal = tab.terminals.find((terminal) => terminal.paneId === tab.activePaneId);
  const resolvedPreviewUrl = previewUrl ?? activeTerminal?.previewUrl;
  if (!resolvedPreviewUrl) return false;

  const newPaneId = store.splitPane(
    tab.id,
    tab.activePaneId,
    "horizontal",
    undefined,
    "preview",
    resolvedPreviewUrl,
    tab.activePaneId,
  );
  store.updateWorkspaceUiState({ previewUrl: resolvedPreviewUrl });
  if (activeTerminal?.previewUrl !== resolvedPreviewUrl) {
    store.updateTab(tab.id, {
      terminals: tab.terminals.map((terminal) =>
        terminal.paneId === tab.activePaneId
          ? { ...terminal, previewUrl: resolvedPreviewUrl }
          : terminal
      ),
    });
  }
  store.setWorkspaceMode("split");

  const terminalNode = store.canvasState.nodes.find((node) => node.terminalTabId === tab.id && node.type === "terminal");
  const existingPreviewNode = store.canvasState.nodes.find((node) =>
    node.type === "preview" && node.terminalTabId === tab.id && node.previewPaneId === newPaneId
  );
  if (existingPreviewNode) return true;

  store.addCanvasNode({
    id: `preview-map-${tab.id}-${newPaneId}`,
    type: "preview",
    title: titleForPreviewUrl(resolvedPreviewUrl),
    x: (terminalNode?.x ?? 120) + (terminalNode?.width ?? TERMINAL_MAP_NODE_SIZE.width) + 36,
    y: terminalNode?.y ?? 90,
    width: 620,
    height: 420,
    terminalTabId: tab.id,
    previewPaneId: newPaneId,
    linkedTerminalPaneId: tab.activePaneId,
    previewUrl: resolvedPreviewUrl,
  });
  return true;
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

async function writePtys(ptyIds: string[], data: string) {
  if (ptyIds.length === 0) return;
  writeBrowserPtys(ptyIds, data);

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await Promise.all(
      ptyIds.map(async (id) => {
        try {
          await writePty(id, data, invoke);
        } catch (error) {
          console.warn("Could not write PTY:", id, error);
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
  pinnedProjects: (persisted.pinnedProjects ?? []).filter(
    (path): path is string => typeof path === "string" && path.trim().length > 0
  ),
  liveCwds: {},
  workspaceUiState: normalizeWorkspaceUiState(persisted.workspaceUiState),
  canvasState: normalizeCanvasState(persisted.canvasState, restoredTabs),
  hydrating: needsDiskHydration,

  // --- Tab actions ---

  hydrateRestoredWorkspace: ({ tabs, activeTabId }) => {
    set((state) => {
      if (tabs.length === 0) return { hydrating: false };
      const nextActive =
        tabs.find((tab) => tab.id === activeTabId)?.id ?? tabs[0].id;
      return {
        tabs,
        activeTabId: nextActive,
        canvasState: normalizeCanvasState(state.canvasState, tabs),
        hydrating: false,
      };
    });
  },

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
        t.id === id
          ? (() => {
              const updated = { ...t, ...updates };
              if (updates.workstream) {
                const completesRun = updates.workstream.status === "done" || updates.workstream.phase === "complete";
                updated.workstream = {
                  ...updates.workstream,
                  completedAt: completesRun
                    ? updates.workstream.completedAt ?? t.workstream?.completedAt ?? Date.now()
                    : updates.workstream.completedAt,
                };
              }
              return updated;
            })()
          : t
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

  recordWorkstreamEvent: (tabId: string, event: WorkstreamEventInput) => {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === tabId && tab.workstream
          ? (() => {
              const eventText = `${event.label} ${event.detail ?? ""}`.toLowerCase();
              const completesRun =
                event.status === "done" ||
                tab.workstream.phase === "complete" ||
                (event.kind === "signal" && (eventText.includes("complete") || eventText.includes("done")));
              return {
              ...tab,
              workstream: {
                ...tab.workstream,
                events: appendWorkstreamEvent(tab.workstream.events, event),
                ...(event.kind === "signal" ? { signalCount: (tab.workstream.signalCount ?? 0) + 1 } : {}),
                ...(event.kind === "control" ? { controlCount: (tab.workstream.controlCount ?? 0) + 1 } : {}),
                ...(event.kind === "prompt" ? { promptCount: (tab.workstream.promptCount ?? 0) + 1 } : {}),
                ...(event.kind === "sent" ? { sentCount: (tab.workstream.sentCount ?? 0) + 1 } : {}),
                ...(event.kind === "provider" || event.kind === "signal" || event.kind === "control"
                  ? { outcome: event.label }
                  : {}),
                ...(completesRun
                  ? { completedAt: tab.workstream.completedAt ?? Date.now() }
                  : {}),
                lastActivityAt: Date.now(),
              },
            };
            })()
          : tab
      ),
    }));
  },

  queueWorkstreamInput: (tabId: string, text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return null;
    const input = {
      id: crypto.randomUUID(),
      text: trimmed,
      createdAt: Date.now(),
    };
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === tabId && tab.workstream
          ? {
              ...tab,
              workstream: {
                ...tab.workstream,
                prompt: trimmed,
                phase: "queued",
                lastSummary: "Operator queued a follow-up prompt",
                nextAction: "Wait for prompt dispatch",
                promptCount: (tab.workstream.promptCount ?? 0) + 1,
                outcome: "Follow-up queued",
                inputQueue: [...(tab.workstream.inputQueue ?? []), input],
                events: appendWorkstreamEvent(tab.workstream.events, {
                  kind: "prompt",
                  label: "Follow-up queued",
                  detail: trimmed,
                  status: tab.workstream.status,
                }),
                lastActivityAt: Date.now(),
              },
            }
          : tab
      ),
    }));
    return input.id;
  },

  markWorkstreamInputSent: (tabId: string, inputId: string) => {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === tabId && tab.workstream
          ? {
              ...tab,
              workstream: {
                ...tab.workstream,
                phase: tab.workstream.phase === "queued" ? "launching" : tab.workstream.phase,
                lastSummary: tab.workstream.status === "ready" || tab.workstream.status === "running"
                  ? "Prompt sent to provider"
                  : tab.workstream.lastSummary,
                nextAction: tab.workstream.status === "ready" || tab.workstream.status === "running"
                  ? "Watch provider response"
                  : tab.workstream.nextAction,
                sentCount: (tab.workstream.sentCount ?? 0) + 1,
                outcome: "Prompt sent",
                lastActivityAt: Date.now(),
                inputQueue: (tab.workstream.inputQueue ?? []).map((input) =>
                  input.id === inputId && !input.sentAt
                    ? { ...input, sentAt: Date.now() }
                    : input
                ),
                events: appendWorkstreamEvent(tab.workstream.events, {
                  kind: "sent",
                  label: "Prompt sent",
                  detail: (tab.workstream.inputQueue ?? []).find((input) => input.id === inputId)?.text,
                  status: tab.workstream.status,
                }),
              },
            }
          : tab
      ),
    }));
  },

  interruptWorkstream: async (tabId: string) => {
    const tab = get().tabs.find((candidate) => candidate.id === tabId);
    if (!tab?.workstream) return;
    await writePtys(tab.terminals.map((terminal) => terminal.id), "\x03");
    set((state) => ({
      tabs: state.tabs.map((candidate) =>
        candidate.id === tabId && candidate.workstream
          ? {
              ...candidate,
              workstream: {
                ...candidate.workstream,
                phase: "cancelling",
                lastSummary: "Cancellation requested",
                nextAction: "Wait for provider acknowledgement or hard-stop",
                controlCount: (candidate.workstream.controlCount ?? 0) + 1,
                outcome: "Cancellation requested",
                events: appendWorkstreamEvent(candidate.workstream.events, {
                  kind: "control",
                  label: "Cancellation requested",
                  detail: candidate.workstream.controlProtocol ?? candidate.workstream.stopBehavior,
                  status: candidate.workstream.status,
                }),
                lastActivityAt: Date.now(),
              },
            }
          : candidate
      ),
    }));
  },

  stopWorkstream: async (tabId: string) => {
    const tab = get().tabs.find((candidate) => candidate.id === tabId);
    if (!tab?.workstream) return;
    await killPtys(tab.terminals.map((terminal) => terminal.id));
    set((state) => ({
      activeTerminalId: tab.terminals.some((terminal) => terminal.id === state.activeTerminalId)
        ? null
        : state.activeTerminalId,
      tabs: state.tabs.map((candidate) =>
        candidate.id === tabId && candidate.workstream
          ? {
              ...candidate,
              terminals: [],
              workstream: {
                ...candidate.workstream,
                status: "stopped",
                phase: "interrupted",
                lastSummary: "Workstream stopped",
                nextAction: "Restart or close the workstream",
                controlCount: (candidate.workstream.controlCount ?? 0) + 1,
                outcome: "Stopped by operator",
                events: appendWorkstreamEvent(candidate.workstream.events, {
                  kind: "control",
                  label: "Stopped by operator",
                  detail: candidate.workstream.stopBehavior,
                  status: "stopped",
                }),
                lastActivityAt: Date.now(),
              },
            }
          : candidate
      ),
    }));
  },

  restartWorkstream: async (tabId: string) => {
    const tab = get().tabs.find((candidate) => candidate.id === tabId);
    if (!tab?.workstream) return;
    await killPtys(tab.terminals.map((terminal) => terminal.id));
    set((state) => ({
      activeTerminalId: tab.terminals.some((terminal) => terminal.id === state.activeTerminalId)
        ? null
        : state.activeTerminalId,
      activeTabId: tabId,
      tabs: state.tabs.map((candidate) =>
        candidate.id === tabId && candidate.workstream
          ? {
              ...candidate,
              terminals: [],
              workstream: {
                ...candidate.workstream,
                status: "ready",
                phase: "queued",
                lastSummary: "Restart requested",
                nextAction: "Watch provider startup",
                controlCount: (candidate.workstream.controlCount ?? 0) + 1,
                outcome: "Restart requested",
                generation: (candidate.workstream.generation ?? 0) + 1,
                events: appendWorkstreamEvent(candidate.workstream.events, {
                  kind: "control",
                  label: "Restart requested",
                  detail: "Terminal remounting through provider startup command",
                  status: "ready",
                }),
                lastActivityAt: Date.now(),
              },
            }
          : candidate
      ),
    }));
  },

  reviewWorkstream: (tabId: string) => {
    const reviewedAt = Date.now();
    set((state) => ({
      tabs: state.tabs.map((candidate) =>
        candidate.id === tabId && candidate.workstream
          ? {
              ...candidate,
              workstream: {
                ...candidate.workstream,
                status: candidate.workstream.status === "done" ? "done" : candidate.workstream.status,
                phase: "reviewed",
                lastSummary: "Workstream reviewed",
                nextAction: "Close or restart the workstream",
                controlCount: (candidate.workstream.controlCount ?? 0) + 1,
                outcome: "Reviewed by operator",
                completedAt: candidate.workstream.completedAt ?? reviewedAt,
                reviewedAt,
                events: appendWorkstreamEvent(candidate.workstream.events, {
                  kind: "control",
                  label: "Reviewed by operator",
                  detail: "Operator acknowledged the completed run record",
                  status: candidate.workstream.status,
                }),
                lastActivityAt: Date.now(),
              },
            }
          : candidate
      ),
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
      const nextRoot =
        groupId === null
          ? nextTab?.initialCwd ?? null
          : project?.projectRoot ?? nextTab?.initialCwd ?? null;

      return {
        activeGroupFilter: groupId,
        activeGroupId: groupId,
        activeTabId: nextTab?.id ?? state.activeTabId,
        activeTerminalId: null,
        projectRoot: nextRoot,
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

  pinProject: (path: string) => {
    const trimmed = path.trim().replace(/\/+$/, "") || path.trim();
    if (!trimmed) return;
    set((state) =>
      state.pinnedProjects.includes(trimmed)
        ? state
        : { pinnedProjects: [...state.pinnedProjects, trimmed] }
    );
  },

  unpinProject: (path: string) => {
    set((state) => ({
      pinnedProjects: state.pinnedProjects.filter((pinned) => pinned !== path),
    }));
  },

  setActiveTerminal: (id: string | null) => {
    set({ activeTerminalId: id });
  },

  setLiveCwd: (id: string, cwd: string) => {
    set((state) => {
      if (!id || !cwd || state.liveCwds[id] === cwd) return {};
      return { liveCwds: { ...state.liveCwds, [id]: cwd } };
    });
  },

  refreshLiveCwd: async (id: string) => {
    if (!id) return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const cwd = await getPtyCwd(id, invoke);
      if (cwd) useWorkspaceStore.getState().setLiveCwd(id, cwd);
    } catch {
      // PTY may be gone or pre-attach; keep the last known cwd.
    }
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

  enterImmersiveTerminal: (tabId: string, paneId: string) => {
    set((state) => ({
      workspaceUiState: {
        ...state.workspaceUiState,
        workspaceMode: "split",
        immersiveTerminal: {
          enabled: true,
          tabId,
          paneId,
        },
      },
      activeTabId: tabId,
      tabs: state.tabs.map((tab) =>
        tab.id === tabId ? { ...tab, activePaneId: paneId } : tab
      ),
    }));
  },

  exitImmersiveTerminal: () => {
    set((state) => ({
      workspaceUiState: {
        ...state.workspaceUiState,
        immersiveTerminal: DEFAULT_UI_STATE.immersiveTerminal,
      },
    }));
  },

  toggleImmersiveTerminal: (tabId: string, paneId: string) => {
    set((state) => {
      const current = state.workspaceUiState.immersiveTerminal;
      const isTarget =
        current.enabled &&
        current.tabId === tabId &&
        current.paneId === paneId;
      return {
        workspaceUiState: {
          ...state.workspaceUiState,
          workspaceMode: isTarget ? state.workspaceUiState.workspaceMode : "split",
          immersiveTerminal: isTarget
            ? DEFAULT_UI_STATE.immersiveTerminal
            : { enabled: true, tabId, paneId },
        },
        activeTabId: isTarget ? state.activeTabId : tabId,
        tabs: isTarget
          ? state.tabs
          : state.tabs.map((tab) =>
              tab.id === tabId ? { ...tab, activePaneId: paneId } : tab
            ),
      };
    });
  },

  addCanvasNode: (node) => {
    const id = node.id ?? crypto.randomUUID();
    set((state) => ({
      canvasState: {
        ...state.canvasState,
        nodes: [
          ...state.canvasState.nodes.filter((candidate) =>
            candidate.id !== id &&
            (node.type !== "terminal" || !node.terminalTabId || candidate.terminalTabId !== node.terminalTabId)
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

  splitPane: (
    tabId: string,
    paneId: string,
    direction: "horizontal" | "vertical",
    cwd?: string,
    paneType: "terminal" | "preview" = "terminal",
    previewUrl?: string,
    linkedTerminalPaneId?: string,
  ) => {
    const newPaneId = crypto.randomUUID();
    set((state) => ({
      tabs: state.tabs.map((t) => {
        if (t.id !== tabId) return t;
        const newLayout = splitNodeInTree(t.splitLayout, paneId, direction, newPaneId, cwd, paneType, previewUrl, linkedTerminalPaneId);
        return {
          ...t,
          splitLayout: newLayout,
          activePaneId: newPaneId,
        };
      }),
    }));
    return newPaneId;
  },

  updatePreviewPaneUrl: (tabId: string, paneId: string, previewUrl: string) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId
          ? {
              ...t,
              splitLayout: updatePanePreviewUrlInTree(t.splitLayout, paneId, previewUrl),
              terminals: t.terminals.map((terminal) =>
                state.canvasState.nodes.some((node) =>
                  node.type === "preview" &&
                  node.terminalTabId === tabId &&
                  node.previewPaneId === paneId &&
                  node.linkedTerminalPaneId === terminal.paneId
                )
                  ? { ...terminal, previewUrl }
                  : terminal
              ),
            }
          : t
      ),
      canvasState: {
        ...state.canvasState,
        nodes: state.canvasState.nodes.map((node) =>
          node.type === "preview" && node.terminalTabId === tabId && node.previewPaneId === paneId
            ? { ...node, title: titleForPreviewUrl(previewUrl), previewUrl }
            : node
        ),
      },
      workspaceUiState: {
        ...state.workspaceUiState,
        previewUrl,
      },
    }));
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
      canvasState: {
        ...state.canvasState,
        nodes: state.canvasState.nodes.filter((node) =>
          !(node.type === "preview" && node.terminalTabId === tabId && node.previewPaneId === paneId)
        ),
        selectedNodeId:
          state.canvasState.nodes.some((node) =>
            node.id === state.canvasState.selectedNodeId &&
            !(node.type === "preview" && node.terminalTabId === tabId && node.previewPaneId === paneId)
          )
            ? state.canvasState.selectedNodeId
            : null,
      },
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
    // Mirror to the daemon's data dir so the tab→session mapping survives a
    // localStorage wipe (verifier RESET_STATE, dev↔release origin change). This
    // is the durable copy; localStorage is just the fast synchronous cache.
    mirrorWorkspaceLayoutToDisk(serialized);
  } catch (error) {
    console.warn("Could not persist workspace state:", error);
  }
}

function mirrorWorkspaceLayoutToDisk(serialized: string) {
  if (!isTauriRuntime()) return;
  void import("@tauri-apps/api/core")
    .then(({ invoke }) => invoke("workspace_layout_save", { contents: serialized }))
    .catch((error) => console.warn("Could not mirror workspace layout to disk:", error));
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
    pinnedProjects: state.pinnedProjects,
    workspaceUiState: state.workspaceUiState,
    canvasState: state.canvasState,
  };

  scheduleWorkspacePersistence(snapshot);
});
