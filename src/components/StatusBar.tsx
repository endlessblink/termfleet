import { CSSProperties } from "react";
import { Activity, Folder, Layers3, Server, TerminalSquare } from "lucide-react";
import { useWorkspaceStore } from "../stores/workspace";
import type { TerminalRuntimeStatus } from "../lib/types";
import { pathTail, projectNameFor, projectRootFor, projectSessionCount } from "../lib/projectDisplay";

// ── Styles ────────────────────────────────────────────────────────────────────

const styles: Record<string, CSSProperties> = {
  bar: {
    height: "var(--statusbar-height)",
    background: "var(--surface-base)",
    color: "var(--text-secondary)",
    borderTop: "1px solid var(--border-subtle)",
    display: "flex",
    alignItems: "center",
    paddingLeft: 12,
    paddingRight: 12,
    fontSize: 12,
    fontFamily: "var(--font-ui)",
    gap: 8,
    userSelect: "none",
    flexShrink: 0,
  },
  left: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flex: 1,
    overflow: "hidden",
  },
  right: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
  },
  chip: {
    height: 18,
    display: "flex",
    alignItems: "center",
    gap: 5,
    padding: "0 7px",
    border: "1px solid transparent",
    borderRadius: "var(--radius-xs)",
    background: "transparent",
    color: "var(--text-secondary)",
    minWidth: 0,
  },
  chipActive: {
    borderColor: "transparent",
    background: "var(--surface-selected)",
    color: "var(--text-primary)",
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    flexShrink: 0,
  },
  value: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    overflow: "hidden",
    minWidth: 0,
  },
  text: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    minWidth: 0,
  },
  muted: {
    color: "var(--text-secondary)",
  },
  icon: {
    flexShrink: 0,
  },
};

type StatusKey = TerminalRuntimeStatus | "idle";

const STATUS_COLORS: Record<StatusKey, string> = {
  starting: "var(--accent-warning)",
  running: "var(--accent-success)",
  reconnected: "var(--accent-info)",
  stale: "var(--accent-warning)",
  failed: "var(--accent-danger)",
  exited: "var(--text-secondary)",
  idle: "var(--text-secondary)",
};

// ── StatusBar ─────────────────────────────────────────────────────────────────

export function StatusBar() {
  const tabs = useWorkspaceStore((s) => s.tabs);
  const groups = useWorkspaceStore((s) => s.groups);
  const activeTabId = useWorkspaceStore((s) => s.activeTabId);
  const activeTerminalId = useWorkspaceStore((s) => s.activeTerminalId);
  const activeGroupFilter = useWorkspaceStore((s) => s.activeGroupFilter);
  const projectRoot = useWorkspaceStore((s) => s.projectRoot);

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const activeTerminal = activeTab?.terminals.find((terminal) => terminal.paneId === activeTab.activePaneId);
  const activeStatus = activeTerminal?.status ?? (activeTerminalId ? "running" : "idle");
  const statusColor = STATUS_COLORS[activeStatus];
  const tabCount = tabs.length;
  const groupCount = groups.length;
  // Count only LIVE ptys. Stale/failed records linger in tab.terminals after a
  // failed reconnect (no cleanup), so counting the raw length inflated the badge
  // with ghost sessions. Restrict to running/reconnected = sessions a PTY backs.
  const terminalCount = tabs.reduce(
    (count, tab) =>
      count +
      tab.terminals.filter((t) => t.status === "running" || t.status === "reconnected").length,
    0,
  );
  const selectedProjectName = projectNameFor(activeGroupFilter, groups);
  const selectedProjectRoot = projectRootFor(activeGroupFilter, groups, activeTab) ?? projectRoot;
  const selectedProjectCount = projectSessionCount(activeGroupFilter, tabs);

  return (
    <div style={styles.bar}>
      <div style={styles.left}>
        {activeTab && (
          <span style={{ ...styles.chip, ...styles.chipActive }} title={activeTab.initialCwd ?? activeTab.title}>
            <TerminalSquare size={12} strokeWidth={1.8} color="var(--accent-live)" style={styles.icon} />
            <span style={styles.value}>
              <span style={{ ...styles.text, maxWidth: 180 }}>{activeTab.title}</span>
            </span>
          </span>
        )}

        <span style={styles.chip} title={selectedProjectRoot ?? undefined}>
            <Folder size={12} strokeWidth={1.8} color="var(--accent-info)" style={styles.icon} />
            <span style={{ ...styles.text, maxWidth: 220 }}>
              {selectedProjectName} · {pathTail(selectedProjectRoot)}
            </span>
          </span>
      </div>

      <div style={styles.right}>
        <span style={styles.chip} title={activeTerminal?.lastError ?? `PTY ${activeStatus}`}>
          <span
            style={{
              ...styles.dot,
              background: statusColor,
              boxShadow: `0 0 0 3px color-mix(in srgb, ${statusColor} 14%, transparent)`,
            }}
            aria-hidden="true"
          />
          <Server size={12} strokeWidth={1.8} color={statusColor} style={styles.icon} />
          <span style={styles.muted}>
            {activeStatus === "idle" ? "pty idle" : `pty ${activeStatus}`}
          </span>
        </span>
        <span style={styles.chip} title={`${terminalCount} terminal runtime records`}>
          <Activity size={12} strokeWidth={1.8} color="var(--accent-live)" style={styles.icon} />
          <span style={styles.muted}>
            {terminalCount} {terminalCount === 1 ? "pty" : "ptys"}
          </span>
        </span>
        {groupCount > 0 && (
          <span style={styles.chip}>
            <Layers3 size={12} strokeWidth={1.8} color="var(--accent-info)" style={styles.icon} />
            {groupCount} {groupCount === 1 ? "group" : "groups"}
          </span>
        )}
        <span style={styles.chip}>
          <TerminalSquare size={12} strokeWidth={1.8} color="var(--text-secondary)" style={styles.icon} />
          {selectedProjectCount}/{tabCount} sessions
        </span>
      </div>
    </div>
  );
}
