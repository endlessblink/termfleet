import { CSSProperties, useCallback } from "react";
import { FileText, Map, NotebookText, TerminalSquare, X } from "lucide-react";
import type { CanvasNode, Group, Tab } from "../lib/types";
import { pathTail, projectForTab } from "../lib/projectDisplay";
import { useWorkspaceStore } from "../stores/workspace";

const styles: Record<string, CSSProperties> = {
  sidebar: {
    width: "var(--canvas-sidebar-width)",
    minWidth: "var(--canvas-sidebar-width)",
    height: "100%",
    background: "var(--surface-base)",
    borderRight: "1px solid var(--border-subtle)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    userSelect: "none",
  },
  header: {
    minHeight: 56,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    padding: "12px 16px",
    borderBottom: "1px solid var(--border-subtle)",
    color: "var(--text-primary)",
    fontSize: 15,
    fontWeight: 500,
  },
  headerTitle: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
  },
  closeButton: {
    width: 25,
    height: 24,
    border: "1px solid transparent",
    borderRadius: "var(--radius-sm)",
    background: "var(--surface-base)",
    color: "var(--text-secondary)",
    cursor: "pointer",
    fontFamily: "var(--font-ui)",
    fontSize: 12,
    display: "grid",
    placeItems: "center",
    transition: "background var(--motion-fast), border-color var(--motion-fast), color var(--motion-fast)",
  },
  sectionLabel: {
    padding: "8px 10px 6px",
    color: "var(--text-secondary)",
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0,
    fontWeight: 500,
  },
  list: {
    flex: 1,
    overflowY: "auto",
    overflowX: "hidden",
    padding: "0 5px 8px",
  },
  row: {
    minHeight: 44,
    display: "grid",
    gridTemplateColumns: "30px minmax(0, 1fr)",
    alignItems: "center",
    gap: 11,
    padding: "8px 10px",
    borderRadius: "var(--radius-sm)",
    cursor: "pointer",
    border: "1px solid transparent",
    transition: "background var(--motion-fast)",
  },
  icon: {
    width: 30,
    height: 30,
    display: "grid",
    placeItems: "center",
    borderRadius: 8,
    color: "var(--canvas-node-icon-fg)",
  },
  title: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: "var(--text-primary)",
    fontSize: 14,
  },
  meta: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: "var(--text-secondary)",
    fontSize: 11,
    marginTop: 2,
  },
  empty: {
    padding: 12,
    color: "var(--text-secondary)",
    fontSize: 12,
    lineHeight: 1.45,
  },
};

function nodeIcon(node: CanvasNode) {
  if (node.type === "terminal") {
    return {
      icon: <TerminalSquare size={13} strokeWidth={1.8} />,
      bg: "var(--canvas-terminal-icon)",
    };
  }
  if (node.type === "file") {
    return {
      icon: <FileText size={13} strokeWidth={1.8} />,
      bg: "var(--canvas-file-icon)",
    };
  }
  return {
    icon: <NotebookText size={13} strokeWidth={1.8} />,
    bg: "var(--canvas-note-icon)",
  };
}

function nodeMeta(node: CanvasNode, linkedTab?: Tab, liveCwd?: string) {
  if (node.type === "terminal") return pathTail(liveCwd ?? node.terminalCwd ?? linkedTab?.initialCwd);
  if (node.type === "file") return node.filePath ?? "No file path";
  return `${Math.round(node.width)} x ${Math.round(node.height)}`;
}

function NodeRow({
  node,
  linkedTab,
  groups,
  selected,
  onSelect,
  onRename,
}: {
  node: CanvasNode;
  linkedTab?: Tab;
  groups: Group[];
  selected: boolean;
  onSelect: (node: CanvasNode) => void;
  onRename: (node: CanvasNode) => void;
}) {
  const icon = nodeIcon(node);
  const linkedProject = projectForTab(linkedTab, groups);
  const liveCwds = useWorkspaceStore((s) => s.liveCwds);
  const liveTermId =
    linkedTab?.terminals.find((t) => t.paneId === linkedTab.activePaneId)?.id ??
    node.terminalPtyId ??
    linkedTab?.terminals[0]?.id;
  const liveCwd = liveTermId ? liveCwds[liveTermId] : undefined;
  const title = node.type === "terminal" && linkedProject ? linkedProject.name : node.title;
  const meta = node.type === "terminal" && linkedTab
    ? `${nodeMeta(node, linkedTab, liveCwd)} · ${linkedTab.title}`
    : nodeMeta(node, linkedTab, liveCwd);
  return (
    <div
      className="canvas-sidebar-row"
      role="button"
      tabIndex={0}
      aria-current={selected ? "true" : undefined}
      data-selected={selected ? "true" : "false"}
      style={{
        ...styles.row,
        background: selected ? "var(--surface-selected)" : "transparent",
        borderColor: "transparent",
        boxShadow: "none",
      }}
      onClick={() => onSelect(node)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(node);
        }
      }}
      onDoubleClick={() => onRename(node)}
      title="Click to jump to node. Double-click to rename."
    >
      <span style={{ ...styles.icon, background: icon.bg }}>{icon.icon}</span>
      <span style={{ minWidth: 0 }}>
        <div style={styles.title} dir="auto">{title}</div>
        <div style={styles.meta} dir="auto">{meta}</div>
      </span>
    </div>
  );
}

export function CanvasSidebar() {
  const workspaceMode = useWorkspaceStore((state) => state.workspaceUiState.workspaceMode);
  const collapsed = useWorkspaceStore((state) => state.workspaceUiState.canvasSidebarCollapsed);
  const canvasState = useWorkspaceStore((state) => state.canvasState);
  const tabs = useWorkspaceStore((state) => state.tabs);
  const groups = useWorkspaceStore((state) => state.groups);
  const activeGroupFilter = useWorkspaceStore((state) => state.activeGroupFilter);
  const selectCanvasNode = useWorkspaceStore((state) => state.selectCanvasNode);
  const updateCanvasNode = useWorkspaceStore((state) => state.updateCanvasNode);
  const updateCanvasViewport = useWorkspaceStore((state) => state.updateCanvasViewport);
  const updateUiState = useWorkspaceStore((state) => state.updateWorkspaceUiState);

  const onSelect = useCallback((node: CanvasNode) => {
    const zoom = node.type === "terminal" ? Math.min(canvasState.viewport.zoom, 0.9) : canvasState.viewport.zoom;
    selectCanvasNode(node.id);
    updateCanvasViewport({
      zoom,
      x: node.type === "terminal" ? 18 - node.x * zoom : 280 - node.x * zoom,
      y: 150 - node.y * zoom,
    });
  }, [canvasState.viewport.zoom, selectCanvasNode, updateCanvasViewport]);

  const onRename = useCallback((node: CanvasNode) => {
    const nextTitle = window.prompt(`Rename ${node.type}`, node.title);
    const trimmed = nextTitle?.trim();
    if (trimmed) updateCanvasNode(node.id, { title: trimmed });
  }, [updateCanvasNode]);

  if (workspaceMode !== "canvas" || collapsed) return null;

  const visibleNodes = activeGroupFilter === null
    ? canvasState.nodes
    : canvasState.nodes.filter((node) => {
        if (!node.terminalTabId) return true;
        return tabs.find((tab) => tab.id === node.terminalTabId)?.groupId === activeGroupFilter;
      });
  const terminals = visibleNodes.filter((node) => node.type === "terminal");
  const others = visibleNodes.filter((node) => node.type !== "terminal");

  return (
    <aside style={styles.sidebar}>
      <div style={styles.header}>
        <span style={styles.headerTitle}>
          <Map size={14} strokeWidth={1.8} />
          <span>Map</span>
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ color: "var(--text-secondary)", fontSize: 11 }}>{visibleNodes.length}</span>
          <button
            className="canvas-sidebar-close"
            style={styles.closeButton}
            title="Hide map index"
            aria-label="Hide map index"
            onClick={() => updateUiState({ canvasSidebarCollapsed: true })}
          >
            <X size={13} strokeWidth={1.8} />
          </button>
        </span>
      </div>
      <div style={styles.sectionLabel}>Shells</div>
      <div style={styles.list}>
        {terminals.length === 0 ? (
          <div style={styles.empty}>No canvas terminals yet.</div>
        ) : (
          terminals.map((node) => (
            <NodeRow
              key={node.id}
              node={node}
              linkedTab={node.terminalTabId ? tabs.find((tab) => tab.id === node.terminalTabId) : undefined}
              groups={groups}
              selected={canvasState.selectedNodeId === node.id}
              onSelect={onSelect}
              onRename={onRename}
            />
          ))
        )}
        {others.length > 0 && <div style={styles.sectionLabel}>Notes and files</div>}
        {others.map((node) => (
          <NodeRow
            key={node.id}
            node={node}
            groups={groups}
            selected={canvasState.selectedNodeId === node.id}
            onSelect={onSelect}
            onRename={onRename}
          />
        ))}
      </div>
    </aside>
  );
}
