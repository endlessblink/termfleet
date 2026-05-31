import { CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AtSign,
  Command,
  FileText,
  FolderTree,
  GitBranch,
  ListTree,
  Map,
  PanelBottom,
  PanelRight,
  Rocket,
  RotateCcw,
  Search,
  Terminal,
  X,
} from "lucide-react";
import {
  closeActivePane,
  createNewTab,
  createTerminalTab,
  resetPersistedWorkspace,
  splitActivePane,
  useWorkspaceStore,
} from "../stores/workspace";
import { getAllLeafIds } from "../lib/splitUtils";
import { pathTail, projectNameFor, projectRootFor } from "../lib/projectDisplay";
import { terminalHasKeyboardFocus } from "../lib/terminalFocus";

const styles: Record<string, CSSProperties> = {
  header: {
    height: "var(--commandbar-height)",
    flexShrink: 0,
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    gap: 10,
    padding: "0 18px",
    background: "var(--surface-floor)",
    borderBottom: "1px solid var(--border-subtle)",
    position: "relative",
  },
  contextCrumb: {
    position: "absolute",
    left: 18,
    display: "flex",
    alignItems: "center",
    gap: 7,
    maxWidth: "min(280px, calc(50vw - 340px))",
    minWidth: 0,
    overflow: "hidden",
    fontSize: 12,
    color: "var(--text-secondary)",
    whiteSpace: "nowrap",
  },
  contextCrumbName: {
    color: "var(--text-primary)",
    fontWeight: 500,
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  contextCrumbPath: {
    color: "var(--text-secondary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    opacity: 0.8,
  },
  search: {
    width: "min(620px, 100%)",
    minWidth: 0,
    height: 32,
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "0 12px",
    border: "none",
    borderRadius: "var(--radius-sm)",
    background: "var(--surface-base)",
    color: "var(--text-secondary)",
    fontSize: 12,
    transition: "background var(--motion-fast)",
  },
  searchActive: {
    background: "var(--surface-hover)",
  },
  projectTabs: {
    width: "100%",
    minWidth: 0,
    height: 30,
    display: "flex",
    alignItems: "center",
    gap: 4,
    padding: 3,
    border: "1px solid transparent",
    borderRadius: "var(--radius-sm)",
    background: "var(--surface-base)",
    overflowX: "auto",
    overflowY: "hidden",
    scrollbarWidth: "none",
  },
  projectTab: {
    minWidth: 0,
    maxWidth: 118,
    height: 22,
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "0 6px",
    border: "1px solid transparent",
    borderRadius: "var(--radius-xs)",
    background: "transparent",
    color: "var(--text-primary)",
    fontFamily: "var(--font-ui)",
    fontSize: 11,
    cursor: "pointer",
    flexShrink: 0,
  },
  projectTabActive: {
    borderColor: "var(--border-focus)",
    background: "var(--command-chip-active-bg)",
    color: "var(--accent-live)",
  },
  projectTabLabel: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontWeight: 500,
  },
  projectTabCount: {
    minWidth: 16,
    height: 16,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "0 4px",
    border: "1px solid transparent",
    borderRadius: "var(--radius-xs)",
    color: "var(--text-secondary)",
    fontSize: 9,
    flexShrink: 0,
  },
  projectCreateButton: {
    width: 24,
    height: 22,
    display: "grid",
    placeItems: "center",
    border: "1px solid transparent",
    borderRadius: "var(--radius-xs)",
    background: "var(--surface-wash)",
    color: "var(--accent-live)",
    cursor: "pointer",
    padding: 0,
    flexShrink: 0,
  },
  projectMenu: {
    position: "fixed",
    top: 38,
    left: "max(48px, calc(50vw - 345px))",
    width: 342,
    maxHeight: 420,
    overflow: "auto",
    padding: 5,
    border: "1px solid transparent",
    borderRadius: "var(--radius-md)",
    background: "var(--surface-raised)",
    boxShadow: "var(--shadow-menu)",
    zIndex: 60,
    animation: "workbench-popover-in var(--motion-med)",
  },
  projectMenuRow: {
    width: "100%",
    minHeight: 44,
    display: "grid",
    gridTemplateColumns: "24px minmax(0, 1fr) auto",
    alignItems: "center",
    gap: 8,
    padding: "6px 8px",
    border: "1px solid transparent",
    borderRadius: "var(--radius-sm)",
    background: "transparent",
    color: "var(--text-primary)",
    cursor: "pointer",
    textAlign: "left",
  },
  projectMenuRowActive: {
    borderColor: "var(--border-focus)",
    background: "var(--command-chip-active-bg)",
  },
  commandInput: {
    flex: 1,
    minWidth: 0,
    height: "100%",
    border: "none",
    outline: "none",
    background: "transparent",
    color: "var(--text-primary)",
    fontFamily: "var(--font-ui)",
    fontSize: 13,
  },
  toolbelt: {
    height: 22,
    display: "flex",
    alignItems: "center",
    gap: 3,
    paddingLeft: 4,
    borderLeft: "1px solid var(--border-subtle)",
    flexShrink: 0,
  },
  toolButton: {
    width: 22,
    height: 20,
    display: "grid",
    placeItems: "center",
    border: "1px solid transparent",
    borderRadius: "var(--radius-xs)",
    background: "transparent",
    color: "var(--text-secondary)",
    cursor: "pointer",
    padding: 0,
  },
  activeToolButton: {
    borderColor: "var(--command-chip-active-border)",
    background: "var(--command-chip-active-bg)",
    color: "var(--accent-live)",
  },
  commandShortcut: {
    height: 18,
    display: "flex",
    alignItems: "center",
    padding: "0 6px",
    border: "none",
    borderRadius: "var(--radius-xs)",
    background: "var(--surface-hover)",
    color: "var(--text-secondary)",
    fontFamily: "var(--font-ui)",
    fontSize: 10,
  },
  scopeRow: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    padding: "4px 4px 6px",
    marginBottom: 4,
    borderBottom: "1px solid var(--border-subtle)",
  },
  contextRow: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    padding: "0 4px 6px",
    marginBottom: 4,
    borderBottom: "1px solid var(--border-subtle)",
    overflow: "hidden",
  },
  contextChip: {
    height: 20,
    maxWidth: 150,
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "0 7px",
    border: "none",
    borderRadius: "var(--radius-xs)",
    background: "var(--surface-hover)",
    color: "var(--text-secondary)",
    fontSize: 10,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    flexShrink: 1,
  },
  scopeButton: {
    height: 22,
    display: "flex",
    alignItems: "center",
    padding: "0 9px",
    border: "none",
    borderRadius: "var(--radius-sm)",
    background: "var(--surface-hover)",
    color: "var(--text-secondary)",
    fontFamily: "var(--font-ui)",
    fontSize: 11,
    cursor: "pointer",
    transition: "background var(--motion-fast), color var(--motion-fast)",
  },
  menuScopeTag: {
    height: 18,
    display: "inline-flex",
    alignItems: "center",
    padding: "0 6px",
    border: "none",
    borderRadius: "var(--radius-xs)",
    color: "var(--text-secondary)",
    fontSize: 10,
    lineHeight: 1,
    background: "var(--surface-hover)",
    flexShrink: 0,
  },
  menuFooter: {
    minHeight: 28,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    padding: "6px 6px 2px",
    marginTop: 4,
    borderTop: "1px solid var(--border-subtle)",
    color: "var(--text-secondary)",
    fontSize: 11,
  },
  keyHints: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    minWidth: 0,
    overflow: "hidden",
  },
  keyHint: {
    height: 17,
    minWidth: 17,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "0 5px",
    border: "none",
    borderRadius: "var(--radius-xs)",
    background: "var(--surface-hover)",
    color: "var(--text-secondary)",
    fontSize: 10,
    lineHeight: 1,
  },
  resultCount: {
    flexShrink: 0,
    color: "var(--text-secondary)",
  },
  menu: {
    position: "absolute",
    left: "50%",
    top: 42,
    transform: "translateX(-50%)",
    width: "var(--commandbar-search-width)",
    minWidth: "var(--commandbar-search-min-width)",
    maxHeight: 360,
    overflow: "auto",
    padding: 5,
    border: "1px solid transparent",
    borderRadius: "var(--radius-md)",
    background: "var(--surface-raised)",
    boxShadow: "var(--shadow-menu)",
    zIndex: 40,
    animation: "workbench-popover-in var(--motion-med)",
  },
  menuRow: {
    minHeight: 38,
    display: "grid",
    gridTemplateColumns: "24px minmax(0, 1fr) auto",
    alignItems: "center",
    gap: 8,
    padding: "6px 8px",
    border: "none",
    borderRadius: "var(--radius-sm)",
    color: "var(--text-primary)",
    cursor: "pointer",
    outline: "none",
    boxShadow: "none",
    transition: "background var(--motion-fast)",
  },
  menuRowActive: {
    background: "var(--surface-selected)",
  },
  emptyResult: {
    minHeight: 86,
    display: "grid",
    placeItems: "center",
    padding: "14px 18px",
    color: "var(--text-secondary)",
    fontSize: 12,
    textAlign: "center",
  },
  menuIcon: {
    width: 24,
    height: 24,
    display: "grid",
    placeItems: "center",
    borderRadius: "var(--radius-sm)",
    background: "var(--surface-base)",
    color: "var(--accent-live)",
  },
  menuLabel: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: 13,
    fontWeight: 500,
  },
  menuDetail: {
    marginTop: 2,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: "var(--text-secondary)",
    fontSize: 12,
  },
  searchIcon: {
    color: "var(--text-secondary)",
    display: "grid",
    placeItems: "center",
  },
  searchText: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: "var(--accent-live)",
    boxShadow: "0 0 0 3px rgba(217, 154, 69, 0.11)",
    flexShrink: 0,
  },
  right: {
    gridColumn: "2",
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 10,
    color: "var(--text-secondary)",
    fontSize: 11,
    minWidth: 0,
    zIndex: 1,
  },
  context: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: "var(--text-primary)",
    fontSize: "var(--font-size-ui-label)",
    fontWeight: "var(--font-weight-ui-status)",
  },
  stat: {
    color: "var(--text-secondary)",
    whiteSpace: "nowrap",
    fontSize: "var(--font-size-ui-meta)",
    fontWeight: "var(--font-weight-ui-status)",
  },
  live: {
    color: "var(--accent-live)",
    fontSize: "var(--font-size-ui-meta)",
    fontWeight: "var(--font-weight-ui-status)",
  },
};

function normalizeCommand(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

type CommandAction = {
  id: string;
  label: string;
  detail: string;
  keywords: string[];
  scope: "actions" | "sessions" | "files" | "panes" | "launch_configs";
  shortcut?: string;
  Icon: typeof Terminal;
  run: () => void;
};

const COMMAND_SCOPES = [
  { id: "actions", label: "actions", prefix: "actions:" },
  { id: "sessions", label: "sessions", prefix: "sessions:" },
  { id: "files", label: "files", prefix: "files:" },
  { id: "panes", label: "panes", prefix: "panes:" },
  { id: "launch_configs", label: "launch", prefix: "launch_configs:" },
] as const;

function basename(path?: string | null) {
  if (!path) return "workspace";
  const clean = path.replace(/\/+$/, "");
  return clean.split("/").filter(Boolean).pop() ?? clean;
}

function actionMatches(action: CommandAction, query: string) {
  if (!query) return true;
  const scope = COMMAND_SCOPES.find((candidate) => query.startsWith(candidate.prefix));
  if (scope && action.scope !== scope.id) return false;
  const scopedQuery = scope ? normalizeCommand(query.slice(scope.prefix.length)) : query;
  if (!scopedQuery) return true;
  const haystack = normalizeCommand(
    [action.label, action.detail, ...action.keywords].join(" ")
  );
  return haystack.includes(scopedQuery);
}

export function WorkbenchHeader() {
  const tabs = useWorkspaceStore((state) => state.tabs);
  const groups = useWorkspaceStore((state) => state.groups);
  const openFiles = useWorkspaceStore((state) => state.openFiles);
  const activeTabId = useWorkspaceStore((state) => state.activeTabId);
  const activeGroupFilter = useWorkspaceStore((state) => state.activeGroupFilter);
  const projectRoot = useWorkspaceStore((state) => state.projectRoot);
  const activeTerminalId = useWorkspaceStore((state) => state.activeTerminalId);
  const liveCwds = useWorkspaceStore((state) => state.liveCwds);
  const setWorkspaceMode = useWorkspaceStore((state) => state.setWorkspaceMode);
  const setActiveTab = useWorkspaceStore((state) => state.setActiveTab);
  const switchProject = useWorkspaceStore((state) => state.switchProject);
  const addOpenFile = useWorkspaceStore((state) => state.addOpenFile);
  const updateUiState = useWorkspaceStore((state) => state.updateWorkspaceUiState);
  const [commandValue, setCommandValue] = useState("");
  const [commandStatus, setCommandStatus] = useState("");
  const [commandOpen, setCommandOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const commandQuery = normalizeCommand(commandValue);
  const activePaneCount = activeTab ? getAllLeafIds(activeTab.splitLayout).length : 0;
  const selectedProjectName = projectNameFor(activeGroupFilter, groups);
  const selectedProjectRoot = projectRootFor(activeGroupFilter, groups, activeTab) ?? projectRoot;
  // The path crumb follows the focused terminal's live cwd (where you actually
  // are after a `cd`/`z`); the project label keeps the project's identity.
  const liveActiveCwd = activeTerminalId ? liveCwds[activeTerminalId] : undefined;
  const crumbRoot = liveActiveCwd ?? selectedProjectRoot;
  const projectLabel = activeGroupFilter === null ? selectedProjectName : basename(selectedProjectRoot ?? activeTab?.initialCwd);

  const setScopedCommand = useCallback((prefix: string) => {
    setCommandValue(prefix);
    setCommandOpen(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const focusActiveTerminalOnMap = useCallback(() => {
    const store = useWorkspaceStore.getState();
    if (!store.activeTabId) return;
    const node = store.canvasState.nodes.find((candidate) => candidate.terminalTabId === store.activeTabId);
    if (!node) return;
    const zoom = Math.min(store.canvasState.viewport.zoom, 0.9);
    store.selectCanvasNode(node.id);
    store.updateCanvasViewport({
      zoom,
      x: 306 - (node.x + node.width / 2) * zoom,
      y: 220 - (node.y + node.height / 2) * zoom,
    });
  }, []);

  const actions = useMemo<CommandAction[]>(() => {
    const baseActions: CommandAction[] = [
      {
        id: "new-terminal",
        label: "New terminal",
        detail: "Create a linked terminal session",
        keywords: ["new", "session", "shell", "terminal"],
        scope: "actions",
        shortcut: "Ctrl Shift T",
        Icon: Terminal,
        run: () => {
          createNewTab();
          setWorkspaceMode("split");
          setCommandStatus("new terminal");
        },
      },
      {
        id: "show-terminal",
        label: "Show terminal",
        detail: activeTab?.title ?? "Focus the active terminal surface",
        keywords: ["terminal", "split", "shell", "surface"],
        scope: "actions",
        Icon: Terminal,
        run: () => {
          setWorkspaceMode("split");
          setCommandStatus("terminal");
        },
      },
      {
        id: "show-map",
        label: "Show map",
        detail: "Open the strategic operations map",
        keywords: ["map", "canvas", "overview", "operations"],
        scope: "actions",
        Icon: Map,
        run: () => {
          setWorkspaceMode("canvas");
          focusActiveTerminalOnMap();
          updateUiState({ primarySidebarCollapsed: false, primarySidebarPanel: "map" });
          setCommandStatus("map");
        },
      },
      {
        id: "show-files",
        label: "Show files",
        detail: "Open the file explorer panel",
        keywords: ["files", "file", "explorer", "tree"],
        scope: "actions",
        Icon: FolderTree,
        run: () => {
          updateUiState({
            fileExplorerCollapsed: false,
          });
          setCommandStatus("files");
        },
      },
      {
        id: "show-sessions",
        label: "Show sessions",
        detail: "Open the sessions panel",
        keywords: ["sessions", "session list", "terminals"],
        scope: "actions",
        Icon: ListTree,
        run: () => {
          updateUiState({ primarySidebarCollapsed: false, primarySidebarPanel: "sessions" });
          setCommandStatus("sessions");
        },
      },
      {
        id: "show-links",
        label: "Show links",
        detail: "Open the workspace relationship view",
        keywords: ["links", "graph", "relationships"],
        scope: "actions",
        Icon: GitBranch,
        run: () => {
          setWorkspaceMode("graph");
          setCommandStatus("links");
        },
      },
      {
        id: "split-right",
        label: "Split right",
        detail: "Split the active pane side by side",
        keywords: ["split", "right", "horizontal", "pane"],
        scope: "actions",
        shortcut: "Ctrl Shift E",
        Icon: PanelRight,
        run: () => {
          splitActivePane("horizontal");
          setWorkspaceMode("split");
          setCommandStatus("split right");
        },
      },
      {
        id: "split-down",
        label: "Split down",
        detail: "Split the active pane vertically",
        keywords: ["split", "down", "vertical", "pane"],
        scope: "actions",
        shortcut: "Ctrl Shift O",
        Icon: PanelBottom,
        run: () => {
          splitActivePane("vertical");
          setWorkspaceMode("split");
          setCommandStatus("split down");
        },
      },
      {
        id: "close-pane",
        label: "Close pane",
        detail: "Close the active pane or session",
        keywords: ["close", "remove", "pane"],
        scope: "actions",
        shortcut: "Ctrl Shift W",
        Icon: X,
        run: () => {
          closeActivePane();
          setCommandStatus("close pane");
        },
      },
      {
        id: "reset-layout",
        label: "Reset layout",
        detail: "Clear persisted workspace state and reload",
        keywords: ["reset", "layout", "workspace", "state"],
        scope: "actions",
        Icon: RotateCcw,
        run: () => {
          resetPersistedWorkspace();
          window.location.reload();
        },
      },
    ];

    const sessionActions = tabs.map<CommandAction>((tab) => ({
      id: `session-${tab.id}`,
      label: `Open ${tab.title}`,
      detail: tab.initialCwd ?? "interactive shell",
      keywords: ["open", "switch", "session", "terminal", tab.title, tab.initialCwd ?? ""],
      scope: "sessions",
      Icon: Terminal,
      run: () => {
        switchProject(tab.groupId);
        setActiveTab(tab.id);
        setWorkspaceMode("split");
        setCommandStatus(tab.title);
      },
    }));

    const paneActions = activeTab
      ? getAllLeafIds(activeTab.splitLayout).map<CommandAction>((paneId, index) => ({
          id: `pane-${paneId}`,
          label: `Focus pane ${index + 1}`,
          detail: activeTab.title,
          keywords: ["focus", "pane", "terminal", `${index + 1}`],
          scope: "panes",
          Icon: Search,
          run: () => {
            useWorkspaceStore.getState().setActivePane(activeTab.id, paneId);
            setWorkspaceMode("split");
            setCommandStatus(`pane ${index + 1}`);
          },
        }))
      : [];

    const launchActions: CommandAction[] = [
      {
        id: "launch-project-shell",
        label: `Launch ${projectLabel} shell`,
        detail: activeTab?.initialCwd ?? "Open a fresh project terminal",
        keywords: ["launch", "config", "project", "shell", "terminal", projectLabel, activeTab?.initialCwd ?? ""],
        scope: "launch_configs",
        shortcut: "launch_configs:",
        Icon: Rocket,
        run: () => {
          createTerminalTab(activeTab?.initialCwd);
          setWorkspaceMode("split");
          setCommandStatus(`${projectLabel} shell`);
        },
      },
      {
        id: "launch-clean-terminal",
        label: "Launch clean terminal",
        detail: "Create a new session from the active terminal context",
        keywords: ["launch", "config", "clean", "new", "session", "terminal"],
        scope: "launch_configs",
        Icon: Terminal,
        run: () => {
          createNewTab();
          setWorkspaceMode("split");
          setCommandStatus("clean terminal");
        },
      },
      {
        id: "launch-split-workbench",
        label: "Launch split workbench",
        detail: "Open a side-by-side pane from the active terminal",
        keywords: ["launch", "config", "split", "workbench", "pane", "side by side"],
        scope: "launch_configs",
        Icon: PanelRight,
        run: () => {
          splitActivePane("horizontal");
          setWorkspaceMode("split");
          setCommandStatus("split workbench");
        },
      },
    ];

    const fileActions = openFiles.map<CommandAction>((file) => ({
      id: `file-${file.path}`,
      label: `Open ${file.name}`,
      detail: file.path,
      keywords: ["open", "file", "search", file.name, file.path],
      scope: "files",
      Icon: FileText,
      run: () => {
        addOpenFile(file);
        updateUiState({
          fileExplorerCollapsed: false,
        });
        setCommandStatus(file.name);
      },
    }));

    return [...baseActions, ...sessionActions, ...paneActions, ...launchActions, ...fileActions];
  }, [activeTab, addOpenFile, focusActiveTerminalOnMap, openFiles, projectLabel, setActiveTab, setWorkspaceMode, switchProject, tabs, updateUiState]);

  const visibleActions = useMemo(() => {
    return actions.filter((action) => actionMatches(action, commandQuery)).slice(0, 9);
  }, [actions, commandQuery]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [commandQuery]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // A focused terminal owns the keyboard — let zellij/vim/the shell have every
      // key (Ctrl+K, Ctrl+Shift+P/T included) instead of opening the command bar.
      if (terminalHasKeyboardFocus()) return;
      const key = event.key.toLowerCase();
      const opensPrimaryPalette = (event.ctrlKey || event.metaKey) && key === "k";
      const opensTerminalPalette = event.ctrlKey && event.shiftKey && key === "p";
      const createsNewTerminal = event.ctrlKey && event.shiftKey && key === "t";
      if (opensPrimaryPalette || opensTerminalPalette) {
        event.preventDefault();
        event.stopPropagation();
        inputRef.current?.focus();
        setCommandOpen(true);
      }
      if (createsNewTerminal) {
        event.preventDefault();
        event.stopPropagation();
        createNewTab();
        setWorkspaceMode("split");
        setCommandStatus("new terminal");
      }
    }

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [setWorkspaceMode]);

  const executeAction = (action: CommandAction | undefined) => {
    if (!action) {
      setCommandStatus(commandValue.trim() ? "no command" : "");
      return;
    }

    action.run();
    setCommandValue("");
    setCommandOpen(false);
    inputRef.current?.blur();
  };


  return (
    <header className="workbench-header" style={styles.header}>
      <span
        className="workbench-header-context"
        style={styles.contextCrumb}
        title={crumbRoot ?? "No project selected"}
      >
        <FolderTree size={13} strokeWidth={1.8} color="var(--text-secondary)" />
        <span style={styles.contextCrumbName}>{projectLabel}</span>
        {crumbRoot && (
          <span style={styles.contextCrumbPath}>{pathTail(crumbRoot)}</span>
        )}
      </span>
      <div className="workbench-command-search" style={{ ...styles.search, ...(commandOpen ? styles.searchActive : null) }}>
        <span style={styles.searchIcon}>
          <Command size={13} strokeWidth={1.8} />
        </span>
        <input
          ref={inputRef}
          style={styles.commandInput}
          value={commandValue}
          placeholder={commandStatus || "Command, session, file, or workspace action"}
          aria-label="Workspace command"
          onFocus={() => setCommandOpen(true)}
          onBlur={() => window.setTimeout(() => setCommandOpen(false), 120)}
          onChange={(event) => {
            setCommandValue(event.target.value);
            setCommandOpen(true);
          }}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Enter") {
              event.preventDefault();
              executeAction(visibleActions[selectedIndex] ?? visibleActions[0]);
            }
            if (event.key === "Escape") {
              setCommandValue("");
              setCommandStatus("");
              setCommandOpen(false);
              inputRef.current?.blur();
            }
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setCommandOpen(true);
              setSelectedIndex((index) => Math.min(index + 1, Math.max(visibleActions.length - 1, 0)));
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setSelectedIndex((index) => Math.max(index - 1, 0));
            }
          }}
        />
        <span className="workbench-command-shortcut" style={styles.commandShortcut}>Ctrl K</span>
      </div>
      {commandOpen && (
        <div className="workbench-command-menu" style={styles.menu}>
          <div style={styles.scopeRow}>
            {COMMAND_SCOPES.map((scope) => {
              const active = commandQuery.startsWith(scope.prefix);
              return (
                <button
                  key={scope.id}
                  type="button"
                  style={{
                    ...styles.scopeButton,
                    borderColor: active ? "var(--command-chip-active-border)" : "var(--border-subtle)",
                    color: active ? "var(--accent-live)" : "var(--text-secondary)",
                    background: active ? "var(--command-chip-active-bg)" : "var(--surface-base)",
                  }}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    setScopedCommand(scope.prefix);
                  }}
                >
                  {scope.label}
                </button>
              );
            })}
          </div>
          <div style={styles.contextRow} aria-label="Input context">
            <span style={styles.contextChip} title={activeTab?.title ?? "No active session"}>
              <Terminal size={11} strokeWidth={1.8} />
              {activeTab?.title ?? "no session"}
            </span>
            <span style={styles.contextChip} title={selectedProjectRoot ?? "Workspace"}>
              <FolderTree size={11} strokeWidth={1.8} />
              {selectedProjectName}
            </span>
            <span style={styles.contextChip} title="Active pane count">
              <PanelRight size={11} strokeWidth={1.8} />
              {activePaneCount} panes
            </span>
            <span style={styles.contextChip} title="Open file context">
              <AtSign size={11} strokeWidth={1.8} />
              {openFiles.length} files
            </span>
          </div>
          {visibleActions.length === 0 && (
            <div style={styles.emptyResult}>
              No matching entries.
            </div>
          )}
          {visibleActions.map((action, index) => {
            const active = index === selectedIndex;
            const Icon = action.Icon;
            return (
              <div
                key={action.id}
                className="workbench-command-result"
                style={{ "--result-index": index } as CSSProperties}
                data-active={active ? "true" : "false"}
              >
                <div
                  style={{
                    ...styles.menuRow,
                    ...(active ? styles.menuRowActive : null),
                  }}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    executeAction(action);
                  }}
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  <span style={styles.menuIcon}>
                    <Icon size={13} strokeWidth={1.8} />
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <div style={styles.menuLabel}>{action.label}</div>
                    <div style={styles.menuDetail}>{action.detail}</div>
                  </span>
                  <span style={styles.menuScopeTag}>{action.shortcut ?? action.scope}</span>
                </div>
              </div>
            );
          })}
          <div style={styles.menuFooter}>
            <div style={styles.keyHints}>
              <span style={styles.keyHint}>↑↓</span>
              <span>navigate</span>
              <span style={styles.keyHint}>Enter</span>
              <span>run</span>
              <span style={styles.keyHint}>Esc</span>
              <span>close</span>
            </div>
            <span style={styles.resultCount}>
              {visibleActions.length === 0 ? "0 results" : `${selectedIndex + 1}/${visibleActions.length}`}
            </span>
          </div>
        </div>
      )}
    </header>
  );
}
