import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft } from "@phosphor-icons/react";
import { invoke } from "@tauri-apps/api/core";
import { useWorkspaceStore } from "../stores/workspace";
import { inferAgentWorkstream, summarizeGitMonitoring, type GitMonitorAgent, type GitMonitorGitFacts, type GitMonitorHealth, type GitMonitorProject } from "../lib/gitMonitoring";

const healthCopy: Record<GitMonitorHealth, { label: string; detail: string; color: string }> = {
  "under-control": { label: "No action needed", detail: "Agents are working normally. Nothing needs your attention right now.", color: "var(--accent-positive, #5fb878)" },
  "decision-ready": { label: "Ready to save", detail: "An agent finished clean work. Review it, then save it into the project.", color: "var(--accent-primary, #d99a45)" },
  "agent-help": { label: "Needs your decision", detail: "An agent is blocked. Open the work below to see the question and choose what happens next.", color: "var(--accent-danger, #d96b6b)" },
  checking: { label: "Checking project status", detail: "The monitor is confirming the projects before offering decisions.", color: "var(--accent-primary, #d99a45)" },
};

function StatusPill({ health }: { health: GitMonitorHealth }) {
  const copy = healthCopy[health];
  return <span style={{ ...styles.statusPill, color: copy.color, borderColor: `${copy.color}66` }}><span style={{ ...styles.statusDot, background: copy.color }} />{copy.label}</span>;
}

function Count({ value, label }: { value: number; label: string }) {
  return <span style={styles.count}><strong>{value}</strong> {label}</span>;
}

function AgentRow({ agent, onCombine, onOpen, combineRequested }: { agent: GitMonitorAgent; onCombine: (agent: GitMonitorAgent) => void; onOpen: (agent: GitMonitorAgent) => void; combineRequested: boolean }) {
  const agentName = /^terminal$/i.test(agent.tab.title.trim()) ? `${agent.workstream.provider ?? "Agent"} agent` : agent.tab.title;
  const goal = agent.goal === agent.tab.title ? "Working on this project" : agent.goal;
  return (
    <div className="git-monitor-agent-row" style={styles.agentRow} data-testid="git-monitor-agent">
      <button type="button" style={styles.agentMain} onClick={() => onOpen(agent)}>
        <div style={styles.agentTitleLine}><span style={styles.agentName}>{agentName}</span><StatusPill health={agent.health} /></div>
        <div style={styles.goal}>{goal}</div>
        <div style={styles.progress}>{agent.progress}</div>
        <div style={styles.agentMeta}>
          <span>{agent.worktree ? "Separate work area" : "Shared project area"}</span>
          {agent.dirty === true && <span style={{ color: "var(--accent-warning)" }}>Changes waiting to be saved</span>}
          {agent.gitHasConflicts === true && <span style={{ color: "var(--accent-danger)" }}>Needs your decision</span>}
        </div>
      </button>
      <div style={styles.agentAction}>
        <span style={styles.nextAction}>{agent.dirty === true ? "Review this work before saving" : agent.needsAgentHelp ? "Open this work to decide what happens next" : agent.nextAction === "Agent is handling the next step" ? "Nothing needed from you right now" : agent.nextAction}</span>
        {agent.readyToCombine && !combineRequested && <button type="button" style={styles.primaryAction} onClick={() => onCombine(agent)}>Combine this work</button>}
        {agent.readyToCombine && combineRequested && <span style={styles.pendingAction} data-testid="git-monitor-combine-pending">{combineOutcome(agent)}</span>}
        {agent.needsAgentHelp && <button type="button" style={styles.secondaryAction} onClick={() => onOpen(agent)}>Explain and contact agent</button>}
      </div>
    </div>
  );
}

export function combineOutcome(agent: GitMonitorAgent) {
  const evidence = `${agent.workstream.outcome ?? ""} ${agent.workstream.lastSummary ?? ""} ${agent.workstream.currentActivity ?? ""}`.toLowerCase();
  if (agent.workstream.status === "failed" || evidence.includes("conflict") || evidence.includes("failed")) return "Agent reported a problem; open the agent for details.";
  if (/(merge|combine|integrat)/.test(evidence) && /(success|pass|green|done|complete)/.test(evidence)) return "The agent reported that the work was combined successfully.";
  if (agent.workstream.phase === "queued" || agent.workstream.phase === "launching" || agent.workstream.status === "running") return "Agent is working on the combination.";
  return "Agent sent an update; open the agent to review it.";
}

function ProjectRow({ project, expanded, onToggle, onCombine, onOpen, combineRequestedIds }: { project: GitMonitorProject; expanded: boolean; onToggle: () => void; onCombine: (agent: GitMonitorAgent) => void; onOpen: (agent: GitMonitorAgent) => void; combineRequestedIds: string[] }) {
  return (
    <section style={styles.project} data-testid="git-monitor-project">
      <button type="button" className="git-monitor-project-header" style={styles.projectHeader} onClick={onToggle} aria-expanded={expanded}>
        <span style={styles.chevron}>{expanded ? "▾" : "▸"}</span>
        <span style={styles.projectIdentity}><strong>{project.name}</strong><small>Project workspace</small></span>
        <StatusPill health={project.health} />
        <span className="git-monitor-project-counts" style={styles.projectCounts}><Count value={project.agents.length} label="agents" /><Count value={project.branches} label="work areas" /><Count value={project.worktrees} label="separate areas" />{project.unpublishedChanges > 0 && <Count value={project.unpublishedChanges} label="unfinished" />}</span>
      </button>
       {expanded && <div style={styles.agentList}>{project.agents.map((agent) => <AgentRow key={agent.tab.id} agent={agent} onCombine={onCombine} onOpen={onOpen} combineRequested={combineRequestedIds.includes(agent.tab.id)} />)}</div>}
    </section>
  );
}

export function GitMonitoringView() {
  const tabs = useWorkspaceStore((state) => state.tabs);
  const groups = useWorkspaceStore((state) => state.groups);
  const liveGitRoots = useWorkspaceStore((state) => state.liveGitRoots);
  const setActiveTab = useWorkspaceStore((state) => state.setActiveTab);
  const setWorkspaceMode = useWorkspaceStore((state) => state.setWorkspaceMode);
  const queueWorkstreamInput = useWorkspaceStore((state) => state.queueWorkstreamInput);
  const [gitFacts, setGitFacts] = useState<Record<string, GitMonitorGitFacts>>({});
  const [expanded, setExpanded] = useState<string[]>([]);
  const [combineRequestedIds, setCombineRequestedIds] = useState<string[]>([]);
  const [narrowViewport, setNarrowViewport] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const update = () => setNarrowViewport(media.matches || window.outerWidth <= 760);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    let disposed = false;
    const refresh = async () => {
      const entries = await Promise.all(tabs.filter((tab) => tab.workstream?.kind === "agent" || tab.terminals.some((terminal) => terminal.agentProvider || terminal.statusSummary?.provider)).map(async (tab) => {
        const cwd = tab.workstream?.worktreePath ?? tab.workstream?.cwd ?? tab.initialCwd;
        if (!cwd) return null;
        try {
          const context = await invoke<GitMonitorGitFacts>("workstream_git_context", { cwd });
          return [tab.id, {
            gitRoot: context.gitRoot,
            gitBranch: context.gitBranch,
            gitDirty: context.gitDirty,
            worktreePath: context.worktreePath ?? cwd,
            gitBranchExists: context.gitBranchExists,
            gitHasCommits: context.gitHasCommits,
            gitHasConflicts: context.gitHasConflicts,
          }] as const;
        } catch {
          return null;
        }
      }));
      const validEntries = entries.filter((entry): entry is NonNullable<typeof entry> => entry !== null);
      if (!disposed) setGitFacts(Object.fromEntries(validEntries));
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [tabs]);
  const monitoredTabs = useMemo(() => tabs.map((tab) => {
    const fact = gitFacts[tab.id];
    if (!fact) return tab;
    const terminal = tab.terminals.find((candidate) => candidate.agentProvider || candidate.statusSummary?.provider);
    const inferred = tab.workstream ?? (terminal ? inferAgentWorkstream(tab, { ...liveGitRoots, [terminal.id]: fact.gitRoot ?? liveGitRoots[terminal.id] }) : undefined);
    return inferred ? { ...tab, workstream: { ...inferred, ...fact } } : tab;
  }), [tabs, gitFacts, liveGitRoots]);
  const summary = useMemo(() => summarizeGitMonitoring(monitoredTabs, groups, liveGitRoots, gitFacts), [monitoredTabs, groups, liveGitRoots, gitFacts]);
  const recentCompletions = summary.agents.filter((agent) => agent.workstream.status === "done" || agent.workstream.phase === "complete" || agent.workstream.phase === "reviewed").slice(0, 3);

  const toggle = (id: string) => setExpanded((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const openAgent = (agent: GitMonitorAgent) => setActiveTab(agent.tab.id);
  const contactAgent = (agent: GitMonitorAgent) => {
    if (agent.readyToCombine) {
      setCombineRequestedIds((current) => current.includes(agent.tab.id) ? current : [...current, agent.tab.id]);
    }
    queueWorkstreamInput(agent.tab.id, agent.readyToCombine
      ? "The Git monitor says your work is clean and ready. Please combine this work into the project, check for conflicts, and report whether it succeeded."
      : "The Git monitor says you need help. Please explain the issue in plain language and tell me what decision or action is needed.", { source: "operator", label: agent.readyToCombine ? "Combine this work" : "Agent needs help" });
    setActiveTab(agent.tab.id);
  };

  const content = (
    <main className={`git-monitor-shell${narrowViewport ? " git-monitor-narrow" : ""}`} style={styles.shell} data-testid="git-monitor-view" aria-label="Git work monitor">
      <style>{responsiveStyles}</style>
      <div style={styles.navigation}>
        <button type="button" style={styles.backButton} onClick={() => setWorkspaceMode("split")} aria-label="Back to cockpit">
          <ArrowLeft size={15} weight="bold" />
          <span>Back to cockpit</span>
        </button>
        <span style={styles.navigationContext}>Git work monitor</span>
      </div>
      <header className="git-monitor-hero" style={styles.hero}>
        <div><div style={styles.eyebrow}>Work monitor</div><h1 style={styles.title}>{healthCopy[summary.health].label}</h1><p style={styles.detail}>{summary.agents.length ? healthCopy[summary.health].detail : "No agent work is being tracked yet."}</p></div>
        <div className="git-monitor-hero-counts" style={styles.heroCounts}><Count value={summary.projects.length} label="projects" /><Count value={summary.agents.length} label="agents" /><Count value={summary.branches} label="work areas" /><Count value={summary.worktrees} label="separate areas" />{summary.unpublishedChanges > 0 && <Count value={summary.unpublishedChanges} label="unfinished" />}</div>
      </header>
      {summary.gitFactsPending > 0 && <div style={styles.callout} data-testid="git-monitor-facts-pending"><strong>Git status is still loading for {summary.gitFactsPending} agent{summary.gitFactsPending === 1 ? "" : "s"}.</strong><span>The monitor will show combine decisions only after the project facts are confirmed.</span></div>}
      {summary.needsAttention > 0 && <div style={styles.callout} data-testid="git-monitor-decision-callout"><strong>{summary.needsAttention} decision{summary.needsAttention === 1 ? "" : "s"} need your attention.</strong><span>Open the project below to understand the next safe action.</span></div>}
      <div style={styles.projectList}>{summary.projects.length ? summary.projects.map((project) => <ProjectRow key={project.id} project={project} expanded={expanded.includes(project.id)} onToggle={() => toggle(project.id)} onCombine={contactAgent} onOpen={openAgent} combineRequestedIds={combineRequestedIds} />) : <div style={styles.empty}><strong>Nothing needs your attention.</strong><span>When agents start work, each project will appear here with a simple status.</span></div>}</div>
      {recentCompletions.length > 0 && <div style={styles.history} data-testid="git-monitor-history"><strong>Recently completed</strong><span>{recentCompletions.map((agent) => agent.tab.title).join(" · ")}</span></div>}
      <footer style={styles.footer}>This view keeps the technical work in the background and brings decisions forward.</footer>
    </main>
  );
  return typeof document !== "undefined" ? createPortal(content, document.body) : content;
}

const styles: Record<string, CSSProperties> = {
  shell: { width: "100%", height: "100%", overflow: "auto", padding: "24px clamp(20px, 4vw, 56px) 36px", background: "var(--surface-sunken)", color: "var(--text-primary)" },
  navigation: { display: "flex", alignItems: "center", gap: 12, maxWidth: 1080, margin: "0 auto 34px" },
  backButton: { display: "inline-flex", alignItems: "center", gap: 8, border: 0, borderRadius: 8, padding: "8px 10px", background: "var(--surface-raised)", color: "var(--text-primary)", font: "inherit", fontSize: 12, cursor: "pointer" },
  navigationContext: { color: "var(--text-tertiary)", fontSize: 11 },
  hero: { display: "flex", justifyContent: "space-between", gap: 32, alignItems: "flex-end", maxWidth: 1080, margin: "0 auto 26px" },
  eyebrow: { fontSize: 11, textTransform: "uppercase", color: "var(--text-tertiary)" },
  title: { margin: "7px 0 6px", fontSize: "clamp(28px, 4vw, 44px)", fontWeight: 400 },
  detail: { margin: 0, color: "var(--text-secondary)", fontSize: 14 },
  heroCounts: { display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 8, maxWidth: 420 },
  count: { color: "var(--text-secondary)", fontSize: 12, whiteSpace: "nowrap" },
  statusPill: { display: "inline-flex", alignItems: "center", gap: 6, border: "1px solid", borderRadius: 999, padding: "5px 9px", fontSize: 11, whiteSpace: "nowrap" },
  statusDot: { width: 7, height: 7, borderRadius: "50%" },
  callout: { display: "flex", flexWrap: "wrap", gap: 10, maxWidth: 1080, margin: "0 auto 18px", padding: "14px 16px", borderRadius: 8, background: "var(--surface-raised)", color: "var(--text-secondary)", fontSize: 13 },
  projectList: { maxWidth: 1080, margin: "0 auto", display: "grid", gap: 10 },
  project: { borderTop: "1px solid var(--border-subtle, rgba(255,255,255,0.1))", background: "var(--surface-raised)", borderRadius: 12, overflow: "hidden" },
  projectHeader: { width: "100%", display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: 10, padding: "16px 18px", border: 0, background: "transparent", color: "inherit", textAlign: "left", cursor: "pointer", font: "inherit" },
  chevron: { width: 14, color: "var(--text-tertiary)" },
  projectIdentity: { display: "grid", gap: 4, flex: "1 1 180px", minWidth: 0 },
  projectCounts: { display: "flex", flex: "1 1 100%", gap: 14, flexWrap: "wrap", justifyContent: "flex-start", paddingLeft: 28 },
  agentList: { borderTop: "1px solid var(--border-subtle, rgba(255,255,255,0.1))", padding: "4px 18px 14px" },
  agentRow: { display: "grid", gridTemplateColumns: "minmax(0, 1.4fr) minmax(220px, 0.8fr)", gap: 22, padding: "18px 0", borderBottom: "1px solid var(--border-subtle, rgba(255,255,255,0.08))" },
  agentMain: { border: 0, padding: 0, background: "transparent", color: "inherit", textAlign: "left", cursor: "pointer", font: "inherit", minWidth: 0 },
  agentTitleLine: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" },
  agentName: { fontSize: 15, fontWeight: 500 },
  goal: { marginTop: 9, fontSize: 14 },
  progress: { marginTop: 5, color: "var(--text-secondary)", fontSize: 12 },
  agentMeta: { display: "flex", gap: 12, flexWrap: "wrap", marginTop: 12, color: "var(--text-tertiary)", fontSize: 11 },
  agentAction: { display: "flex", flexDirection: "column", alignItems: "flex-start", justifyContent: "center", gap: 10 },
  nextAction: { color: "var(--text-secondary)", fontSize: 12 },
  pendingAction: { color: "var(--text-secondary)", fontSize: 12 },
  primaryAction: { border: 0, borderRadius: 7, padding: "9px 12px", background: "var(--accent-primary, #d99a45)", color: "#171717", font: "inherit", fontSize: 12, fontWeight: 500, cursor: "pointer" },
  secondaryAction: { border: 0, boxShadow: "inset 0 -1px 0 var(--accent-danger, #d96b6b)", borderRadius: 7, padding: "8px 11px", background: "transparent", color: "var(--accent-danger, #d96b6b)", font: "inherit", fontSize: 12, cursor: "pointer" },
  empty: { display: "grid", gap: 7, padding: "36px 20px", textAlign: "center", color: "var(--text-secondary)" },
  history: { maxWidth: 1080, margin: "20px auto 0", display: "flex", flexWrap: "wrap", gap: 10, color: "var(--text-secondary)", fontSize: 12 },
  footer: { maxWidth: 1080, margin: "22px auto 0", color: "var(--text-tertiary)", fontSize: 11 },
};

const responsiveStyles = `
  .git-monitor-shell.git-monitor-narrow { width: 100%; height: 100%; display: block !important; overflow: auto; padding: 18px 16px 24px !important; background: var(--surface-sunken) !important; }
  .git-monitor-shell.git-monitor-narrow .git-monitor-project-header { flex-wrap: wrap; align-items: flex-start; gap: 10px; }
  .git-monitor-shell.git-monitor-narrow .git-monitor-project-counts { width: 100%; justify-content: flex-start; padding-left: 28px; }
  @media (max-width: 760px) {
    .git-monitor-shell { width: 100%; height: 100%; display: block !important; overflow: auto; padding: 18px 16px 24px !important; background: var(--surface-sunken) !important; }
    .git-monitor-hero { flex-direction: column; align-items: flex-start !important; gap: 18px !important; }
    .git-monitor-hero-counts { justify-content: flex-start !important; max-width: none !important; }
    .git-monitor-agent-row { grid-template-columns: 1fr !important; gap: 12px !important; }
    .git-monitor-project-header { flex-wrap: wrap; align-items: flex-start; gap: 10px; }
    .git-monitor-project-counts { width: 100%; justify-content: flex-start; padding-left: 28px; }
  }
`;
