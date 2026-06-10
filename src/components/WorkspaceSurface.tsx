import { CSSProperties, Suspense, lazy } from "react";
import type { Tab } from "../lib/types";
import { useWorkspaceStore } from "../stores/workspace";
import { CanvasSidebar } from "./CanvasSidebar";

const MagicCanvas = lazy(() => import("./MagicCanvas").then((module) => ({ default: module.MagicCanvas })));
const SplitPaneLayout = lazy(() => import("./SplitPane").then((module) => ({ default: module.SplitPaneLayout })));
const LinksView = lazy(() => import("./LinksView").then((module) => ({ default: module.LinksView })));

const styles: Record<string, CSSProperties> = {
  shell: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    background: "var(--surface-floor)",
  },
  stage: {
    flex: 1,
    minHeight: 0,
    position: "relative",
    overflow: "hidden",
    borderLeft: "1px solid var(--border-strong)",
    background:
      "radial-gradient(circle at 62% -18%, rgba(255, 255, 255, 0.04), transparent 28%), linear-gradient(180deg, #1f2325, #171b1d 72%)",
  },
  surfacePane: {
    position: "absolute",
    inset: 0,
    minWidth: 0,
    minHeight: 0,
  },
  canvasShell: {
    width: "100%",
    height: "100%",
    minWidth: 0,
    minHeight: 0,
    display: "flex",
  },
  canvasStage: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    position: "relative",
  },
  terminalFrame: {
    position: "absolute",
    inset: 6,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    border: "1px solid transparent",
    background: "var(--surface-sunken)",
    boxShadow: "var(--shadow-active-pane)",
    animation: "workbench-surface-in var(--motion-med)",
  },
  terminalFrameChrome: {
    height: "var(--pane-chrome-height)",
    minHeight: "var(--pane-chrome-height)",
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "0 8px",
    borderBottom: "1px solid var(--border-subtle)",
    background: "linear-gradient(180deg, var(--surface-raised), var(--surface-wash))",
  },
  terminalFrameDot: {
    width: 7,
    height: 7,
    borderRadius: "50%",
    background: "var(--accent-warning)",
    boxShadow: "0 0 0 3px rgba(212, 164, 79, 0.12)",
  },
  terminalFrameTitle: {
    width: 132,
    height: 9,
    borderRadius: "var(--radius-xs)",
    background: "var(--surface-hover)",
  },
  terminalFrameBody: {
    flex: 1,
    display: "grid",
    alignContent: "start",
    gap: 9,
    padding: "12px 10px",
    background:
      "linear-gradient(180deg, rgba(217, 154, 69, 0.025), transparent 120px), var(--surface-sunken)",
  },
  terminalLine: {
    height: 10,
    borderRadius: "var(--radius-xs)",
    background: "linear-gradient(90deg, rgba(216, 222, 231, 0.42), rgba(216, 222, 231, 0.08))",
    opacity: 0.7,
  },
  graph: {
    width: "100%",
    height: "100%",
    minWidth: 0,
    minHeight: 0,
    color: "var(--text-secondary)",
    fontSize: 13,
    background: "var(--surface-sunken)",
  },
};

function TerminalSurfaceFallback() {
  return (
    <div style={styles.terminalFrame} aria-hidden="true">
      <div style={styles.terminalFrameChrome}>
        <span style={styles.terminalFrameDot} />
        <span style={styles.terminalFrameTitle} />
      </div>
      <div style={styles.terminalFrameBody}>
        <span style={{ ...styles.terminalLine, width: "42%" }} />
        <span style={{ ...styles.terminalLine, width: "64%" }} />
        <span style={{ ...styles.terminalLine, width: "28%" }} />
      </div>
    </div>
  );
}

function MapSurfaceFallback() {
  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        background:
          "linear-gradient(var(--canvas-grid-soft) 1px, transparent 1px), linear-gradient(90deg, var(--canvas-grid-soft) 1px, transparent 1px), linear-gradient(180deg, var(--surface-base), var(--surface-sunken))",
        backgroundSize: "56px 56px",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 14,
          left: 14,
          width: 170,
          height: 42,
          border: "1px solid transparent",
          borderRadius: "var(--radius-md)",
          background: "var(--surface-raised)",
          boxShadow: "var(--shadow-card)",
        }}
      />
      <TerminalSurfaceFallback />
    </div>
  );
}

function SplitWorkspace({ tabs, activeTabId }: { tabs: Tab[]; activeTabId: string | null }) {
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  if (!activeTab) return null;

  return (
    <div className="terminal-area" style={{ width: "100%", height: "100%" }}>
      <div
        key={activeTab.id}
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 1,
        }}
      >
        <Suspense fallback={<TerminalSurfaceFallback />}>
          <SplitPaneLayout
            tab={activeTab}
            sessionLabel={`${activeTab.title} ${tabs.findIndex((tab) => tab.id === activeTab.id) + 1}`}
          />
        </Suspense>
      </div>
    </div>
  );
}

export function WorkspaceSurface() {
  const tabs = useWorkspaceStore((state) => state.tabs);
  const activeTabId = useWorkspaceStore((state) => state.activeTabId);
  const workspaceMode = useWorkspaceStore((state) => state.workspaceUiState.workspaceMode);
  const immersiveTerminal = useWorkspaceStore((state) => state.workspaceUiState.immersiveTerminal);
  const hydrating = useWorkspaceStore((state) => state.hydrating);
  const effectiveWorkspaceMode = immersiveTerminal.enabled ? "split" : workspaceMode;

  // Hold terminals from mounting until the durable layout is loaded, so they
  // spawn against the restored tab/pane ids (not the default tab's) — otherwise
  // a session would be created and then orphaned when the real tabs swap in.
  if (hydrating) {
    return (
      <main className="workspace-surface" style={styles.shell}>
        <div style={styles.stage}>
          <div style={{ ...styles.surfacePane, zIndex: 1 }}>
            <TerminalSurfaceFallback />
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="workspace-surface" style={styles.shell}>
      <div style={styles.stage}>
        {effectiveWorkspaceMode === "canvas" && (
          <div style={{ ...styles.surfacePane, zIndex: 1 }}>
            <div style={styles.canvasShell}>
              {!immersiveTerminal.enabled && <CanvasSidebar />}
              <div style={styles.canvasStage}>
                <Suspense fallback={<MapSurfaceFallback />}>
                  <MagicCanvas />
                </Suspense>
              </div>
            </div>
          </div>
        )}
        {effectiveWorkspaceMode === "split" && (
          <div style={{ ...styles.surfacePane, zIndex: 1 }}>
            <SplitWorkspace tabs={tabs} activeTabId={activeTabId} />
          </div>
        )}
        {effectiveWorkspaceMode === "graph" && (
          <div style={{ ...styles.surfacePane, zIndex: 1 }}>
            <div style={styles.graph}>
              <Suspense fallback={<MapSurfaceFallback />}>
                <LinksView />
              </Suspense>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
