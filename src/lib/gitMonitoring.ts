import type { Group, Tab, TerminalState, WorkstreamMetadata } from "./types";

export type GitMonitorHealth = "under-control" | "decision-ready" | "agent-help" | "checking";

export interface GitMonitorGitFacts {
  gitRoot?: string;
  gitBranch?: string;
  gitDirty?: boolean;
  worktreePath?: string;
  gitBranchExists?: boolean;
  gitHasCommits?: boolean;
  gitHasConflicts?: boolean;
}

function gitFactsAreAvailable(facts: GitMonitorGitFacts | null | undefined) {
  return Boolean(
    facts?.gitRoot &&
      facts.gitBranch &&
      facts.gitDirty !== undefined &&
      facts.gitHasCommits !== undefined &&
      facts.gitHasConflicts !== undefined,
  );
}

export interface GitMonitorAgent {
  tab: Tab;
  workstream: WorkstreamMetadata;
  projectId: string;
  projectName: string;
  projectRoot?: string;
  branch?: string;
  worktree?: string;
  dirty: boolean | undefined;
  goal: string;
  progress: string;
  nextAction: string;
  why: string;
  health: GitMonitorHealth;
  readyToCombine: boolean;
  needsAgentHelp: boolean;
  gitFactsAvailable: boolean;
  gitHasConflicts?: boolean;
}

export interface GitMonitorProject {
  id: string;
  name: string;
  root?: string;
  agents: GitMonitorAgent[];
  branches: number;
  worktrees: number;
  needsAttention: number;
  health: GitMonitorHealth;
  unpublishedChanges: number;
  gitFactsPending: number;
  why: string;
}

export interface GitMonitorSummary {
  projects: GitMonitorProject[];
  agents: GitMonitorAgent[];
  branches: number;
  worktrees: number;
  needsAttention: number;
  unpublishedChanges: number;
  gitFactsPending: number;
  health: GitMonitorHealth;
}

const CHECKS_PASSED = /(?:check|test|lint|build)[^.!?]*(?:pass|green|success)|(?:pass|green|success)[^.!?]*(?:check|test|lint|build)/i;

function textOr(value: string | undefined, fallback: string) {
  return value?.trim() || fallback;
}

function pathName(path: string | undefined) {
  if (!path) return "Unassigned work";
  return path.split("/").filter(Boolean).pop() || path;
}

function hasBlocker(workstream: WorkstreamMetadata) {
  return Boolean(
    workstream.status === "failed" ||
      workstream.phase === "blocked" ||
      workstream.statusSummary?.status === "blocked" ||
      workstream.statusSummary?.blocker?.trim() ||
      workstream.extractedBlockers?.some((item) => item.text.trim()),
  );
}

function checksPassed(workstream: WorkstreamMetadata) {
  const evidence = [workstream.evidence, workstream.statusSummary?.proof, workstream.lastSummary]
    .filter(Boolean)
    .join(" ");
  return CHECKS_PASSED.test(evidence);
}

function agentWhy(workstream: WorkstreamMetadata, facts: GitMonitorGitFacts | null, ready: boolean, help: boolean) {
  if (!gitFactsAreAvailable(facts)) return "Git status is still being checked, so the monitor is not offering a combine decision yet.";
  if (help) return facts?.gitHasConflicts === true
    ? "A conflict was found, so an agent needs your decision before anything is combined."
    : "The agent reported a blocker, so it needs your help before work can continue.";
  if (ready) return "The agent is finished, the work area is clean, checks passed, and no conflicts were found.";
  if (workstream.status === "running" || workstream.phase === "active") return "The agent is still working, so there is nothing for you to combine yet.";
  return "No finished clean work is waiting for you; the agent will report when a decision is needed.";
}

export function readyToCombine(workstream: WorkstreamMetadata, facts: GitMonitorGitFacts | null = null) {
  const completed = workstream.status === "done" || workstream.phase === "complete" || workstream.phase === "reviewed";
  const clean = facts ? facts.gitDirty === false : workstream.gitDirty === false;
  const safetyChecksPass = Boolean(
    facts &&
    facts.gitRoot &&
    facts.gitBranch &&
    facts.gitBranchExists === true &&
    facts.gitHasCommits === true &&
    facts.gitHasConflicts === false
  );
  return completed && clean && safetyChecksPass && !hasBlocker(workstream) && checksPassed(workstream);
}

function healthFor(workstream: WorkstreamMetadata, facts?: GitMonitorGitFacts | null): GitMonitorHealth {
  if (hasBlocker(workstream) || facts?.gitHasConflicts === true) return "agent-help";
  if (readyToCombine(workstream, facts)) return "decision-ready";
  return "under-control";
}

function projectKey(tab: Tab, workstream: WorkstreamMetadata, groups: Group[], liveGitRoots: Record<string, string>) {
  const group = tab.groupId ? groups.find((candidate) => candidate.id === tab.groupId) : undefined;
  const firstTerminal = tab.terminals[0];
  const root = workstream.gitRoot || (firstTerminal && liveGitRoots[firstTerminal.id]) || group?.projectRoot || tab.initialCwd;
  return { id: group?.id ?? `root:${root ?? "unassigned"}`, name: group?.name ?? pathName(root), root };
}

export function inferAgentWorkstream(tab: Tab, liveGitRoots: Record<string, string>): WorkstreamMetadata | undefined {
  const terminal = tab.terminals.find((candidate) => candidate.agentProvider || candidate.statusSummary?.provider);
  if (!terminal) return undefined;
  const providerLabel = terminal.agentProvider ?? terminal.statusSummary?.provider ?? "Agent";
  const projectLabel = pathName(liveGitRoots[terminal.id] || tab.initialCwd);
  return {
    kind: "agent",
    provider: terminal.agentProvider ?? terminal.statusSummary?.provider,
    mission: terminal.statusSummary?.mainTask || terminal.purpose?.title || `${providerLabel} work in ${projectLabel}`,
    cwd: tab.initialCwd,
    gitRoot: liveGitRoots[terminal.id] || undefined,
    worktreePath: tab.initialCwd,
    currentActivity: terminal.currentActivity || terminal.statusSummary?.now,
    activityKind: terminal.activityKind,
    statusSummary: terminal.statusSummary,
    statusSummaryUpdatedAt: terminal.statusSummaryUpdatedAt,
    status: terminalStatus(terminal),
    createdAt: Date.now(),
  };
}

function terminalStatus(terminal: TerminalState): WorkstreamMetadata["status"] {
  if (terminal.status === "failed") return "failed";
  if (terminal.status === "running" || terminal.status === "reconnected") return "running";
  return "ready";
}

export function summarizeGitMonitoring(
  tabs: Tab[],
  groups: Group[],
  liveGitRoots: Record<string, string>,
  liveGitFacts: Record<string, GitMonitorGitFacts> = {},
): GitMonitorSummary {
  const projects = new Map<string, GitMonitorProject>();
  const agents: GitMonitorAgent[] = [];

  for (const tab of tabs) {
    const workstream = tab.workstream ?? inferAgentWorkstream(tab, liveGitRoots);
    if (!workstream || workstream.kind !== "agent") continue;
    const facts = Object.prototype.hasOwnProperty.call(liveGitFacts, tab.id) ? liveGitFacts[tab.id] : null;
    const project = projectKey(tab, workstream, groups, liveGitRoots);
    const ready = readyToCombine(workstream, facts);
    const help = hasBlocker(workstream) || facts?.gitHasConflicts === true;
    const branch = facts?.gitBranch ?? workstream.gitBranch;
    const worktree = facts?.worktreePath ?? workstream.worktreePath;
    const agent: GitMonitorAgent = {
      tab,
      workstream,
      projectId: project.id,
      projectName: project.name,
      projectRoot: project.root,
      branch,
      worktree,
      dirty: facts?.gitDirty ?? workstream.gitDirty,
      goal: textOr(workstream.mission || workstream.statusSummary?.mainTask || workstream.statusSummary?.task, "Working on the project"),
      progress: !gitFactsAreAvailable(facts)
        ? "Git status is still loading"
        : textOr(workstream.currentActivity || workstream.statusSummary?.now, "Working normally"),
      nextAction: textOr(workstream.nextAction, ready ? "Ask the agent to combine this work" : "Agent is handling the next step"),
      why: agentWhy(workstream, facts, ready, help),
      health: healthFor(workstream, facts),
      readyToCombine: ready,
      needsAgentHelp: help,
      gitFactsAvailable: gitFactsAreAvailable(facts),
      gitHasConflicts: facts?.gitHasConflicts,
    };
    agents.push(agent);

    const current = projects.get(project.id) ?? {
      id: project.id,
      name: project.name,
      root: project.root,
      agents: [],
      branches: 0,
      worktrees: 0,
      needsAttention: 0,
      unpublishedChanges: 0,
      gitFactsPending: 0,
      why: "",
      health: "under-control" as GitMonitorHealth,
    };
    current.agents.push(agent);
    projects.set(project.id, current);
  }

  const projectValues = [...projects.values()].map((project) => {
    project.branches = new Set(project.agents.map((agent) => agent.branch).filter(Boolean)).size;
    project.worktrees = new Set(project.agents.map((agent) => agent.worktree).filter(Boolean)).size;
    project.needsAttention = project.agents.filter((agent) => agent.health !== "under-control").length;
    project.unpublishedChanges = new Set(
      project.agents
        .filter((agent) => agent.dirty === true)
        .map((agent) => agent.worktree || agent.projectRoot || agent.tab.id),
    ).size;
    project.gitFactsPending = project.agents.filter((agent) => !agent.gitFactsAvailable).length;
    project.health = project.agents.some((agent) => agent.needsAgentHelp)
      ? "agent-help"
      : project.agents.some((agent) => agent.readyToCombine)
        ? "decision-ready"
        : project.agents.some((agent) => !agent.gitFactsAvailable)
          ? "checking"
        : "under-control";
    project.why = project.health === "agent-help"
      ? "One or more agents reported a blocker or conflict."
      : project.health === "decision-ready"
        ? "At least one agent has finished clean work with passed checks and no conflicts."
        : project.health === "checking"
          ? "Git status is still being confirmed for one or more agents."
          : "All tracked agents are working normally; no finished clean work is waiting for you.";
    return project;
  });

  projectValues.sort((a, b) => b.needsAttention - a.needsAttention || a.name.localeCompare(b.name));
  return {
    projects: projectValues,
    agents,
    branches: new Set(agents.map((agent) => agent.branch).filter(Boolean)).size,
    worktrees: new Set(agents.map((agent) => agent.worktree).filter(Boolean)).size,
    needsAttention: agents.filter((agent) => agent.health !== "under-control").length,
    unpublishedChanges: new Set(
      agents
        .filter((agent) => agent.dirty === true)
        .map((agent) => agent.worktree || agent.projectRoot || agent.tab.id),
    ).size,
    gitFactsPending: agents.filter((agent) => !agent.gitFactsAvailable).length,
    health: agents.some((agent) => agent.needsAgentHelp)
      ? "agent-help"
      : agents.some((agent) => agent.readyToCombine)
        ? "decision-ready"
        : agents.some((agent) => !agent.gitFactsAvailable)
          ? "checking"
        : "under-control",
  };
}
