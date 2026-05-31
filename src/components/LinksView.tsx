import { CSSProperties, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useWorkspaceStore } from "../stores/workspace";
import { pathTail } from "../lib/projectDisplay";
import type { OpenFile, Tab, TerminalRuntimeStatus } from "../lib/types";

// The Links view is a read-only relationship map of the live workspace:
//   Project (group)  →  Session (tab + its terminals)  →  Files
// It surfaces the relationships the store actually models — group→tab via
// `groupId`, tab→terminals via `Tab.terminals`, tab→cwd via `initialCwd`/live
// cwd — instead of inventing task data that doesn't exist yet. Files are linked
// to the session whose working directory contains them; the rest fall under a
// workspace bucket so nothing is silently dropped.

const UNASSIGNED = "__unassigned__";

interface ProjectGroupView {
  id: string;
  name: string;
  root: string | null;
  color?: string;
  sessions: SessionView[];
}

interface SessionView {
  id: string;
  tab: Tab;
  cwd: string | null;
  files: OpenFile[];
}

const statusTone: Record<TerminalRuntimeStatus, string> = {
  starting: "var(--accent-warning)",
  running: "var(--accent-positive, #5fb878)",
  reconnected: "var(--accent-positive, #5fb878)",
  stale: "var(--text-tertiary, #8a8f93)",
  failed: "var(--accent-danger, #d96b6b)",
};

function sessionStatus(tab: Tab): { tone: string; label: string } {
  const statuses = tab.terminals.map((t) => t.status).filter(Boolean) as TerminalRuntimeStatus[];
  if (statuses.includes("failed")) return { tone: statusTone.failed, label: "failed" };
  if (statuses.some((s) => s === "running" || s === "reconnected"))
    return { tone: statusTone.running, label: "running" };
  if (statuses.includes("starting")) return { tone: statusTone.starting, label: "starting" };
  if (statuses.includes("stale")) return { tone: statusTone.stale, label: "stale" };
  return { tone: "var(--text-tertiary, #8a8f93)", label: tab.terminals.length ? "idle" : "no pty" };
}

export function LinksView() {
  const tabs = useWorkspaceStore((state) => state.tabs);
  const groups = useWorkspaceStore((state) => state.groups);
  const openFiles = useWorkspaceStore((state) => state.openFiles);
  const liveCwds = useWorkspaceStore((state) => state.liveCwds);
  const activeTabId = useWorkspaceStore((state) => state.activeTabId);
  const setActiveTab = useWorkspaceStore((state) => state.setActiveTab);
  const setWorkspaceMode = useWorkspaceStore((state) => state.setWorkspaceMode);

  const containerRef = useRef<HTMLDivElement>(null);
  // Anchor refs keyed by node id — measured after layout to draw connectors.
  const anchorRefs = useRef(new Map<string, HTMLElement>());
  const [edges, setEdges] = useState<{ key: string; d: string; color: string }[]>([]);

  const cwdForTab = (tab: Tab): string | null => {
    const activeTerm = tab.terminals.find((t) => t.paneId === tab.activePaneId) ?? tab.terminals[0];
    return (activeTerm && liveCwds[activeTerm.id]) ?? tab.initialCwd ?? null;
  };

  const { projects, orphanFiles } = useMemo(() => {
    const sessions: SessionView[] = tabs.map((tab) => ({
      id: tab.id,
      tab,
      cwd: cwdForTab(tab),
      files: [],
    }));

    // Attach each open file to the session whose cwd is the longest matching
    // prefix of the file path. Unmatched files become workspace-level orphans.
    const orphans: OpenFile[] = [];
    for (const file of openFiles) {
      let best: SessionView | null = null;
      let bestLen = -1;
      for (const session of sessions) {
        if (session.cwd && file.path.startsWith(session.cwd) && session.cwd.length > bestLen) {
          best = session;
          bestLen = session.cwd.length;
        }
      }
      if (best) best.files.push(file);
      else orphans.push(file);
    }

    const byProject = new Map<string, ProjectGroupView>();
    const ensure = (id: string, name: string, root: string | null, color?: string) => {
      let entry = byProject.get(id);
      if (!entry) {
        entry = { id, name, root, color, sessions: [] };
        byProject.set(id, entry);
      }
      return entry;
    };

    for (const session of sessions) {
      const group = session.tab.groupId
        ? groups.find((g) => g.id === session.tab.groupId)
        : undefined;
      if (group) {
        ensure(group.id, group.name, group.projectRoot ?? session.cwd, group.color).sessions.push(session);
      } else if (session.cwd) {
        // Folder-picker tabs have no Group but do carry a working directory.
        // Derive a project identity from the cwd so they read as e.g.
        // "arthouse" instead of collapsing into one "Unassigned" bucket
        // (mirrors the Map sidebar — see map-unassigned-and-phantom-nodes).
        const name = session.cwd.split("/").filter(Boolean).pop() ?? session.cwd;
        ensure(`cwd:${session.cwd}`, name, session.cwd).sessions.push(session);
      } else {
        ensure(UNASSIGNED, "Unassigned", null).sessions.push(session);
      }
    }

    return { projects: [...byProject.values()], orphanFiles: orphans };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs, groups, openFiles, liveCwds]);

  const setAnchor = (id: string) => (el: HTMLElement | null) => {
    if (el) anchorRefs.current.set(id, el);
    else anchorRefs.current.delete(id);
  };

  // Measure anchor rects and recompute connector paths whenever the model or
  // container size changes.
  useLayoutEffect(() => {
    const compute = () => {
      const container = containerRef.current;
      if (!container) return;
      const base = container.getBoundingClientRect();
      const rectOf = (id: string) => {
        const el = anchorRefs.current.get(id);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return r;
      };
      const link = (fromId: string, toId: string, color: string) => {
        const a = rectOf(fromId);
        const b = rectOf(toId);
        if (!a || !b) return null;
        const x1 = a.right - base.left + container.scrollLeft;
        const y1 = a.top + a.height / 2 - base.top + container.scrollTop;
        const x2 = b.left - base.left + container.scrollLeft;
        const y2 = b.top + b.height / 2 - base.top + container.scrollTop;
        const dx = Math.max(28, (x2 - x1) / 2);
        return { d: `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`, color };
      };

      const next: { key: string; d: string; color: string }[] = [];
      for (const project of projects) {
        const color = project.color ?? "var(--border-strong)";
        for (const session of project.sessions) {
          const e = link(`project:${project.id}`, `session:${session.id}`, color);
          if (e) next.push({ key: `p${project.id}-s${session.id}`, ...e });
          for (const file of session.files) {
            const fe = link(`session:${session.id}`, `file:${session.id}:${file.path}`, "var(--border-strong)");
            if (fe) next.push({ key: `s${session.id}-f${file.path}`, ...fe });
          }
        }
      }
      setEdges(next);
    };

    compute();
    const container = containerRef.current;
    const ro = new ResizeObserver(compute);
    if (container) ro.observe(container);
    window.addEventListener("resize", compute);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", compute);
    };
  }, [projects, orphanFiles]);

  const totalSessions = projects.reduce((n, p) => n + p.sessions.length, 0);

  if (totalSessions === 0) {
    return (
      <div style={styles.empty}>
        <div style={styles.emptyTitle}>No links yet</div>
        <div style={styles.emptyBody}>
          Open a project and start sessions — links will map terminals, working directories, and files.
        </div>
      </div>
    );
  }

  const openSession = (tabId: string) => {
    setActiveTab(tabId);
    setWorkspaceMode("split");
  };

  return (
    <div ref={containerRef} style={styles.canvas}>
      <svg style={styles.edgeLayer} aria-hidden="true">
        {edges.map((edge) => (
          <path key={edge.key} d={edge.d} fill="none" stroke={edge.color} strokeWidth={1.5} strokeOpacity={0.5} />
        ))}
      </svg>

      <div style={styles.columns}>
        {/* Projects */}
        <div style={styles.column}>
          <div style={styles.columnLabel}>Projects</div>
          {projects.map((project) => (
            <div key={project.id} ref={setAnchor(`project:${project.id}`)} style={styles.projectCard}>
              <span
                style={{
                  ...styles.projectDot,
                  background: project.color ?? "var(--text-tertiary, #8a8f93)",
                }}
              />
              <div style={styles.cardText}>
                <div style={styles.cardTitle}>{project.name}</div>
                <div style={styles.cardSub}>
                  {project.root ? pathTail(project.root, 2) : `${project.sessions.length} session${project.sessions.length === 1 ? "" : "s"}`}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Sessions */}
        <div style={styles.column}>
          <div style={styles.columnLabel}>Sessions</div>
          {projects.flatMap((project) =>
            project.sessions.map((session) => {
              const status = sessionStatus(session.tab);
              const active = session.id === activeTabId;
              return (
                <button
                  key={session.id}
                  ref={setAnchor(`session:${session.id}`)}
                  onClick={() => openSession(session.id)}
                  style={{
                    ...styles.sessionCard,
                    ...(active ? styles.sessionCardActive : null),
                  }}
                  title="Open this session"
                >
                  <span style={styles.sessionEmoji}>{session.tab.emoji}</span>
                  <div style={styles.cardText}>
                    <div style={styles.cardTitle}>{session.tab.title}</div>
                    <div style={styles.cardSub}>{session.cwd ? pathTail(session.cwd, 2) : "interactive shell"}</div>
                  </div>
                  <div style={styles.statusWrap}>
                    <span style={{ ...styles.statusDot, background: status.tone }} />
                    <span style={styles.statusLabel}>
                      {session.tab.terminals.length > 1 ? `${session.tab.terminals.length} · ` : ""}
                      {status.label}
                    </span>
                  </div>
                </button>
              );
            }),
          )}
        </div>

        {/* Files */}
        <div style={styles.column}>
          <div style={styles.columnLabel}>Files</div>
          {projects.flatMap((project) =>
            project.sessions.flatMap((session) =>
              session.files.map((file) => (
                <div key={`${session.id}:${file.path}`} ref={setAnchor(`file:${session.id}:${file.path}`)} style={styles.fileCard}>
                  <div style={styles.cardText}>
                    <div style={styles.cardTitle}>
                      {file.name}
                      {file.dirty ? <span style={styles.dirtyDot} /> : null}
                    </div>
                    <div style={styles.cardSub}>{pathTail(file.path, 2)}</div>
                  </div>
                </div>
              )),
            ),
          )}
          {orphanFiles.length > 0 && (
            <>
              <div style={styles.subLabel}>Workspace files</div>
              {orphanFiles.map((file) => (
                <div key={file.path} style={styles.fileCard}>
                  <div style={styles.cardText}>
                    <div style={styles.cardTitle}>
                      {file.name}
                      {file.dirty ? <span style={styles.dirtyDot} /> : null}
                    </div>
                    <div style={styles.cardSub}>{pathTail(file.path, 2)}</div>
                  </div>
                </div>
              ))}
            </>
          )}
          {projects.every((p) => p.sessions.every((s) => s.files.length === 0)) && orphanFiles.length === 0 && (
            <div style={styles.filesEmpty}>No open files</div>
          )}
        </div>
      </div>
    </div>
  );
}

const cardBase: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "10px 12px",
  borderRadius: "var(--radius-md, 10px)",
  border: "1px solid var(--border-subtle)",
  background: "var(--surface-raised)",
  boxShadow: "var(--shadow-card)",
  minWidth: 0,
};

const styles: Record<string, CSSProperties> = {
  canvas: {
    position: "relative",
    width: "100%",
    height: "100%",
    overflow: "auto",
    padding: "28px 32px",
    background:
      "linear-gradient(var(--canvas-grid-soft, rgba(255,255,255,0.02)) 1px, transparent 1px), linear-gradient(90deg, var(--canvas-grid-soft, rgba(255,255,255,0.02)) 1px, transparent 1px), var(--surface-sunken)",
    backgroundSize: "56px 56px",
  },
  edgeLayer: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    pointerEvents: "none",
    zIndex: 0,
    overflow: "visible",
  },
  columns: {
    position: "relative",
    zIndex: 1,
    display: "grid",
    gridTemplateColumns: "minmax(180px, 1fr) minmax(220px, 1.2fr) minmax(180px, 1fr)",
    gap: "64px",
    alignItems: "start",
  },
  column: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    minWidth: 0,
  },
  columnLabel: {
    fontSize: 11,
    fontWeight: 500,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "var(--text-tertiary, #8a8f93)",
    marginBottom: 2,
  },
  subLabel: {
    fontSize: 10,
    fontWeight: 500,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--text-tertiary, #8a8f93)",
    marginTop: 8,
  },
  projectCard: { ...cardBase },
  projectDot: {
    width: 10,
    height: 10,
    borderRadius: "50%",
    flexShrink: 0,
  },
  sessionCard: {
    ...cardBase,
    cursor: "pointer",
    textAlign: "left",
    font: "inherit",
    color: "var(--text-primary)",
  },
  sessionCardActive: {
    border: "1px solid var(--accent-primary, #d99a45)",
    boxShadow: "0 0 0 1px var(--accent-primary, #d99a45), var(--shadow-card)",
  },
  sessionEmoji: {
    fontSize: 16,
    flexShrink: 0,
    lineHeight: 1,
  },
  fileCard: { ...cardBase },
  cardText: { minWidth: 0, flex: 1 },
  cardTitle: {
    fontSize: 13,
    fontWeight: 500,
    color: "var(--text-primary)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  cardSub: {
    fontSize: 11,
    color: "var(--text-secondary)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    marginTop: 2,
  },
  statusWrap: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    flexShrink: 0,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: "50%",
  },
  statusLabel: {
    fontSize: 10,
    color: "var(--text-tertiary, #8a8f93)",
  },
  dirtyDot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: "var(--accent-warning)",
    flexShrink: 0,
  },
  filesEmpty: {
    fontSize: 12,
    color: "var(--text-tertiary, #8a8f93)",
    padding: "8px 4px",
  },
  empty: {
    height: "100%",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    background: "var(--surface-sunken)",
    padding: 24,
    textAlign: "center",
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: 500,
    color: "var(--text-primary)",
  },
  emptyBody: {
    fontSize: 12,
    color: "var(--text-secondary)",
    maxWidth: 360,
    lineHeight: 1.5,
  },
};
