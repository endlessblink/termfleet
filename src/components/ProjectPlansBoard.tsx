import { AlertCircle, Check, ChevronDown, ChevronRight, Copy, FolderKanban, RefreshCw, Search } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useMasterPlanTasks } from "../hooks/useMasterPlanTasks";
import { taskStatusLabel, type MasterPlanTask } from "../lib/masterPlanTasks";
import { useWorkspaceStore } from "../stores/workspace";
import { PROJECT_BOARD_HISTORY_KEY, projectShortcuts, readProjectBoardHistory, recordProjectVisit } from "../lib/projectBoardHistory";
import { StatusDot } from "../ui";
import type { AgentState } from "../lib/agentState";
import "./ProjectPlansBoard.css";

type ProjectTask = MasterPlanTask & { projectRoot: string };

const NO_PRIORITY = "none";
const PRIORITY_LABEL: Record<string, string> = { P0: "P0 · Urgent", P1: "P1 · High", P2: "P2 · Normal", P3: "P3 · Low", P4: "P4 · Someday", [NO_PRIORITY]: "No priority set" };
const STATUS_STATE: Record<MasterPlanTask["status"], AgentState> = { "in-progress": "running", blocked: "waiting", todo: "idle", unknown: "idle", done: "done" };

function projectName(root: string) { const parts = root.split("/").filter(Boolean); return parts[parts.length - 1] || root; }
function projectInitial(root: string) { return projectName(root).slice(0, 2).toUpperCase(); }
function taskStatus(task: ProjectTask) { return task.status === "in-progress" ? "In progress" : taskStatusLabel(task.status); }
function priorityKey(task: ProjectTask) { return task.priority ?? NO_PRIORITY; }
function priorityRank(key: string) { return key === NO_PRIORITY ? 9 : Number(key.slice(1)); }
function idNumber(task: ProjectTask) { return Number(task.id.match(/(\d+)/)?.[1] ?? 0); }
function byPriorityThenId(a: ProjectTask, b: ProjectTask) {
  return priorityRank(priorityKey(a)) - priorityRank(priorityKey(b)) || idNumber(a) - idNumber(b) || a.id.localeCompare(b.id);
}
function checks(task: ProjectTask) {
  const items = task.checklist ?? [];
  return { done: items.filter((item) => item.status === "done").length, total: items.length };
}
function taskDetails(task: ProjectTask) {
  return [`${task.id}: ${task.title}`, ...(task.detail ? ["", task.detail, ""] : []), `Project: ${projectName(task.projectRoot)}`,
    `Source: ${task.projectRoot}/MASTER_PLAN.md`, `Status: ${taskStatus(task)}`, `Raw status: ${task.rawStatus}`,
    ...(task.priority ? [`Priority: ${task.priority}`] : []), ...(task.size ? [`Size: ${task.size}`] : []),
    ...(task.checklist?.length ? ["Checklist:", ...task.checklist.map((item) => `- [${item.status === "done" ? "x" : " "}] ${item.text}`)] : [])].join("\n");
}

function Meta({ task }: { task: ProjectTask }) {
  const { done, total } = checks(task);
  return <span className="pb-meta">
    {task.priority && <span className={`pb-chip pb-chip--${task.priority.toLowerCase()}`} title={PRIORITY_LABEL[task.priority]}>{task.priority}</span>}
    {task.size && <span className="pb-chip pb-chip--size" title={`Size ${task.size}`}>{task.size}</span>}
    {total > 0 && <span className="pb-checks" title={`${done} of ${total} checks done`}>
      <span className="pb-checks-bar"><span style={{ width: `${done / total * 100}%` }} /></span>{done}/{total}
    </span>}
  </span>;
}

function TaskDetail({ task }: { task: ProjectTask }) {
  const [copied, setCopied] = useState(false);
  const checklist = task.checklist ?? [];
  return <div className="pb-detail">
    {task.detail && <p className="pb-detail-text">{task.detail}</p>}
    {checklist.length > 0 && <ul className="pb-checklist">{checklist.map((item) => <li key={item.id} data-done={item.status === "done"}>
      <Check size={13} aria-hidden="true" /><span>{item.text}</span></li>)}</ul>}
    <div className="pb-detail-foot">
      <span>Plan says <q>{task.rawStatus}</q></span>
      <button type="button" aria-label={`Copy details for ${task.id}`} onClick={() => {
        void navigator.clipboard?.writeText(taskDetails(task)); setCopied(true); window.setTimeout(() => setCopied(false), 1400);
      }}>{copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy for an agent"}</button>
    </div>
  </div>;
}

/** A task you are watching right now: in progress or stuck. Roomy, full headline. */
function FocusCard({ task }: { task: ProjectTask }) {
  const [expanded, setExpanded] = useState(false);
  return <article className="watchpost-task-card pb-card" data-status={task.status} data-expanded={expanded}>
    <button type="button" className="pb-card-head" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
      <span className="pb-card-top"><StatusDot state={STATUS_STATE[task.status]} /><span className="pb-id">{task.id}</span><Meta task={task} /></span>
      <strong className="pb-card-title">{task.title}</strong>
    </button>
    {expanded && <TaskDetail task={task} />}
  </article>;
}

/** A task waiting its turn: one dense, scannable line. */
function TaskRow({ task, showPriority = true }: { task: ProjectTask; showPriority?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  return <li className="watchpost-task-card pb-row" data-status={task.status} data-expanded={expanded}>
    <button type="button" className="pb-row-head" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
      {expanded ? <ChevronDown size={14} className="pb-row-caret" /> : <ChevronRight size={14} className="pb-row-caret" />}
      <span className="pb-id">{task.id}</span>
      <span className="pb-row-title">{task.title}</span>
      <Meta task={showPriority ? task : { ...task, priority: undefined }} />
    </button>
    {expanded && <TaskDetail task={task} />}
  </li>;
}

function PriorityGroups({ tasks }: { tasks: ProjectTask[] }) {
  const groups = new Map<string, ProjectTask[]>();
  for (const task of tasks) groups.set(priorityKey(task), [...(groups.get(priorityKey(task)) ?? []), task]);
  return <>{[...groups.entries()].sort(([a], [b]) => priorityRank(a) - priorityRank(b)).map(([key, items]) =>
    <section key={key} className="pb-group" aria-label={PRIORITY_LABEL[key] ?? key}>
      <h3 data-priority={key}><span>{PRIORITY_LABEL[key] ?? key}</span><span className="pb-count">{items.length}</span></h3>
      <ul className="pb-rows">{items.map((task) => <TaskRow key={task.id} task={task} showPriority={false} />)}</ul>
    </section>)}</>;
}

export function ProjectPlansBoard() {
  const groups = useWorkspaceStore((state) => state.groups);
  const tabs = useWorkspaceStore((state) => state.tabs);
  const projectRoot = useWorkspaceStore((state) => state.projectRoot);
  const [history, setHistory] = useState(readProjectBoardHistory);
  const [selectedProject, setSelectedProject] = useState(() => readProjectBoardHistory().selected || projectRoot?.replace(/\/+$/, "") || "");
  const [query, setQuery] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [priorityFilter, setPriorityFilter] = useState("all");
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
  // The two shortcut lists used to repeat the same projects; "Most used" now shows only what Recent does not.
  const frequentOnly = shortcuts.frequent.filter((item) => !shortcuts.recent.some((recent) => recent.root === item.root));
  const tasks = useMemo<ProjectTask[]>(() => (plans[activeProject] ?? []).map((task) => ({ ...task, projectRoot: activeProject })), [plans, activeProject]);
  const matching = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return tasks.filter((task) => (priorityFilter === "all" || priorityKey(task) === priorityFilter) &&
      (!needle || `${task.id} ${task.title} ${task.detail ?? ""}`.toLocaleLowerCase().includes(needle))).sort(byPriorityThenId);
  }, [query, tasks, priorityFilter]);
  const count = (status: MasterPlanTask["status"]) => tasks.filter((task) => task.status === status).length;
  const done = count("done");
  const priorities = useMemo(() => [...new Set(tasks.filter((task) => task.status !== "done").map(priorityKey))]
    .sort((a, b) => priorityRank(a) - priorityRank(b)), [tasks]);
  const inStatus = (status: MasterPlanTask["status"]) => matching.filter((task) => task.status === status);
  const moving = inStatus("in-progress"), stuck = inStatus("blocked"), next = inStatus("todo"), unsorted = inStatus("unknown"), finished = inStatus("done");
  const filtering = Boolean(query.trim()) || priorityFilter !== "all";
  const loading = !discoveryReady || Boolean(activeProject && !(activeProject in plans));
  const pickerRoots = roots.filter((root) => root.toLocaleLowerCase().includes(projectQuery.trim().toLocaleLowerCase()));
  const chooseProject = (root: string) => {
    setSelectedProject(root); setPickerOpen(false); setProjectQuery(""); setQuery(""); setPriorityFilter("all");
    pickerButtonRef.current?.focus();
  };
  const projectRow = (root: string) => <button type="button" key={root} className="project-board-project-row"
    aria-label={`Open ${projectName(root)}`} aria-current={root === activeProject ? "page" : undefined}
    title={root} onClick={() => chooseProject(root)}>
    <span className="project-board-monogram">{projectInitial(root)}</span>
    <span className="project-board-project-name">{projectName(root)}</span>
    <span className="project-board-project-count">{plans[root]?.length ?? "–"}</span>
  </button>;
  const emptyLine = (text: string) => <p className="project-board-empty">{filtering ? "Nothing here matches your search." : text}</p>;

  return <section data-testid="project-plans-board" aria-label="Project plans" className="project-board">
    <aside className="project-board-sidebar" aria-label="Project shortcuts">
      <div className="project-board-sidebar-title"><FolderKanban size={17} /> Projects</div>
      <button className="project-board-browse" type="button" onClick={() => setPickerOpen(true)}><Search size={15} /> Find a project <ChevronRight size={14} /></button>
      <section aria-label="Recent projects" className="project-board-shortcuts"><h2>Recent</h2>
        {shortcuts.recent.map((item) => projectRow(item.root))}
        {!shortcuts.recent.length && <p>Projects you open will appear here.</p>}
      </section>
      {frequentOnly.length > 0 && <section aria-label="Most used projects" className="project-board-shortcuts"><h2>Also used often</h2>
        {frequentOnly.map((item) => projectRow(item.root))}
      </section>}
    </aside>
    <main className="project-board-main">
      <header className="project-board-header">
        <div className="project-board-heading">
          <div className="project-board-picker" ref={pickerRef} onKeyDown={(event) => {
            if (event.key === "Escape") { setPickerOpen(false); pickerButtonRef.current?.focus(); }
          }}>
            <button type="button" className="project-board-picker-trigger" ref={pickerButtonRef}
              aria-label="Choose project" aria-expanded={pickerOpen} aria-controls="project-board-picker"
              onClick={() => setPickerOpen((value) => !value)}>
              <h1>{activeProject ? projectName(activeProject) : loading ? "Finding projects…" : "Choose a project"}</h1><ChevronDown size={18} />
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
          {!loading && tasks.length > 0 && <p className="project-board-summary" aria-label="Project totals">
            <strong>{tasks.length}</strong> tasks
            <span className="pb-sep" aria-hidden="true">·</span><span data-tone="running">{count("in-progress")} in progress</span>
            <span className="pb-sep" aria-hidden="true">·</span><span data-tone={count("blocked") ? "waiting" : undefined}>{count("blocked") ? `${count("blocked")} stuck` : "nothing stuck"}</span>
            <span className="pb-sep" aria-hidden="true">·</span><span>{count("todo")} up next</span>
            <span className="pb-sep" aria-hidden="true">·</span><span>{done} done</span>
          </p>}
        </div>
        {!loading && tasks.length > 0 && <div className="project-board-progress">
          <span>{Math.round(done / tasks.length * 100)}% done</span>
          <span className="project-board-completion" role="progressbar" aria-label="Project completion" aria-valuemin={0} aria-valuemax={100}
            aria-valuenow={Math.round(done / tasks.length * 100)}><span style={{ width: `${done / tasks.length * 100}%` }} /></span>
        </div>}
      </header>
      <div className="project-board-toolbar">
        <label className="project-board-task-search"><Search size={15} /><input aria-label="Search project plan tasks" value={query}
          onChange={(event) => setQuery(event.target.value)} placeholder="Search tasks by name or ID…" /></label>
        {priorities.length > 1 && <div className="pb-segments" role="group" aria-label="Filter by priority">
          {["all", ...priorities].map((key) => <button type="button" key={key} aria-pressed={priorityFilter === key}
            onClick={() => setPriorityFilter(key)} title={key === "all" ? "Every priority" : PRIORITY_LABEL[key]}>
            {key === "all" ? "All" : key === NO_PRIORITY ? "Unset" : key}</button>)}
        </div>}
        <label className="project-board-show-done"><input type="checkbox" checked={showDone} onChange={(event) => setShowDone(event.target.checked)} /> Show Done</label>
        <button type="button" className="project-board-refresh" aria-label="Refresh project plans" onClick={() => setRefresh((value) => value + 1)} title="Reload the plan from disk"><RefreshCw size={15} /></button>
      </div>
      {discoveryFailed && <p role="status" className="project-board-notice">The project list could not be refreshed. Projects open in your workspace are still here.</p>}
      {loading ? <div className="project-board-loading" role="status">Reading the project plan…</div> :
        !tasks.length ? <div className="project-board-empty-state"><AlertCircle size={22} /><h2>No tasks in this project’s plan yet</h2><p>Pick another project, or ask an agent to add tasks to this project’s plan.</p><button type="button" onClick={() => setPickerOpen(true)}>Choose a project</button></div> :
        <div className="pb-sections">
          <section className="pb-section pb-section--now" aria-label="In Progress">
            <h2><StatusDot state="running" /><span>Working on now</span><span className="pb-count">{moving.length}</span></h2>
            {moving.length ? <div className="pb-cards">{moving.map((task) => <FocusCard key={task.id} task={task} />)}</div> : emptyLine("Nothing is in progress. Pick something from Up next.")}
          </section>
          {(stuck.length > 0 || count("blocked") > 0) && <section className="pb-section pb-section--stuck" aria-label="Blocked">
            <h2><StatusDot state="waiting" /><span>Stuck — needs a decision</span><span className="pb-count">{stuck.length}</span></h2>
            {stuck.length ? <div className="pb-cards">{stuck.map((task) => <FocusCard key={task.id} task={task} />)}</div> : emptyLine("")}
          </section>}
          <section className="pb-section" aria-label="To Do">
            <h2><StatusDot state="idle" /><span>Up next</span><span className="pb-count">{next.length}</span><small>most urgent first</small></h2>
            {next.length ? <PriorityGroups tasks={next} /> : emptyLine("Nothing waiting. The plan is clear.")}
          </section>
          {unsorted.length > 0 && <section className="pb-section pb-section--quiet" aria-label="Unsorted">
            <h2><StatusDot state="idle" /><span>No status in the plan</span><span className="pb-count">{unsorted.length}</span><small>the plan doesn’t say where these stand</small></h2>
            <ul className="pb-rows">{unsorted.map((task) => <TaskRow key={task.id} task={task} />)}</ul>
          </section>}
          {showDone && <section className="pb-section pb-section--quiet" aria-label="Done">
            <h2><StatusDot state="done" /><span>Done</span><span className="pb-count">{finished.length}</span></h2>
            {finished.length ? <ul className="pb-rows">{finished.map((task) => <TaskRow key={task.id} task={task} />)}</ul> : emptyLine("Nothing finished yet.")}
          </section>}
        </div>}
    </main>
  </section>;
}
