import { CSSProperties, ReactNode, useEffect, useRef, useState } from "react";
import {
  CaretDoubleLeft,
  CaretDoubleRight,
  FileText,
  FolderOpen,
  MapTrifold,
  Note,
  Palette,
  Plus,
  Smiley,
  SquaresFour,
  TerminalWindow,
  TextT,
  Trash,
  TreeStructure,
  X,
} from "@phosphor-icons/react";
import { createNewTab, createTerminalTab, splitActivePane, splitActivePreviewPane, useWorkspaceStore } from "../stores/workspace";
import { FolderPicker } from "./FolderPicker";
import type { CanvasNode, Tab } from "../lib/types";
import { taskStatusColor, taskStatusLabel } from "../lib/masterPlanTasks";
import { useMasterPlanTasks } from "../hooks/useMasterPlanTasks";
import { pathTail, projectNameFor } from "../lib/projectDisplay";
import { FileExplorer } from "./FileExplorer";

const TERMINAL_COLORS = [
  "#d99a45",
  "#7fc681",
  "#7dbac3",
  "#6ea8fe",
  "#ad8fcb",
  "#ef6f72",
];
const TERMINAL_EMOJIS = ["💻", "⚙️", "🚀", "🧪", "🛠️", "📦", "🔧", "🧭"];

type OperationsPanel = "sessions" | "map";

const panelIcons: Record<OperationsPanel, typeof TerminalWindow> = {
  sessions: TerminalWindow,
  map: MapTrifold,
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
    padding: 8,
  },
  projectList: {
    padding: "8px 8px 6px",
    borderBottom: "1px solid var(--border-subtle)",
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
    minHeight: 40,
    display: "grid",
    gridTemplateColumns: "30px minmax(0, 1fr) auto",
    gap: 11,
    alignItems: "center",
    padding: "9px 10px",
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
    width: 30,
    height: 30,
    borderRadius: 8,
    display: "grid",
    placeItems: "center",
    background: "var(--surface-raised)",
    border: "none",
  },
  projectGrid: {
    display: "grid",
    gap: 5,
  },
  row: {
    position: "relative",
    minHeight: 48,
    display: "grid",
    gridTemplateColumns: "30px minmax(0, 1fr) auto",
    gap: 11,
    alignItems: "center",
    padding: "9px 10px",
    border: "1px solid transparent",
    borderRadius: "var(--radius-sm)",
    background: "transparent",
    cursor: "pointer",
    color: "var(--text-primary)",
    outline: "none",
    boxShadow: "none",
    WebkitTapHighlightColor: "transparent",
    transition: "background var(--motion-fast), box-shadow var(--motion-fast)",
  },
  activeRow: {
    background: "var(--surface-selected)",
    borderColor: "transparent",
    boxShadow: "none",
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
  if (node.type === "preview") return <SquaresFour size={13} weight="duotone" />;
  if (node.type === "file") return <FileText size={13} />;
  return <Note size={13} />;
}

function PanelButton({ panel }: { panel: OperationsPanel }) {
  const ui = useWorkspaceStore((state) => state.workspaceUiState);
  const updateUi = useWorkspaceStore((state) => state.updateWorkspaceUiState);
  const setWorkspaceMode = useWorkspaceStore((state) => state.setWorkspaceMode);
  const active = ui.primarySidebarPanel === panel && !ui.primarySidebarCollapsed;
  const Icon = panelIcons[panel];
  const label = panel[0].toUpperCase() + panel.slice(1);

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
      title={label}
      aria-label={label}
      aria-current={active ? "page" : undefined}
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
      title={active ? "Hide files" : "Show files"}
      aria-label={active ? "Hide files" : "Show files"}
      aria-current={active ? "page" : undefined}
      onClick={() => updateUi({ fileExplorerCollapsed: !ui.fileExplorerCollapsed })}
    >
      <FolderOpen size={15} weight="duotone" />
    </button>
  );
}

function PreviewButton() {
  const activeTabId = useWorkspaceStore((state) => state.activeTabId);
  const activeTab = useWorkspaceStore((state) => state.tabs.find((tab) => tab.id === activeTabId));
  const active = JSON.stringify(activeTab?.splitLayout).includes('"type":"preview"');

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
      title="Preview"
      aria-label="Preview"
      aria-current={active ? "page" : undefined}
      onClick={() => splitActivePreviewPane()}
      disabled={!activeTab?.terminals.find((terminal) => terminal.paneId === activeTab.activePaneId)?.previewUrl}
    >
      <SquaresFour size={15} weight="duotone" />
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
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    }

    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
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
      <div style={styles.emojiGrid}>
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
      </div>
    </div>
  );
}

function ProjectContextMenu({
  id,
  name,
  x,
  y,
  onClose,
}: {
  id: string;
  name: string;
  x: number;
  y: number;
  onClose: () => void;
}) {
  const updateGroup = useWorkspaceStore((state) => state.updateGroup);
  const removeGroup = useWorkspaceStore((state) => state.removeGroup);
  const [value, setValue] = useState(name);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
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
        top: Math.min(y, window.innerHeight - 188),
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div style={styles.contextHeader}>
        <TreeStructure size={14} weight="duotone" />
        <span style={{ minWidth: 0, display: "grid", gap: 1 }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Project</span>
          <span style={{ color: "var(--text-secondary)", fontSize: 10, fontWeight: 400 }}>Rename or remove</span>
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
}: {
  x: number;
  y: number;
  onClose: () => void;
  onProjectLauncher: () => void;
}) {
  const activeTabId = useWorkspaceStore((state) => state.activeTabId);
  const activeTab = useWorkspaceStore((state) => state.tabs.find((tab) => tab.id === activeTabId));
  const setWorkspaceMode = useWorkspaceStore((state) => state.setWorkspaceMode);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    }

    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
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
        icon={<SquaresFour size={13} weight="duotone" />}
        label="Localhost preview"
        detail="Open beside the active terminal"
        onClick={() => {
          if (splitActivePreviewPane()) setWorkspaceMode("split");
        }}
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

function SessionsPanel({
  onOpenTerminalMenu,
  onOpenProjectMenu,
}: {
  onOpenTerminalMenu: (event: React.MouseEvent, tab: Tab) => void;
  onOpenProjectMenu: (event: React.MouseEvent, project: { id: string; name: string }) => void;
}) {
  const tabs = useWorkspaceStore((state) => state.tabs);
  const groups = useWorkspaceStore((state) => state.groups);
  const projectRoot = useWorkspaceStore((state) => state.projectRoot);
  const activeTabId = useWorkspaceStore((state) => state.activeTabId);
  const activeGroupFilter = useWorkspaceStore((state) => state.activeGroupFilter);
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
  const [showLauncher, setShowLauncher] = useState(false);
  const [newTerminalMenu, setNewTerminalMenu] = useState<{ x: number; y: number } | null>(null);
  const [projectName, setProjectName] = useState("");
  const [projectPath, setProjectPath] = useState(projectRoot ?? "");
  const [pickerOpen, setPickerOpen] = useState(false);
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
  const projects = groups.map((group) => ({
    id: group.id as string | null,
    name: group.name,
    color: group.color,
    count: tabs.filter((tab) => tab.groupId === group.id).length,
  }));

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
    const nextX = 306 - (node.x + node.width / 2) * zoom;
    const nextY = 220 - (node.y + node.height / 2) * zoom;
    selectCanvasNode(node.id);
    updateCanvasViewport({
      zoom,
      x: Math.round(nextX),
      y: Math.round(nextY),
    });
  };

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
      <div style={styles.projectList}>
        <div style={styles.sectionLabel}>
          <span>Projects</span>
          <span>{groups.length}</span>
        </div>
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
        ) : (
        <div style={styles.projectGrid}>
          {projects.map((project) => {
            const active = project.id === activeGroupFilter;
            return (
              <button
                key={project.id ?? "all-projects"}
                className="workspace-sidebar-row"
                data-active={active ? "true" : "false"}
                style={styles.projectRow}
                title={project.id ? `Switch to ${project.name} — right-click to rename` : `Switch to ${project.name}`}
                aria-label={`Switch to ${project.name}`}
                onClick={() => switchProject(project.id)}
                onContextMenu={(event) => {
                  if (!project.id) return;
                  onOpenProjectMenu(event, { id: project.id, name: project.name });
                }}
              >
                <span
                  style={{
                    ...styles.projectDot,
                    color: active ? "var(--text-primary)" : "var(--text-secondary)",
                  }}
                >
                  {project.id === null ? (
                    <SquaresFour size={12} weight="duotone" />
                  ) : (
                    <TreeStructure size={12} weight="duotone" />
                  )}
                </span>
                <span style={{ minWidth: 0, display: "flex", alignItems: "baseline", gap: 7 }}>
                  <span
                    style={{
                      ...styles.rowTitle,
                      color: active ? "var(--text-primary)" : "var(--text-secondary)",
                    }}
                  >
                    {project.name}
                  </span>
                  <span style={{ ...styles.rowMeta, marginTop: 0 }}>{project.count}</span>
                </span>
              </button>
            );
          })}
        </div>
        )}
      </div>
      <div style={styles.list}>
        <div style={styles.sectionLabel}>
          <span>Sessions</span>
          <span>{activeProjectName}</span>
        </div>
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
          return (
            <div
              key={tab.id}
              className="workspace-sidebar-row"
              role="button"
              tabIndex={0}
              aria-label={`Open session ${tab.title}`}
              aria-current={active ? "true" : undefined}
              data-active={active ? "true" : "false"}
              style={{
                ...styles.row,
                ...(active ? styles.activeRow : null),
              }}
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
              <span style={{ minWidth: 0 }}>
                <div style={{ ...styles.rowTitle, color: active ? "var(--text-primary)" : "var(--text-secondary)" }}>
                  {tab.title}
                </div>
                <div style={styles.rowMeta}>
                  {group ? `${group.name} · ` : ""}
                  {pathTail(tab.initialCwd)}
                </div>
              </span>
              <span className="workspace-sidebar-actions" style={styles.rowActions}>
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
      <div style={styles.footer}>
        <button className="workspace-primary-button" style={styles.primaryButton} onClick={openProjectLauncher}>
          <Plus size={14} />
          Project
        </button>
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
}: {
  onOpenTerminalMenu: (event: React.MouseEvent, tab: Tab) => void;
}) {
  const tabs = useWorkspaceStore((state) => state.tabs);
  const groups = useWorkspaceStore((state) => state.groups);
  const liveCwds = useWorkspaceStore((state) => state.liveCwds);
  const activeGroupFilter = useWorkspaceStore((state) => state.activeGroupFilter);
  const canvasState = useWorkspaceStore((state) => state.canvasState);
  const setActiveTab = useWorkspaceStore((state) => state.setActiveTab);
  const setWorkspaceMode = useWorkspaceStore((state) => state.setWorkspaceMode);
  const selectCanvasNode = useWorkspaceStore((state) => state.selectCanvasNode);
  const updateCanvasViewport = useWorkspaceStore((state) => state.updateCanvasViewport);
  const removeCanvasNode = useWorkspaceStore((state) => state.removeCanvasNode);
  const closeTerminalSession = useWorkspaceStore((state) => state.closeTerminalSession);
  const closePane = useWorkspaceStore((state) => state.closePane);

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

  const visibleNodes = activeGroupFilter === null
    ? canvasState.nodes
    : canvasState.nodes.filter((node) => {
        if (!node.terminalTabId) return true;
        return tabs.find((tab) => tab.id === node.terminalTabId)?.groupId === activeGroupFilter;
      });
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

  return (
    <>
      <div style={styles.header}>
        <div style={styles.title}>
          <MapTrifold size={14} weight="duotone" />
          <span>Map</span>
        </div>
        <span style={styles.count}>{visibleNodes.length}</span>
      </div>
      <div style={styles.list}>
        {visibleNodes.length === 0 ? (
          <div style={styles.empty}>No map nodes yet.</div>
        ) : (
          visibleNodes.map((node) => {
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
            return (
              <div
                key={node.id}
                className="workspace-sidebar-row"
                data-active={node.id === canvasState.selectedNodeId ? "true" : "false"}
                style={{
                  ...styles.row,
                  ...(node.id === canvasState.selectedNodeId ? styles.activeRow : null),
                }}
                onMouseDown={(event) => event.preventDefault()}
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
              >
                {linkedTab && node.type !== "preview" ? (
                  <TerminalAvatar
                    tab={linkedTab}
                    active={node.id === canvasState.selectedNodeId}
                  />
                ) : (
                  <span style={styles.iconCell}>{nodeIcon(node)}</span>
                )}
                <span style={{ minWidth: 0 }}>
                  <div style={styles.rowTitle}>
                    {node.type === "preview" ? node.title : linkedTab ? linkedProjectName : node.title}
                  </div>
                  <div style={styles.rowMeta}>
                    {node.type === "preview"
                      ? node.previewUrl ?? "Localhost preview"
                      : node.terminalTabId && linkedTab
                      ? `${pathTail(liveNodeCwd ?? node.terminalCwd ?? linkedTab.initialCwd)} · ${linkedTab.title}`
                      : `${Math.round(node.width)} x ${Math.round(node.height)}`}
                  </div>
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
                    <X size={13} />
                  </button>
                </span>
              </div>
            );
          })
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
  const [projectMenu, setProjectMenu] = useState<{ id: string; name: string; x: number; y: number } | null>(null);

  const openTerminalMenu = (event: React.MouseEvent, tab: Tab) => {
    event.preventDefault();
    event.stopPropagation();
    setTerminalMenu({ tab, x: event.clientX, y: event.clientY });
  };

  const openProjectMenu = (event: React.MouseEvent, project: { id: string; name: string }) => {
    event.preventDefault();
    event.stopPropagation();
    setProjectMenu({ id: project.id, name: project.name, x: event.clientX, y: event.clientY });
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
          <MapPanel onOpenTerminalMenu={openTerminalMenu} />
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
          x={projectMenu.x}
          y={projectMenu.y}
          onClose={() => setProjectMenu(null)}
        />
      )}
    </aside>
  );
}
