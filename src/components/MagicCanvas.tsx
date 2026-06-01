import { CSSProperties, useCallback, useRef, useState } from "react";
import {
  ArrowUpRight,
  FileText,
  Layers3,
  Minus,
  NotebookText,
  Plus,
  RotateCcw,
  TerminalSquare,
  X,
} from "lucide-react";
import type { CanvasNode } from "../lib/types";
import { pathTail, projectForTab } from "../lib/projectDisplay";
import { createNewTab, useWorkspaceStore } from "../stores/workspace";
import { TerminalComponent } from "./Terminal";

const styles: Record<string, CSSProperties> = {
  shell: {
    position: "relative",
    width: "100%",
    height: "100%",
    overflow: "hidden",
    cursor: "grab",
    background:
      "radial-gradient(circle, var(--canvas-grid) 1px, transparent 1.5px), linear-gradient(var(--canvas-grid-soft) 1px, transparent 1px), linear-gradient(90deg, var(--canvas-grid-soft) 1px, transparent 1px), #1d2224",
    backgroundSize: "24px 24px, 96px 96px, 96px 96px, auto",
  },
  toolbar: {
    position: "absolute",
    top: 14,
    left: 14,
    zIndex: 20,
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: 7,
    background: "color-mix(in srgb, var(--surface-raised) 96%, transparent)",
    border: "1px solid transparent",
    borderRadius: "var(--radius-md)",
    boxShadow: "var(--shadow-menu)",
    animation: "workbench-popover-in var(--motion-med)",
  },
  toolbarLabel: {
    height: 28,
    display: "flex",
    alignItems: "center",
    gap: 7,
    padding: "0 9px 0 4px",
    color: "var(--accent-live)",
    fontSize: 11,
    letterSpacing: 0,
    textTransform: "uppercase",
    borderRight: "1px solid var(--border-subtle)",
  },
  viewportControls: {
    position: "absolute",
    right: 12,
    bottom: 12,
    zIndex: 20,
    display: "flex",
    alignItems: "center",
    gap: 4,
    padding: 5,
    background: "color-mix(in srgb, var(--surface-raised) 94%, transparent)",
    border: "1px solid transparent",
    borderRadius: "var(--radius-md)",
    boxShadow: "var(--shadow-menu)",
    animation: "workbench-popover-in var(--motion-med)",
  },
  zoomReadout: {
    minWidth: 54,
    textAlign: "center",
    color: "var(--text-secondary)",
    fontSize: 12,
    fontFamily: "var(--font-ui)",
  },
  button: {
    height: 28,
    border: "1px solid transparent",
    borderRadius: "var(--radius-sm)",
    background: "var(--surface-base)",
    color: "var(--text-secondary)",
    fontFamily: "var(--font-ui)",
    fontSize: 12,
    padding: "0 10px",
    cursor: "pointer",
    transition: "background var(--motion-fast), border-color var(--motion-fast), color var(--motion-fast), transform var(--motion-fast)",
  },
  stage: {
    position: "absolute",
    inset: 0,
    transformOrigin: "0 0",
  },
  node: {
    position: "absolute",
    display: "flex",
    flexDirection: "column",
    background: "var(--surface-raised)",
    border: "1px solid transparent",
    borderRadius: "var(--radius-md)",
    boxShadow: "var(--shadow-card)",
    overflow: "hidden",
    transition: "border-color var(--motion-med), box-shadow var(--motion-med), transform var(--motion-fast)",
    animation: "workbench-surface-in var(--motion-med)",
  },
  nodeHeader: {
    minHeight: 42,
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "0 9px 0 11px",
    borderBottom: "1px solid var(--border-subtle)",
    background: "linear-gradient(180deg, var(--surface-raised), var(--surface-wash))",
    cursor: "grab",
    userSelect: "none",
  },
  nodeTitle: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: 13,
    fontWeight: 500,
    color: "var(--text-primary)",
  },
  nodeTitleMeta: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: "var(--text-secondary)",
    fontSize: 10,
    marginTop: 1,
  },
  nodeKind: {
    height: 18,
    display: "flex",
    alignItems: "center",
    padding: "0 6px",
    borderRadius: "var(--radius-xs)",
    background: "rgba(217, 154, 69, 0.12)",
    color: "var(--accent-live)",
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0,
  },
  nodeBody: {
    flex: 1,
    minHeight: 0,
    padding: 10,
    color: "var(--text-secondary)",
    fontSize: 13,
    lineHeight: 1.45,
    overflow: "auto",
  },
  terminalBody: {
    flex: 1,
    minHeight: 0,
    padding: 0,
    overflow: "hidden",
    background: "var(--surface-sunken)",
  },
  nativeTerminalPreview: {
    height: "100%",
    display: "grid",
    gridTemplateRows: "1fr auto",
    gap: 12,
    padding: 16,
    background: "linear-gradient(180deg, #10161a, #0b1013)",
    color: "var(--terminal-fg)",
    cursor: "pointer",
  },
  nativeTerminalPreviewGrid: {
    display: "grid",
    alignContent: "start",
    gap: 8,
    padding: 12,
    border: "1px solid transparent",
    borderRadius: "var(--radius-sm)",
    background:
      "linear-gradient(90deg, rgba(255,255,255,0.045) 1px, transparent 1px), linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), rgba(0,0,0,0.18)",
    backgroundSize: "28px 28px",
  },
  nativeTerminalPrompt: {
    display: "flex",
    alignItems: "center",
    gap: 9,
    minWidth: 0,
    fontFamily: "var(--font-mono)",
    fontSize: 13,
    color: "var(--terminal-fg)",
  },
  nativeTerminalPromptGlyph: {
    color: "var(--accent-live)",
  },
  nativeTerminalPath: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: "var(--text-secondary)",
  },
  nativeTerminalAction: {
    height: 32,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    border: "1px solid transparent",
    borderRadius: "var(--radius-sm)",
    background: "var(--surface-raised)",
    color: "var(--text-primary)",
    fontFamily: "var(--font-ui)",
    fontSize: 12,
    cursor: "pointer",
  },
  closeButton: {
    border: "none",
    background: "transparent",
    color: "var(--text-secondary)",
    cursor: "pointer",
    fontFamily: "var(--font-ui)",
    fontSize: 14,
  },
  headerButton: {
    border: "1px solid transparent",
    background: "var(--surface-raised)",
    color: "var(--text-secondary)",
    cursor: "pointer",
    fontFamily: "var(--font-ui)",
    fontSize: 12,
    height: 22,
    minWidth: 22,
    borderRadius: "var(--radius-sm)",
    padding: "0 5px",
    transition: "background var(--motion-fast), border-color var(--motion-fast), color var(--motion-fast)",
  },
  resizeHandle: {
    position: "absolute",
    zIndex: 8,
  },
  cornerHandle: {
    width: 14,
    height: 14,
    border: "1px solid transparent",
    borderRadius: 3,
    background: "var(--surface-base)",
  },
  edgeHandle: {
    background: "transparent",
  },
  sizeBadge: {
    position: "absolute",
    right: 22,
    bottom: 5,
    zIndex: 7,
    padding: "2px 6px",
    borderRadius: 4,
    background: "color-mix(in srgb, var(--surface-sunken) 90%, transparent)",
    border: "1px solid transparent",
    color: "var(--text-secondary)",
    fontSize: 11,
    fontFamily: "var(--font-ui)",
    pointerEvents: "none",
  },
  empty: {
    position: "absolute",
    left: "50%",
    top: "50%",
    transform: "translate(-50%, -50%)",
    color: "var(--text-secondary)",
    fontSize: 13,
    textAlign: "center",
  },
};

const NODE_MIN_SIZE = {
  terminal: { width: 640, height: 360 },
  file: { width: 260, height: 120 },
  note: { width: 220, height: 120 },
};
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 2.2;
type ResizeDirection = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

function isDesktopNativeRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function clampNodeSize(type: CanvasNode["type"], width: number, height: number) {
  const min = NODE_MIN_SIZE[type];
  return {
    width: Math.max(min.width, Math.round(width)),
    height: Math.max(min.height, Math.round(height)),
  };
}

function cursorForDirection(direction: ResizeDirection) {
  if (direction === "n" || direction === "s") return "ns-resize";
  if (direction === "e" || direction === "w") return "ew-resize";
  if (direction === "ne" || direction === "sw") return "nesw-resize";
  return "nwse-resize";
}

function handleStyle(direction: ResizeDirection): CSSProperties {
  const edge = 6;
  const corner = 14;
  const base = {
    ...styles.resizeHandle,
    cursor: cursorForDirection(direction),
  };

  if (direction === "n") return { ...base, ...styles.edgeHandle, left: corner, right: corner, top: -edge, height: edge * 2 };
  if (direction === "s") return { ...base, ...styles.edgeHandle, left: corner, right: corner, bottom: -edge, height: edge * 2 };
  if (direction === "e") return { ...base, ...styles.edgeHandle, top: corner, bottom: corner, right: -edge, width: edge * 2 };
  if (direction === "w") return { ...base, ...styles.edgeHandle, top: corner, bottom: corner, left: -edge, width: edge * 2 };
  if (direction === "ne") return { ...base, ...styles.cornerHandle, top: -corner / 2, right: -corner / 2 };
  if (direction === "nw") return { ...base, ...styles.cornerHandle, top: -corner / 2, left: -corner / 2 };
  if (direction === "se") return { ...base, ...styles.cornerHandle, bottom: -corner / 2, right: -corner / 2 };
  return { ...base, ...styles.cornerHandle, bottom: -corner / 2, left: -corner / 2 };
}

function nextNodePosition(count: number) {
  return {
    x: 120 + (count % 4) * 36,
    y: 90 + (count % 5) * 34,
  };
}

function CanvasNodeView({ node }: { node: CanvasNode }) {
  const tabs = useWorkspaceStore((state) => state.tabs);
  const groups = useWorkspaceStore((state) => state.groups);
  const liveCwds = useWorkspaceStore((state) => state.liveCwds);
  const selectedNodeId = useWorkspaceStore((state) => state.canvasState.selectedNodeId);
  const zoom = useWorkspaceStore((state) => state.canvasState.viewport.zoom);
  const updateCanvasNode = useWorkspaceStore((state) => state.updateCanvasNode);
  const removeCanvasNode = useWorkspaceStore((state) => state.removeCanvasNode);
  const closeTerminalSession = useWorkspaceStore((state) => state.closeTerminalSession);
  const selectCanvasNode = useWorkspaceStore((state) => state.selectCanvasNode);
  const setActiveTab = useWorkspaceStore((state) => state.setActiveTab);
  const setWorkspaceMode = useWorkspaceStore((state) => state.setWorkspaceMode);
  const terminalRendererMode = useWorkspaceStore((state) => state.workspaceUiState.terminalRendererMode);
  const dragRef = useRef<{ x: number; y: number; nodeX: number; nodeY: number } | null>(null);
  const resizeRef = useRef<{
    pointerX: number;
    pointerY: number;
    nodeX: number;
    nodeY: number;
    width: number;
    height: number;
    direction: ResizeDirection;
  } | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const selected = selectedNodeId === node.id;

  const onMouseDown = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    selectCanvasNode(node.id);
    dragRef.current = {
      x: event.clientX,
      y: event.clientY,
      nodeX: node.x,
      nodeY: node.y,
    };

    function onMouseMove(moveEvent: MouseEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      updateCanvasNode(node.id, {
        x: drag.nodeX + (moveEvent.clientX - drag.x) / zoom,
        y: drag.nodeY + (moveEvent.clientY - drag.y) / zoom,
      });
    }

    function onMouseUp() {
      dragRef.current = null;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [node.id, node.x, node.y, selectCanvasNode, updateCanvasNode, zoom]);

  const onResizeMouseDown = useCallback((event: React.MouseEvent, direction: ResizeDirection) => {
    event.preventDefault();
    event.stopPropagation();
    selectCanvasNode(node.id);
    setIsResizing(true);
    resizeRef.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      nodeX: node.x,
      nodeY: node.y,
      width: node.width,
      height: node.height,
      direction,
    };

    function onMouseMove(moveEvent: MouseEvent) {
      const resize = resizeRef.current;
      if (!resize) return;
      const deltaX = (moveEvent.clientX - resize.pointerX) / zoom;
      const deltaY = (moveEvent.clientY - resize.pointerY) / zoom;
      const affectsWest = resize.direction.includes("w");
      const affectsEast = resize.direction.includes("e");
      const affectsNorth = resize.direction.includes("n");
      const affectsSouth = resize.direction.includes("s");

      const rawWidth = resize.width + (affectsEast ? deltaX : 0) - (affectsWest ? deltaX : 0);
      const rawHeight = resize.height + (affectsSouth ? deltaY : 0) - (affectsNorth ? deltaY : 0);
      const next = clampNodeSize(node.type, rawWidth, rawHeight);

      updateCanvasNode(node.id, {
        ...next,
        x: affectsWest ? resize.nodeX + resize.width - next.width : resize.nodeX,
        y: affectsNorth ? resize.nodeY + resize.height - next.height : resize.nodeY,
      });
    }

    function onMouseUp() {
      resizeRef.current = null;
      setIsResizing(false);
      document.body.classList.remove("no-select");
      document.body.style.cursor = "";
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    }

    document.body.classList.add("no-select");
    document.body.style.cursor = cursorForDirection(direction);
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [node.height, node.id, node.type, node.width, node.x, node.y, selectCanvasNode, updateCanvasNode, zoom]);

  const onRename = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const nextTitle = window.prompt(`Rename ${node.type}`, node.title);
    const trimmed = nextTitle?.trim();
    if (trimmed) {
      updateCanvasNode(node.id, { title: trimmed });
    }
  }, [node.id, node.title, node.type, updateCanvasNode]);

  const linkedTab = node.terminalTabId
    ? tabs.find((tab) => tab.id === node.terminalTabId)
    : undefined;
  const linkedProject = projectForTab(linkedTab, groups);
  const terminalRoot = node.terminalCwd ?? linkedTab?.initialCwd;
  const terminalTabId = linkedTab?.id ?? `canvas-${node.id}`;
  // The map node MUST share the tab's active pane identity. Terminal.tsx derives
  // runtimeSessionId = `terminal-${tabId}-${paneId}`, so the map node and the split
  // pane only attach to the SAME daemon PTY when they agree on this paneId. The map
  // and split views are mutually exclusive (workspaceMode is canvas xor split, and
  // WorkspaceSurface mounts only one), so they never compete over the session at the
  // same time — sharing the id is exactly what lets switching between map and split
  // reattach to the live shell instead of minting a fresh one (the terminal-reset
  // regression). The `node.id` fallback is the LAST resort (a node with no live
  // tab); before it, prefer any pane the tab already owns, because spawning
  // against `node.id` (`terminal-map-<tabId>`) mints a SEPARATE daemon PTY from
  // the split's `terminal-<tabId>-<activePaneId>` — that orphan shell is the
  // "extra line on the map" that accrues across map↔split switches.
  const terminalPaneId =
    linkedTab?.activePaneId ?? linkedTab?.terminals[0]?.paneId ?? node.id;
  // Resolve the live PTY id for this shared pane (for attach only), falling back to
  // the persisted node pty or the tab's first terminal.
  const linkedPaneTerminalId = linkedTab?.terminals.find((terminal) => terminal.paneId === terminalPaneId)?.id;
  const linkedTerminalId = linkedPaneTerminalId ?? node.terminalPtyId ?? linkedTab?.terminals[0]?.id;
  // Prefer the live cwd (polled from the PTY) over the initial cwd so the
  // breadcrumb tracks `cd`/`z`; falls back to the spawn cwd before the first poll.
  const liveTerminalRoot = (linkedTerminalId ? liveCwds[linkedTerminalId] : undefined) ?? terminalRoot;
  // Title a terminal node by what it actually points at: a named project wins,
  // otherwise the current directory's name (tracks cd/z via liveTerminalRoot).
  // A manual rename (title differs from the default) is respected.
  const cwdName = liveTerminalRoot?.split("/").filter(Boolean).pop();
  const isDefaultName = (value?: string) => !value || value === "Terminal";
  const terminalTitle =
    linkedProject?.name ??
    (isDefaultName(linkedTab?.title) && isDefaultName(node.title)
      ? cwdName ?? "Terminal"
      : linkedTab?.title ?? node.title);
  // Native VTE is disabled app-wide (see useNativeTerminalPane.wantsNativeRenderer):
  // the GTK overlay could not live on the zoom/pan canvas, which is why map nodes
  // used to fall back to a static "Open terminal" card. With xterm.js everywhere,
  // map nodes render a live terminal directly. Kept as a constant so the card
  // branch and its helpers type-check; restore the old expression alongside the
  // `native-vte-snapshot` tag if native VTE is reinstated.
  const shouldUseNativeSplitForInteraction = false;
  void isDesktopNativeRuntime;
  void terminalRendererMode;
  const openLinkedTerminal = useCallback(() => {
    if (!linkedTab) return;
    setActiveTab(linkedTab.id);
    setWorkspaceMode("split");
  }, [linkedTab, setActiveTab, setWorkspaceMode]);

  const body =
    node.type === "terminal" && shouldUseNativeSplitForInteraction ? (
      <div
        style={styles.nativeTerminalPreview}
        role="button"
        tabIndex={0}
        onClick={(event) => {
          event.stopPropagation();
          openLinkedTerminal();
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          event.stopPropagation();
          openLinkedTerminal();
        }}
      >
        <div style={styles.nativeTerminalPreviewGrid}>
          <div style={styles.nativeTerminalPrompt}>
            <TerminalSquare size={15} strokeWidth={1.8} />
            <span style={styles.nativeTerminalPromptGlyph}>$</span>
            <span style={styles.nativeTerminalPath}>{pathTail(liveTerminalRoot)}</span>
          </div>
          <div style={styles.nativeTerminalPrompt}>
            <span style={styles.nativeTerminalPromptGlyph}>native</span>
            <span style={styles.nativeTerminalPath}>{linkedTab?.title ?? node.title}</span>
          </div>
        </div>
        <button
          style={styles.nativeTerminalAction}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            openLinkedTerminal();
          }}
        >
          <ArrowUpRight size={14} strokeWidth={1.8} />
          Open terminal
        </button>
      </div>
    ) : node.type === "terminal" ? (
      <TerminalComponent
        tabId={terminalTabId}
        paneId={terminalPaneId}
        cwd={node.terminalCwd ?? linkedTab?.initialCwd}
        attachToPtyId={linkedTerminalId ?? null}
        runtimeActive={selected}
        onActivate={() => selectCanvasNode(node.id)}
        standalone
        // Map nodes sit under the canvas CSS scale() transform. Supersample the
        // backing store 2x so glyphs stay sharp when the compositor scales them.
        // Fixed (not tied to live zoom) so changing zoom never re-runs the attach
        // effect — that would detach/reattach the grid on every zoom tick.
        renderScale={2}
      />
    ) : node.type === "file" ? (
      <div dir="auto">{node.filePath ?? "No file attached yet"}</div>
    ) : (
      <div dir="auto">{node.content}</div>
    );

  return (
    <section
      style={{
        ...styles.node,
        left: node.x,
        top: node.y,
        width: node.width,
        height: node.height,
        borderColor: selected ? "var(--border-focus)" : "var(--border-subtle)",
        boxShadow: selected
          ? "0 0 0 1px rgba(217,154,69,0.36), 0 20px 54px rgba(0,0,0,0.52)"
          : styles.node.boxShadow,
      }}
      onMouseDown={(event) => {
        event.stopPropagation();
        selectCanvasNode(node.id);
      }}
    >
      <div style={styles.nodeHeader} onMouseDown={onMouseDown}>
        <span
          style={{
            ...styles.nodeKind,
            borderLeft: linkedTab?.color ? `2px solid ${linkedTab.color}` : undefined,
          }}
        >
          {node.type === "terminal" ? "shell" : node.type}
        </span>
        <span
          style={{ minWidth: 0, flex: 1 }}
          dir="auto"
          title="Double-click to rename"
          onDoubleClick={onRename}
        >
          <div style={styles.nodeTitle}>
            {node.type === "terminal" ? terminalTitle : linkedTab?.title ?? node.title}
          </div>
          {node.type === "terminal" && (
            <div style={styles.nodeTitleMeta}>
              {linkedProject ? `${pathTail(liveTerminalRoot)} · ${linkedTab?.title ?? node.title}` : pathTail(liveTerminalRoot)}
            </div>
          )}
        </span>
        {node.type === "terminal" && (
          <button
            style={styles.headerButton}
            title="Open full terminal"
            aria-label="Open full terminal"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              openLinkedTerminal();
            }}
          >
            <ArrowUpRight size={13} strokeWidth={1.8} />
          </button>
        )}
        <button
          style={{ ...styles.closeButton, ...styles.headerButton }}
          title={linkedTab ? "Close terminal session" : "Remove node"}
          aria-label={linkedTab ? `Close ${linkedTab.title}` : "Remove node"}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            if (linkedTab) {
              closeTerminalSession(linkedTab.id);
              return;
            }
            removeCanvasNode(node.id);
          }}
        >
          <X size={13} strokeWidth={1.8} />
        </button>
      </div>
      <div style={node.type === "terminal" ? styles.terminalBody : styles.nodeBody}>{body}</div>
      {selected && (
        <>
          {(["n", "s", "e", "w", "ne", "nw", "se", "sw"] as ResizeDirection[]).map((direction) => (
            <div
              key={direction}
              style={handleStyle(direction)}
              onMouseDown={(event) => onResizeMouseDown(event, direction)}
              title={`Resize ${direction.toUpperCase()}`}
            />
          ))}
          {isResizing && (
            <div style={styles.sizeBadge}>
              {Math.round(node.width)} × {Math.round(node.height)}
            </div>
          )}
        </>
      )}
    </section>
  );
}

export function MagicCanvas() {
  const canvasState = useWorkspaceStore((state) => state.canvasState);
  const addCanvasNode = useWorkspaceStore((state) => state.addCanvasNode);
  const updateCanvasNode = useWorkspaceStore((state) => state.updateCanvasNode);
  const updateCanvasViewport = useWorkspaceStore((state) => state.updateCanvasViewport);
  const openFiles = useWorkspaceStore((state) => state.openFiles);
  const shellRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<{ x: number; y: number; viewportX: number; viewportY: number } | null>(null);
  const [fileIndex, setFileIndex] = useState(0);
  // Right-click "create here" menu. Screen coords place the menu; canvas coords
  // drop the new node where the cursor is.
  const [menu, setMenu] = useState<{ x: number; y: number; canvasX: number; canvasY: number } | null>(null);

  const openCanvasMenu = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return; // only empty canvas background
    event.preventDefault();
    const rect = shellRef.current?.getBoundingClientRect();
    const viewport = canvasState.viewport;
    const canvasX = rect ? (event.clientX - rect.left - viewport.x) / viewport.zoom : 0;
    const canvasY = rect ? (event.clientY - rect.top - viewport.y) / viewport.zoom : 0;
    setMenu({ x: event.clientX, y: event.clientY, canvasX, canvasY });
  }, [canvasState.viewport]);

  const createTerminalAt = useCallback(async (canvasX: number, canvasY: number) => {
    await createNewTab();
    const newTabId = useWorkspaceStore.getState().activeTabId;
    if (newTabId) {
      updateCanvasNode(`terminal-map-${newTabId}`, { x: Math.round(canvasX), y: Math.round(canvasY) });
    }
  }, [updateCanvasNode]);

  const setZoomAt = useCallback((nextZoomValue: number, clientX?: number, clientY?: number) => {
    const viewport = canvasState.viewport;
    const nextZoom = clamp(nextZoomValue, MIN_ZOOM, MAX_ZOOM);
    const shellRect = shellRef.current?.getBoundingClientRect();

    if (!shellRect || clientX === undefined || clientY === undefined) {
      updateCanvasViewport({ zoom: nextZoom });
      return;
    }

    const localX = clientX - shellRect.left;
    const localY = clientY - shellRect.top;
    const canvasX = (localX - viewport.x) / viewport.zoom;
    const canvasY = (localY - viewport.y) / viewport.zoom;

    updateCanvasViewport({
      zoom: nextZoom,
      x: localX - canvasX * nextZoom,
      y: localY - canvasY * nextZoom,
    });
  }, [canvasState.viewport, updateCanvasViewport]);

  const onCanvasMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.target !== event.currentTarget) return;
    event.preventDefault();
    panRef.current = {
      x: event.clientX,
      y: event.clientY,
      viewportX: canvasState.viewport.x,
      viewportY: canvasState.viewport.y,
    };
    document.body.classList.add("no-select");
    if (shellRef.current) shellRef.current.style.cursor = "grabbing";

    function onMouseMove(moveEvent: MouseEvent) {
      const pan = panRef.current;
      if (!pan) return;
      updateCanvasViewport({
        x: pan.viewportX + moveEvent.clientX - pan.x,
        y: pan.viewportY + moveEvent.clientY - pan.y,
      });
    }

    function onMouseUp() {
      panRef.current = null;
      document.body.classList.remove("no-select");
      if (shellRef.current) shellRef.current.style.cursor = "";
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [canvasState.viewport.x, canvasState.viewport.y, updateCanvasViewport]);

  const onCanvasWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest(".terminal-container")) return;
    event.preventDefault();
    const direction = event.deltaY > 0 ? -1 : 1;
    const factor = direction > 0 ? 1.1 : 0.9;
    setZoomAt(canvasState.viewport.zoom * factor, event.clientX, event.clientY);
  }, [canvasState.viewport.zoom, setZoomAt]);

  const addNote = useCallback(() => {
    const pos = nextNodePosition(canvasState.nodes.length);
    addCanvasNode({
      type: "note",
      title: "Run note",
      x: pos.x,
      y: pos.y,
      width: 280,
      height: 160,
      content: "Capture the command, blocker, or next action for this run.",
    });
  }, [addCanvasNode, canvasState.nodes.length]);

  const addTerminal = useCallback(() => {
    createNewTab();
  }, []);

  const addFile = useCallback(() => {
    const file = openFiles[fileIndex % Math.max(openFiles.length, 1)];
    const pos = nextNodePosition(canvasState.nodes.length);
    addCanvasNode({
      type: "file",
      title: file?.name ?? "File",
      x: pos.x,
      y: pos.y,
      width: 320,
      height: 150,
      filePath: file?.path,
      content: file?.path ?? "Open a file from the explorer, then add another file node.",
    });
    setFileIndex((index) => index + 1);
  }, [addCanvasNode, canvasState.nodes.length, fileIndex, openFiles]);

  return (
    <div
      ref={shellRef}
      data-magic-canvas-shell
      style={{
        ...styles.shell,
        backgroundSize: `${24 * canvasState.viewport.zoom}px ${24 * canvasState.viewport.zoom}px, ${96 * canvasState.viewport.zoom}px ${96 * canvasState.viewport.zoom}px, ${96 * canvasState.viewport.zoom}px ${96 * canvasState.viewport.zoom}px, auto`,
        backgroundPosition: `${canvasState.viewport.x}px ${canvasState.viewport.y}px`,
      }}
      onMouseDown={onCanvasMouseDown}
      onWheel={onCanvasWheel}
      onContextMenu={openCanvasMenu}
    >
      <div style={styles.toolbar}>
        <span style={styles.toolbarLabel}>
          <Layers3 size={13} strokeWidth={1.8} />
          Map
        </span>
        <button className="magic-canvas-button" style={styles.button} title="Add note" aria-label="Add note" onClick={addNote}>
          <NotebookText size={14} strokeWidth={1.8} />
        </button>
        <button className="magic-canvas-button" style={styles.button} title="Add terminal" aria-label="Add terminal" onClick={addTerminal}>
          <TerminalSquare size={14} strokeWidth={1.8} />
        </button>
        <button className="magic-canvas-button" style={styles.button} title="Add file" aria-label="Add file" onClick={addFile}>
          <FileText size={14} strokeWidth={1.8} />
        </button>
      </div>

      {canvasState.nodes.length === 0 && (
        <div style={styles.empty}>Map is empty. Add a note, shell, or file node.</div>
      )}

      <div
        style={{
          ...styles.stage,
          transform: `translate(${canvasState.viewport.x}px, ${canvasState.viewport.y}px) scale(${canvasState.viewport.zoom})`,
        }}
        onMouseDown={onCanvasMouseDown}
        onContextMenu={openCanvasMenu}
      >
        {canvasState.nodes.map((node) => (
          <CanvasNodeView key={node.id} node={node} />
        ))}
      </div>

      <div style={styles.viewportControls}>
        <button
          className="magic-canvas-button"
          style={styles.button}
          onClick={() => setZoomAt(canvasState.viewport.zoom * 0.9)}
          title="Zoom out"
          aria-label="Zoom out"
        >
          <Minus size={14} strokeWidth={1.8} />
        </button>
        <span style={styles.zoomReadout}>{Math.round(canvasState.viewport.zoom * 100)}%</span>
        <button
          className="magic-canvas-button"
          style={styles.button}
          onClick={() => setZoomAt(canvasState.viewport.zoom * 1.1)}
          title="Zoom in"
          aria-label="Zoom in"
        >
          <Plus size={14} strokeWidth={1.8} />
        </button>
        <button
          className="magic-canvas-button"
          style={styles.button}
          onClick={() => updateCanvasViewport({ x: 0, y: 0, zoom: 1 })}
          title="Reset canvas view"
          aria-label="Reset canvas view"
        >
          <RotateCcw size={14} strokeWidth={1.8} />
        </button>
      </div>

      {menu && (
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 50 }}
            onMouseDown={() => setMenu(null)}
            onContextMenu={(event) => {
              event.preventDefault();
              setMenu(null);
            }}
          />
          <div
            role="menu"
            style={{
              position: "fixed",
              left: Math.min(menu.x, window.innerWidth - 196),
              top: Math.min(menu.y, window.innerHeight - 120),
              zIndex: 51,
              minWidth: 184,
              padding: 5,
              background: "var(--surface-raised)",
              borderRadius: "var(--radius-md)",
              boxShadow: "var(--shadow-menu)",
              border: "none",
            }}
          >
            {[
              {
                icon: <TerminalSquare size={14} strokeWidth={1.8} />,
                label: "New terminal here",
                run: () => createTerminalAt(menu.canvasX, menu.canvasY),
              },
              {
                icon: <NotebookText size={14} strokeWidth={1.8} />,
                label: "New note here",
                run: () =>
                  addCanvasNode({
                    type: "note",
                    title: "Run note",
                    x: Math.round(menu.canvasX),
                    y: Math.round(menu.canvasY),
                    width: 280,
                    height: 160,
                    content: "Capture the command, blocker, or next action for this run.",
                  }),
              },
            ].map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                className="workspace-launch-config-item"
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  padding: "9px 10px",
                  border: "none",
                  borderRadius: "var(--radius-sm)",
                  background: "transparent",
                  color: "var(--text-primary)",
                  fontFamily: "var(--font-ui)",
                  fontSize: 13,
                  cursor: "pointer",
                  textAlign: "left",
                }}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  item.run();
                  setMenu(null);
                }}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
