import { CSSProperties } from "react";
import { createNewTab, useWorkspaceStore } from "../stores/workspace";
import type { Tab } from "../lib/types";

const styles: Record<string, CSSProperties> = {
  rail: {
    width: 250,
    minWidth: 250,
    height: "100%",
    display: "flex",
    flexDirection: "column",
    background: "#202529",
    borderRight: "1px solid #333b43",
    color: "#d2dae3",
    userSelect: "none",
  },
  search: {
    height: 38,
    display: "flex",
    alignItems: "center",
    padding: "0 10px",
    borderBottom: "1px solid #303840",
  },
  searchBox: {
    width: "100%",
    height: 26,
    display: "flex",
    alignItems: "center",
    padding: "0 9px",
    borderRadius: 5,
    background: "#242a30",
    color: "#87929f",
    fontSize: 12,
  },
  section: {
    padding: "8px",
    display: "flex",
    flexDirection: "column",
    gap: 7,
  },
  sessionCard: {
    minHeight: 60,
    display: "grid",
    gridTemplateColumns: "28px minmax(0, 1fr)",
    alignItems: "center",
    gap: 9,
    padding: "8px",
    border: "1px solid transparent",
    borderRadius: 5,
    background: "#2a3035",
    cursor: "pointer",
  },
  activeSession: {
    background: "#3a3428",
    borderColor: "#4f422d",
  },
  icon: {
    width: 24,
    height: 24,
    borderRadius: "50%",
    display: "grid",
    placeItems: "center",
    background: "#40484f",
    color: "#dce4ec",
    fontSize: 12,
    fontWeight: 500,
  },
  title: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: 13,
    fontWeight: 500,
  },
  meta: {
    marginTop: 3,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: "#949fa9",
    fontSize: 11,
  },
  label: {
    padding: "9px 9px 2px",
    color: "#8c98a4",
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0,
  },
  dockGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 7,
    padding: "8px",
    borderTop: "1px solid #303840",
  },
  dockButton: {
    height: 34,
    border: "1px solid #3a424a",
    borderRadius: 5,
    background: "#252b31",
    color: "#aeb8c2",
    fontFamily: "var(--font-ui)",
    fontSize: 12,
    cursor: "pointer",
  },
  footer: {
    marginTop: "auto",
    borderTop: "1px solid #303840",
    padding: 8,
  },
  newButton: {
    width: "100%",
    height: 34,
    border: "1px solid #4b3f2b",
    borderRadius: 5,
    background: "rgba(217, 154, 69, 0.14)",
    color: "#e0aa5b",
    fontFamily: "var(--font-ui)",
    fontSize: 12,
    fontWeight: 500,
    cursor: "pointer",
  },
};

function sessionInitial(tab: Tab) {
  const title = tab.title.trim();
  return (title[0] || "$").toUpperCase();
}

export function ProjectRail() {
  const tabs = useWorkspaceStore((state) => state.tabs);
  const activeTabId = useWorkspaceStore((state) => state.activeTabId);
  const projectRoot = useWorkspaceStore((state) => state.projectRoot);
  const ui = useWorkspaceStore((state) => state.workspaceUiState);
  const setActiveTab = useWorkspaceStore((state) => state.setActiveTab);
  const setWorkspaceMode = useWorkspaceStore((state) => state.setWorkspaceMode);
  const updateUi = useWorkspaceStore((state) => state.updateWorkspaceUiState);

  return (
    <aside style={styles.rail}>
      <div style={styles.search}>
        <div style={styles.searchBox}>Search tabs...</div>
      </div>

      <div style={styles.label}>Workspace</div>
      <div style={styles.section}>
        <div style={{ ...styles.sessionCard, ...styles.activeSession }}>
          <span style={styles.icon}>CC</span>
          <span style={{ minWidth: 0 }}>
            <div style={styles.title}>cc-linux-enhancements</div>
            <div style={styles.meta}>{projectRoot ?? "No project root selected"}</div>
          </span>
        </div>
      </div>

      <div style={styles.label}>Sessions</div>
      <div style={styles.section}>
        {tabs.map((tab) => (
          <div
            key={tab.id}
            style={{
              ...styles.sessionCard,
              ...(tab.id === activeTabId ? styles.activeSession : null),
            }}
            onClick={() => {
              setActiveTab(tab.id);
              setWorkspaceMode("split");
            }}
          >
            <span style={styles.icon}>{sessionInitial(tab)}</span>
            <span style={{ minWidth: 0 }}>
              <div style={styles.title}>{tab.title}</div>
              <div style={styles.meta}>{tab.initialCwd ?? "interactive shell"}</div>
            </span>
          </div>
        ))}
      </div>

      <div style={styles.footer}>
        <button style={styles.newButton} onClick={() => createNewTab()}>
          New Session
        </button>
      </div>

      <div style={styles.dockGrid}>
        <button
          style={{
            ...styles.dockButton,
            color: ui.fileExplorerCollapsed ? "#aeb8c2" : "#e0aa5b",
            borderColor: ui.fileExplorerCollapsed ? "#3a424a" : "#70562e",
          }}
          onClick={() => updateUi({ fileExplorerCollapsed: !ui.fileExplorerCollapsed })}
        >
          Files
        </button>
        <button
          style={{
            ...styles.dockButton,
            color: ui.workspaceMode === "canvas" ? "#e0aa5b" : "#aeb8c2",
            borderColor: ui.workspaceMode === "canvas" ? "#70562e" : "#3a424a",
          }}
          onClick={() => {
            setWorkspaceMode("canvas");
            updateUi({ canvasSidebarCollapsed: false });
          }}
        >
          Map
        </button>
      </div>
    </aside>
  );
}
