import { useEffect, useMemo, useState } from "react";
import { ArrowsClockwise, Check, Eye, Funnel, Kanban, MagnifyingGlass, Play, Warning, X } from "@phosphor-icons/react";
import {
  BOARD_STATUSES,
  filterCanonicalTasks,
  groupCanonicalTasks,
  readCanonicalAuthority,
  taskAttentionLane,
  taskDescriptionSummary,
  taskProjectLabel,
  transitionCanonicalTask,
  claimCanonicalTask,
  type CanonicalTask,
  type CanonicalTaskFilters,
  type CanonicalTaskStatus,
} from "../lib/canonicalAgentBoard";
import { useCanonicalTasks } from "../hooks/useCanonicalTasks";
import { acceptanceProgress, classifyTaskRun, lifecycleProgress, linkedTaskRun, readTaskRunRegistry, readTaskRunRegistryAsync, requestTaskRunStopAsync, taskRunLabel, type TaskRunRecord } from "../lib/canonicalTaskRuntime";
import { checkAgentProvider } from "../lib/agentProviders";
import { createAgentWorkstream, createAgentWorkstreamRunId, currentAgentWorkstreamCwd } from "../stores/workspace";
import { promptWorkstreamIsolation, promptWorkstreamLaunchProfile, resolveWorkstreamOpsContext } from "../lib/workstreamOpsContext";

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

const ATTENTION_GROUPS = [
  { label: "Decide", hint: "Needs sorting or a start", statuses: ["TRIAGE", "PLANNED"] as CanonicalTaskStatus[] },
  { label: "Working", hint: "In motion or awaiting review", statuses: ["IN PROGRESS", "REVIEW"] as CanonicalTaskStatus[] },
  { label: "Needs attention", hint: "Blocked or waiting for help", statuses: ["BLOCKED"] as CanonicalTaskStatus[] },
] as const;

function attentionLabel(task: CanonicalTask, health: string, showAttention: boolean): string {
  if (showAttention && taskAttentionLane(task, health) === "needs-attention" && task.status === "IN PROGRESS") return "Needs attention · execution is not live";
  if (!task.owner || task.owner === "unassigned") return "Needs an owner";
  if (task.status === "BLOCKED") return "Blocked";
  if (task.status === "REVIEW") return "Waiting for review";
  if (task.status === "PLANNED") return "Ready to start";
  if (task.status === "TRIAGE") return "Needs sorting";
  return "In progress";
}

function TaskCard({ task, onSelect, showAttention, runs }: { task: CanonicalTask; onSelect: () => void; showAttention: boolean; runs: TaskRunRecord[] }) {
  const taskRuns = runs.filter((item) => item.taskId === task.id);
  const run = linkedTaskRun(taskRuns, task.liveExecutionHandle);
  const health = classifyTaskRun(run, Date.now(), task.liveExecutionHandle);
  const lifecycle = lifecycleProgress(task.status);
  const acceptance = acceptanceProgress(task.acceptance);
  const statusIcon = task.status === "DONE" ? <Check size={12} /> : health === "running-and-progressing" ? <Play size={12} weight="fill" /> : taskAttentionLane(task, health) === "needs-attention" ? <Warning size={12} /> : <Eye size={12} />;
  return <button type="button" className="canonical-task-row" data-status={task.status.toLowerCase().replace(/\s+/g, "-")} aria-label={`Open ${task.id}: ${task.title}`} onClick={onSelect}>
    <span className="canonical-task-row-top"><span className="canonical-task-id">{statusIcon}{task.id}</span><span className="canonical-task-status">{displayStatus(task.status)}</span></span>
    <strong className="canonical-task-title">{task.title}</strong>
    <span className="canonical-task-project"><Funnel size={11} />{taskProjectLabel(task)}</span>
    <span className="canonical-task-summary">{taskDescriptionSummary(task.description)}</span>
    <span className="canonical-task-meta"><span>{attentionLabel(task, health, showAttention)}</span><span className={health === "running-and-progressing" ? "is-live" : ""}>{taskRunLabel(health)}</span><span>{task.owner || "No one yet"}</span></span>
    <span role="progressbar" className="canonical-task-progress" aria-label={`${task.id} lifecycle progress`} aria-valuetext={`${lifecycle.current}; next ${lifecycle.next ?? "none"}; ${acceptance.label}`}><span style={{ width: `${Math.round((lifecycle.completed.length + (lifecycle.current === "DONE" ? 1 : 0)) / 5 * 100)}%` }} /><em>{lifecycle.current} · {acceptance.label}</em></span>
  </button>;
}

function TaskDetail({ task, runs, onClose, onStatus, onRefresh, onLaunch }: { task: CanonicalTask; runs: TaskRunRecord[]; onClose: () => void; onStatus: (status: CanonicalTaskStatus) => void; onRefresh: () => void; onLaunch: () => void }) {
  const taskRuns = runs.filter((item) => item.taskId === task.id);
  const run = linkedTaskRun(taskRuns, task.liveExecutionHandle);
  const health = classifyTaskRun(run, Date.now(), task.liveExecutionHandle);
  const lifecycle = lifecycleProgress(task.status);
  const acceptance = acceptanceProgress(task.acceptance);
  const stop = () => {
    if (!window.confirm("Request a safe stop for this linked run?")) return;
    void requestTaskRunStopAsync(task.id).then(onRefresh);
  };
  return <aside className="canonical-task-detail" aria-label={`Details for ${task.id}`} style={{ position: "absolute", zIndex: 2, right: 0, top: 0, bottom: 0, width: "min(300px, 100%)", minWidth: 0, padding: "18px 16px", borderLeft: "1px solid var(--border-subtle)", overflow: "auto", background: "var(--surface-raised)", boxShadow: "-12px 0 30px rgba(0, 0, 0, 0.18)" }}>
    <button type="button" style={{ ...styles.button, float: "right" }} aria-label="Close task details" onClick={onClose}><X size={14} /></button>
    <div className="canonical-detail-kicker"><Eye size={13} />Task details</div>
    <h2 className="canonical-detail-title" style={{ fontSize: 20, lineHeight: 1.2, margin: "8px 28px 18px 0" }}>{task.title}</h2>
    <div style={{ display: "grid", gap: 12, marginBottom: 18 }}>
      <div><div style={{ color: "var(--text-secondary)", fontSize: 11 }}>Project</div><strong>{taskProjectLabel(task)}</strong></div>
      <div><div style={{ color: "var(--text-secondary)", fontSize: 11 }}>Workflow status</div><strong>{displayStatus(task.status)}</strong></div>
      <div><div style={{ color: "var(--text-secondary)", fontSize: 11 }}>Claim / owner</div><strong>{task.owner || "No one yet"}</strong></div>
      <div><div style={{ color: "var(--text-secondary)", fontSize: 11 }}>Live execution</div><strong aria-label="Live execution state">{taskRunLabel(health)}</strong></div>
      <div aria-label="Canonical lifecycle progress"><div style={{ display: "flex", justifyContent: "space-between", color: "var(--text-secondary)", fontSize: 11 }}><span>Lifecycle</span><span>{lifecycle.current}</span></div><div role="progressbar" aria-label="Canonical lifecycle progress" aria-valuetext={`${lifecycle.current}; completed ${lifecycle.completed.join(", ") || "none"}; next ${lifecycle.next ?? "none"}`} style={{ display: "flex", gap: 3, marginTop: 5 }}>{["TRIAGE", "PLANNED", "IN PROGRESS", "REVIEW", "DONE"].map((stage) => <span key={stage} title={stage} style={{ height: 6, flex: 1, background: lifecycle.completed.includes(stage) || lifecycle.current === stage ? "var(--accent-live)" : "var(--surface-sunken)" }} />)}</div><small style={{ color: "var(--text-secondary)" }}>{lifecycle.blocked ? "Blocked: resolve the interrupting dependency or blocker." : `Next: ${lifecycle.next ?? "No next stage"}`}</small></div>
      <div><div style={{ color: "var(--text-secondary)", fontSize: 11 }}>Acceptance evidence</div><strong>{acceptance.label}</strong></div>
      <label style={{ display: "grid", gap: 5, fontSize: 11, color: "var(--text-secondary)" }}>Status
        <select aria-label="Task status" style={styles.select} value={task.status} onChange={(event) => onStatus(event.target.value as CanonicalTaskStatus)}>{BOARD_STATUSES.map((status) => <option key={status} value={status}>{displayStatus(status)}</option>)}</select>
      </label>
      {task.status !== "DONE" && <button type="button" style={{ ...styles.button, justifyContent: "center", background: "var(--accent-live)", color: "var(--surface-base)" }} onClick={onLaunch}><Play size={14} weight="fill" /> Launch agent</button>}
    </div>
    {run && <section className="canonical-session-summary" aria-label="Live session progress" style={{ display: "grid", gap: 7, padding: 10, marginBottom: 14, background: "var(--surface-sunken)" }}><strong><Play size={12} weight="fill" /> Execution</strong><span>{taskRunLabel(health)} · {run.agent}</span><div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}><button type="button" style={styles.button} onClick={() => { void navigator.clipboard?.writeText(run.runId); }}>Copy ID</button><button type="button" style={styles.button} onClick={onRefresh}>Refresh</button>{["running-and-progressing", "running-but-idle", "waiting-for-input"].includes(health) && <button type="button" style={{ ...styles.button, color: "var(--accent-danger)" }} onClick={stop}>Stop</button>}</div></section>}
    {!run && <p style={{ color: "var(--text-secondary)", fontSize: 12 }}>No linked run evidence. This task is not presented as currently running.</p>}
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

function AttentionBoard({ tasks, runs, onSelect, showDone }: { tasks: CanonicalTask[]; runs: TaskRunRecord[]; onSelect: (task: CanonicalTask) => void; showDone: boolean }) {
  const groups = [...ATTENTION_GROUPS, { label: "Finished", hint: "Completed work", statuses: ["DONE"] as CanonicalTaskStatus[] }];
  return <div className="canonical-attention-grid">{groups.map((group) => {
    const groupTasks = tasks.filter((task) => taskAttentionLane(task, classifyTaskRun(linkedTaskRun(runs.filter((item) => item.taskId === task.id), task.liveExecutionHandle), Date.now(), task.liveExecutionHandle)) === group.label.toLowerCase().replace(/ /g, "-") as ReturnType<typeof taskAttentionLane>);
    const visibleTasks = group.label === "Finished" && !showDone ? [] : groupTasks;
    return <section key={group.label} className="canonical-attention-group" aria-label={`${group.label} tasks`}>
      <div className="canonical-attention-heading"><span><strong>{group.label}</strong><small>{group.hint}</small></span><span>{groupTasks.length}</span></div>
      {visibleTasks.length ? visibleTasks.map((task) => <TaskCard key={task.id} task={task} runs={runs} onSelect={() => onSelect(task)} showAttention />) : <p className="canonical-empty-group">{group.label === "Finished" && groupTasks.length ? "Turn on Finished to show completed work" : "Nothing here"}</p>}
    </section>;
  })}</div>;
}

function WorkflowBoard({ grouped, runs, onSelect }: { grouped: Record<CanonicalTaskStatus, CanonicalTask[]>; runs: TaskRunRecord[]; onSelect: (task: CanonicalTask) => void }) {
  return <div className="canonical-workflow-grid">{BOARD_STATUSES.map((status) => <section key={status} className="canonical-workflow-column" aria-label={`${displayStatus(status)} tasks`}>
    <div className="canonical-workflow-heading"><span>{displayStatus(status)}</span><span>{grouped[status].length}</span></div>
    {grouped[status].map((task) => <TaskCard key={task.id} task={task} runs={runs} onSelect={() => onSelect(task)} showAttention={false} />)}
    {!grouped[status].length && <p className="canonical-empty-group">Nothing here</p>}
  </section>)}</div>;
}

export function CanonicalAgentBoard() {
  const { tasks, setTasks, error, loading, refresh } = useCanonicalTasks();
  const [runRegistry, setRunRegistry] = useState<TaskRunRecord[]>(() => readTaskRunRegistry());
  const [filters, setFilters] = useState<CanonicalTaskFilters>({ showDone: false });
  const [viewMode, setViewMode] = useState<"attention" | "workflow">("workflow");
  const [selected, setSelected] = useState<CanonicalTask | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [authority, setAuthority] = useState<{ source: string; mutationBoundary: string } | null>(null);
  const [authorityError, setAuthorityError] = useState<string | null>(null);
  const [runRegistryUpdatedAt, setRunRegistryUpdatedAt] = useState<number | null>(null);
  const [runRegistryError, setRunRegistryError] = useState<string | null>(null);
  const visible = useMemo(() => filterCanonicalTasks(tasks, filters), [tasks, filters]);
  const grouped = useMemo(() => groupCanonicalTasks(visible), [visible]);
  const doneCount = tasks.filter((task) => task.status === "DONE").length;
  const activeCount = tasks.filter((task) => ["running-and-progressing", "running-but-idle", "waiting-for-input"].includes(classifyTaskRun(linkedTaskRun(runRegistry.filter((item) => item.taskId === task.id), task.liveExecutionHandle), Date.now(), task.liveExecutionHandle))).length;
  const linkedRunIds = new Set(tasks.map((task) => task.liveExecutionHandle).filter((runId): runId is string => Boolean(runId)));
  const liveRunCount = runRegistry.filter((run) => linkedRunIds.has(run.runId) && ["running", "starting", "waiting"].includes(run.state) && ["running-and-progressing", "running-but-idle", "waiting-for-input"].includes(classifyTaskRun(run, Date.now(), run.runId))).length;
  useEffect(() => {
    const refreshRuns = () => { void readTaskRunRegistryAsync().then((next) => { setRunRegistry(next); setRunRegistryUpdatedAt(Date.now()); setRunRegistryError(null); }).catch((cause) => setRunRegistryError(cause instanceof Error ? cause.message : "Task run registry unavailable")); };
    refreshRuns();
    const timer = window.setInterval(refreshRuns, 2_000);
    return () => window.clearInterval(timer);
  }, []);
  const updateStatus = async (status: CanonicalTaskStatus) => {
    if (!selected || status === selected.status) return;
    if (!window.confirm(`Change ${selected.id} from ${displayStatus(selected.status)} to ${displayStatus(status)}? The shared queue will be updated.`)) return;
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
  const launchTask = async () => {
    if (!selected || selected.status === "DONE") return;
    try {
      const availability = await checkAgentProvider("codex");
      const isolationMode = promptWorkstreamIsolation(availability.label);
      if (isolationMode === null) return;
      const launchProfile = promptWorkstreamLaunchProfile(availability.label);
      if (launchProfile === null) return;
      const createdAt = Date.now();
      const runId = createAgentWorkstreamRunId("codex", createdAt);
      const resolved = await resolveWorkstreamOpsContext(currentAgentWorkstreamCwd(), isolationMode, runId, createdAt);
      const claimed = await claimCanonicalTask(selected.id, "termfleet");
      createAgentWorkstream("codex", selected.title, availability, { ...resolved, canonicalTaskId: selected.id }, launchProfile);
      setTasks((current) => current.map((task) => task.id === claimed.id ? claimed : task));
      setSelected(claimed);
      setMutationError(null);
    } catch (cause) {
      setMutationError(cause instanceof Error ? cause.message : "Agent launch failed; the canonical task was not presented as running");
    }
  };
  useEffect(() => {
    void readCanonicalAuthority().then(setAuthority).catch((cause) => setAuthorityError(cause instanceof Error ? cause.message : "Canonical authority verification failed"));
  }, []);
  return <section className="canonical-agent-board" style={styles.shell} aria-label="Canonical task board" data-testid="canonical-agent-board">
    <div className="canonical-board-toolbar" style={styles.toolbar}>
      <div className="canonical-board-title"><span className="canonical-board-mark"><Kanban size={17} /></span><span><strong>Shared tasks</strong><small>One queue for work that needs a decision, a handoff, or a finish.</small></span></div>
      <div className="canonical-board-health"><span className={`canonical-live-dot ${activeCount ? "is-active" : "is-idle"}`} />{activeCount ? `${activeCount} running` : "No active runs"}<span className="canonical-health-separator" />{liveRunCount} live records<span className="canonical-health-separator" />{tasks.length} total<span className="canonical-health-separator" />{doneCount} done{runRegistryUpdatedAt && <small>Synced {Math.max(0, Math.round((Date.now() - runRegistryUpdatedAt) / 1000))}s ago</small>}</div>
      <span className="canonical-source-badge" aria-label="Canonical source" title={authority?.source ?? authorityError ?? "Verifying canonical source"}>{authority ? "Queue verified · agent-ops" : authorityError ?? "Verifying…"}</span>
    </div>
    <div className="canonical-board-controls" style={styles.controls}>
      <label className="canonical-search"><MagnifyingGlass size={15} /><input aria-label="Search canonical tasks" placeholder="Search tasks or projects" style={styles.input} value={filters.query ?? ""} onChange={(event) => setFilters({ ...filters, query: event.target.value })} /></label>
      <div className="canonical-filter-group"><select aria-label="Filter task status" style={styles.select} value={filters.status ?? ""} onChange={(event) => setFilters({ ...filters, status: (event.target.value || undefined) as CanonicalTaskStatus | undefined })}><option value="">Status: all</option>{BOARD_STATUSES.map((status) => <option key={status}>{status}</option>)}</select><select aria-label="Filter task type" style={styles.select} value={filters.type ?? ""} onChange={(event) => setFilters({ ...filters, type: (event.target.value || undefined) as CanonicalTaskFilters["type"] })}><option value="">Type: all</option>{["TASK", "BUG", "FEATURE", "INQUIRY", "ISSUE"].map((type) => <option key={type}>{type}</option>)}</select></div>
      <div className="canonical-view-switch" role="group" aria-label="Task view"><button type="button" aria-pressed={viewMode === "attention"} onClick={() => setViewMode("attention")}>Attention</button><button type="button" aria-pressed={viewMode === "workflow"} onClick={() => setViewMode("workflow")}>Workflow</button></div>
      <label className="canonical-finished-toggle"><input type="checkbox" checked={filters.showDone === true} onChange={(event) => setFilters({ ...filters, showDone: event.target.checked })} /> Finished</label>
      <button type="button" className="canonical-refresh" style={styles.button} onClick={() => void refresh()} aria-label="Refresh canonical tasks"><ArrowsClockwise size={14} /> Refresh</button>
    </div>
    {error && <div role="alert" style={{ padding: "8px 18px", color: "var(--accent-danger)" }}>{error}</div>}
    {authorityError && <div role="alert" style={{ padding: "8px 18px", color: "var(--accent-danger)" }}>{authorityError}</div>}
    {runRegistryError && <div role="alert" style={{ padding: "8px 18px", color: "var(--accent-danger)" }}>Live execution state unavailable: {runRegistryError}</div>}
    {mutationError && <div role="alert" style={{ padding: "8px 18px", color: "var(--accent-danger)" }}>{mutationError}</div>}
    {loading ? <div style={{ padding: 20 }}>Reading shared tasks…</div> : <div className="canonical-board-main" style={{ position: "relative", display: "flex", flex: 1, minHeight: 0 }}><div className="canonical-board-content">{viewMode === "attention" ? <AttentionBoard tasks={visible} runs={runRegistry} onSelect={setSelected} showDone={filters.showDone === true} /> : <WorkflowBoard grouped={grouped} runs={runRegistry} onSelect={setSelected} />}</div>{selected && <TaskDetail task={selected} runs={runRegistry} onClose={() => setSelected(null)} onStatus={(status) => void updateStatus(status)} onRefresh={() => { void readTaskRunRegistryAsync().then(setRunRegistry).catch((cause) => setRunRegistryError(cause instanceof Error ? cause.message : "Task run registry unavailable")); }} onLaunch={() => void launchTask()} />}</div>}
  <style>{`.canonical-board-content { flex: 1; min-width: 0; min-height: 0; overflow: auto; padding: 4px 18px 18px; } .canonical-attention-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; } .canonical-attention-group { min-width: 0; padding: 12px 9px; background: var(--surface-sunken); } .canonical-attention-heading, .canonical-workflow-heading { display: flex; justify-content: space-between; gap: 8px; padding: 0 3px 10px; color: var(--text-primary); font-size: 13px; } .canonical-attention-heading small { display: block; margin-top: 3px; color: var(--text-secondary); font-size: 11px; font-weight: 400; } .canonical-empty-group { margin: 4px 3px; color: var(--text-secondary); font-size: 12px; } .canonical-workflow-grid { display: grid; grid-template-columns: repeat(6, minmax(150px, 1fr)); gap: 8px; min-width: 960px; } .canonical-workflow-column { min-width: 0; padding: 9px 7px; background: var(--surface-sunken); } .canonical-view-switch { display: inline-flex; gap: 2px; padding: 2px; background: var(--surface-sunken); border-radius: 6px; } .canonical-view-switch button { border: none; border-radius: 4px; padding: 7px 9px; background: transparent; color: var(--text-secondary); cursor: pointer; font: inherit; font-size: 12px; } .canonical-view-switch button:focus-visible, .canonical-task-row:focus-visible, .canonical-board-controls input:focus-visible, .canonical-board-controls select:focus-visible { outline: 2px solid var(--accent-live); outline-offset: 2px; } .canonical-view-switch button[aria-pressed="true"] { background: var(--surface-selected); color: var(--text-primary); } .canonical-live-dot.is-idle { background: var(--text-secondary); } .canonical-board-health small { color: var(--text-secondary); font-size: 11px; } @media (max-width: 1100px) { .canonical-board-toolbar { grid-template-columns: 1fr !important; gap: 6px !important; } .canonical-attention-grid { grid-template-columns: 1fr; } } @media (max-width: 720px) { .canonical-controls { align-items: stretch; } .canonical-view-switch { width: 100%; } .canonical-view-switch button { flex: 1; } }`}</style>
  </section>;
}
