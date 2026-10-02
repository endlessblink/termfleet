import { AlertCircle, Check, ChevronDown, ChevronRight, Copy, FolderKanban, RefreshCw, Search } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useMasterPlanTasks } from "../hooks/useMasterPlanTasks";
import { taskStatusLabel, type MasterPlanTask } from "../lib/masterPlanTasks";
import type { MasterPlanTaskStatus } from "../lib/types";
import { useWorkspaceStore } from "../stores/workspace";
import { PROJECT_BOARD_HISTORY_KEY, projectShortcuts, readProjectBoardHistory, recordProjectVisit } from "../lib/projectBoardHistory";
import "./ProjectPlansBoard.css";

type ProjectTask = MasterPlanTask & { projectRoot: string };
type BoardColumn = { id: string; title: string; statuses: MasterPlanTaskStatus[]; tone: string };
const columns: BoardColumn[] = [
  { id: "todo", title: "To Do", statuses: ["todo"], tone: "#8b949e" },
  { id: "progress", title: "In Progress", statuses: ["in-progress"], tone: "#58a6ff" },
  { id: "blocked", title: "Blocked", statuses: ["blocked"], tone: "#f0883e" },
  { id: "unsorted", title: "Unsorted", statuses: ["unknown"], tone: "#8b949e" },
  { id: "done", title: "Done", statuses: ["done"], tone: "#3fb950" },
];

function projectName(root: string) { const parts = root.split("/").filter(Boolean); return parts[parts.length - 1] || root; }
function projectInitial(root: string) { return projectName(root).slice(0, 2).toUpperCase(); }
function taskStatus(task: ProjectTask) { return task.status === "in-progress" ? "In Progress" : taskStatusLabel(task.status); }
function taskType(task: ProjectTask) { return /bug/i.test(`${task.id} ${task.title}`) ? "Bugs" : /issue/i.test(`${task.id} ${task.title}`) ? "Issues" : "Tasks"; }
function taskPriority(task: ProjectTask) { return /urgent|p0|p1|high/i.test(`${task.id} ${task.title} ${task.rawStatus}`) ? "High" : /p2|medium/i.test(`${task.id} ${task.title} ${task.rawStatus}`) ? "Medium" : "Low"; }
function checklistSummary(task: ProjectTask) { const items = task.checklist ?? []; return items.length ? `${items.filter((item) => item.status === "done").length}/${items.length} checks` : "No checklist"; }
function taskDetails(task: ProjectTask) { return [`${task.id}: ${task.title}`, `Project: ${projectName(task.projectRoot)}`, `Source: ${task.projectRoot}/MASTER_PLAN.md`, `Status: ${taskStatus(task)}`, `Raw status: ${task.rawStatus}`, ...(task.checklist?.length ? ["Checklist:", ...task.checklist.map((item) => `- [${item.status === "done" ? "x" : " "}] ${item.text}`)] : [])].join("\n"); }

function TaskCard({ task }: { task: ProjectTask }) {
  const [expanded, setExpanded] = useState(false);
  const checklist = task.checklist ?? [];
  return <article className="watchpost-task-card" style={{ borderBottom: "1px solid #30363d", background: "#161b22", borderRadius: 6, padding: "13px 14px", transition: "border-color .18s, transform .18s" }}>
    <button type="button" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded} style={{ display: "block", width: "100%", border: 0, padding: 0, background: "transparent", color: "inherit", textAlign: "left", cursor: "pointer", font: "inherit" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}><span style={{ color: "#8b949e", fontSize: 11, fontFamily: "var(--font-ui)" }}>{task.id}</span>{expanded ? <ChevronDown size={14} color="#8b949e" /> : <ChevronRight size={14} color="#8b949e" />}</div>
      <strong style={{ display: "block", marginTop: 8, color: "#e6edf3", fontSize: 13, fontWeight: 500, lineHeight: 1.4 }}>{task.title}</strong>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 12, color: "#8b949e", fontSize: 11 }}><span>{projectName(task.projectRoot)}</span><span>{checklistSummary(task)}</span></div>
    </button>
    {expanded && <div style={{ borderTop: "1px solid #30363d", marginTop: 12, paddingTop: 10, color: "#c9d1d9", fontSize: 11, lineHeight: 1.55 }}><div style={{ display: "flex", justifyContent: "space-between", color: "#8b949e", marginBottom: 8 }}><span>{taskStatus(task)}</span><span>{task.rawStatus}</span></div>{checklist.length ? <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>{checklist.map((item) => <li key={item.id} style={{ display: "flex", gap: 7, alignItems: "flex-start", padding: "3px 0" }}><Check size={13} color={item.status === "done" ? "#3fb950" : "#8b949e"} /><span>{item.text}</span></li>)}</ul> : <span>Open the project plan to add acceptance checks.</span>}<button type="button" aria-label={`Copy details for ${task.id}`} onClick={() => { void navigator.clipboard?.writeText(taskDetails(task)); }} style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 12, border: 0, borderBottom: "1px solid #30363d", borderRadius: 5, padding: "6px 9px", background: "#0d1117", color: "#c9d1d9", cursor: "pointer", font: "inherit", fontSize: 11 }}><Copy size={13} /> Copy task details</button></div>}
  </article>;
}

export function ProjectPlansBoard() {
  const groups = useWorkspaceStore((state) => state.groups);
  const tabs = useWorkspaceStore((state) => state.tabs);
  const projectRoot = useWorkspaceStore((state) => state.projectRoot);
  const [history, setHistory] = useState(readProjectBoardHistory);
  const [selectedProject, setSelectedProject] = useState(() => readProjectBoardHistory().selected || projectRoot?.replace(/\/+$/, "") || "");
  const [query, setQuery] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [typeFilter, setTypeFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [sortOrder, setSortOrder] = useState("priority");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [projectQuery, setProjectQuery] = useState("");
  const [discoveredRoots, setDiscoveredRoots] = useState<string[]>([]);
  const [discoveryReady, setDiscoveryReady] = useState(false);
  const [discoveryFailed, setDiscoveryFailed] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const pickerRef = useRef<HTMLDivElement>(null);
  const pickerButtonRef = useRef<HTMLButtonElement>(null);
  const recordedProject = useRef("");

  useEffect(() => {
    let cancelled = false;
    void invoke<string[]>("fs_find_master_plan_roots").then((found) => {
      if (!cancelled) { setDiscoveredRoots(found); setDiscoveryFailed(false); }
    }).catch(() => { if (!cancelled) setDiscoveryFailed(true); })
      .finally(() => { if (!cancelled) setDiscoveryReady(true); });
    return () => { cancelled = true; };
  }, [refresh]);
  const roots = useMemo(() => [...new Set([projectRoot, ...discoveredRoots, ...groups.map((group) => group.projectRoot), ...tabs.map((tab) => tab.initialCwd)]
    .filter((root): root is string => Boolean(root?.trim())).map((root) => root.replace(/\/+$/, "")))].sort(), [discoveredRoots, groups, projectRoot, tabs]);
  const plans = useMasterPlanTasks(roots, refresh);
  const currentProject = projectRoot?.replace(/\/+$/, "") ?? "";
  const activeProject = roots.includes(selectedProject) ? selectedProject : discoveryReady
    ? roots.includes(currentProject) ? currentProject : roots[0] ?? "" : "";
  useEffect(() => {
    if (!discoveryReady || !activeProject || recordedProject.current === activeProject) return;
    recordedProject.current = activeProject;
    const next = recordProjectVisit(readProjectBoardHistory(), activeProject);
    try { localStorage.setItem(PROJECT_BOARD_HISTORY_KEY, JSON.stringify(next)); } catch { /* Shortcuts still work for this visit. */ }
    setHistory(next);
  }, [activeProject, discoveryReady]);
  useEffect(() => {
    const sync = (event: StorageEvent) => { if (event.key === PROJECT_BOARD_HISTORY_KEY) setHistory(readProjectBoardHistory()); };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  useEffect(() => {
    if (!pickerOpen) return;
    const closeOutside = (event: PointerEvent) => { if (!pickerRef.current?.contains(event.target as Node)) setPickerOpen(false); };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [pickerOpen]);
  const shortcuts = useMemo(() => projectShortcuts(history, roots), [history, roots]);
  const tasks = useMemo<ProjectTask[]>(() => (plans[activeProject] ?? []).map((task) => ({ ...task, projectRoot: activeProject })), [plans, activeProject]);
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return tasks.filter((task) => (showDone || task.status !== "done") &&
      (typeFilter === "all" || taskType(task) === typeFilter) &&
      (priorityFilter === "all" || taskPriority(task) === priorityFilter) &&
      (!needle || `${task.id} ${task.title}`.toLocaleLowerCase().includes(needle)))
      .sort((a, b) => sortOrder === "title" ? a.title.localeCompare(b.title) : sortOrder === "status" ? a.status.localeCompare(b.status) : taskPriority(a).localeCompare(taskPriority(b)));
  }, [query, showDone, sortOrder, tasks, typeFilter, priorityFilter]);
  const done = tasks.filter((task) => task.status === "done").length;
  const loading = !discoveryReady || Boolean(activeProject && !(activeProject in plans));
  const pickerRoots = roots.filter((root) => root.toLocaleLowerCase().includes(projectQuery.trim().toLocaleLowerCase()));
  const chooseProject = (root: string) => {
    setSelectedProject(root); setPickerOpen(false); setProjectQuery(""); setQuery("");
    pickerButtonRef.current?.focus();
  };
  const projectRow = (root: string) => <button type="button" key={root} className="project-board-project-row"
    aria-label={`Open ${projectName(root)}`} aria-current={root === activeProject ? "page" : undefined}
    title={root} onClick={() => chooseProject(root)}>
    <span className="project-board-monogram">{projectInitial(root)}</span>
    <span className="project-board-project-name">{projectName(root)}</span>
    <span className="project-board-project-count">{plans[root]?.length ?? "–"}</span>
  </button>;

  return <section data-testid="project-plans-board" aria-label="Project plans" className="project-board">
    <aside className="project-board-sidebar" aria-label="Project shortcuts">
      <div className="project-board-sidebar-title"><FolderKanban size={17} /> Projects</div>
      <button className="project-board-browse" type="button" onClick={() => setPickerOpen(true)}><Search size={15} /> Find a project <ChevronRight size={14} /></button>
      <section aria-label="Most used projects" className="project-board-shortcuts"><h2>Most used <span>{shortcuts.frequent.length}</span></h2>
        {shortcuts.frequent.map((item) => projectRow(item.root))}
        {!shortcuts.frequent.length && <p>Your frequently opened projects will appear here.</p>}
      </section>
      <section aria-label="Recent projects" className="project-board-shortcuts"><h2>Recent <span>{shortcuts.recent.length}</span></h2>
        {shortcuts.recent.map((item) => projectRow(item.root))}
        {!shortcuts.recent.length && <p>Open a project to start your recent list.</p>}
      </section>
      <p className="project-board-sidebar-footnote">Shortcuts update as you open projects.</p>
    </aside>
    <main className="project-board-main">
      <header className="project-board-header">
        <div className="project-board-heading">
          <p className="project-board-eyebrow">Status board</p>
          <div className="project-board-picker" ref={pickerRef} onKeyDown={(event) => {
            if (event.key === "Escape") { setPickerOpen(false); pickerButtonRef.current?.focus(); }
          }}>
            <button type="button" className="project-board-picker-trigger" ref={pickerButtonRef}
              aria-label="Choose project" aria-expanded={pickerOpen} aria-controls="project-board-picker"
              onClick={() => setPickerOpen((value) => !value)}>
              <h1>{activeProject ? projectName(activeProject) : loading ? "Finding projects…" : "Choose a project"}</h1><ChevronDown size={20} />
            </button>
            {pickerOpen && <div id="project-board-picker" role="dialog" aria-label="Project picker" className="project-board-picker-panel">
              <label className="project-board-project-search"><Search size={16} /><input autoFocus aria-label="Search projects"
                placeholder="Find a project…" value={projectQuery} onChange={(event) => setProjectQuery(event.target.value)} /></label>
              <div className="project-board-picker-list">{pickerRoots.map((root) => <button type="button" key={root}
                className="project-board-picker-option" aria-label={`Open ${projectName(root)}`} aria-current={root === activeProject ? "page" : undefined}
                onClick={() => chooseProject(root)}>
                <span className="project-board-monogram">{projectInitial(root)}</span>
                <span className="project-board-option-copy"><strong>{projectName(root)}</strong><small>{root}</small></span>
                {root === activeProject ? <Check size={16} /> : <span className="project-board-project-count">{plans[root]?.length ?? "–"}</span>}
              </button>)}
              {!pickerRoots.length && <p className="project-board-empty">No projects match. Try a different name.</p>}</div>
              <div className="project-board-picker-footer">{roots.length} projects</div>
            </div>}
          </div>
        </div>
        <div className="project-board-summary" aria-label="Project totals"><span><strong>{tasks.length}</strong> tasks</span><span>{done} completed</span>
          <span className="project-board-completion" role="progressbar" aria-label="Project completion" aria-valuemin={0} aria-valuemax={100}
            aria-valuenow={tasks.length ? Math.round(done / tasks.length * 100) : 0}><span style={{ width: `${tasks.length ? done / tasks.length * 100 : 0}%` }} /></span>
        </div>
      </header>
      <div className="project-board-toolbar">
        <label className="project-board-task-search"><Search size={16} /><input aria-label="Search project plan tasks" value={query}
          onChange={(event) => setQuery(event.target.value)} placeholder="Search this project’s tasks…" /></label>
        <details className="project-board-filters"><summary>Filters{typeFilter !== "all" || priorityFilter !== "all" ? " · active" : ""}</summary>
          <div className="project-board-filter-controls">
            <label>Type<select aria-label="Filter by type" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option value="all">All types</option><option value="Tasks">Tasks</option><option value="Bugs">Bugs</option><option value="Issues">Issues</option></select></label>
            <label>Priority<select aria-label="Filter by priority" value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}><option value="all">All priorities</option><option value="High">High</option><option value="Medium">Medium</option><option value="Low">Low</option></select></label>
            <label>Sort<select aria-label="Sort tasks" value={sortOrder} onChange={(event) => setSortOrder(event.target.value)}><option value="priority">Priority</option><option value="status">Status</option><option value="title">Title</option></select></label>
          </div>
        </details>
        <label className="project-board-show-done"><input type="checkbox" checked={showDone} onChange={(event) => setShowDone(event.target.checked)} /> Show Done</label>
        <button type="button" className="project-board-refresh" aria-label="Refresh project plans" onClick={() => setRefresh((value) => value + 1)} title="Refresh project plans"><RefreshCw size={16} /></button>
      </div>
      {discoveryFailed && <p role="status" className="project-board-notice">The project catalog could not be refreshed. Workspace projects are still available.</p>}
      {loading ? <div className="project-board-loading" role="status">Loading project tasks…</div> :
        !tasks.length ? <div className="project-board-empty-state"><AlertCircle size={22} /><h2>No readable tasks yet</h2><p>Choose another project, or add tasks to this project’s plan.</p><button type="button" onClick={() => setPickerOpen(true)}>Choose a project</button></div> :
        <div className="project-board-columns">{columns.filter((column) => showDone || column.id !== "done").map((column) => {
          const columnTasks = visible.filter((task) => column.statuses.includes(task.status));
          return <section key={column.id} aria-label={column.title} className="project-board-column">
            <h2><span className="project-board-status-dot" style={{ background: column.tone }} /><span>{column.title}</span><span className="project-board-column-count">{columnTasks.length}</span></h2>
            <div className="project-board-cards">{columnTasks.map((task) => <TaskCard key={task.id} task={task} />)}
              {!columnTasks.length && <p className="project-board-empty">{query || typeFilter !== "all" || priorityFilter !== "all" ? "No matching tasks" : "No tasks"}</p>}</div>
          </section>;
        })}</div>}
    </main>
  </section>;
}
