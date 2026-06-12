import { useRef, useEffect, useLayoutEffect, useState, useCallback, CSSProperties } from "react";
import { Globe, PanelRight, PanelBottom, X, TerminalSquare } from "lucide-react";
import { TerminalComponent } from "./Terminal";
import { LocalhostPreview } from "./LocalhostPreview";
import { useWorkspaceStore } from "../stores/workspace";
import { splitActivePane, closeActivePane } from "../stores/workspace";
import type { Tab, TerminalRuntimeStatus } from "../lib/types";
import { pathTail, projectForTab } from "../lib/projectDisplay";
import {
  calculatePaneBounds,
  calculateHandles,
  getAllLeafIds,
  getPaneCwd,
  resizeSizes,
  countLeaves,
  getLeafNode,
  SPLIT_GAP,
  type Rect,
  type HandleInfo,
} from "../lib/splitUtils";

const STATUS_LABELS: Record<TerminalRuntimeStatus, string> = {
  starting: "starting",
  running: "running",
  reconnected: "reconnected",
  stale: "stale",
  failed: "failed",
};

const STATUS_COLORS: Record<TerminalRuntimeStatus, string> = {
  starting: "var(--accent-warning)",
  running: "var(--accent-success)",
  reconnected: "var(--accent-info)",
  stale: "var(--accent-warning)",
  failed: "var(--accent-danger)",
};

// ── PaneToolbar ──────────────────────────────────────────────────────────────

interface PaneToolbarProps {
  paneId: string;
  tabId: string;
  canClose: boolean;
  visible: boolean;
}

function PaneToolbar({ paneId, tabId, canClose, visible }: PaneToolbarProps) {
  const toolbarStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 3,
    opacity: visible ? 1 : 0,
    transform: visible ? "translateY(0)" : "translateY(-2px)",
    transition: "opacity var(--motion-fast), transform var(--motion-fast)",
    pointerEvents: visible ? "auto" : "none",
  };

  const btnStyle: CSSProperties = {
    width: 24,
    height: 22,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "transparent",
    border: "1px solid transparent",
    borderRadius: 4,
    color: "var(--text-secondary)",
    cursor: "pointer",
    lineHeight: 1,
    padding: 0,
    transition: "color var(--motion-fast), background var(--motion-fast), border-color var(--motion-fast)",
  };

  return (
    <div className="terminal-pane-toolbar" style={toolbarStyle}>
      <button
        className="terminal-pane-action"
        style={btnStyle}
        title="Split Right (Ctrl+Shift+E)"
        aria-label="Split right"
        onClick={(e) => {
          e.stopPropagation();
          useWorkspaceStore.getState().setActivePane(tabId, paneId);
          splitActivePane("horizontal");
        }}
      >
        <PanelRight size={13} strokeWidth={1.8} />
      </button>
      <button
        className="terminal-pane-action"
        style={btnStyle}
        title="Split Down (Ctrl+Shift+O)"
        aria-label="Split down"
        onClick={(e) => {
          e.stopPropagation();
          useWorkspaceStore.getState().setActivePane(tabId, paneId);
          splitActivePane("vertical");
        }}
      >
        <PanelBottom size={13} strokeWidth={1.8} />
      </button>
      {canClose && (
        <button
          className="terminal-pane-action terminal-pane-action--danger"
          style={{ ...btnStyle, color: "var(--accent-danger)" }}
          title="Close Pane (Ctrl+Shift+W)"
          aria-label="Close pane"
          onClick={(e) => {
            e.stopPropagation();
            useWorkspaceStore.getState().setActivePane(tabId, paneId);
            closeActivePane();
          }}
        >
          <X size={13} strokeWidth={1.8} />
        </button>
      )}
    </div>
  );
}

// ── PaneContextMenu ──────────────────────────────────────────────────────────

interface PaneContextMenuProps {
  x: number;
  y: number;
  paneId: string;
  tabId: string;
  canClose: boolean;
  onDismiss: () => void;
}

function PaneContextMenu({ x, y, paneId, tabId, canClose, onDismiss }: PaneContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onDismiss();
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [onDismiss]);

  function MenuItem({
    label,
    shortcut,
    danger,
    onClick,
  }: {
    label: string;
    shortcut?: string;
    danger?: boolean;
    onClick: () => void;
  }) {
    return (
      <div
        className={`terminal-pane-menu-item${danger ? " terminal-pane-menu-item--danger" : ""}`}
        style={{
          minHeight: 30,
          padding: "6px 9px",
          margin: "0 4px",
          fontSize: 12,
          cursor: "pointer",
          color: danger ? "var(--accent-danger)" : "var(--text-primary)",
          fontFamily: "var(--font-ui)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          borderRadius: "var(--radius-sm)",
          background: "transparent",
          transition: "background var(--motion-fast), color var(--motion-fast)",
        }}
        onClick={onClick}
      >
        <span>{label}</span>
        {shortcut && (
          <span
            style={{
              height: 18,
              padding: "0 5px",
              border: "1px solid transparent",
              borderRadius: "var(--radius-xs)",
              background: "var(--surface-base)",
              color: "var(--text-secondary)",
              fontSize: 10,
              lineHeight: "16px",
              fontFamily: "var(--font-ui)",
            }}
          >
            {shortcut}
          </span>
        )}
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className="terminal-pane-context-menu"
      style={{
        position: "fixed",
        top: y,
        left: x,
        background: "var(--surface-raised)",
        border: "1px solid transparent",
        borderRadius: "var(--radius-md)",
        padding: 4,
        minWidth: 180,
        zIndex: 1000,
        boxShadow: "var(--shadow-menu)",
        animation: "workbench-popover-in var(--motion-med)",
      }}
    >
      <MenuItem
        label="Split Right"
        shortcut="Ctrl+Shift+E"
        onClick={() => {
          useWorkspaceStore.getState().setActivePane(tabId, paneId);
          splitActivePane("horizontal");
          onDismiss();
        }}
      />
      <MenuItem
        label="Split Down"
        shortcut="Ctrl+Shift+O"
        onClick={() => {
          useWorkspaceStore.getState().setActivePane(tabId, paneId);
          splitActivePane("vertical");
          onDismiss();
        }}
      />
      {canClose && (
        <>
          <div style={{ borderTop: "1px solid var(--border-subtle)", margin: "4px 4px" }} />
          <MenuItem
            label="Close Pane"
            shortcut="Ctrl+Shift+W"
            danger
            onClick={() => {
              useWorkspaceStore.getState().setActivePane(tabId, paneId);
              closeActivePane();
              onDismiss();
            }}
          />
        </>
      )}
    </div>
  );
}

// ── ResizeHandle ─────────────────────────────────────────────────────────────

interface ResizeHandleProps {
  handle: HandleInfo;
  tabId: string;
}

function ResizeHandle({ handle, tabId }: ResizeHandleProps) {
  const isH = handle.direction === "horizontal";
  const updateSplitSizes = useWorkspaceStore((s) => s.updateSplitSizes);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const startPos = isH ? e.clientX : e.clientY;
      const startSizes = [...handle.splitNodeSizes];
      const available = handle.availableSize;

      function onMouseMove(ev: MouseEvent) {
        const currentPos = isH ? ev.clientX : ev.clientY;
        const delta = currentPos - startPos;
        const deltaPercent = (delta / available) * 100;
        const newSizes = resizeSizes(startSizes, handle.handleIndex, deltaPercent);
        updateSplitSizes(tabId, handle.splitNodeId, newSizes);
      }

      function onMouseUp() {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.classList.remove("no-select");
      }

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
      document.body.style.cursor = isH ? "col-resize" : "row-resize";
      document.body.classList.add("no-select");
    },
    [isH, handle, tabId, updateSplitSizes]
  );

  // Expand the hit area for easier grabbing
  const hitPad = 4;

  return (
    <div
      style={{
        position: "absolute",
        left: handle.rect.left - (isH ? hitPad : 0),
        top: handle.rect.top - (isH ? 0 : hitPad),
        width: isH ? SPLIT_GAP + hitPad * 2 : handle.rect.width,
        height: isH ? handle.rect.height : SPLIT_GAP + hitPad * 2,
        cursor: isH ? "col-resize" : "row-resize",
        zIndex: 5,
      }}
      onMouseDown={onMouseDown}
    >
      {/* Visible line */}
      <div
        style={{
          position: "absolute",
          left: isH ? hitPad : 0,
          top: isH ? 0 : hitPad,
          width: isH ? SPLIT_GAP : "100%",
          height: isH ? "100%" : SPLIT_GAP,
          background: "var(--border-strong)",
          opacity: 0.4,
          transition: "opacity var(--motion-fast), background var(--motion-fast)",
          borderRadius: 1,
        }}
        onMouseEnter={(e) => {
          (e.target as HTMLElement).style.opacity = "1";
        }}
        onMouseLeave={(e) => {
          (e.target as HTMLElement).style.opacity = "0.4";
        }}
      />
    </div>
  );
}

// ── SplitPaneLayout ──────────────────────────────────────────────────────────

interface SplitPaneLayoutProps {
  tab: Tab;
  sessionLabel?: string;
}

function MeasuringFallback() {
  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        border: "1px solid transparent",
        background: "var(--surface-sunken)",
        boxShadow: "var(--shadow-active-pane)",
      }}
    >
      <div
        style={{
          height: 30,
          minHeight: 30,
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "0 8px",
          borderBottom: "1px solid var(--border-subtle)",
          background: "linear-gradient(180deg, var(--surface-raised), var(--surface-wash))",
        }}
      >
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: "var(--accent-warning)",
            boxShadow: "0 0 0 3px rgba(212, 164, 79, 0.12)",
          }}
        />
        <span
          style={{
            width: 132,
            height: 9,
            borderRadius: "var(--radius-xs)",
            background: "var(--surface-hover)",
          }}
        />
      </div>
      <div
        style={{
          flex: 1,
          display: "grid",
          alignContent: "start",
          gap: 9,
          padding: "12px 10px",
        }}
      >
        {[42, 64, 28].map((width) => (
          <span
            key={width}
            style={{
              width: `${width}%`,
              height: 10,
              borderRadius: "var(--radius-xs)",
              background: "linear-gradient(90deg, rgba(216, 222, 231, 0.42), rgba(216, 222, 231, 0.08))",
              opacity: 0.7,
            }}
          />
        ))}
      </div>
    </div>
  );
}

export function SplitPaneLayout({ tab, sessionLabel }: SplitPaneLayoutProps) {
  const groups = useWorkspaceStore((state) => state.groups);
  const immersiveTerminal = useWorkspaceStore((state) => state.workspaceUiState.immersiveTerminal);
  const exitImmersiveTerminal = useWorkspaceStore((state) => state.exitImmersiveTerminal);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; paneId: string } | null>(null);
  const [hoveredPaneId, setHoveredPaneId] = useState<string | null>(null);

  const measureContainer = useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setContainerSize((current) => {
      const width = Math.round(rect.width);
      const height = Math.round(rect.height);
      if (width <= 0 || height <= 0) return current;
      if (current.width === width && current.height === height) return current;
      return { width, height };
    });
  }, []);

  useLayoutEffect(() => {
    measureContainer();
  }, [measureContainer]);

  // Track container size
  useEffect(() => {
    if (!containerRef.current) return;
    measureContainer();
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        if (entry.contentRect.width <= 0 || entry.contentRect.height <= 0) return;
        setContainerSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [measureContainer]);

  const containerRect: Rect = {
    left: 0,
    top: 0,
    width: containerSize.width,
    height: containerSize.height,
  };

  const paneBounds = calculatePaneBounds(tab.splitLayout, containerRect);
  const handles = calculateHandles(tab.splitLayout, containerRect);
  const immersivePaneId =
    immersiveTerminal.enabled && immersiveTerminal.tabId === tab.id
      ? immersiveTerminal.paneId
      : null;
  const leafIds = immersivePaneId
    ? getAllLeafIds(tab.splitLayout).filter((paneId) => paneId === immersivePaneId)
    : getAllLeafIds(tab.splitLayout);
  const multiplePanes = countLeaves(tab.splitLayout) > 1;

  useEffect(() => {
    if (!immersivePaneId) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      exitImmersiveTerminal();
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [exitImmersiveTerminal, immersivePaneId]);

  return (
    <div
      ref={containerRef}
      style={{ position: "relative", width: "100%", height: "100%" }}
    >
      {(containerSize.width <= 0 || containerSize.height <= 0) && <MeasuringFallback />}
      {/* Terminal panes — stable keys, absolute positioning */}
      {leafIds.map((paneId) => {
        const bounds = immersivePaneId
          ? containerRect
          : paneBounds.get(paneId);
        if (!bounds || bounds.width <= 0 || bounds.height <= 0) return null;

        const isActive = paneId === tab.activePaneId;
        const isImmersivePane = immersivePaneId === paneId;
        const paneNode = getLeafNode(tab.splitLayout, paneId);
        const isPreviewPane = paneNode?.type === "preview";
        const paneCwd = getPaneCwd(tab.splitLayout, paneId) ?? tab.initialCwd;
        const project = projectForTab(tab, groups);
        const paneContext = project
          ? `${project.name} · ${pathTail(paneCwd)}`
          : paneCwd ?? sessionLabel ?? tab.title;
        const paneTerminal = tab.terminals.find((terminal) => terminal.paneId === paneId);
        const terminalStatus = paneTerminal?.status ?? "starting";
        const terminalStatusLabel = STATUS_LABELS[terminalStatus];
        const queuedWorkstreamInput = tab.workstream?.inputQueue?.find((input) => !input.sentAt);
        const chromeHeight = 24;
        const showActions = hoveredPaneId === paneId || isActive;

        return (
          <div
            key={paneId}
            className="terminal-pane-frame"
            data-active={isActive ? "true" : "false"}
            data-status={terminalStatus}
            style={{
              position: "absolute",
              left: bounds.left,
              top: bounds.top,
              width: bounds.width,
              height: bounds.height,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              background: "var(--surface-sunken)",
              border: isImmersivePane ? "none" : "1px solid transparent",
              borderRadius: isImmersivePane ? 0 : "var(--radius-md)",
              boxShadow: isImmersivePane
                ? "none"
                : isActive ? "var(--shadow-active-pane)" : "0 0 0 1px rgba(0, 0, 0, 0.12)",
              transition: isImmersivePane
                ? "none"
                : "box-shadow var(--motion-med), border-color var(--motion-med), background var(--motion-med)",
              animation: isImmersivePane ? "none" : "workbench-surface-in var(--motion-med)",
            }}
            onClick={() => {
              useWorkspaceStore.getState().setActivePane(tab.id, paneId);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              useWorkspaceStore.getState().setActivePane(tab.id, paneId);
              setContextMenu({ x: e.clientX, y: e.clientY, paneId });
            }}
            onMouseEnter={() => setHoveredPaneId(paneId)}
            onMouseLeave={() => setHoveredPaneId((current) => current === paneId ? null : current)}
          >
            {isActive && !isImmersivePane && (
              <div
                aria-hidden="true"
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  height: 1,
                  background: "linear-gradient(90deg, transparent, var(--accent-live) 8%, var(--accent-live) 92%, transparent)",
                  zIndex: 2,
                }}
              />
            )}
            {!isImmersivePane && (
            <div
              style={{
                height: chromeHeight,
                minHeight: chromeHeight,
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "0 7px",
                borderBottom: "1px solid var(--border-subtle)",
                background: isActive ? "#202527" : "#1d2224",
                color: "var(--text-secondary)",
                cursor: "default",
              }}
            >
              <span
                className="terminal-pane-status-dot"
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: STATUS_COLORS[terminalStatus],
                  opacity: isActive ? 1 : 0.7,
                  boxShadow: isActive ? `0 0 0 3px color-mix(in srgb, ${STATUS_COLORS[terminalStatus]} 16%, transparent)` : "none",
                  flexShrink: 0,
                }}
                title={isPreviewPane ? "Localhost preview" : `Terminal ${terminalStatusLabel}`}
              />
              {isPreviewPane ? (
                <Globe
                  size={13}
                  strokeWidth={1.8}
                  color={isActive ? "var(--accent-live)" : "var(--text-secondary)"}
                />
              ) : (
                <TerminalSquare
                  size={13}
                  strokeWidth={1.8}
                  color={isActive ? "var(--accent-live)" : "var(--text-secondary)"}
                />
              )}
              <span
                className="terminal-pane-status-pill"
                data-status={terminalStatus}
                style={{
                  minWidth: 0,
                  flex: 1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
                  fontSize: 12,
                  fontWeight: 500,
                }}
                title={isPreviewPane ? paneNode.previewUrl : project?.projectRoot ?? paneCwd ?? tab.title}
              >
                {isPreviewPane ? paneNode.previewUrl ?? "Localhost preview" : paneContext}
              </span>
              <span
                style={{
                  color: STATUS_COLORS[terminalStatus],
                  fontSize: 10,
                  lineHeight: 1,
                  textTransform: "none",
                  fontWeight: 500,
                  letterSpacing: 0,
                  padding: "0 6px",
                  height: 17,
                  display: "inline-flex",
                  alignItems: "center",
                  border: "1px solid color-mix(in srgb, currentColor 28%, transparent)",
                  borderRadius: 999,
                  background: "color-mix(in srgb, currentColor 10%, transparent)",
                  flexShrink: 0,
                }}
                title={isPreviewPane ? "Preview pane" : paneTerminal?.lastError ?? `Terminal ${terminalStatusLabel}`}
              >
                {isPreviewPane ? "preview" : terminalStatusLabel}
              </span>
              <PaneToolbar
                paneId={paneId}
                tabId={tab.id}
                canClose={multiplePanes}
                visible={showActions}
              />
            </div>
            )}
            <div style={{ flex: 1, minHeight: 0, minWidth: 0 }}>
              {isPreviewPane ? (
                <LocalhostPreview
                  previewUrl={paneNode.previewUrl}
                  onPreviewUrlChange={(previewUrl) =>
                    useWorkspaceStore.getState().updatePreviewPaneUrl(tab.id, paneId, previewUrl)
                  }
                />
              ) : tab.workstream?.kind === "agent" && tab.workstream.providerAvailable === false ? (
                <div
                  role="status"
                  style={{
                    height: "100%",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    gap: 8,
                    padding: 24,
                    background: "var(--terminal-bg)",
                    color: "var(--text-secondary)",
                    fontFamily: "var(--font-ui)",
                    fontSize: 13,
                  }}
                >
                  <strong style={{ color: "var(--text-primary)", fontWeight: 500 }}>
                    {tab.workstream.role} provider unavailable
                  </strong>
                  <span>{tab.workstream.providerAvailabilityMessage ?? "Provider command was not found."}</span>
                </div>
              ) : (
                <TerminalComponent
                  key={`${tab.id}-${paneId}-${tab.workstream?.generation ?? 0}`}
                  tabId={tab.id}
                  paneId={paneId}
                  cwd={paneCwd}
                  command={tab.workstream?.startupCommand}
                  queuedInput={queuedWorkstreamInput}
                  onQueuedInputSent={(inputId) =>
                    useWorkspaceStore.getState().markWorkstreamInputSent(tab.id, inputId)
                  }
                />
              )}
            </div>
          </div>
        );
      })}

      {/* Resize handles */}
      {!immersivePaneId && handles.map((handle, i) => (
        <ResizeHandle key={i} handle={handle} tabId={tab.id} />
      ))}

      {/* Context menu */}
      {!immersivePaneId && contextMenu && (
        <PaneContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          paneId={contextMenu.paneId}
          tabId={tab.id}
          canClose={multiplePanes}
          onDismiss={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
