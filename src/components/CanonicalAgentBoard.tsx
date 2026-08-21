import { useEffect, useMemo, useState } from "react";
import { ArrowsClockwise, Kanban, MagnifyingGlass, X } from "@phosphor-icons/react";
import {
  BOARD_STATUSES,
  filterCanonicalTasks,
  groupCanonicalTasks,
  readCanonicalAuthority,
  taskDescriptionSummary,
  taskProjectLabel,
  transitionCanonicalTask,
  type CanonicalTask,
  type CanonicalTaskFilters,
  type CanonicalTaskStatus,
} from "../lib/canonicalAgentBoard";
import { useCanonicalTasks } from "../hooks/useCanonicalTasks";

const styles = {
  shell: { height: "100%", display: "flex", flexDirection: "column" as const, minWidth: 0, background: "var(--surface-base)" },
  toolbar: { display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 12, alignItems: "center", padding: "16px 18px 12px", borderBottom: "1px solid var(--border-subtle)" },
  controls: { display: "flex", gap: 8, alignItems: "center", padding: "0 18px 12px", flexWrap: "wrap" as const },
  input: { flex: 1, minWidth: 220, height: 34, border: "none", borderRadius: 6, background: "var(--surface-sunken)", color: "var(--text-primary)", padding: "0 10px", boxShadow: "inset 0 0 0 1px var(--border-subtle)" },
  select: { height: 34, border: "none", borderRadius: 6, background: "var(--surface-sunken)", color: "var(--text-primary)", padding: "0 8px" },
  button: { height: 34, display: "inline-flex", alignItems: "center", gap: 6, border: "none", borderRadius: 6, background: "var(--surface-raised)", color: "var(--text-primary)", padding: "0 10px", cursor: "pointer" },
  board: { flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "repeat(6, minmax(170px, 1fr))", gap: 8, padding: "4px 18px 18px", overflow: "auto" },
  column: { minWidth: 170, display: "flex", flexDirection: "column" as const, gap: 7, padding: "9px 7px", background: "var(--surface-sunken)" },
  card: { display: "grid", gap: 8, padding: "11px 10px", border: "none", borderRadius: 7, background: "var(--surface-raised)", color: "var(--text-primary)", cursor: "pointer", textAlign: "start" as const },
};

function displayStatus(status: CanonicalTaskStatus): string {
  return status.toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function TaskCard({ task, onSelect }: { task: CanonicalTask; onSelect: () => void }) {
  return <button type="button" style={styles.card} aria-label={`Open ${task.id}: ${task.title}`} onClick={onSelect}>
    <strong style={{ fontSize: 14, lineHeight: 1.25, fontWeight: 500 }}>{task.title}</strong>
    <span style={{ color: "var(--text-primary)", fontSize: 12 }}>Project: {taskProjectLabel(task)}</span>
    <span style={{ color: "var(--text-secondary)", fontSize: 11 }}>Assigned to: {task.owner || "No one yet"}</span>
  </button>;
}

function TaskDetail({ task, onClose, onStatus }: { task: CanonicalTask; onClose: () => void; onStatus: (status: CanonicalTaskStatus) => void }) {
  return <aside aria-label={`Details for ${task.id}`} style={{ position: "absolute", zIndex: 2, right: 0, top: 0, bottom: 0, width: "min(300px, 100%)", minWidth: 0, padding: "18px 16px", borderLeft: "1px solid var(--border-subtle)", overflow: "auto", background: "var(--surface-raised)", boxShadow: "-12px 0 30px rgba(0, 0, 0, 0.18)" }}>
    <button type="button" style={{ ...styles.button, float: "right" }} aria-label="Close task details" onClick={onClose}><X size={14} /></button>
    <div style={{ color: "var(--text-secondary)", fontSize: 12 }}>Task details</div>
    <h2 style={{ fontSize: 20, lineHeight: 1.2, margin: "8px 28px 18px 0" }}>{task.title}</h2>
    <div style={{ display: "grid", gap: 12, marginBottom: 18 }}>
      <div><div style={{ color: "var(--text-secondary)", fontSize: 11 }}>Project</div><strong>{taskProjectLabel(task)}</strong></div>
      <div><div style={{ color: "var(--text-secondary)", fontSize: 11 }}>Assigned to</div><strong>{task.owner || "No one yet"}</strong></div>
      <label style={{ display: "grid", gap: 5, fontSize: 11, color: "var(--text-secondary)" }}>Status
        <select aria-label="Task status" style={styles.select} value={task.status} onChange={(event) => onStatus(event.target.value as CanonicalTaskStatus)}>{BOARD_STATUSES.map((status) => <option key={status} value={status}>{displayStatus(status)}</option>)}</select>
      </label>
    </div>
    <p style={{ margin: "0 0 18px", lineHeight: 1.45, color: "var(--text-primary)" }}>{taskDescriptionSummary(task.description)}</p>
    <details>
      <summary style={{ cursor: "pointer", fontSize: 13 }}>What success looks like</summary>
      <ul style={{ paddingLeft: 18, lineHeight: 1.45 }}>{task.acceptance.length ? task.acceptance.map((item) => <li key={item.text}>{item.complete ? "Done: " : "Next: "}{taskDescriptionSummary(item.text)}</li>) : <li>No success criteria recorded</li>}</ul>
    </details>
    <details style={{ marginTop: 12 }}>
      <summary style={{ cursor: "pointer", fontSize: 13 }}>Recent updates ({task.progress.length})</summary>
      <ul style={{ paddingLeft: 18, lineHeight: 1.45 }}>{task.progress.length ? task.progress.slice(-3).map((item, index) => <li key={`${item.text}-${index}`}>{taskDescriptionSummary(item.text)}</li>) : <li>No updates yet</li>}</ul>
    </details>
    <details style={{ marginTop: 12 }}>
      <summary style={{ cursor: "pointer", fontSize: 13 }}>More context</summary>
      <dl style={{ display: "grid", gap: 8, fontSize: 12 }}>
        <div><dt style={{ color: "var(--text-secondary)" }}>Reference</dt><dd>{task.id} · {task.type} · priority {task.priority}</dd></div>
        <div><dt style={{ color: "var(--text-secondary)" }}>Workspace</dt><dd style={{ overflowWrap: "anywhere" }}>{task.workspace || "Not assigned"}</dd></div>
        <div><dt style={{ color: "var(--text-secondary)" }}>Dependencies</dt><dd>{task.dependencies.join(", ") || "None"}</dd></div>
        <div><dt style={{ color: "var(--text-secondary)" }}>Source</dt><dd style={{ overflowWrap: "anywhere" }}>{task.source || "Not recorded"}</dd></div>
      </dl>
    </details>
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
  const doneCount = tasks.filter((task) => task.status === "DONE").length;
  const activeCount = tasks.filter((task) => task.status === "IN PROGRESS").length;
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
    void readCanonicalAuthority().then(setAuthority).catch((cause) => setAuthorityError(cause instanceof Error ? cause.message : "Canonical authority verification failed"));
  }, []);
  return <section style={styles.shell} aria-label="Canonical task board" data-testid="canonical-agent-board">
    <div className="canonical-board-toolbar" style={styles.toolbar}>
      <strong style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 16 }}><Kanban size={18} /> Shared tasks</strong>
      <span style={{ color: "var(--text-secondary)", fontSize: 12 }}>See what needs attention and which project it belongs to · {tasks.length} total · {activeCount} active · {doneCount} done</span>
      <span aria-label="Canonical source" title={authority?.source ?? authorityError ?? "Verifying canonical source"} style={{ color: authority ? "var(--text-secondary)" : "var(--accent-danger)", fontSize: 11 }}>{authority ? "Shared queue verified" : authorityError ?? "Verifying shared queue…"}</span>
    </div>
    <div style={styles.controls}>
      <label style={{ display: "flex", alignItems: "center", gap: 6, flex: 1 }}><MagnifyingGlass size={15} /><input aria-label="Search canonical tasks" placeholder="Find a task by name or project" style={styles.input} value={filters.query ?? ""} onChange={(event) => setFilters({ ...filters, query: event.target.value })} /></label>
      <select aria-label="Filter task status" style={styles.select} value={filters.status ?? ""} onChange={(event) => setFilters({ ...filters, status: (event.target.value || undefined) as CanonicalTaskStatus | undefined })}><option value="">All statuses</option>{BOARD_STATUSES.map((status) => <option key={status}>{status}</option>)}</select>
      <select aria-label="Filter task type" style={styles.select} value={filters.type ?? ""} onChange={(event) => setFilters({ ...filters, type: (event.target.value || undefined) as CanonicalTaskFilters["type"] })}><option value="">All types</option>{["TASK", "BUG", "FEATURE", "INQUIRY", "ISSUE"].map((type) => <option key={type}>{type}</option>)}</select>
      <label style={{ display: "inline-flex", gap: 5, alignItems: "center", fontSize: 12 }}><input type="checkbox" checked={filters.showDone !== false} onChange={(event) => setFilters({ ...filters, showDone: event.target.checked })} /> Show done</label>
      <button type="button" style={styles.button} onClick={() => void refresh()} aria-label="Refresh canonical tasks"><ArrowsClockwise size={14} /> Refresh</button>
    </div>
    {error && <div role="alert" style={{ padding: "8px 18px", color: "var(--accent-danger)" }}>{error}</div>}
    {authorityError && <div role="alert" style={{ padding: "8px 18px", color: "var(--accent-danger)" }}>{authorityError}</div>}
    {mutationError && <div role="alert" style={{ padding: "8px 18px", color: "var(--accent-danger)" }}>{mutationError}</div>}
    {loading ? <div style={{ padding: 20 }}>Reading shared tasks…</div> : <div className="canonical-board-main" style={{ position: "relative", display: "flex", flex: 1, minHeight: 0 }}><div className="canonical-board-columns" style={styles.board}>{BOARD_STATUSES.map((status) => <div key={status} style={styles.column} aria-label={`${displayStatus(status)} tasks`}><div style={{ display: "flex", justifyContent: "space-between", padding: "0 3px 3px", fontSize: 12, fontWeight: 500 }}><span>{displayStatus(status)}</span><span style={{ color: "var(--text-secondary)" }}>{grouped[status].length}</span></div>{grouped[status].map((task) => <TaskCard key={task.id} task={task} onSelect={() => setSelected(task)} />)}</div>)}</div>{selected && <TaskDetail task={selected} onClose={() => setSelected(null)} onStatus={(status) => void updateStatus(status)} />}</div>}
    <style>{`@media (max-width: 1100px) { .canonical-board-toolbar { grid-template-columns: 1fr !important; gap: 6px !important; } .canonical-board-columns { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; overflow-y: auto !important; } } @media (max-width: 720px) { .canonical-board-columns { grid-template-columns: 1fr !important; } }`}</style>
  </section>;
}
