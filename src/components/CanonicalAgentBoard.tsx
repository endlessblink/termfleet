import { useEffect, useMemo, useState } from "react";
import { ArrowsClockwise, Kanban, MagnifyingGlass, X } from "@phosphor-icons/react";
import {
  BOARD_STATUSES,
  filterCanonicalTasks,
  groupCanonicalTasks,
  readCanonicalAuthority,
  transitionCanonicalTask,
  type CanonicalTask,
  type CanonicalTaskFilters,
  type CanonicalTaskStatus,
} from "../lib/canonicalAgentBoard";
import { useCanonicalTasks } from "../hooks/useCanonicalTasks";

const styles = {
  shell: { height: "100%", display: "flex", flexDirection: "column" as const, minWidth: 0, background: "var(--surface-base)" },
  toolbar: { display: "flex", gap: 8, alignItems: "center", padding: "12px 14px", borderBottom: "1px solid var(--border-subtle)", flexWrap: "wrap" as const },
  input: { flex: 1, minWidth: 140, height: 32, border: "1px solid var(--border-subtle)", borderRadius: 6, background: "var(--surface-sunken)", color: "var(--text-primary)", padding: "0 10px" },
  select: { height: 32, border: "1px solid var(--border-subtle)", borderRadius: 6, background: "var(--surface-sunken)", color: "var(--text-primary)", padding: "0 8px" },
  button: { height: 32, display: "inline-flex", alignItems: "center", gap: 6, border: "1px solid var(--border-subtle)", borderRadius: 6, background: "var(--surface-raised)", color: "var(--text-primary)", padding: "0 10px", cursor: "pointer" },
  board: { flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "repeat(6, minmax(180px, 1fr))", gap: 8, padding: 10, overflow: "auto" },
  column: { minWidth: 180, display: "flex", flexDirection: "column" as const, gap: 7, padding: 8, border: "1px solid var(--border-subtle)", borderRadius: 8, background: "var(--surface-sunken)" },
  card: { display: "grid", gap: 7, padding: 10, border: "1px solid var(--border-subtle)", borderRadius: 7, background: "var(--surface-raised)", color: "var(--text-primary)", cursor: "pointer", textAlign: "start" as const },
};

function TaskCard({ task, onSelect }: { task: CanonicalTask; onSelect: () => void }) {
  return <button type="button" style={styles.card} aria-label={`Open ${task.id}: ${task.title}`} onClick={onSelect}>
    <span style={{ display: "flex", justifyContent: "space-between", gap: 6, color: "var(--text-secondary)", fontSize: 11 }}><span>{task.id}</span><span>{task.priority}</span></span>
    <strong style={{ fontSize: 13, fontWeight: 500 }}>{task.title}</strong>
    <span style={{ color: "var(--text-secondary)", fontSize: 11 }}>{task.owner} · {task.workspace || "No workspace"}</span>
  </button>;
}

function TaskDetail({ task, onClose, onStatus }: { task: CanonicalTask; onClose: () => void; onStatus: (status: CanonicalTaskStatus) => void }) {
  return <aside aria-label={`Details for ${task.id}`} style={{ width: 320, minWidth: 280, padding: 16, borderLeft: "1px solid var(--border-subtle)", overflow: "auto", background: "var(--surface-raised)" }}>
    <button type="button" style={{ ...styles.button, float: "right" }} aria-label="Close task details" onClick={onClose}><X size={14} /></button>
    <div style={{ color: "var(--text-secondary)", fontSize: 12 }}>{task.id} · {task.type}</div>
    <h2 style={{ fontSize: 18, margin: "8px 0 14px" }}>{task.title}</h2>
    <label style={{ display: "grid", gap: 5, fontSize: 12, color: "var(--text-secondary)" }}>Status
      <select style={styles.select} value={task.status} onChange={(event) => onStatus(event.target.value as CanonicalTaskStatus)}>{BOARD_STATUSES.map((status) => <option key={status}>{status}</option>)}</select>
    </label>
    <dl style={{ display: "grid", gap: 8, fontSize: 12 }}><div><dt style={{ color: "var(--text-secondary)" }}>Owner</dt><dd>{task.owner}</dd></div><div><dt style={{ color: "var(--text-secondary)" }}>Workspace</dt><dd style={{ overflowWrap: "anywhere" }}>{task.workspace || "Not assigned"}</dd></div><div><dt style={{ color: "var(--text-secondary)" }}>Source</dt><dd style={{ overflowWrap: "anywhere" }}>{task.source}</dd></div><div><dt style={{ color: "var(--text-secondary)" }}>Dependencies</dt><dd>{task.dependencies.join(", ") || "None"}</dd></div></dl>
    <p style={{ whiteSpace: "pre-wrap", lineHeight: 1.45 }}>{task.description}</p>
    <h3 style={{ fontSize: 13 }}>Acceptance</h3><ul>{task.acceptance.map((item) => <li key={item.text}>{item.complete ? "✓" : "○"} {item.text}</li>)}</ul>
    <h3 style={{ fontSize: 13 }}>Progress</h3><ul>{task.progress.map((item, index) => <li key={`${item.text}-${index}`}>{item.date ? `${item.date} — ` : ""}{item.text}</li>)}</ul>
  </aside>;
}

export function CanonicalAgentBoard() {
  const { tasks, setTasks, error, loading, refresh } = useCanonicalTasks();
  const [filters, setFilters] = useState<CanonicalTaskFilters>({ showDone: true });
  const [selected, setSelected] = useState<CanonicalTask | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [authority, setAuthority] = useState<{ source: string; mutationBoundary: string } | null>(null);
  const [authorityError, setAuthorityError] = useState<string | null>(null);
  const visible = useMemo(() => filterCanonicalTasks(tasks, filters), [tasks, filters]);
  const grouped = useMemo(() => groupCanonicalTasks(visible), [visible]);
  const updateStatus = async (status: CanonicalTaskStatus) => {
    if (!selected || status === selected.status) return;
    const previous = selected;
    try {
      const confirmed = await transitionCanonicalTask(selected.id, status, selected.owner || "termfleet");
      setTasks((current) => current.map((task) => task.id === confirmed.id ? confirmed : task));
      setSelected(confirmed);
      setMutationError(null);
    } catch (cause) {
      setSelected(previous);
      setMutationError(cause instanceof Error ? cause.message : "Canonical update failed; no local change was kept");
    }
  };
  useEffect(() => {
    void readCanonicalAuthority().then(setAuthority).catch((cause) => {
      setAuthorityError(cause instanceof Error ? cause.message : "Canonical authority verification failed");
    });
  }, []);
  return <section style={styles.shell} aria-label="Canonical task board" data-testid="canonical-agent-board">
    <div style={styles.toolbar}><strong style={{ display: "inline-flex", alignItems: "center", gap: 7 }}><Kanban size={18} /> Tasks</strong><span aria-label="Canonical source" title={authority?.source ?? authorityError ?? "Verifying canonical source"} style={{ color: authority ? "var(--text-secondary)" : "var(--accent-danger)", fontSize: 11 }}>{authority ? "Shared queue verified" : authorityError ?? "Verifying shared queue…"}</span><label style={{ display: "flex", alignItems: "center", gap: 6, flex: 1 }}><MagnifyingGlass size={15} /><input aria-label="Search canonical tasks" placeholder="Search tasks" style={styles.input} value={filters.query ?? ""} onChange={(event) => setFilters({ ...filters, query: event.target.value })} /></label><select aria-label="Filter task status" style={styles.select} value={filters.status ?? ""} onChange={(event) => setFilters({ ...filters, status: (event.target.value || undefined) as CanonicalTaskStatus | undefined })}><option value="">All statuses</option>{BOARD_STATUSES.map((status) => <option key={status}>{status}</option>)}</select><select aria-label="Filter task type" style={styles.select} value={filters.type ?? ""} onChange={(event) => setFilters({ ...filters, type: (event.target.value || undefined) as CanonicalTaskFilters["type"] })}><option value="">All types</option>{["TASK", "BUG", "FEATURE", "INQUIRY", "ISSUE"].map((type) => <option key={type}>{type}</option>)}</select><label style={{ display: "inline-flex", gap: 5, alignItems: "center", fontSize: 12 }}><input type="checkbox" checked={filters.showDone !== false} onChange={(event) => setFilters({ ...filters, showDone: event.target.checked })} /> Done</label><button type="button" style={styles.button} onClick={() => void refresh()} aria-label="Refresh canonical tasks"><ArrowsClockwise size={14} /> Refresh</button></div>
    {error && <div role="alert" style={{ padding: "10px 14px", color: "var(--accent-danger)" }}>{error}</div>}{authorityError && <div role="alert" style={{ padding: "10px 14px", color: "var(--accent-danger)" }}>{authorityError}</div>}{mutationError && <div role="alert" style={{ padding: "10px 14px", color: "var(--accent-danger)" }}>{mutationError}</div>}
    {loading ? <div style={{ padding: 20 }}>Reading canonical tasks…</div> : <div style={{ display: "flex", flex: 1, minHeight: 0 }}><div style={styles.board}>{BOARD_STATUSES.map((status) => <div key={status} style={styles.column} aria-label={`${status} tasks`}><div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 500 }}><span>{status}</span><span style={{ color: "var(--text-secondary)" }}>{grouped[status].length}</span></div>{grouped[status].map((task) => <TaskCard key={task.id} task={task} onSelect={() => setSelected(task)} />)}</div>)}</div>{selected && <TaskDetail task={selected} onClose={() => setSelected(null)} onStatus={(status) => void updateStatus(status)} />}</div>}
  </section>;
}
