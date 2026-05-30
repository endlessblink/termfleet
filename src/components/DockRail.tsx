import { CSSProperties } from "react";
import { useWorkspaceStore } from "../stores/workspace";

const styles: Record<string, CSSProperties> = {
  rail: {
    width: 44,
    minWidth: 44,
    height: "100%",
    background: "#090b0e",
    borderRight: "1px solid var(--border)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    padding: "8px 5px",
    gap: 6,
    userSelect: "none",
  },
  button: {
    width: 32,
    height: 32,
    border: "1px solid var(--border)",
    borderRadius: 5,
    background: "transparent",
    color: "var(--fg-dark)",
    display: "grid",
    placeItems: "center",
    fontFamily: "var(--font-ui)",
    fontSize: 11,
    fontWeight: 500,
    cursor: "pointer",
  },
  spacer: {
    flex: 1,
  },
  modeButton: {
    width: 32,
    height: 24,
    border: "1px solid var(--border)",
    borderRadius: 5,
    background: "transparent",
    color: "var(--fg-dark)",
    display: "grid",
    placeItems: "center",
    fontFamily: "var(--font-ui)",
    fontSize: 10,
    cursor: "pointer",
  },
};

function DockButton({
  label,
  title,
  active,
  onClick,
}: {
  label: string;
  title: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      style={{
        ...styles.button,
        background: active ? "var(--live-muted)" : "transparent",
        borderColor: active ? "var(--live)" : "var(--border)",
        color: active ? "var(--live)" : "var(--fg-dark)",
      }}
      title={title}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

export function DockRail() {
  const ui = useWorkspaceStore((state) => state.workspaceUiState);
  const updateUi = useWorkspaceStore((state) => state.updateWorkspaceUiState);
  const setWorkspaceMode = useWorkspaceStore((state) => state.setWorkspaceMode);

  return (
    <nav style={styles.rail} aria-label="Workspace docks">
      <DockButton
        label="F"
        title={ui.fileExplorerCollapsed ? "Open files" : "Hide files"}
        active={!ui.fileExplorerCollapsed}
        onClick={() => updateUi({ fileExplorerCollapsed: !ui.fileExplorerCollapsed })}
      />
      <DockButton
        label="M"
        title={ui.canvasSidebarCollapsed ? "Open map index" : "Hide map index"}
        active={ui.workspaceMode === "canvas" && !ui.canvasSidebarCollapsed}
        onClick={() => {
          setWorkspaceMode("canvas");
          updateUi({ canvasSidebarCollapsed: ui.workspaceMode === "canvas" ? !ui.canvasSidebarCollapsed : false });
        }}
      />
      <DockButton
        label="$"
        title={ui.terminalSidebarCollapsed ? "Open sessions" : "Hide sessions"}
        active={ui.workspaceMode === "split" && !ui.terminalSidebarCollapsed}
        onClick={() => {
          setWorkspaceMode("split");
          updateUi({ terminalSidebarCollapsed: ui.workspaceMode === "split" ? !ui.terminalSidebarCollapsed : false });
        }}
      />
      <div style={styles.spacer} />
      <button
        style={{
          ...styles.modeButton,
          borderColor: ui.workspaceMode === "graph" ? "var(--live)" : "var(--border)",
          color: ui.workspaceMode === "graph" ? "var(--live)" : "var(--fg-dark)",
        }}
        title="Links"
        onClick={() => setWorkspaceMode("graph")}
      >
        L
      </button>
    </nav>
  );
}
