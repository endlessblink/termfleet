import { CSSProperties, useCallback, useMemo, useState } from "react";
import { FileText, Globe, Map, NotebookText, TerminalSquare, X } from "lucide-react";
import type { CanvasNode, Group, Tab } from "../lib/types";
import { pathTail, projectForTab, projectNameFor } from "../lib/projectDisplay";
import { useWorkspaceStore } from "../stores/workspace";
import { MAP_FILTERS, type MapFilter, nodeMatchesMapFilter } from "../lib/mapNodeFilters";

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
  filterBar: {
    display: "flex",
    gap: 5,
    padding: "8px 10px",
    borderBottom: "1px solid var(--border-subtle)",
    overflowX: "auto",
  },
  filterButton: {
    minWidth: 64,
    height: 28,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    padding: "0 8px",
    border: "1px solid transparent",
    borderRadius: "var(--radius-sm)",
    background: "var(--surface-base)",
    color: "var(--text-secondary)",
    fontFamily: "var(--font-ui)",
    fontSize: 11,
    fontWeight: 500,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  filterCount: {
    color: "var(--text-tertiary)",
    fontSize: 10,
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
  titleInput: {
    width: "100%",
    minWidth: 0,
    height: 24,
    border: "1px solid var(--border-focus)",
    borderRadius: "var(--radius-sm)",
    background: "var(--surface-raised)",
    color: "var(--text-primary)",
    fontFamily: "var(--font-ui)",
    fontSize: 14,
    outline: "none",
    padding: "0 6px",
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
  sortToggle: {
    display: "inline-flex",
    gap: 3,
    padding: 2,
    borderRadius: "var(--radius-sm)",
    background: "var(--surface-base)",
    border: "1px solid var(--border-subtle)",
  },
  sortToggleButton: {
    height: 22,
    padding: "0 8px",
    border: "1px solid transparent",
    borderRadius: "var(--radius-sm)",
    background: "transparent",
    color: "var(--text-secondary)",
    fontFamily: "var(--font-ui)",
    fontSize: 11,
    fontWeight: 500,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
};

const DROP_INDICATOR_COLOR = "var(--border-focus)";

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
  if (node.type === "preview") {
    return {
      icon: <Globe size={13} strokeWidth={1.8} />,
      bg: "var(--accent-info)",
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
  if (node.type === "preview") return node.previewUrl ?? "Localhost preview";
  return `${Math.round(node.width)} x ${Math.round(node.height)}`;
}

function NodeRow({
  node,
  linkedTab,
  groups,
  selected,
  onSelect,
  onRename,
  draggable = false,
  dropIndicator,
  isDragging = false,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  node: CanvasNode;
  linkedTab?: Tab;
  groups: Group[];
  selected: boolean;
  onSelect: (node: CanvasNode) => void;
  onRename: (node: CanvasNode, title: string) => void;
  draggable?: boolean;
  dropIndicator?: "before" | "after" | null;
  isDragging?: boolean;
  onDragStart?: (node: CanvasNode, event: React.DragEvent) => void;
  onDragOver?: (node: CanvasNode, event: React.DragEvent) => void;
  onDrop?: (node: CanvasNode, event: React.DragEvent) => void;
  onDragEnd?: () => void;
}) {
  const icon = nodeIcon(node);
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(node.title);
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
  const beginRename = useCallback(() => {
    setDraftTitle(node.title);
    setEditing(true);
  }, [node.title]);
  const commitRename = useCallback(() => {
    const trimmed = draftTitle.trim();
    if (trimmed) onRename(node, trimmed);
    setEditing(false);
  }, [draftTitle, node, onRename]);
  const cancelRename = useCallback(() => {
    setDraftTitle(node.title);
    setEditing(false);
  }, [node.title]);
  return (
    <div
      className="canvas-sidebar-row"
      data-testid="canvas-sidebar-node-row"
      role="button"
      tabIndex={0}
      aria-current={selected ? "true" : undefined}
      data-selected={selected ? "true" : "false"}
      draggable={draggable && !editing}
      style={{
        ...styles.row,
        background: selected ? "var(--surface-selected)" : "transparent",
        borderColor: "transparent",
        boxShadow:
          dropIndicator === "before"
            ? `inset 0 2px 0 0 ${DROP_INDICATOR_COLOR}`
            : dropIndicator === "after"
              ? `inset 0 -2px 0 0 ${DROP_INDICATOR_COLOR}`
              : "none",
        opacity: isDragging ? 0.45 : 1,
        cursor: draggable ? "grab" : "pointer",
      }}
      onDragStart={(event) => onDragStart?.(node, event)}
      onDragOver={(event) => onDragOver?.(node, event)}
      onDrop={(event) => onDrop?.(node, event)}
      onDragEnd={() => onDragEnd?.()}
      onClick={() => onSelect(node)}
      onKeyDown={(event) => {
        if (editing) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(node);
        }
      }}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        beginRename();
      }}
      title="Click to jump to node. Double-click to rename."
    >
      <span style={{ ...styles.icon, background: icon.bg }}>{icon.icon}</span>
      <span style={{ minWidth: 0 }}>
        {editing ? (
          <input
            aria-label={`Rename ${node.type}`}
            data-testid="canvas-sidebar-rename-input"
            autoFocus
            draggable={false}
            dir="auto"
            style={styles.titleInput}
            value={draftTitle}
            onChange={(event) => setDraftTitle(event.target.value)}
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
        ) : (
          <div style={styles.title} dir="auto">{title}</div>
        )}
        <div style={styles.meta} dir="auto">{meta}</div>
      </span>
    </div>
  );
}

const SORT_MODES: { id: "manual" | "project"; label: string }[] = [
  { id: "manual", label: "Manual" },
  { id: "project", label: "By project" },
];

export function CanvasSidebar() {
  const [mapFilter, setMapFilter] = useState<MapFilter>("all");
  const workspaceMode = useWorkspaceStore((state) => state.workspaceUiState.workspaceMode);
  const collapsed = useWorkspaceStore((state) => state.workspaceUiState.canvasSidebarCollapsed);
  const sortMode = useWorkspaceStore((state) => state.workspaceUiState.canvasSidebarSortMode);
  const canvasState = useWorkspaceStore((state) => state.canvasState);
  const tabs = useWorkspaceStore((state) => state.tabs);
  const groups = useWorkspaceStore((state) => state.groups);
  const selectCanvasNode = useWorkspaceStore((state) => state.selectCanvasNode);
  const renameCanvasNode = useWorkspaceStore((state) => state.renameCanvasNode);
  const reorderCanvasNodes = useWorkspaceStore((state) => state.reorderCanvasNodes);
  const updateCanvasViewport = useWorkspaceStore((state) => state.updateCanvasViewport);
  const updateUiState = useWorkspaceStore((state) => state.updateWorkspaceUiState);

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; place: "before" | "after" } | null>(null);

  const onSelect = useCallback((node: CanvasNode) => {
    const zoom = node.type === "terminal" ? 1 : canvasState.viewport.zoom;
    selectCanvasNode(node.id);
    const nextX = node.type === "terminal" ? 18 - node.x * zoom : 280 - node.x * zoom;
    const nextY = 150 - node.y * zoom;
    updateCanvasViewport({
      zoom,
      x: node.type === "terminal" && zoom === 1 ? Math.round(nextX) : nextX,
      y: node.type === "terminal" && zoom === 1 ? Math.round(nextY) : nextY,
    });
  }, [canvasState.viewport.zoom, selectCanvasNode, updateCanvasViewport]);

  const onRename = useCallback((node: CanvasNode, title: string) => {
    renameCanvasNode(node.id, title);
  }, [renameCanvasNode]);

  const groupVisibleNodes = canvasState.nodes;
  const nodeTab = useCallback((node: CanvasNode) =>
    node.terminalTabId ? tabs.find((tab) => tab.id === node.terminalTabId) : undefined,
  [tabs]);
  const filterCounts = useMemo(() => Object.fromEntries(
    MAP_FILTERS.map((filter) => [
      filter.id,
      groupVisibleNodes.filter((node) => nodeMatchesMapFilter(node, nodeTab(node), filter.id)).length,
    ])
  ) as Record<MapFilter, number>, [groupVisibleNodes, nodeTab]);
  const visibleNodes = groupVisibleNodes.filter((node) => nodeMatchesMapFilter(node, nodeTab(node), mapFilter));
  const terminals = visibleNodes.filter((node) => node.type === "terminal");
  const others = visibleNodes.filter((node) => node.type !== "terminal");

  const draggable = sortMode === "manual";

  const clearDrag = useCallback(() => {
    setDraggingId(null);
    setDropTarget(null);
  }, []);
  const onDragStart = useCallback((node: CanvasNode, event: React.DragEvent) => {
    setDraggingId(node.id);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", node.id);
  }, []);
  const onDragOver = useCallback((node: CanvasNode, event: React.DragEvent) => {
    if (!draggingId || draggingId === node.id) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const rect = event.currentTarget.getBoundingClientRect();
    const place = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
    setDropTarget((prev) => (prev?.id === node.id && prev.place === place ? prev : { id: node.id, place }));
  }, [draggingId]);
  const onDrop = useCallback((node: CanvasNode, event: React.DragEvent) => {
    event.preventDefault();
    const place = dropTarget?.id === node.id ? dropTarget.place : "before";
    if (draggingId && draggingId !== node.id) reorderCanvasNodes(draggingId, node.id, place);
    clearDrag();
  }, [draggingId, dropTarget, reorderCanvasNodes, clearDrag]);

  const renderRow = useCallback((node: CanvasNode, rowDraggable: boolean) => (
    <NodeRow
      key={node.id}
      node={node}
      linkedTab={nodeTab(node)}
      groups={groups}
      selected={canvasState.selectedNodeId === node.id}
      onSelect={onSelect}
      onRename={onRename}
      draggable={rowDraggable}
      isDragging={draggingId === node.id}
      dropIndicator={dropTarget?.id === node.id ? dropTarget.place : null}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={clearDrag}
    />
  ), [nodeTab, groups, canvasState.selectedNodeId, onSelect, onRename, draggingId, dropTarget, onDragStart, onDragOver, onDrop, clearDrag]);

  const projectBuckets = useMemo(() => {
    const buckets = new globalThis.Map<string | null, CanvasNode[]>();
    for (const node of terminals) {
      const gid = nodeTab(node)?.groupId ?? null;
      const list = buckets.get(gid);
      if (list) list.push(node);
      else buckets.set(gid, [node]);
    }
    const ordered: { key: string; label: string; nodes: CanvasNode[] }[] = [];
    for (const group of groups) {
      const list = buckets.get(group.id);
      if (list) ordered.push({ key: group.id, label: group.name, nodes: list });
    }
    for (const [gid, list] of buckets) {
      if (gid !== null && !groups.some((group) => group.id === gid)) {
        ordered.push({ key: gid, label: projectNameFor(gid, groups), nodes: list });
      }
    }
    const unassigned = buckets.get(null);
    if (unassigned) ordered.push({ key: "__unassigned__", label: projectNameFor(null, groups), nodes: unassigned });
    return ordered;
  }, [terminals, groups, nodeTab]);

  if (workspaceMode !== "canvas" || collapsed) return null;

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
      <div style={styles.filterBar} aria-label="Map arrangement">
        <div style={styles.sortToggle} role="group" aria-label="Arrange terminals">
          {SORT_MODES.map((mode) => {
            const active = sortMode === mode.id;
            return (
              <button
                key={mode.id}
                type="button"
                data-testid={`map-sort-${mode.id}`}
                aria-pressed={active}
                style={{
                  ...styles.sortToggleButton,
                  background: active ? "var(--surface-selected)" : "transparent",
                  color: active ? "var(--text-primary)" : "var(--text-secondary)",
                  borderColor: active ? "var(--border-strong)" : "transparent",
                }}
                onClick={() => updateUiState({ canvasSidebarSortMode: mode.id })}
              >
                {mode.label}
              </button>
            );
          })}
        </div>
      </div>
      <div style={styles.filterBar} aria-label="Map filters">
        {MAP_FILTERS.map((filter) => {
          const active = mapFilter === filter.id;
          return (
            <button
              key={filter.id}
              type="button"
              data-testid={`map-filter-${filter.id}`}
              aria-pressed={active}
              style={{
                ...styles.filterButton,
                background: active ? "var(--surface-selected)" : "var(--surface-base)",
                color: active ? "var(--text-primary)" : "var(--text-secondary)",
                borderColor: active ? "var(--border-strong)" : "transparent",
              }}
              onClick={() => setMapFilter(filter.id)}
            >
              <span>{filter.label}</span>
              <span style={styles.filterCount}>{filterCounts[filter.id]}</span>
            </button>
          );
        })}
      </div>
      {sortMode === "manual" && <div style={styles.sectionLabel}>Shells</div>}
      <div style={styles.list} data-testid="canvas-sidebar-node-list">
        {terminals.length === 0 ? (
          <div style={styles.empty} data-testid="canvas-sidebar-empty">
            {mapFilter === "all" ? "No canvas terminals yet." : "No map nodes match this filter."}
          </div>
        ) : sortMode === "project" ? (
          projectBuckets.map((bucket) => (
            <div key={bucket.key} data-testid="canvas-sidebar-project-group">
              <div style={styles.sectionLabel}>{bucket.label}</div>
              {bucket.nodes.map((node) => renderRow(node, false))}
            </div>
          ))
        ) : (
          terminals.map((node) => renderRow(node, draggable))
        )}
        {others.length > 0 && <div style={styles.sectionLabel}>Previews, notes, and files</div>}
        {others.map((node) => renderRow(node, false))}
      </div>
    </aside>
  );
}
