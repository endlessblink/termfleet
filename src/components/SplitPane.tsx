import { useRef, useEffect, useLayoutEffect, useState, useCallback, CSSProperties } from "react";
import { Globe, ListTodo, Minimize2, PanelRight, PanelRightClose, PanelBottom, X, TerminalSquare } from "lucide-react";
import { TerminalComponent } from "./Terminal";
import { LocalhostPreview } from "./LocalhostPreview";
import { useWorkspaceStore } from "../stores/workspace";
import { splitActivePane, closeActivePane } from "../stores/workspace";
import type { Tab, TaskLineupItem, TerminalRuntimeStatus, WorkstreamMetadata, WorkstreamStatusSummary } from "../lib/types";
import { pathTail, projectForTab } from "../lib/projectDisplay";
import { agentStatusSummaryFromWorkstream, getDisplaySummary } from "../lib/agentStatusSummary";
import { workstreamActivityText } from "../lib/workstreamActivity";
import { taskLineupNextLabel, taskLineupStats, visibleTaskLineup as pickVisibleTaskLineup } from "../lib/taskLineup";
import { normalizePersistedShellSummary, summaryFromDurableActivity, summarySourceLabel, terminalPurposeFromContext } from "../lib/terminalHeaderDisplay";
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
  exited: "exited",
};

const STATUS_COLORS: Record<TerminalRuntimeStatus, string> = {
  starting: "var(--accent-warning)",
  running: "var(--accent-success)",
  reconnected: "var(--accent-info)",
  stale: "var(--accent-warning)",
  failed: "var(--accent-danger)",
  exited: "var(--text-secondary)",
};

type SplitTaskRow = {
  id: string;
  task: string;
  state: string;
  next: string;
  meta?: string;
};

function AgentTaskSidebar({
  workstream,
  summary,
  taskLineup,
  collapsed,
  onToggleCollapsed,
}: {
  workstream: WorkstreamMetadata;
  summary: WorkstreamStatusSummary;
  taskLineup?: TaskLineupItem[];
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  const rows: SplitTaskRow[] = taskLineup?.length
    ? taskLineup.map((item) => ({
        id: item.id,
        task: item.content,
        state: item.status === "completed" ? "Done" : item.status === "in_progress" ? "Working" : item.status === "cancelled" ? "Cancelled" : "Not done",
        next: taskLineupNextLabel(item),
      }))
    : [];
  void workstream;
  void summary;
  const stats = taskLineupStats(rows.map((row) => ({
    id: row.id,
    content: row.task,
    status: row.state === "Done" ? "completed" : row.state === "Working" ? "in_progress" : "pending",
    source: "summary",
    updatedAt: 0,
  })));

  if (collapsed) {
    return (
      <button
        type="button"
        data-testid="split-agent-task-rail"
        aria-label={stats.total > 0
          ? `Agent terminal tasks: ${stats.open} open, ${stats.done} done. Expand tasks.`
          : "Agent terminal tasks: no task list captured for this run. Expand tasks."}
        title={stats.total > 0 ? `${stats.open} open · ${stats.done} done` : "No task list captured"}
        onClick={(event) => {
          event.stopPropagation();
          onToggleCollapsed();
        }}
        style={{
          width: 46,
          minWidth: 46,
          height: "100%",
          display: "grid",
          gridTemplateRows: "auto auto auto auto 1fr",
          justifyItems: "center",
          alignItems: "start",
          gap: 7,
          padding: "12px 6px",
          border: "none",
          borderLeft: "1px solid var(--border-subtle)",
          background: "color-mix(in srgb, var(--surface-base) 78%, var(--surface-sunken))",
          color: "var(--text-secondary)",
          fontFamily: "var(--font-ui)",
          cursor: "pointer",
        }}
      >
        <ListTodo size={14} strokeWidth={1.8} />
        <span style={{ writingMode: "vertical-rl", textTransform: "uppercase", color: "var(--text-primary)", fontSize: 10, fontWeight: 600, letterSpacing: 0 }}>Tasks</span>
        {stats.total > 0 ? (
          <>
            <span style={{ minWidth: 22, height: 22, display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 6, background: "color-mix(in srgb, var(--accent-live) 16%, var(--surface-raised))", color: "var(--text-primary)", fontSize: 11, fontWeight: 600 }}>{stats.total}</span>
            <span style={{ writingMode: "vertical-rl", color: "var(--text-tertiary)", fontSize: 9, lineHeight: 1, whiteSpace: "nowrap" }}>{stats.open} open</span>
            <span style={{ writingMode: "vertical-rl", color: "var(--text-tertiary)", fontSize: 9, lineHeight: 1, whiteSpace: "nowrap" }}>{stats.done} done</span>
          </>
        ) : (
          <span style={{ writingMode: "vertical-rl", color: "var(--text-tertiary)", fontSize: 9, lineHeight: 1, whiteSpace: "nowrap" }}>No list</span>
        )}
      </button>
    );
  }

  return (
    <aside
      data-testid="split-agent-task-sidebar"
      aria-label="Agent terminal tasks"
      style={{
        width: "min(240px, 34%)",
        minWidth: 176,
        maxWidth: 260,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "10px 10px 11px",
        borderLeft: "1px solid var(--border-subtle)",
        background: "color-mix(in srgb, var(--surface-base) 72%, var(--surface-sunken))",
        color: "var(--text-secondary)",
        fontFamily: "var(--font-ui)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          minHeight: 18,
        }}
      >
        <span style={{ color: "var(--text-primary)", fontSize: 11, fontWeight: 500 }}>
          Tasks
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "var(--text-tertiary)", fontSize: 10 }}>
          <span>{rows.length > 0 ? rows.length : "No list"}</span>
          <button
            type="button"
            aria-label="Minimize tasks"
            title="Minimize tasks"
            onClick={(event) => {
              event.stopPropagation();
              onToggleCollapsed();
            }}
            style={{
              width: 22,
              height: 22,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
              border: "1px solid var(--border-subtle)",
              borderRadius: 6,
              background: "color-mix(in srgb, var(--surface-raised) 82%, transparent)",
              color: "var(--text-secondary)",
              cursor: "pointer",
            }}
          >
            <PanelRightClose size={13} strokeWidth={1.8} />
          </button>
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 7, minHeight: 0, overflow: "hidden" }}>
        {rows.map((row) => {
          const done = row.state === "Done";
          return (
            <div
              key={row.id}
              data-testid="split-agent-task-row"
              title={`${row.task} · ${row.state} · Next: ${row.next}`}
              style={{
                display: "grid",
                gap: 4,
                minWidth: 0,
                padding: "7px 0 8px",
                borderTop: "1px solid var(--border-subtle)",
                opacity: done ? 0.62 : 1,
              }}
            >
              {row.meta && (
                <div
                  style={{
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    color: "color-mix(in srgb, var(--text-secondary) 70%, transparent)",
                    fontSize: 9,
                    fontWeight: 500,
                  }}
                >
                  {row.meta}
                </div>
              )}
              <div
                style={{
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  color: done
                    ? "color-mix(in srgb, var(--text-secondary) 68%, transparent)"
                    : "var(--text-primary)",
                  fontSize: 12,
                  fontWeight: 500,
                  textDecoration: done ? "line-through" : "none",
                  textDecorationThickness: done ? 1 : undefined,
                  textDecorationColor: done
                    ? "color-mix(in srgb, var(--text-tertiary) 58%, transparent)"
                    : undefined,
                }}
              >
                {row.task}
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  minWidth: 0,
                  color: "var(--text-secondary)",
                  fontSize: 10,
                  textDecoration: done ? "line-through" : "none",
                  textDecorationColor: done
                    ? "color-mix(in srgb, var(--text-tertiary) 58%, transparent)"
                    : undefined,
                }}
              >
                <span
                  data-testid="split-agent-task-state"
                  style={{
                    flexShrink: 0,
                    color: row.state === "Blocked" ? "var(--accent-danger)" : row.state === "Waiting" ? "var(--accent-warning)" : "var(--text-secondary)",
                  }}
                >
                  {row.state}
                </span>
                <span style={{ color: "var(--text-tertiary)" }}>·</span>
                <span
                  data-testid="split-agent-task-next"
                  style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                >
                  Next: {row.next}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

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
        const workstreamInputs = tab.workstream?.inputQueue ?? [];
        const latestWorkstreamInput = workstreamInputs[workstreamInputs.length - 1];
        const latestMissionControlInput = latestWorkstreamInput?.source === "mission-control" ? latestWorkstreamInput : undefined;
        const agentStatusSummary = tab.workstream?.kind === "agent"
          ? agentStatusSummaryFromWorkstream(tab.workstream)
          : null;
        const shellExtractedSummary = !agentStatusSummary && !isPreviewPane && paneTerminal
          ? getDisplaySummary({
              mission: "Terminal",
              provider: "shell",
              status: terminalStatus === "failed"
                ? "failed"
                : terminalStatus === "exited"
                  ? "done"
                  : terminalStatus === "running" || terminalStatus === "reconnected"
                    ? "running"
                    : "ready",
              cwd: paneCwd,
              currentActivity: paneTerminal.currentActivity,
              terminalOutput: paneTerminal.terminalOutput,
            }, paneTerminal.statusSummary)
          : null;
        const visibleTaskLineup = pickVisibleTaskLineup(
          tab.workstream?.taskLineup ?? paneTerminal?.taskLineup,
          paneTerminal?.activeRunId
        );
        const terminalPurpose = terminalPurposeFromContext({
          stored: paneTerminal?.purpose,
          workstreamTitle: tab.workstream?.mission ?? tab.workstream?.prompt,
          activeTaskTitle: visibleTaskLineup.find((item) => item.status === "in_progress")?.content ?? visibleTaskLineup[0]?.content,
          terminalOutput: !paneTerminal?.durableActivity || /\b(?:Working\s+\(|Worked for\b)/i.test(paneTerminal.terminalOutput ?? "")
            ? paneTerminal?.terminalOutput
            : undefined,
        });
        const shellStatusSummaryBase = !agentStatusSummary && !isPreviewPane && paneTerminal
          ? paneTerminal.durableActivity
            ? summaryFromDurableActivity(
                paneTerminal.durableActivity,
                pathTail(paneCwd) ?? paneCwd ?? "workspace path unknown",
                shellExtractedSummary ?? undefined,
                terminalPurpose,
              )
            : shellExtractedSummary
              ? normalizePersistedShellSummary(shellExtractedSummary, pathTail(paneCwd) ?? paneCwd ?? "workspace path unknown", terminalPurpose)
              : null
          : null;
        // When the agent has a REAL task list (sidecar TaskCreate/TaskUpdate →
        // tasksFromTodoWrite), the header title/now MUST be the agent's current task —
        // never the heuristic/purpose inference from terminal output. Read straight from
        // statusSummary so this holds even if the task lineup hasn't populated. (TC-033)
        const shellRealTask = paneTerminal?.statusSummary?.tasksFromTodoWrite
          ? paneTerminal.statusSummary
          : null;
        const shellStatusSummary = shellStatusSummaryBase && shellRealTask
          ? {
              ...shellStatusSummaryBase,
              task: shellRealTask.task || shellStatusSummaryBase.task,
              now: shellRealTask.now || shellStatusSummaryBase.now,
            }
          : shellStatusSummaryBase;
        const shellSummarySource = summarySourceLabel(
          paneTerminal?.statusSummarySource ?? tab.workstream?.statusSummarySource,
          paneTerminal?.statusSummaryError ?? tab.workstream?.statusSummaryError,
        );
        const isAgentPane = Boolean(agentStatusSummary);
        const isShellSummaryPane = Boolean(shellStatusSummary);
        const taskSidebarCollapsed = paneTerminal?.taskSidebarCollapsed ?? false;
        const paneActivity = !isPreviewPane
          ? tab.workstream?.kind === "agent"
            ? agentStatusSummary?.now ?? workstreamActivityText(tab.workstream)
            : shellStatusSummary?.now
          : null;
        const paneOutput = !isPreviewPane
          ? tab.workstream?.kind === "agent"
            ? tab.workstream.terminalOutput?.trim()
            : paneTerminal?.terminalOutput?.trim()
          : undefined;
        const chromeHeight = isAgentPane
          ? 68 + (latestMissionControlInput ? 16 : 0) + (paneOutput ? 16 : 0)
          : isShellSummaryPane ? 58 : 24;
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
            {isImmersivePane && (
              <div
                role="toolbar"
                aria-label="Terminal focus controls"
                style={{
                  position: "absolute",
                  top: 10,
                  right: 10,
                  zIndex: 5,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "7px 8px",
                  borderRadius: 8,
                  background: "rgba(29, 34, 36, 0.94)",
                  border: "1px solid var(--border-subtle)",
                  boxShadow: "0 12px 32px rgba(0,0,0,0.35)",
                  color: "var(--text-primary)",
                  fontFamily: "var(--font-ui)",
                }}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
              >
                <span
                  style={{
                    maxWidth: 220,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    color: "var(--text-secondary)",
                    fontSize: 12,
                    fontWeight: 500,
                  }}
                  title={paneContext}
                >
                  Terminal focus
                </span>
                <button
                  type="button"
                  title="Restore workspace chrome"
                  aria-label="Exit terminal focus"
                  onClick={() => exitImmersiveTerminal()}
                  style={{
                    height: 28,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 7,
                    padding: "0 10px",
                    border: "1px solid color-mix(in srgb, var(--accent-live) 42%, transparent)",
                    borderRadius: 6,
                    background: "color-mix(in srgb, var(--accent-live) 16%, var(--surface-raised))",
                    color: "var(--text-primary)",
                    fontSize: 12,
                    fontWeight: 500,
                    cursor: "pointer",
                  }}
                >
                  <Minimize2 size={14} strokeWidth={1.8} />
                  <span>Exit focus</span>
                </button>
              </div>
            )}
            {!isImmersivePane && (
            <div
              style={{
                height: chromeHeight,
                minHeight: chromeHeight,
                display: isAgentPane || isShellSummaryPane ? "grid" : "flex",
                gridTemplateRows: isAgentPane || isShellSummaryPane ? "auto auto" : undefined,
                alignItems: isAgentPane || isShellSummaryPane ? "stretch" : "center",
                gap: isAgentPane ? 6 : isShellSummaryPane ? 5 : 8,
                padding: isAgentPane ? "8px 9px 7px" : isShellSummaryPane ? "7px 8px 6px" : "0 7px",
                borderBottom: "1px solid var(--border-subtle)",
                background: isActive ? "#202527" : "#1d2224",
                color: "var(--text-secondary)",
                cursor: "default",
              }}
            >
              {isAgentPane && agentStatusSummary ? (
                <>
                <div
                  style={{
                    minWidth: 0,
                    display: "grid",
                    gridTemplateColumns: "auto auto minmax(0, 1fr) auto auto",
                    alignItems: "center",
                    gap: 8,
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
                    }}
                    title={`Terminal ${terminalStatusLabel}`}
                  />
                  <TerminalSquare
                    size={13}
                    strokeWidth={1.8}
                    color={isActive ? "var(--accent-live)" : "var(--text-secondary)"}
                  />
                  <div
                    data-testid="split-agent-working-on"
                    style={{
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
                      fontSize: 13,
                      fontWeight: 500,
                    }}
                    title={agentStatusSummary.task}
                  >
                    {agentStatusSummary.task}
                  </div>
                  <span
                    style={{
                      minWidth: 92,
                      height: 18,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: "0 7px",
                      border: "1px solid var(--border-subtle)",
                      borderRadius: "var(--radius-xs)",
                      background: "var(--surface-base)",
                      color: "var(--text-secondary)",
                      fontSize: 10,
                      textTransform: "uppercase",
                    }}
                    title={`${agentStatusSummary.provider} · ${agentStatusSummary.status}`}
                  >
                    {agentStatusSummary.provider} · {agentStatusSummary.status}
                  </span>
                  <PaneToolbar
                    paneId={paneId}
                    tabId={tab.id}
                    canClose={multiplePanes}
                    visible={showActions}
                  />
                </div>
                <div
                  style={{
                    minWidth: 0,
                    display: "grid",
                    gridTemplateColumns: "minmax(120px, 0.8fr) minmax(180px, 1.2fr)",
                    gap: 8,
                    alignItems: "center",
                  }}
                >
                  <div
                    data-testid="split-agent-status-path"
                    style={{
                      minWidth: 0,
                      display: "flex",
                      alignItems: "baseline",
                      gap: 5,
                      overflow: "hidden",
                      color: "var(--text-secondary)",
                      fontSize: 11,
                    }}
                    title={agentStatusSummary.path}
                  >
                    <span style={{ flexShrink: 0, color: "var(--text-tertiary)", fontSize: 10 }}>Path</span>
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{agentStatusSummary.path}</span>
                  </div>
                  <div
                    data-testid="split-agent-pane-now"
                    style={{
                      minWidth: 0,
                      display: "flex",
                      alignItems: "baseline",
                      gap: 5,
                      overflow: "hidden",
                      color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
                      fontSize: 11,
                      fontWeight: 500,
                    }}
                    title={agentStatusSummary.now}
                  >
                    <span style={{ flexShrink: 0, color: "var(--text-tertiary)", fontSize: 10, textTransform: "uppercase" }}>Now</span>
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{agentStatusSummary.now}</span>
                  </div>
                </div>
                {latestMissionControlInput && (
                  <div
                    data-testid="split-agent-pane-ask"
                    style={{
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      color: "var(--text-secondary)",
                      fontSize: 10,
                      fontWeight: 500,
                    }}
                    title={latestMissionControlInput.text}
                  >
                    Ask · {latestMissionControlInput.label ?? "Mission control"} · {latestMissionControlInput.sentAt ? "sent" : "queued"} · {latestMissionControlInput.text}
                  </div>
                )}
                {paneOutput && (
                  <div
                    data-testid="split-agent-pane-output"
                    style={{
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      color: "var(--text-secondary)",
                      fontSize: 10,
                      fontWeight: 500,
                    }}
                    title={paneOutput}
                  >
                    Output: {paneOutput}
                  </div>
                )}
                </>
              ) : shellStatusSummary ? (
                <>
                <div
                  style={{
                    minWidth: 0,
                    display: "grid",
                    gridTemplateColumns: "auto auto minmax(0, 1fr) auto",
                    alignItems: "center",
                    gap: 7,
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
                    }}
                    title={`Terminal ${terminalStatusLabel}`}
                  />
                  <TerminalSquare
                    size={13}
                    strokeWidth={1.8}
                    color={isActive ? "var(--accent-live)" : "var(--text-secondary)"}
                  />
                  <div
                    data-testid="split-terminal-summary-task"
                    style={{
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
                      fontSize: 13,
                      fontWeight: 500,
                    }}
                    title={shellStatusSummary.task}
                  >
                    {shellStatusSummary.task}
                  </div>
                  <PaneToolbar
                    paneId={paneId}
                    tabId={tab.id}
                    canClose={multiplePanes}
                    visible={showActions}
                  />
                </div>
                <div
                  style={{
                    minWidth: 0,
                    display: "grid",
                    gridTemplateColumns: "minmax(120px, 0.8fr) minmax(180px, 1.2fr)",
                    gap: 8,
                    alignItems: "center",
                  }}
                >
                  <div
                    data-testid="split-terminal-summary-path"
                    style={{
                      minWidth: 0,
                      display: "flex",
                      alignItems: "baseline",
                      gap: 5,
                      overflow: "hidden",
                      color: "var(--text-secondary)",
                      fontSize: 11,
                    }}
                    title={shellStatusSummary.path}
                  >
                    <span style={{ flexShrink: 0, color: "var(--text-tertiary)", fontSize: 10, textTransform: "uppercase" }}>Path</span>
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{shellStatusSummary.path}</span>
                  </div>
                  <div
                    data-testid="split-terminal-summary-now"
                    style={{
                      minWidth: 0,
                      display: "flex",
                      alignItems: "baseline",
                      gap: 5,
                      overflow: "hidden",
                      color: isActive ? "var(--text-secondary)" : "var(--text-secondary)",
                      fontSize: 11,
                      fontWeight: 500,
                    }}
                    title={shellStatusSummary.now}
                  >
                    <span style={{ flexShrink: 0, color: "var(--text-tertiary)", fontSize: 10 }}>Now</span>
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{shellStatusSummary.now}</span>
                    {shellSummarySource ? (
                      <span
                        data-testid="split-terminal-summary-source"
                        title={shellSummarySource.detail}
                        style={{ flexShrink: 0, color: "var(--text-tertiary)", fontSize: 10 }}
                      >
                        {shellSummarySource.label}
                      </span>
                    ) : null}
                  </div>
                </div>
                </>
              ) : (
              <>
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
                data-testid={agentStatusSummary ? "split-agent-working-on" : paneActivity ? "split-agent-pane-context" : undefined}
                data-status={terminalStatus}
                style={{
                  minWidth: 0,
                  flex: paneActivity ? "0 1 45%" : 1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
                  fontSize: 12,
                  fontWeight: 500,
                }}
                title={agentStatusSummary ? agentStatusSummary.path : isPreviewPane ? paneNode.previewUrl : project?.projectRoot ?? paneCwd ?? tab.title}
              >
                {agentStatusSummary ? `Working on: ${agentStatusSummary.task}` : isPreviewPane ? paneNode.previewUrl ?? "Localhost preview" : paneContext}
              </span>
              {paneActivity && (
                <span
                  data-testid="split-agent-pane-now"
                  style={{
                    minWidth: 0,
                    flex: paneOutput ? "1 1 40%" : "1 1 auto",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
                    fontSize: 11,
                    fontWeight: 500,
                  }}
                  title={paneActivity}
                >
                  Now: {paneActivity}
                </span>
              )}
              {latestMissionControlInput && (
                <span
                  data-testid="split-agent-pane-ask"
                  style={{
                    minWidth: 0,
                    flex: "1 1 28%",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
                    fontSize: 11,
                    fontWeight: 500,
                  }}
                  title={latestMissionControlInput.text}
                >
                  Ask: {latestMissionControlInput.label ?? "Mission control"} · {latestMissionControlInput.sentAt ? "sent" : "queued"} · {latestMissionControlInput.text}
                </span>
              )}
              {paneOutput && (
                <span
                  data-testid="split-agent-pane-output"
                  style={{
                    minWidth: 0,
                    flex: "1 1 28%",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
                    fontSize: 11,
                    fontWeight: 500,
                  }}
                  title={paneOutput}
                >
                  Output: {paneOutput}
                </span>
              )}
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
              </>
              )}
            </div>
            )}
            <div
              style={{
                flex: 1,
                minHeight: 0,
                minWidth: 0,
                display: "flex",
              }}
            >
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
              {isAgentPane && agentStatusSummary && tab.workstream?.kind === "agent" && !isPreviewPane && (
                <AgentTaskSidebar
                  workstream={tab.workstream}
                  summary={agentStatusSummary}
                  taskLineup={visibleTaskLineup}
                  collapsed={taskSidebarCollapsed}
                  onToggleCollapsed={() =>
                    useWorkspaceStore.getState().setTerminalTaskSidebarCollapsed(
                      tab.id,
                      paneId,
                      !taskSidebarCollapsed
                    )
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
