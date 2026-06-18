import type { Tab, WorkstreamCockpitObject, WorkstreamCockpitObjectKind, WorkstreamIsolationMode, WorkstreamMetadata, WorktreeCleanupStatus } from "./types";
import { mergeCockpitObjectsFromExtractedItems } from "./workstreamExtraction";
import { workstreamActivityMeta, workstreamActivityText } from "./workstreamActivity";
import { formatWorkstreamBranch, formatWorkstreamIsolation, formatWorkstreamOpsContext, pathLabel } from "./workstreamOpsContext";

export interface AgentLaneWorkstream {
  tab: Tab;
  workstream: WorkstreamMetadata;
}

export interface AgentWorkspaceGroup {
  id: string;
  label: string;
  detail: string;
  brief: string;
  tabIds: string[];
  total: number;
  active: number;
  attention: number;
  cleanupRequested: number;
  isolationMode?: WorkstreamIsolationMode;
  cleanupStatus?: WorktreeCleanupStatus;
  primaryTabId?: string;
}

export interface AgentLaneSummary {
  workstreams: AgentLaneWorkstream[];
  workspaceGroups: AgentWorkspaceGroup[];
  cockpitHeadline: {
    label: string;
    detail: string;
    tone: "action" | "running" | "complete" | "idle";
  };
  missionItemCount: number;
  hiddenMissionItemCount: number;
  missionActionCount: number;
  hiddenMissionActionCount: number;
  missionBreakdown: {
    label: string;
    count: number;
  }[];
  providerBreakdown: {
    label: string;
    count: number;
  }[];
  isolationBreakdown: {
    label: string;
    count: number;
  }[];
  cleanupBreakdown: {
    label: string;
    count: number;
  }[];
  supervisorItems: {
    tabId: string;
    title: string;
    label: string;
    detail: string;
    activity: string;
    signalAge: string;
    signalSource: string;
    runIdentity: string;
    workspaceIdentity: string;
    action: "queue-prompt" | "review" | "focus";
    actionText?: string;
    prompt?: string;
    alternateActions?: {
      label: string;
      detail: string;
      actionText?: string;
    }[];
  }[];
  hiddenSupervisorItems: {
    tabId: string;
    title: string;
    label: string;
    detail: string;
    activity: string;
    signalAge: string;
    signalSource: string;
    runIdentity: string;
    workspaceIdentity: string;
    action: "queue-prompt" | "review" | "focus";
    actionText?: string;
    prompt?: string;
    alternateActions?: {
      label: string;
      detail: string;
      actionText?: string;
    }[];
  }[];
  staleItems: {
    tabId: string;
    title: string;
    ageLabel: string;
    activity: string;
    detail: string;
    prompt: string;
  }[];
  memoryItems: {
    tabId: string;
    title: string;
    memory: string;
    brief: string;
  }[];
  reviewItems: {
    tabId: string;
    title: string;
    summary: string;
    proofStatus: string;
    handoffStatus: string;
    detail: string;
  }[];
  attentionItems: {
    tabId: string;
    title: string;
    label: string;
    detail: string;
  }[];
  attentionBreakdown: {
    label: string;
    count: number;
  }[];
  readinessBreakdown: {
    label: string;
    count: number;
  }[];
  missionControlDispatchBreakdown: {
    label: string;
    sent: number;
    queued: number;
    count: number;
  }[];
  authItems: {
    tabId: string;
    title: string;
    reason: string;
    nextAction: string;
    readinessCheck?: string;
    authCheck?: string;
    providerMessage?: string;
    brief: string;
  }[];
  evidenceItems: {
    tabId: string;
    title: string;
    evidence: string;
    artifact?: string;
    artifactPath?: string;
    artifactName?: string;
    brief: string;
  }[];
  proofItems: {
    tabId: string;
    title: string;
    summary: string;
    request: string;
  }[];
  memoryRequestItems: {
    tabId: string;
    title: string;
    summary: string;
    proofStatus: string;
    handoffStatus: string;
    request: string;
  }[];
  riskItems: {
    tabId: string;
    title: string;
    confidence?: string;
    risk?: string;
    detail: string;
    prompt: string;
  }[];
  riskBreakdown: {
    label: string;
    count: number;
  }[];
  closeoutBreakdown: {
    label: string;
    count: number;
  }[];
  recoveryItems: {
    tabId: string;
    title: string;
    reason: string;
    prompt: string;
  }[];
  recentEvents: {
    tabId: string;
    title: string;
    kind: string;
    label: string;
    detail?: string;
    at: number;
    brief: string;
  }[];
  inputItems: {
    tabId: string;
    title: string;
    text: string;
    state: "queued" | "sent";
    source?: "operator" | "mission-control";
    label?: string;
    at: number;
    brief: string;
  }[];
  outputItems: {
    tabId: string;
    title: string;
    output: string;
    at: number;
    brief: string;
  }[];
  nextItems: {
    tabId: string;
    title: string;
    nextAction: string;
    at: number;
    brief: string;
  }[];
  extractedItems: {
    objectId: string;
    tabId: string;
    title: string;
    kind: WorkstreamCockpitObjectKind;
    label: string;
    actionLabel: string;
    text: string;
    status: WorkstreamCockpitObject["status"];
    reviewState: WorkstreamCockpitObject["reviewState"];
    source: WorkstreamCockpitObject["source"];
    provenance: WorkstreamCockpitObject["source"];
    excerpt: string;
    at: number;
    createdAt: number;
    updatedAt: number;
    resolvedAt?: number;
    brief: string;
    prompt: string;
    request?: string;
  }[];
  total: number;
  promptCount: number;
  missionControlPromptCount: number;
  missionControlPromptSentCount: number;
  outputCount: number;
  nextCount: number;
  extractedCount: number;
  reviewReadyWithProof: number;
  reviewNeedsProof: number;
  reviewReadyWithMemory: number;
  reviewNeedsMemory: number;
  reviewCloseoutReady: number;
  reviewCloseoutBlocked: number;
  active: number;
  waiting: number;
  blocked: number;
  complete: number;
  interrupted: number;
  shared: number;
  dedicated: number;
  dedicatedReady: number;
  cleanupReady: number;
  cleanupRequested: number;
  attention: number;
  primaryAttention?: {
    tabId: string;
    title: string;
    label: string;
    detail: string;
  };
}

const NO_AGENT_MEMORY = "No agent memory reported yet.";
const STALE_WORKSTREAM_MS = 10 * 60 * 1000;

export function hasAgentReviewProof(workstream?: Pick<WorkstreamMetadata, "evidence" | "artifact">) {
  return Boolean(workstream?.evidence?.trim() || workstream?.artifact?.trim());
}

export function hasDurableAgentMemory(workstream?: Pick<WorkstreamMetadata, "memory">) {
  const memory = workstream?.memory?.trim();
  return Boolean(memory && memory !== NO_AGENT_MEMORY);
}

export function isAgentReviewCloseoutReady(workstream?: Pick<WorkstreamMetadata, "evidence" | "artifact" | "memory">) {
  return hasAgentReviewProof(workstream) && hasDurableAgentMemory(workstream);
}

export function isReviewItemCloseoutReady(item: Pick<AgentLaneSummary["reviewItems"][number], "proofStatus" | "handoffStatus">) {
  return item.proofStatus === "Ready with proof" && item.handoffStatus === "Memory ready";
}

export function needsAgentProofRequest(workstream?: Pick<WorkstreamMetadata, "phase" | "status" | "evidence" | "artifact">) {
  if (!workstream || workstream.phase === "reviewed") return false;
  const complete = workstream.phase === "complete" || workstream.status === "done";
  return complete && !workstream.evidence?.trim() && !workstream.artifact?.trim();
}

function providerLabel(provider?: string) {
  if (provider === "opencode") return "OpenCode";
  if (provider === "claude") return "Claude";
  if (provider === "shell") return "Shell";
  return "Codex";
}

function shortRunId(runId?: string) {
  if (!runId) return "run pending";
  const parts = runId.split("-");
  return parts.length > 1 ? parts[parts.length - 1] : runId;
}

function missionControlRunIdentity(tab?: Tab) {
  const workstream = tab?.workstream;
  if (!workstream) return "run unknown";
  return `${providerLabel(workstream.provider)} · ${workstream.status}/${workstream.phase ?? "unknown"} · ${shortRunId(workstream.runId)}`;
}

function missionControlWorkspaceIdentity(tab?: Tab) {
  const workstream = tab?.workstream;
  if (!workstream) return "workspace unknown";
  return formatWorkstreamOpsContext(workstream);
}

function missionControlActivity(tab?: Tab) {
  return workstreamActivityText(tab?.workstream, "No current activity");
}

function signalAgeLabel(elapsedMs: number) {
  const elapsedMinutes = Math.max(0, Math.floor(elapsedMs / 60_000));
  if (elapsedMinutes < 1) return "just now";
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  const remainingMinutes = elapsedMinutes % 60;
  return remainingMinutes > 0 ? `${elapsedHours}h ${remainingMinutes}m ago` : `${elapsedHours}h ago`;
}

function missionControlSignalAge(tab: Tab | undefined, now: number) {
  const workstream = tab?.workstream;
  if (!workstream) return "unknown";
  return signalAgeLabel(now - workstreamActivityTimestamp(workstream));
}

function missionControlSignalSource(tab?: Tab) {
  return workstreamActivityMeta(tab?.workstream);
}

function missionBreakdownFor(items: { label: string }[]) {
  const counts = new Map<string, number>();
  for (const item of items) {
    counts.set(item.label, (counts.get(item.label) ?? 0) + 1);
  }
  return [...counts.entries()].map(([label, count]) => ({ label, count }));
}

export function missionBreakdownText(summary: Pick<AgentLaneSummary, "missionBreakdown">) {
  if (summary.missionBreakdown.length === 0) return "none";
  return summary.missionBreakdown.map((item) => `${item.label}: ${item.count}`).join(" · ");
}

export function missionControlAlternateText(item: { alternateActions?: { label: string; detail: string }[] }) {
  return item.alternateActions?.length
    ? item.alternateActions.map((action) => `${action.label}: ${action.detail}`).join(" · ")
    : "";
}

function missionControlActionWeight(item: object) {
  return 1 + ("alternateActions" in item && Array.isArray(item.alternateActions) ? item.alternateActions.length : 0);
}


function providerBreakdownFor(workstreams: AgentLaneWorkstream[]) {
  const counts = new Map<string, number>();
  for (const { workstream } of workstreams) {
    const label = providerLabel(workstream.provider);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()].map(([label, count]) => ({ label, count }));
}

export function providerBreakdownText(summary: Pick<AgentLaneSummary, "providerBreakdown">) {
  if (summary.providerBreakdown.length === 0) return "none";
  return summary.providerBreakdown.map((item) => `${item.label}: ${item.count}`).join(" · ");
}

function isolationBreakdownFor(workstreams: AgentLaneWorkstream[]) {
  const counts = new Map<string, number>();
  for (const { workstream } of workstreams) {
    const label = formatWorkstreamIsolation(workstream.isolationMode, workstream.isolationStatus);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()].map(([label, count]) => ({ label, count }));
}

export function isolationBreakdownText(summary: Pick<AgentLaneSummary, "isolationBreakdown">) {
  if (summary.isolationBreakdown.length === 0) return "none";
  return summary.isolationBreakdown.map((item) => `${item.label}: ${item.count}`).join(" · ");
}

function cleanupBreakdownFor(workstreams: AgentLaneWorkstream[]) {
  const counts = new Map<string, number>();
  for (const { workstream } of workstreams) {
    const label = workstream.worktreeCleanupStatus ?? "unknown";
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()].map(([label, count]) => ({ label, count }));
}

export function cleanupBreakdownText(summary: Pick<AgentLaneSummary, "cleanupBreakdown">) {
  if (summary.cleanupBreakdown.length === 0) return "none";
  return summary.cleanupBreakdown.map((item) => `${item.label}: ${item.count}`).join(" · ");
}

function attentionBreakdownFor(items: { label: string }[]) {
  const counts = new Map<string, number>();
  for (const item of items) {
    counts.set(item.label, (counts.get(item.label) ?? 0) + 1);
  }
  return [...counts.entries()].map(([label, count]) => ({ label, count }));
}

export function attentionBreakdownText(summary: Pick<AgentLaneSummary, "attentionBreakdown">) {
  if (summary.attentionBreakdown.length === 0) return "none";
  return summary.attentionBreakdown.map((item) => `${item.label}: ${item.count}`).join(" · ");
}

function readinessLabel(workstream: WorkstreamMetadata) {
  if (workstream.providerAvailable === false) return "Provider unavailable";
  if (workstream.readiness === "provider-ready") return "Provider ready";
  if (workstream.readiness === "auth-required") return "Auth required";
  if (workstream.readiness === "path-checked") return "Path checked";
  return "Unknown readiness";
}

function readinessBreakdownFor(workstreams: AgentLaneWorkstream[]) {
  const counts = new Map<string, number>();
  for (const { workstream } of workstreams) {
    const label = readinessLabel(workstream);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()].map(([label, count]) => ({ label, count }));
}

export function readinessBreakdownText(summary: Pick<AgentLaneSummary, "readinessBreakdown">) {
  if (summary.readinessBreakdown.length === 0) return "none";
  return summary.readinessBreakdown.map((item) => `${item.label}: ${item.count}`).join(" · ");
}

function riskBreakdownFor(items: { confidence?: string; risk?: string }[]) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const confidence = item.confidence?.trim();
    const label = confidence ? `${confidence} confidence` : "risk reported";
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()].map(([label, count]) => ({ label, count }));
}

export function riskBreakdownText(summary: Pick<AgentLaneSummary, "riskBreakdown">) {
  if (summary.riskBreakdown.length === 0) return "none";
  return summary.riskBreakdown.map((item) => `${item.label}: ${item.count}`).join(" · ");
}

function closeoutBreakdownFor(items: AgentLaneSummary["reviewItems"]) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const needsProof = item.proofStatus === "Needs proof";
    const needsMemory = item.handoffStatus === "Needs memory";
    const label = needsProof && needsMemory
      ? "Needs proof + memory"
      : needsProof
        ? "Needs proof"
        : needsMemory
          ? "Needs memory"
          : "Ready";
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()].map(([label, count]) => ({ label, count }));
}

export function closeoutBreakdownText(summary: Pick<AgentLaneSummary, "closeoutBreakdown">) {
  if (summary.closeoutBreakdown.length === 0) return "none";
  return summary.closeoutBreakdown.map((item) => `${item.label}: ${item.count}`).join(" · ");
}

export function missionControlDispatchText(
  summary: Pick<AgentLaneSummary, "missionControlPromptCount" | "missionControlPromptSentCount">
) {
  const queued = Math.max(0, summary.missionControlPromptCount - summary.missionControlPromptSentCount);
  return `${summary.missionControlPromptCount} mission-control prompts · ${summary.missionControlPromptSentCount} sent · ${queued} queued`;
}

function missionControlDispatchBreakdownFor(workstreams: AgentLaneWorkstream[]) {
  const counts = new Map<string, { label: string; sent: number; queued: number; count: number }>();
  for (const { workstream } of workstreams) {
    for (const input of workstream.inputQueue ?? []) {
      if (input.source !== "mission-control") continue;
      const label = input.label ?? "Mission control";
      const current = counts.get(label) ?? { label, sent: 0, queued: 0, count: 0 };
      current.count += 1;
      if (input.sentAt) current.sent += 1;
      else current.queued += 1;
      counts.set(label, current);
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export function missionControlDispatchBreakdownText(
  summary: Pick<AgentLaneSummary, "missionControlDispatchBreakdown">
) {
  if (summary.missionControlDispatchBreakdown.length === 0) return "none";
  return summary.missionControlDispatchBreakdown
    .map((item) => `${item.label}: ${item.sent} sent${item.queued > 0 ? ` · ${item.queued} queued` : ""}`)
    .join(" · ");
}

function latestWorkstreamInput(workstream?: WorkstreamMetadata) {
  const inputs = workstream?.inputQueue ?? [];
  return inputs[inputs.length - 1];
}

function workstreamInputSourceText(input?: { source?: string; label?: string }) {
  if (input?.source !== "mission-control") return "";
  return ` via mission-control${input.label ? ` ${input.label}` : ""}`;
}

export function latestMissionControlAskText(workstream?: Pick<WorkstreamMetadata, "inputQueue">) {
  const inputs = workstream?.inputQueue ?? [];
  const latestInput = inputs[inputs.length - 1];
  if (latestInput?.source !== "mission-control") return "";
  return `Ask: ${latestInput.label ?? "Mission control"} · ${latestInput.sentAt ? "sent" : "queued"} · ${latestInput.text}`;
}

export function formatAgentRunBrief(tab: Tab) {
  const workstream = tab.workstream;
  if (!workstream) return `${tab.title}\nNo agent run metadata available.`;
  const latestEvent = workstream.events?.[workstream.events.length - 1];
  const mission = workstream.mission ?? workstream.prompt ?? "Supervised workstream";
  const latestInput = latestWorkstreamInput(workstream);
  const latestAsk = latestMissionControlAskText(workstream);
  return [
    `Agent run: ${tab.title}`,
    `Run: ${workstream.runId ?? "pending"} (generation ${workstream.generation ?? 0})`,
    `Task: ${mission}`,
    `Provider: ${providerLabel(workstream.provider)}`,
    `Cwd: ${workstream.cwd ?? "unknown"}`,
    `Git: ${formatWorkstreamBranch(workstream)}`,
    `Isolation: ${formatWorkstreamIsolation(workstream.isolationMode, workstream.isolationStatus)}`,
    `Isolation note: ${workstream.isolationNote ?? "pending"}`,
    `Worktree: ${workstream.worktreePath ?? "unknown"}`,
    `Worktree cleanup: ${workstream.worktreeCleanupStatus ?? "unknown"}`,
    `Worktree cleanup note: ${workstream.worktreeCleanupNote ?? "pending"}`,
    `Status: ${workstream.status} / ${workstream.phase ?? "unknown"}`,
    `Readiness: ${workstream.readiness ?? "unknown"}`,
    `Stage: ${workstream.stage ?? "pending"}`,
    `Confidence: ${workstream.confidence ?? "pending"}`,
    `Risk: ${workstream.risk ?? "pending"}`,
    `Exit: ${typeof workstream.exitCode === "number" ? workstream.exitCode : "pending"}`,
    `Timing: started=${workstream.createdAt ? new Date(workstream.createdAt).toISOString() : "unknown"}, completed=${workstream.completedAt ? new Date(workstream.completedAt).toISOString() : "pending"}, reviewed=${workstream.reviewedAt ? new Date(workstream.reviewedAt).toISOString() : "pending"}`,
    `Now: ${workstreamActivityText(workstream, "No current activity")}`,
    `Activity: ${workstreamActivityMeta(workstream)}`,
    `Summary: ${workstream.lastSummary ?? "No summary yet"}`,
    `Next: ${workstream.nextAction ?? "Watch provider response"}`,
    `Memory: ${workstream.memory ?? NO_AGENT_MEMORY}`,
    `Evidence: ${workstream.evidence ?? "pending"}`,
    `Artifact: ${workstream.artifact ?? "pending"}`,
    `Outcome: ${workstream.outcome ?? "Pending"}`,
    `Cockpit ask: ${latestAsk || "none"}`,
    `Latest input: ${latestInput ? `${latestInput.sentAt ? "sent" : "queued"}${workstreamInputSourceText(latestInput)} - ${latestInput.text}` : "none"}`,
    `Run record: prompts=${workstream.promptCount ?? 0}, sent=${workstream.sentCount ?? 0}, signals=${workstream.signalCount ?? 0}, controls=${workstream.controlCount ?? 0}`,
    `Latest event: ${latestEvent ? `${latestEvent.kind} - ${latestEvent.label}` : "none"}`,
  ].join("\n");
}

function isActiveWorkstream(workstream: WorkstreamMetadata) {
  const waiting = workstream.phase === "needs-input" || workstream.status === "waiting";
  const blocked = workstream.phase === "blocked" || workstream.status === "failed" || workstream.providerAvailable === false;
  const complete = workstream.phase === "complete" || workstream.phase === "reviewed" || workstream.status === "done";
  const interrupted = workstream.phase === "cancelling" || workstream.phase === "interrupted" || workstream.status === "stopped";
  return (
    !waiting &&
    !blocked &&
    !complete &&
    !interrupted &&
    (workstream.phase === "queued" ||
      workstream.phase === "launching" ||
      workstream.phase === "active" ||
      workstream.status === "ready" ||
      workstream.status === "running")
  );
}

export function isActiveAgentWorkstream(workstream: WorkstreamMetadata) {
  return isActiveWorkstream(workstream);
}

export function isRestartableAgentWorkstream(workstream: WorkstreamMetadata) {
  return (
    workstream.status === "failed" ||
    workstream.status === "stopped" ||
    workstream.phase === "blocked" ||
    workstream.phase === "interrupted"
  );
}

export function isAuthRetryableAgentWorkstream(workstream: WorkstreamMetadata) {
  return workstream.readiness === "auth-required";
}

export function isCleanupRequestableAgentWorkstream(workstream: WorkstreamMetadata) {
  const complete = workstream.phase === "complete" || workstream.phase === "reviewed" || workstream.status === "done";
  return (
    workstream.kind === "agent" &&
    workstream.isolationMode === "dedicated-worktree" &&
    workstream.worktreeCleanupStatus === "available" &&
    complete
  );
}

export function agentLaneStatusSweepCounts(summary: Pick<AgentLaneSummary, "workstreams" | "total">) {
  const active = summary.workstreams.filter(({ workstream }) => isActiveWorkstream(workstream)).length;
  return {
    active,
    held: Math.max(0, summary.total - active),
  };
}

export function agentLaneStatusSweepText(summary: Pick<AgentLaneSummary, "workstreams" | "total">) {
  const { active, held } = agentLaneStatusSweepCounts(summary);
  return held > 0 ? `Sweep ${active} active · ${held} held` : `Sweep ${active} active`;
}

export function agentLaneStatusSweepTitle(summary: Pick<AgentLaneSummary, "workstreams" | "total">) {
  const { active, held } = agentLaneStatusSweepCounts(summary);
  const activeAgentText = `${active} active agent${active === 1 ? "" : "s"}`;
  if (held === 0) return `Request status from ${activeAgentText}`;
  return `Request status from ${activeAgentText}; ${held} held run${held === 1 ? "" : "s"} skipped`;
}

export function agentLaneInterruptText(summary: Pick<AgentLaneSummary, "workstreams" | "total">) {
  const { active, held } = agentLaneStatusSweepCounts(summary);
  return held > 0 ? `Interrupt ${active} active · ${held} held` : `Interrupt ${active} active`;
}

export function agentLaneInterruptTitle(summary: Pick<AgentLaneSummary, "workstreams" | "total">) {
  const { active, held } = agentLaneStatusSweepCounts(summary);
  const activeAgentText = `${active} active agent${active === 1 ? "" : "s"}`;
  if (held === 0) return `Request graceful cancellation for ${activeAgentText}`;
  return `Request graceful cancellation for ${activeAgentText}; ${held} held run${held === 1 ? "" : "s"} skipped`;
}

export function agentLaneRestartCounts(summary: Pick<AgentLaneSummary, "workstreams" | "total">) {
  const recovery = summary.workstreams.filter(({ workstream }) => isRestartableAgentWorkstream(workstream)).length;
  return {
    recovery,
    held: Math.max(0, summary.total - recovery),
  };
}

export function agentLaneRestartText(summary: Pick<AgentLaneSummary, "workstreams" | "total">) {
  const { recovery, held } = agentLaneRestartCounts(summary);
  return held > 0 ? `Restart ${recovery} recovery · ${held} held` : `Restart ${recovery} recovery`;
}

export function agentLaneRestartTitle(summary: Pick<AgentLaneSummary, "workstreams" | "total">) {
  const { recovery, held } = agentLaneRestartCounts(summary);
  const recoveryText = `${recovery} recovery run${recovery === 1 ? "" : "s"}`;
  if (held === 0) return `Restart ${recoveryText}`;
  return `Restart ${recoveryText}; ${held} held run${held === 1 ? "" : "s"} skipped`;
}

export function agentLaneAuthRetryCounts(summary: Pick<AgentLaneSummary, "workstreams" | "total">) {
  const auth = summary.workstreams.filter(({ workstream }) => isAuthRetryableAgentWorkstream(workstream)).length;
  return {
    auth,
    held: Math.max(0, summary.total - auth),
  };
}

export function agentLaneAuthRetryText(summary: Pick<AgentLaneSummary, "workstreams" | "total">) {
  const { auth, held } = agentLaneAuthRetryCounts(summary);
  return held > 0 ? `Retry ${auth} auth · ${held} held` : `Retry ${auth} auth`;
}

export function agentLaneAuthRetryTitle(summary: Pick<AgentLaneSummary, "workstreams" | "total">) {
  const { auth, held } = agentLaneAuthRetryCounts(summary);
  const authText = `${auth} auth-blocked run${auth === 1 ? "" : "s"}`;
  if (held === 0) return `Restart ${authText} after CLI authentication`;
  return `Restart ${authText} after CLI authentication; ${held} held run${held === 1 ? "" : "s"} skipped`;
}

export function agentLaneCleanupRequestCounts(summary: Pick<AgentLaneSummary, "workstreams" | "total">) {
  const ready = summary.workstreams.filter(({ workstream }) => isCleanupRequestableAgentWorkstream(workstream)).length;
  return {
    ready,
    held: Math.max(0, summary.total - ready),
  };
}

export function agentLaneCleanupRequestText(summary: Pick<AgentLaneSummary, "workstreams" | "total">) {
  const { ready, held } = agentLaneCleanupRequestCounts(summary);
  return held > 0 ? `Cleanup ${ready} ready · ${held} held` : `Cleanup ${ready} ready`;
}

export function agentLaneCleanupRequestTitle(summary: Pick<AgentLaneSummary, "workstreams" | "total">) {
  const { ready, held } = agentLaneCleanupRequestCounts(summary);
  const readyText = `${ready} cleanup-ready run${ready === 1 ? "" : "s"}`;
  if (held === 0) return `Request worktree cleanup for ${readyText}`;
  return `Request worktree cleanup for ${readyText}; ${held} held run${held === 1 ? "" : "s"} skipped`;
}

export function agentLaneCloseoutCounts(summary: Pick<AgentLaneSummary, "reviewItems" | "total">) {
  const ready = summary.reviewItems.filter((item) => isReviewItemCloseoutReady(item)).length;
  return {
    ready,
    held: Math.max(0, summary.total - ready),
  };
}

export function agentLaneCloseoutText(summary: Pick<AgentLaneSummary, "reviewItems" | "total">) {
  const { ready, held } = agentLaneCloseoutCounts(summary);
  return held > 0 ? `Review ${ready} ready · ${held} held` : `Review ${ready} ready`;
}

export function agentLaneCloseoutTitle(summary: Pick<AgentLaneSummary, "reviewItems" | "total">) {
  const { ready, held } = agentLaneCloseoutCounts(summary);
  const readyText = `${ready} closeout-ready run${ready === 1 ? "" : "s"}`;
  if (held === 0) return `Mark ${readyText} reviewed`;
  return `Mark ${readyText} reviewed; ${held} held run${held === 1 ? "" : "s"} skipped`;
}

export function agentLaneProofRequestCounts(summary: Pick<AgentLaneSummary, "proofItems" | "total">) {
  const proofNeeded = summary.proofItems.length;
  return {
    proofNeeded,
    held: Math.max(0, summary.total - proofNeeded),
  };
}

export function agentLaneProofRequestText(summary: Pick<AgentLaneSummary, "proofItems" | "total">) {
  const { proofNeeded, held } = agentLaneProofRequestCounts(summary);
  return held > 0 ? `Proof ${proofNeeded} needed · ${held} held` : `Proof ${proofNeeded} needed`;
}

export function agentLaneProofRequestTitle(summary: Pick<AgentLaneSummary, "proofItems" | "total">) {
  const { proofNeeded, held } = agentLaneProofRequestCounts(summary);
  const proofText = `${proofNeeded} proof-needed run${proofNeeded === 1 ? "" : "s"}`;
  if (held === 0) return `Request verification proof from ${proofText}`;
  return `Request verification proof from ${proofText}; ${held} held run${held === 1 ? "" : "s"} skipped`;
}

export function agentLaneMemoryRequestCounts(summary: Pick<AgentLaneSummary, "memoryRequestItems" | "total">) {
  const memoryNeeded = summary.memoryRequestItems.length;
  return {
    memoryNeeded,
    held: Math.max(0, summary.total - memoryNeeded),
  };
}

export function agentLaneMemoryRequestText(summary: Pick<AgentLaneSummary, "memoryRequestItems" | "total">) {
  const { memoryNeeded, held } = agentLaneMemoryRequestCounts(summary);
  return held > 0 ? `Memory ${memoryNeeded} needed · ${held} held` : `Memory ${memoryNeeded} needed`;
}

export function agentLaneMemoryRequestTitle(summary: Pick<AgentLaneSummary, "memoryRequestItems" | "total">) {
  const { memoryNeeded, held } = agentLaneMemoryRequestCounts(summary);
  const memoryText = `${memoryNeeded} memory-needed run${memoryNeeded === 1 ? "" : "s"}`;
  if (held === 0) return `Request durable handoff memory from ${memoryText}`;
  return `Request durable handoff memory from ${memoryText}; ${held} held run${held === 1 ? "" : "s"} skipped`;
}

export function agentLaneRiskMitigationCounts(summary: Pick<AgentLaneSummary, "riskItems" | "total">) {
  const riskOpen = summary.riskItems.length;
  return {
    riskOpen,
    held: Math.max(0, summary.total - riskOpen),
  };
}

export function agentLaneRiskMitigationText(summary: Pick<AgentLaneSummary, "riskItems" | "total">) {
  const { riskOpen, held } = agentLaneRiskMitigationCounts(summary);
  return held > 0 ? `Risk ${riskOpen} open · ${held} held` : `Risk ${riskOpen} open`;
}

export function agentLaneRiskMitigationTitle(summary: Pick<AgentLaneSummary, "riskItems" | "total">) {
  const { riskOpen, held } = agentLaneRiskMitigationCounts(summary);
  const riskText = `${riskOpen} risky run${riskOpen === 1 ? "" : "s"}`;
  if (held === 0) return `Request risk mitigation from ${riskText}`;
  return `Request risk mitigation from ${riskText}; ${held} held run${held === 1 ? "" : "s"} skipped`;
}

function workstreamActivityTimestamp(workstream: WorkstreamMetadata) {
  return workstream.lastActivityAt ?? workstream.activityUpdatedAt ?? workstream.createdAt;
}

function idleAgeLabel(elapsedMs: number) {
  const elapsedMinutes = Math.max(1, Math.floor(elapsedMs / 60_000));
  if (elapsedMinutes < 60) return `${elapsedMinutes}m idle`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  const remainingMinutes = elapsedMinutes % 60;
  return remainingMinutes > 0 ? `${elapsedHours}h ${remainingMinutes}m idle` : `${elapsedHours}h idle`;
}

function staleWorkstreamFor(item: AgentLaneWorkstream, now: number) {
  const { tab, workstream } = item;
  if (!isStaleAgentWorkstream(workstream, now)) return null;
  const activityAt = workstreamActivityTimestamp(workstream);
  const elapsedMs = now - activityAt;
  const activity = workstreamActivityText(workstream, "No current activity");
  const ageLabel = idleAgeLabel(elapsedMs);
  return {
    tabId: tab.id,
    title: workstream.mission ?? workstream.prompt ?? tab.title,
    ageLabel,
    activity,
    detail: `${ageLabel} · ${activity}`,
    prompt: statusCheckPromptForWorkstream(workstream),
  };
}

export function isStaleAgentWorkstream(workstream: WorkstreamMetadata, now = Date.now()) {
  return isActiveWorkstream(workstream) && now - workstreamActivityTimestamp(workstream) >= STALE_WORKSTREAM_MS;
}

function isReviewReadyWorkstream(workstream: WorkstreamMetadata) {
  return workstream.phase !== "reviewed" && (workstream.phase === "complete" || workstream.status === "done");
}

function isRecoveryReadyWorkstream(workstream: WorkstreamMetadata) {
  return workstream.phase === "blocked" || workstream.status === "failed" || workstream.providerAvailable === false;
}

function needsProof(workstream: WorkstreamMetadata) {
  return needsAgentProofRequest(workstream);
}

function needsHandoffMemory(workstream: WorkstreamMetadata) {
  if (!isReviewReadyWorkstream(workstream)) return false;
  if (needsProof(workstream)) return false;
  const memory = workstream.memory?.trim();
  return !memory || memory === NO_AGENT_MEMORY;
}

function isBenignRisk(risk?: string) {
  const normalized = risk?.trim().toLowerCase();
  return !normalized || normalized === "low residual risk" || normalized === "no known residual risk";
}

function isRiskyWorkstream(workstream: WorkstreamMetadata) {
  const confidence = workstream.confidence?.trim().toLowerCase();
  return confidence === "low" || confidence === "medium" || !isBenignRisk(workstream.risk);
}

function recoveryPromptForWorkstream(workstream: WorkstreamMetadata) {
  return `Recover ${providerLabel(workstream.provider)} agent: inspect the failure output, summarize the root cause, and propose the next command.`;
}

function extractedProofRequestPrompt(item: Pick<WorkstreamCockpitObject, "text" | "source" | "sourceExcerpt">, workstream: WorkstreamMetadata) {
  const mission = workstream.mission ?? workstream.prompt ?? "agent run";
  return `Resolve extracted blocker for ${providerLabel(workstream.provider)} agent: verify whether this still blocks the work, provide exact evidence or artifact paths, and report the next concrete action. Mission: ${mission}. Blocker: ${item.text}. Source: ${item.source}. Excerpt: ${item.sourceExcerpt}.`;
}

function extractedPromptForObject(item: Pick<WorkstreamCockpitObject, "kind" | "text" | "source" | "sourceExcerpt">, workstream: WorkstreamMetadata) {
  const mission = workstream.mission ?? workstream.prompt ?? "agent run";
  return `Follow up on extracted ${item.kind} for ${providerLabel(workstream.provider)} agent. Mission: ${mission}. Item: ${item.text}. Source: ${item.source}. Excerpt: ${item.sourceExcerpt}.`;
}

function extractedLaneItem(
  tab: Tab,
  workstream: WorkstreamMetadata,
  item: WorkstreamCockpitObject
): AgentLaneSummary["extractedItems"][number] {
  const title = workstream.mission ?? workstream.prompt ?? tab.title;
  const kind = item.kind;
  const label =
    kind === "task" ? "Task" :
    kind === "blocker" ? "Blocker" :
    kind === "evidence" ? "Evidence" :
    "Next";
  const actionLabel =
    kind === "task" ? "Focus task" :
    kind === "blocker" ? "Request proof" :
    kind === "evidence" ? "Copy proof" :
    "Copy next";
  return {
    objectId: item.id,
    tabId: tab.id,
    title,
    kind,
    label,
    actionLabel,
    text: item.text,
    status: item.status,
    reviewState: item.reviewState,
    source: item.source,
    provenance: item.source,
    excerpt: item.sourceExcerpt,
    at: item.updatedAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    resolvedAt: item.resolvedAt,
    brief: `${title}: ${item.reviewState} ${label.toLowerCase()} - ${item.text} (${item.source})`,
    prompt: extractedPromptForObject(item, workstream),
    request: kind === "blocker" ? extractedProofRequestPrompt(item, workstream) : undefined,
  };
}

function cockpitObjectsForWorkstream(tab: Tab, workstream: WorkstreamMetadata) {
  if (workstream.cockpitObjects?.length) return workstream.cockpitObjects;
  return mergeCockpitObjectsFromExtractedItems([], tab.id, {
    task: workstream.extractedTasks,
    blocker: workstream.extractedBlockers,
    evidence: workstream.extractedEvidence,
    "next-action": workstream.extractedNextActions,
  }, workstream.statusSummaryUpdatedAt ?? workstream.lastActivityAt ?? workstream.createdAt);
}

export function statusCheckPromptForWorkstream(workstream: WorkstreamMetadata) {
  const mission = workstream.mission ?? workstream.prompt ?? "this workstream";
  const activity = workstreamActivityText(workstream, "No current activity");
  return `Status check for ${providerLabel(workstream.provider)} agent: report what you are doing now, whether you are blocked, the next concrete step, and any proof or artifact produced so far. Mission: ${mission}. Last visible activity: ${activity}.`;
}

export function proofRequestPromptForWorkstream(workstream?: Pick<WorkstreamMetadata, "provider" | "lastSummary" | "nextAction">) {
  const summary = workstream?.lastSummary ?? "your completed work";
  const next = workstream?.nextAction ?? "Provide exact verification commands, results, and artifact paths before this run is reviewed.";
  return `Provide proof for ${providerLabel(workstream?.provider)} agent completion: summarize the completed work, list the exact verification commands and results, and include artifact paths. Current summary: ${summary}. Operator request: ${next}`;
}

function riskMitigationPromptForWorkstream(workstream: WorkstreamMetadata) {
  const mission = workstream.mission ?? workstream.prompt ?? "this workstream";
  const confidence = workstream.confidence?.trim() || "pending";
  const risk = workstream.risk?.trim() || "pending";
  return `Resolve risk for ${providerLabel(workstream.provider)} agent: review the remaining risk, either mitigate it or explain why it is acceptable, then report updated confidence, residual risk, and any verification evidence. Mission: ${mission}. Current confidence: ${confidence}. Current risk: ${risk}.`;
}

export function handoffMemoryPromptForWorkstream(workstream: WorkstreamMetadata) {
  const mission = workstream.mission ?? workstream.prompt ?? "this workstream";
  const summary = workstream.lastSummary?.trim() || "no summary reported";
  const evidence = workstream.evidence?.trim() || "no evidence line reported";
  const artifact = workstream.artifact?.trim() || "no artifact path reported";
  const risk = workstream.risk?.trim() || "risk not reported";
  return `Provide durable handoff memory for ${providerLabel(workstream.provider)} agent: summarize the restart context, key decisions, remaining caveats, and where proof lives in one concise note. Mission: ${mission}. Summary: ${summary}. Evidence: ${evidence}. Artifact: ${artifact}. Risk: ${risk}.`;
}

function resolveArtifactPath(workstream: WorkstreamMetadata, artifact?: string) {
  const trimmed = artifact?.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("/")) return trimmed;
  const base = workstream.worktreePath ?? workstream.gitRoot ?? workstream.cwd;
  if (!base?.trim()) return trimmed;
  return `${base.replace(/\/+$/, "")}/${trimmed.replace(/^\/+/, "")}`;
}

function artifactNameFor(path?: string) {
  return path?.split("/").filter(Boolean).pop() ?? path;
}

function attentionForWorkstream(item: AgentLaneWorkstream) {
  const { tab, workstream } = item;
  const title = workstream.mission ?? workstream.prompt ?? tab.title;
  if (workstream.phase === "reviewed") return null;
  if (workstream.readiness === "auth-required") {
    return {
      tabId: tab.id,
      title,
      label: "Auth required",
      detail: workstream.nextAction ?? "Authenticate the provider CLI",
      priority: 0,
    };
  }
  if (workstream.phase === "needs-input" || workstream.status === "waiting") {
    return {
      tabId: tab.id,
      title,
      label: "Needs input",
      detail: workstream.nextAction ?? "Send a follow-up prompt",
      priority: 1,
    };
  }
  if (workstream.phase === "cancelling") {
    return {
      tabId: tab.id,
      title,
      label: "Cancelling",
      detail: workstream.nextAction ?? "Wait for provider acknowledgement",
      priority: 2,
    };
  }
  if (workstream.phase === "blocked" || workstream.status === "failed" || workstream.providerAvailable === false) {
    return {
      tabId: tab.id,
      title,
      label: "Blocked",
      detail: workstreamActivityText(workstream, workstream.providerAvailabilityMessage ?? "Provider blocked"),
      priority: 3,
    };
  }
  if (workstream.phase === "complete" || workstream.status === "done") {
    return {
      tabId: tab.id,
      title,
      label: "Complete",
      detail: workstreamActivityText(workstream, workstream.nextAction ?? "Review output"),
      priority: 4,
    };
  }
  return null;
}

function workspaceGroupKey(workstream: WorkstreamMetadata) {
  if (workstream.isolationMode === "dedicated-worktree") {
    return `dedicated:${workstream.worktreePath ?? workstream.runId ?? workstream.createdAt}`;
  }
  return `shared:${workstream.gitRoot ?? workstream.cwd ?? workstream.cwdLabel ?? "unknown"}`;
}

function workspaceGroupLabel(workstream: WorkstreamMetadata) {
  if (workstream.isolationMode === "dedicated-worktree") {
    return workstream.cwdLabel ?? pathLabel(workstream.worktreePath ?? workstream.cwd);
  }
  return workstream.cwdLabel ?? pathLabel(workstream.gitRoot ?? workstream.cwd);
}

function workspaceGroupDetail(workstream: WorkstreamMetadata) {
  const isolation = formatWorkstreamIsolation(workstream.isolationMode, workstream.isolationStatus);
  const branch = workstream.gitBranch ?? "branch unknown";
  return `${isolation} · ${branch}`;
}

function summarizeWorkspaceGroups(workstreams: AgentLaneWorkstream[]) {
  const groups = new Map<string, AgentWorkspaceGroup>();

  for (const item of workstreams) {
    const { tab, workstream } = item;
    const key = workspaceGroupKey(workstream);
    const attention = attentionForWorkstream(item);
    const active = isActiveWorkstream(workstream);
    const cleanupRequested = workstream.worktreeCleanupStatus === "requested";
    const existing = groups.get(key);
    const cleanupStatus = cleanupRequested
      ? workstream.worktreeCleanupStatus
      : existing?.cleanupStatus ?? workstream.worktreeCleanupStatus;
    const nextTotal = (existing?.total ?? 0) + 1;
    const nextActive = (existing?.active ?? 0) + (active ? 1 : 0);
    const nextAttention = (existing?.attention ?? 0) + (attention ? 1 : 0);
    const nextCleanupRequested = (existing?.cleanupRequested ?? 0) + (cleanupRequested ? 1 : 0);
    const label = existing?.label ?? workspaceGroupLabel(workstream);
    const detail = existing?.detail ?? workspaceGroupDetail(workstream);
    const cleanupText = nextCleanupRequested > 0 ? `, cleanup requested=${nextCleanupRequested}` : "";
    const attentionText = nextAttention > 0 ? `, attention=${nextAttention}` : "";

    groups.set(key, {
      id: key,
      label,
      detail,
      brief: `${label}: ${nextTotal} agents, ${nextActive} active${cleanupText}${attentionText} (${detail})`,
      tabIds: [...(existing?.tabIds ?? []), tab.id],
      total: nextTotal,
      active: nextActive,
      attention: nextAttention,
      cleanupRequested: nextCleanupRequested,
      isolationMode: existing?.isolationMode ?? workstream.isolationMode,
      cleanupStatus,
      primaryTabId: existing?.primaryTabId ?? tab.id,
    });
  }

  return [...groups.values()].sort((a, b) => {
    const attentionDelta = b.attention - a.attention;
    if (attentionDelta) return attentionDelta;
    const cleanupDelta = b.cleanupRequested - a.cleanupRequested;
    if (cleanupDelta) return cleanupDelta;
    const activeDelta = b.active - a.active;
    if (activeDelta) return activeDelta;
    return a.label.localeCompare(b.label);
  });
}

function cockpitHeadlineFor(
  summary: AgentLaneSummary,
  supervisorItems: AgentLaneSummary["supervisorItems"],
  hiddenMissionItemCount: number
) {
  const topItem = supervisorItems[0];
  if (topItem) {
    const hiddenText = hiddenMissionItemCount > 0 ? ` · +${hiddenMissionItemCount} more` : "";
    return {
      label: `Next: ${topItem.label}`,
      detail: `${topItem.title} · ${topItem.detail}${hiddenText}`,
      tone: "action" as const,
    };
  }
  if (summary.active > 0) {
    const agentText = summary.active === 1 ? "1 active agent" : `${summary.active} active agents`;
    const nextText = summary.nextCount === 1 ? "1 next action" : `${summary.nextCount} next actions`;
    return {
      label: "Running",
      detail: `${agentText} · ${nextText}`,
      tone: "running" as const,
    };
  }
  if (summary.complete > 0) {
    const completeText = summary.complete === 1 ? "1 complete run" : `${summary.complete} complete runs`;
    return {
      label: "Complete",
      detail: `${completeText} · no mission items`,
      tone: "complete" as const,
    };
  }
  return {
    label: "Idle",
    detail: "No active agent work",
    tone: "idle" as const,
  };
}

export function summarizeAgentLane(tabs: Tab[], now = Date.now()): AgentLaneSummary {
  const workstreams = tabs.flatMap((tab) =>
    tab.workstream?.kind === "agent"
      ? [{ tab, workstream: tab.workstream }]
      : []
  );

  const summary = workstreams.reduce<AgentLaneSummary>((summary, item) => {
    const { workstream } = item;
    const attention = attentionForWorkstream(item);
    const waiting = workstream.phase === "needs-input" || workstream.status === "waiting";
    const blocked = workstream.phase === "blocked" || workstream.status === "failed" || workstream.providerAvailable === false;
    const complete = workstream.phase === "complete" || workstream.phase === "reviewed" || workstream.status === "done";
    const interrupted = workstream.phase === "cancelling" || workstream.phase === "interrupted" || workstream.status === "stopped";
    const dedicated = workstream.isolationMode === "dedicated-worktree";
    const shared = workstream.isolationMode === "shared-worktree" || !workstream.isolationMode;
    const dedicatedReady = dedicated && workstream.isolationStatus === "ready";
    const cleanupReady = isCleanupRequestableAgentWorkstream(workstream);
    const cleanupRequested = workstream.worktreeCleanupStatus === "requested";
    const active = isActiveWorkstream(workstream);

    return {
      workstreams: summary.workstreams,
      workspaceGroups: summary.workspaceGroups,
      cockpitHeadline: summary.cockpitHeadline,
      missionItemCount: summary.missionItemCount,
      hiddenMissionItemCount: summary.hiddenMissionItemCount,
      missionActionCount: summary.missionActionCount,
      hiddenMissionActionCount: summary.hiddenMissionActionCount,
      missionBreakdown: summary.missionBreakdown,
      providerBreakdown: summary.providerBreakdown,
      isolationBreakdown: summary.isolationBreakdown,
      cleanupBreakdown: summary.cleanupBreakdown,
      supervisorItems: summary.supervisorItems,
      hiddenSupervisorItems: summary.hiddenSupervisorItems,
      staleItems: summary.staleItems,
      memoryItems: summary.memoryItems,
      reviewItems: summary.reviewItems,
      attentionItems: summary.attentionItems,
      attentionBreakdown: summary.attentionBreakdown,
      readinessBreakdown: summary.readinessBreakdown,
      missionControlDispatchBreakdown: summary.missionControlDispatchBreakdown,
      authItems: summary.authItems,
      evidenceItems: summary.evidenceItems,
      proofItems: summary.proofItems,
      memoryRequestItems: summary.memoryRequestItems,
      riskItems: summary.riskItems,
      riskBreakdown: summary.riskBreakdown,
      closeoutBreakdown: summary.closeoutBreakdown,
      recoveryItems: summary.recoveryItems,
      recentEvents: summary.recentEvents,
      inputItems: summary.inputItems,
      outputItems: summary.outputItems,
      nextItems: summary.nextItems,
      extractedItems: summary.extractedItems,
      reviewReadyWithProof: summary.reviewReadyWithProof,
      reviewNeedsProof: summary.reviewNeedsProof,
      reviewReadyWithMemory: summary.reviewReadyWithMemory,
      reviewNeedsMemory: summary.reviewNeedsMemory,
      reviewCloseoutReady: summary.reviewCloseoutReady,
      reviewCloseoutBlocked: summary.reviewCloseoutBlocked,
      total: summary.total + 1,
      promptCount: summary.promptCount + (workstream.inputQueue?.length ?? 0),
      missionControlPromptCount: summary.missionControlPromptCount + (workstream.inputQueue?.filter((input) => input.source === "mission-control").length ?? 0),
      missionControlPromptSentCount: summary.missionControlPromptSentCount + (workstream.inputQueue?.filter((input) => input.source === "mission-control" && input.sentAt).length ?? 0),
      outputCount: summary.outputCount + (workstream.terminalOutput?.trim() ? 1 : 0),
      nextCount: summary.nextCount + (workstream.nextAction?.trim() ? 1 : 0),
      extractedCount:
        summary.extractedCount +
        (workstream.cockpitObjects?.length ?? cockpitObjectsForWorkstream(item.tab, workstream).length),
      active: summary.active + (active ? 1 : 0),
      waiting: summary.waiting + (waiting ? 1 : 0),
      blocked: summary.blocked + (blocked ? 1 : 0),
      complete: summary.complete + (complete ? 1 : 0),
      interrupted: summary.interrupted + (interrupted ? 1 : 0),
      shared: summary.shared + (shared ? 1 : 0),
      dedicated: summary.dedicated + (dedicated ? 1 : 0),
      dedicatedReady: summary.dedicatedReady + (dedicatedReady ? 1 : 0),
      cleanupReady: summary.cleanupReady + (cleanupReady ? 1 : 0),
      cleanupRequested: summary.cleanupRequested + (cleanupRequested ? 1 : 0),
      attention: summary.attention + (attention ? 1 : 0),
      primaryAttention: summary.primaryAttention,
    };
  }, {
    workstreams,
    workspaceGroups: summarizeWorkspaceGroups(workstreams),
    cockpitHeadline: {
      label: "Idle",
      detail: "No active agent work",
      tone: "idle",
    },
    missionItemCount: 0,
    hiddenMissionItemCount: 0,
    missionActionCount: 0,
    hiddenMissionActionCount: 0,
    missionBreakdown: [],
    providerBreakdown: [],
    isolationBreakdown: [],
    cleanupBreakdown: [],
    supervisorItems: [],
    hiddenSupervisorItems: [],
    staleItems: workstreams
      .map((item) => staleWorkstreamFor(item, now))
      .filter((item): item is NonNullable<ReturnType<typeof staleWorkstreamFor>> => Boolean(item)),
    memoryItems: workstreams.flatMap(({ tab, workstream }) => {
      const memory = workstream.memory?.trim();
      const title = workstream.mission ?? workstream.prompt ?? tab.title;
      return memory && memory !== NO_AGENT_MEMORY
        ? [{ tabId: tab.id, title, memory, brief: `${title}: ${memory}` }]
        : [];
    }),
    reviewItems: workstreams.flatMap(({ tab, workstream }) => {
      if (!isReviewReadyWorkstream(workstream)) return [];
      const proofStatus = workstream.evidence?.trim() || workstream.artifact?.trim()
        ? "Ready with proof"
        : "Needs proof";
      const memory = workstream.memory?.trim();
      const handoffStatus = memory && memory !== NO_AGENT_MEMORY
        ? "Memory ready"
        : "Needs memory";
      return [{
        tabId: tab.id,
        title: workstream.mission ?? workstream.prompt ?? tab.title,
        summary: workstream.lastSummary ?? "Agent run is ready for review",
        proofStatus,
        handoffStatus,
        detail: workstream.artifact ?? workstream.evidence ?? workstream.nextAction ?? "Review output",
      }];
    }),
    attentionItems: workstreams
      .map(attentionForWorkstream)
      .filter((item): item is NonNullable<ReturnType<typeof attentionForWorkstream>> => Boolean(item))
      .sort((a, b) => a.priority - b.priority)
      .map(({ priority: _priority, ...item }) => item),
    attentionBreakdown: [],
    readinessBreakdown: [],
    missionControlDispatchBreakdown: [],
    authItems: workstreams.flatMap(({ tab, workstream }) => {
      if (workstream.readiness !== "auth-required") return [];
      const title = workstream.mission ?? workstream.prompt ?? tab.title;
      const reason = workstream.lastSummary ?? "Provider requires authentication";
      const nextAction = workstream.nextAction ?? "Authenticate the provider CLI, then restart or recover the run.";
      const readinessCheck = workstream.readinessCheck;
      const authCheck = workstream.authCheck;
      const providerMessage = workstream.providerAvailabilityMessage;
      const parts = [
        `${title}: ${reason}`,
        `next=${nextAction}`,
        readinessCheck ? `readiness=${readinessCheck}` : null,
        authCheck ? `auth=${authCheck}` : null,
        providerMessage ? `provider=${providerMessage}` : null,
      ].filter((part): part is string => Boolean(part));
      return [{
        tabId: tab.id,
        title,
        reason,
        nextAction,
        readinessCheck,
        authCheck,
        providerMessage,
        brief: parts.join("; "),
      }];
    }),
    evidenceItems: workstreams.flatMap(({ tab, workstream }) => {
      const evidence = workstream.evidence?.trim();
      const artifact = workstream.artifact?.trim();
      if (!evidence && !artifact) return [];
      const evidenceText = evidence ?? "No evidence line reported";
      const artifactPath = resolveArtifactPath(workstream, artifact);
      return [{
        tabId: tab.id,
        title: workstream.mission ?? workstream.prompt ?? tab.title,
        evidence: evidenceText,
        artifact,
        artifactPath,
        artifactName: artifactNameFor(artifactPath),
        brief: `${workstream.mission ?? workstream.prompt ?? tab.title}: ${evidenceText}${artifact ? ` (${artifact})` : ""}`,
      }];
    }),
    proofItems: workstreams.flatMap(({ tab, workstream }) => {
      if (!needsProof(workstream)) return [];
      return [{
        tabId: tab.id,
        title: workstream.mission ?? workstream.prompt ?? tab.title,
        summary: workstream.lastSummary ?? "Agent run completed without proof",
        request: workstream.nextAction ?? "Ask the agent for evidence, artifacts, or exact verification commands before review.",
      }];
    }),
    memoryRequestItems: workstreams.flatMap(({ tab, workstream }) => {
      if (!needsHandoffMemory(workstream)) return [];
      const title = workstream.mission ?? workstream.prompt ?? tab.title;
      return [{
        tabId: tab.id,
        title,
        summary: workstream.lastSummary ?? "Agent run is ready for handoff memory",
        proofStatus: "Ready with proof",
        handoffStatus: "Needs memory",
        request: handoffMemoryPromptForWorkstream(workstream),
      }];
    }),
    riskItems: workstreams.flatMap(({ tab, workstream }) => {
      if (!isRiskyWorkstream(workstream)) return [];
      const confidence = workstream.confidence?.trim();
      const risk = workstream.risk?.trim();
      const confidenceText = confidence ? `confidence=${confidence}` : "confidence pending";
      const riskText = risk ? `risk=${risk}` : "risk pending";
      return [{
        tabId: tab.id,
        title: workstream.mission ?? workstream.prompt ?? tab.title,
        confidence,
        risk,
        detail: `${confidenceText} · ${riskText}`,
        prompt: riskMitigationPromptForWorkstream(workstream),
      }];
    }),
    riskBreakdown: [],
    closeoutBreakdown: [],
    recoveryItems: workstreams.flatMap(({ tab, workstream }) => {
      if (!isRecoveryReadyWorkstream(workstream)) return [];
      return [{
        tabId: tab.id,
        title: workstream.mission ?? workstream.prompt ?? tab.title,
        reason: workstream.lastSummary ?? workstream.providerAvailabilityMessage ?? "Agent run is blocked",
        prompt: recoveryPromptForWorkstream(workstream),
      }];
    }),
    recentEvents: workstreams
      .flatMap(({ tab, workstream }) =>
        (workstream.events ?? []).map((event) => {
          const title = workstream.mission ?? workstream.prompt ?? tab.title;
          const detail = event.detail ? ` - ${event.detail}` : "";
          return {
            tabId: tab.id,
            title,
            kind: event.kind,
            label: event.label,
            detail: event.detail,
            at: event.at,
            brief: `${title}: ${event.kind} · ${event.label}${detail}`,
          };
        })
      )
      .sort((a, b) => b.at - a.at)
      .slice(0, 5),
    inputItems: workstreams
      .flatMap(({ tab, workstream }) => {
        const title = workstream.mission ?? workstream.prompt ?? tab.title;
        return (workstream.inputQueue ?? []).map((input) => {
          const state = input.sentAt ? "sent" : "queued";
          const source = workstreamInputSourceText(input);
          return {
            tabId: tab.id,
            title,
            text: input.text,
            state,
            source: input.source,
            label: input.label,
            at: input.sentAt ?? input.createdAt,
            brief: `${title}: ${state}${source} - ${input.text}`,
          } as const;
        });
      })
      .sort((a, b) => b.at - a.at)
      .slice(0, 5),
    outputItems: workstreams
      .flatMap(({ tab, workstream }) => {
        const output = workstream.terminalOutput?.trim();
        if (!output) return [];
        const title = workstream.mission ?? workstream.prompt ?? tab.title;
        return [{
          tabId: tab.id,
          title,
          output,
          at: workstream.terminalOutputUpdatedAt ?? workstream.lastActivityAt ?? workstream.createdAt,
          brief: `${title}: ${output}`,
        }];
      })
      .sort((a, b) => b.at - a.at)
      .slice(0, 5),
    nextItems: workstreams
      .flatMap(({ tab, workstream }) => {
        const nextAction = workstream.nextAction?.trim();
        if (!nextAction) return [];
        const title = workstream.mission ?? workstream.prompt ?? tab.title;
        return [{
          tabId: tab.id,
          title,
          nextAction,
          at: workstream.lastActivityAt ?? workstream.activityUpdatedAt ?? workstream.createdAt,
          brief: `${title}: next - ${nextAction}`,
        }];
      })
      .sort((a, b) => b.at - a.at)
      .slice(0, 5),
    extractedItems: workstreams
      .flatMap(({ tab, workstream }) =>
        cockpitObjectsForWorkstream(tab, workstream).map((item) => extractedLaneItem(tab, workstream, item))
      )
      .sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt)
      .slice(0, 8),
    total: 0,
    promptCount: 0,
    missionControlPromptCount: 0,
    missionControlPromptSentCount: 0,
    outputCount: 0,
    nextCount: 0,
    extractedCount: 0,
    reviewReadyWithProof: 0,
    reviewNeedsProof: 0,
    reviewReadyWithMemory: 0,
    reviewNeedsMemory: 0,
    reviewCloseoutReady: 0,
    reviewCloseoutBlocked: 0,
    active: 0,
    waiting: 0,
    blocked: 0,
    complete: 0,
    interrupted: 0,
    shared: 0,
    dedicated: 0,
    dedicatedReady: 0,
    cleanupReady: 0,
    cleanupRequested: 0,
    attention: 0,
  });

  const primaryAttention = workstreams
    .map(attentionForWorkstream)
    .filter((item): item is NonNullable<ReturnType<typeof attentionForWorkstream>> => Boolean(item))
    .sort((a, b) => a.priority - b.priority)[0];
  const rawSupervisorItems = [
    ...summary.recoveryItems.map((item) => ({
      tabId: item.tabId,
      title: item.title,
      label: "Recover",
      detail: item.reason,
      action: "queue-prompt" as const,
      prompt: item.prompt,
      priority: 0,
    })),
    ...summary.proofItems.map((item) => ({
      tabId: item.tabId,
      title: item.title,
      label: "Request proof",
      detail: item.summary,
      action: "queue-prompt" as const,
      prompt: item.request,
      priority: 1,
    })),
    ...summary.memoryRequestItems.map((item) => ({
      tabId: item.tabId,
      title: item.title,
      label: "Request memory",
      detail: `${item.proofStatus} · ${item.handoffStatus} · ${item.summary}`,
      action: "queue-prompt" as const,
      prompt: item.request,
      priority: 2,
    })),
    ...summary.riskItems.map((item) => ({
      tabId: item.tabId,
      title: item.title,
      label: "Mitigate risk",
      detail: item.detail,
      action: "queue-prompt" as const,
      prompt: item.prompt,
      priority: 3,
    })),
    ...summary.staleItems.map((item) => ({
      tabId: item.tabId,
      title: item.title,
      label: "Check in",
      detail: item.detail,
      action: "queue-prompt" as const,
      prompt: item.prompt,
      priority: 4,
    })),
    ...summary.reviewItems.map((item) => ({
      tabId: item.tabId,
      title: item.title,
      label: "Review",
      detail: `${item.proofStatus} · ${item.handoffStatus} · ${item.summary}`,
      action: "review" as const,
      priority: 5,
    })),
    ...workstreams
      .filter(({ workstream }) => workstream.worktreeCleanupStatus === "requested")
      .map(({ tab, workstream }) => ({
        tabId: tab.id,
        title: workstream.mission ?? workstream.prompt ?? tab.title,
        label: "Cleanup pending",
        detail: workstream.worktreeCleanupNote ?? workstream.worktreePath ?? "Worktree cleanup requested",
        action: "focus" as const,
        actionText: "focus run and execute guarded cleanup",
        priority: 6,
      })),
    ...summary.attentionItems.map((item) => ({
      tabId: item.tabId,
      title: item.title,
      label: item.label,
      detail: item.detail,
      action: "focus" as const,
      priority: 7,
    })),
  ].sort((a, b) => a.priority - b.priority);
  const allSupervisorItems = rawSupervisorItems
    .filter((item, index, items) => items.findIndex((candidate) => candidate.tabId === item.tabId) === index)
    .map((item) => {
      const alternateActions = rawSupervisorItems
        .filter((candidate) => candidate.tabId === item.tabId && candidate !== item)
        .map((candidate) => {
          let actionText = "focus run";
          if (candidate.action === "queue-prompt") {
            actionText = "send prompt";
          } else if (candidate.action === "review") {
            actionText = "mark reviewed";
          } else if ("actionText" in candidate && typeof candidate.actionText === "string") {
            actionText = candidate.actionText;
          }
          return {
            label: candidate.label,
            detail: candidate.detail,
            actionText,
          };
        });
      return alternateActions.length > 0 ? { ...item, alternateActions } : item;
    });
  const tabsById = new Map(workstreams.map(({ tab }) => [tab.id, tab]));
  const missionControlItems = allSupervisorItems
    .map(({ priority: _priority, ...item }) => ({
      ...item,
      activity: missionControlActivity(tabsById.get(item.tabId)),
      signalAge: missionControlSignalAge(tabsById.get(item.tabId), now),
      signalSource: missionControlSignalSource(tabsById.get(item.tabId)),
      runIdentity: missionControlRunIdentity(tabsById.get(item.tabId)),
      workspaceIdentity: missionControlWorkspaceIdentity(tabsById.get(item.tabId)),
    }));
  const supervisorItems = missionControlItems.slice(0, 5);
  const hiddenSupervisorItems = missionControlItems.slice(5);
  const visibleMissionActionCount = supervisorItems.reduce((count, item) => count + missionControlActionWeight(item), 0);
  const hiddenMissionActionCount = hiddenSupervisorItems.reduce((count, item) => count + missionControlActionWeight(item), 0);
  const missionItemCount = missionControlItems.length;
  const hiddenMissionItemCount = Math.max(0, missionItemCount - supervisorItems.length);
  const missionActionCount = visibleMissionActionCount + hiddenMissionActionCount;
  const missionBreakdown = missionBreakdownFor(rawSupervisorItems);
  const missionControlDispatchBreakdown = missionControlDispatchBreakdownFor(workstreams);
  const providerBreakdown = providerBreakdownFor(workstreams);
  const isolationBreakdown = isolationBreakdownFor(workstreams);
  const cleanupBreakdown = cleanupBreakdownFor(workstreams);
  const attentionBreakdown = attentionBreakdownFor(summary.attentionItems);
  const readinessBreakdown = readinessBreakdownFor(workstreams);
  const riskBreakdown = riskBreakdownFor(summary.riskItems);
  const closeoutBreakdown = closeoutBreakdownFor(summary.reviewItems);
  const reviewReadyWithProof = summary.reviewItems.filter((item) => item.proofStatus === "Ready with proof").length;
  const reviewNeedsProof = summary.reviewItems.filter((item) => item.proofStatus === "Needs proof").length;
  const reviewReadyWithMemory = summary.reviewItems.filter((item) => item.handoffStatus === "Memory ready").length;
  const reviewNeedsMemory = summary.reviewItems.filter((item) => item.handoffStatus === "Needs memory").length;
  const reviewCloseoutReady = summary.reviewItems.filter((item) => isReviewItemCloseoutReady(item)).length;
  const reviewCloseoutBlocked = summary.reviewItems.length - reviewCloseoutReady;

  return {
    ...summary,
    missionItemCount,
    hiddenMissionItemCount,
    missionActionCount,
    hiddenMissionActionCount,
    missionBreakdown,
    missionControlDispatchBreakdown,
    providerBreakdown,
    isolationBreakdown,
    cleanupBreakdown,
    attentionBreakdown,
    readinessBreakdown,
    riskBreakdown,
    closeoutBreakdown,
    reviewReadyWithProof,
    reviewNeedsProof,
    reviewReadyWithMemory,
    reviewNeedsMemory,
    reviewCloseoutReady,
    reviewCloseoutBlocked,
    supervisorItems,
    hiddenSupervisorItems,
    cockpitHeadline: cockpitHeadlineFor(summary, supervisorItems, hiddenMissionItemCount),
    ...(primaryAttention
      ? {
          primaryAttention: {
            tabId: primaryAttention.tabId,
            title: primaryAttention.title,
            label: primaryAttention.label,
            detail: primaryAttention.detail,
          },
        }
      : {}),
  };
}

export function agentLaneStatusText(summary: AgentLaneSummary) {
  if (summary.total === 0) return "No agent runs";
  return `${summary.total} agents · ${summary.workspaceGroups.length} workspace groups · ${summary.missionItemCount} mission rows · ${summary.hiddenMissionItemCount} hidden mission rows · ${summary.missionActionCount} mission actions · ${summary.hiddenMissionActionCount} hidden mission actions · ${summary.promptCount} prompts · ${summary.missionControlPromptCount} mission-control prompts · ${summary.missionControlPromptSentCount} mission-control sent · ${summary.outputCount} outputs · ${summary.nextCount} next actions · ${summary.extractedCount} extracted · ${summary.memoryItems.length} memories · ${summary.recentEvents.length} events · ${summary.staleItems.length} stale · ${summary.evidenceItems.length} evidence · ${summary.proofItems.length} proof needed · ${summary.authItems.length} auth · ${summary.riskItems.length} risk · ${summary.recoveryItems.length} recovery · ${summary.reviewItems.length} review ready · ${summary.reviewCloseoutReady} closeout ready · ${summary.reviewCloseoutBlocked} closeout blocked · ${summary.reviewReadyWithProof} proven review · ${summary.reviewNeedsProof} unproven review · ${summary.reviewReadyWithMemory} handoff ready · ${summary.reviewNeedsMemory} handoff missing · ${summary.attentionItems.length} attention queue · ${summary.active} active · ${summary.waiting} waiting · ${summary.blocked} blocked · ${summary.complete} complete · ${summary.dedicated} dedicated · ${summary.shared} shared · ${summary.cleanupReady} cleanup ready · ${summary.cleanupRequested} cleanup requested · ${summary.attention} need attention`;
}

export function agentLaneHealthText(summary: AgentLaneSummary) {
  if (summary.total === 0) return "No agent runs";

  const pressure =
    summary.authItems.length +
    summary.recoveryItems.length +
    summary.riskItems.length +
    summary.staleItems.length +
    summary.proofItems.length +
    summary.reviewCloseoutBlocked +
    summary.cleanupReady +
    summary.cleanupRequested;
  const label =
    pressure > 0
      ? "Needs attention"
      : summary.reviewCloseoutReady > 0
        ? "Review ready"
        : summary.active > 0
          ? "Running"
          : "Stable";
  const parts = [
    `${summary.total} agents`,
    summary.active > 0 ? `${summary.active} active` : null,
    summary.waiting > 0 ? `${summary.waiting} waiting` : null,
    summary.blocked > 0 ? `${summary.blocked} blocked` : null,
    summary.complete > 0 ? `${summary.complete} complete` : null,
    `${summary.workspaceGroups.length} groups`,
    summary.attentionItems.length > 0 ? `${summary.attentionItems.length} attention` : null,
    summary.authItems.length > 0 ? `${summary.authItems.length} auth` : null,
    summary.recoveryItems.length > 0 ? `${summary.recoveryItems.length} recovery` : null,
    summary.riskItems.length > 0 ? `${summary.riskItems.length} risk` : null,
    summary.staleItems.length > 0 ? `${summary.staleItems.length} stale` : null,
    summary.extractedCount > 0 ? `${summary.extractedCount} extracted` : null,
    summary.proofItems.length > 0 ? `${summary.proofItems.length} proof` : null,
    summary.reviewCloseoutReady > 0 ? `${summary.reviewCloseoutReady} closeout ready` : null,
    summary.reviewCloseoutBlocked > 0 ? `${summary.reviewCloseoutBlocked} closeout blocked` : null,
    summary.cleanupReady > 0 ? `${summary.cleanupReady} cleanup ready` : null,
    summary.cleanupRequested > 0 ? `${summary.cleanupRequested} cleanup` : null,
  ].filter((part): part is string => Boolean(part));

  return `${label} · ${parts.join(" · ")}`;
}

export function formatAgentLaneBrief(summary: AgentLaneSummary) {
  const lines = [
    "Agent supervision brief",
    `Totals: ${agentLaneStatusText(summary)}`,
    `Health: ${agentLaneHealthText(summary)}`,
    `Mission-control dispatch: ${missionControlDispatchText(summary)}`,
    `Mission-control dispatch mix: ${missionControlDispatchBreakdownText(summary)}`,
    `Cockpit headline: ${summary.cockpitHeadline.label} - ${summary.cockpitHeadline.detail}`,
    `Provider mix: ${providerBreakdownText(summary)}`,
    `Isolation mix: ${isolationBreakdownText(summary)}`,
    `Cleanup mix: ${cleanupBreakdownText(summary)}`,
    `Readiness mix: ${readinessBreakdownText(summary)}`,
    `Attention mix: ${attentionBreakdownText(summary)}`,
    `Risk mix: ${riskBreakdownText(summary)}`,
    `Closeout mix: ${closeoutBreakdownText(summary)}`,
    "",
    "Workspace groups:",
  ];

  if (summary.workspaceGroups.length === 0) {
    lines.push("- none");
  } else {
    for (const group of summary.workspaceGroups) {
      const cleanup = group.cleanupRequested > 0 ? `, cleanup requested=${group.cleanupRequested}` : "";
      const attention = group.attention > 0 ? `, attention=${group.attention}` : "";
      lines.push(`- ${group.label}: ${group.total} agents, ${group.active} active${cleanup}${attention} (${group.detail})`);
    }
  }

  lines.push("", "Mission control:");
  if (summary.supervisorItems.length === 0) {
    lines.push("- none");
  } else {
    for (const item of summary.supervisorItems) {
      lines.push(`- ${item.title}: ${item.label} (${item.detail})`);
      lines.push(`  Run: ${item.runIdentity}`);
      lines.push(`  Workspace: ${item.workspaceIdentity}`);
      lines.push(`  Now: ${item.activity}`);
      lines.push(`  Signal: ${item.signalAge}`);
      lines.push(`  Source: ${item.signalSource}`);
      if (item.action === "queue-prompt" && item.prompt) {
        lines.push("  Action: send prompt", `  Prompt: ${item.prompt}`);
      } else if (item.action === "review") {
        lines.push("  Action: mark reviewed");
      } else {
        lines.push(`  Action: ${item.actionText ?? "focus run"}`);
      }
      const alternateText = missionControlAlternateText(item);
      if (alternateText) lines.push(`  Also: ${alternateText}`);
    }
    if (summary.hiddenMissionItemCount > 0) {
      lines.push(`- +${summary.hiddenMissionItemCount} more mission rows hidden (${summary.hiddenMissionActionCount} actions)`);
    }
  }

  lines.push("", "Hidden mission control:");
  if (summary.hiddenSupervisorItems.length === 0) {
    lines.push("- none");
  } else {
    for (const item of summary.hiddenSupervisorItems) {
      lines.push(`- ${item.title}: ${item.label} (${item.detail})`);
      lines.push(`  Run: ${item.runIdentity}`);
      lines.push(`  Workspace: ${item.workspaceIdentity}`);
      lines.push(`  Now: ${item.activity}`);
      lines.push(`  Signal: ${item.signalAge}`);
      lines.push(`  Source: ${item.signalSource}`);
      if (item.action === "queue-prompt" && item.prompt) {
        lines.push("  Action: send prompt", `  Prompt: ${item.prompt}`);
      } else if (item.action === "review") {
        lines.push("  Action: mark reviewed");
      } else {
        lines.push(`  Action: ${item.actionText ?? "focus run"}`);
      }
      const alternateText = missionControlAlternateText(item);
      if (alternateText) lines.push(`  Also: ${alternateText}`);
    }
  }

  lines.push("", "Recent events:");
  if (summary.recentEvents.length === 0) {
    lines.push("- none");
  } else {
    for (const item of summary.recentEvents) {
      const detail = item.detail ? ` - ${item.detail}` : "";
      lines.push(`- ${item.title}: ${item.kind} · ${item.label}${detail}`);
    }
  }

  lines.push("", "Operator prompts:");
  if (summary.inputItems.length === 0) {
    lines.push("- none");
  } else {
    for (const item of summary.inputItems) {
      const source = item.source === "mission-control"
        ? ` via mission-control${item.label ? ` ${item.label}` : ""}`
        : "";
      lines.push(`- ${item.title}: ${item.state}${source} - ${item.text}`);
    }
  }

  const missionControlInputs = summary.inputItems.filter((item) => item.source === "mission-control");
  lines.push("", "Mission-control prompts:");
  if (missionControlInputs.length === 0) {
    lines.push("- none");
  } else {
    for (const item of missionControlInputs) {
      lines.push(`- ${item.title}: ${item.state}${item.label ? ` · ${item.label}` : ""} - ${item.text}`);
    }
  }

  lines.push("", "Terminal output:");
  if (summary.outputItems.length === 0) {
    lines.push("- none");
  } else {
    for (const item of summary.outputItems) {
      lines.push(`- ${item.title}: ${item.output}`);
    }
  }

  lines.push("", "Next actions:");
  if (summary.nextItems.length === 0) {
    lines.push("- none");
  } else {
    for (const item of summary.nextItems) {
      lines.push(`- ${item.title}: ${item.nextAction}`);
    }
  }

  lines.push("", "Extracted cockpit objects:");
  if (summary.extractedItems.length === 0) {
    lines.push("- none");
  } else {
    for (const item of summary.extractedItems) {
      lines.push(`- ${item.title}: ${item.label} · ${item.text} · ${item.provenance}`);
    }
  }

  lines.push("", "Stale agents:");
  if (summary.staleItems.length === 0) {
    lines.push("- none");
  } else {
    for (const item of summary.staleItems) {
      lines.push(`- ${item.title}: ${item.detail}`);
    }
  }

  lines.push("", "Proof needed:");
  if (summary.proofItems.length === 0) {
    lines.push("- none");
  } else {
    for (const item of summary.proofItems) {
      lines.push(`- ${item.title}: ${item.summary}`, `  Request: ${item.request}`);
    }
  }

  lines.push("", "Handoff memory needed:");
  if (summary.memoryRequestItems.length === 0) {
    lines.push("- none");
  } else {
    for (const item of summary.memoryRequestItems) {
      lines.push(`- ${item.title}: ${item.proofStatus} · ${item.handoffStatus} · ${item.summary}`, `  Request: ${item.request}`);
    }
  }

  lines.push("", "Auth queue:");
  if (summary.authItems.length === 0) {
    lines.push("- none");
  } else {
    for (const item of summary.authItems) {
      lines.push(`- ${item.title}: ${item.reason}`);
      lines.push(`  Next: ${item.nextAction}`);
      if (item.readinessCheck) lines.push(`  Readiness: ${item.readinessCheck}`);
      if (item.authCheck) lines.push(`  Auth: ${item.authCheck}`);
      if (item.providerMessage) lines.push(`  Provider: ${item.providerMessage}`);
    }
  }

  lines.push("", "Risk queue:");
  if (summary.riskItems.length === 0) {
    lines.push("- none");
  } else {
    for (const item of summary.riskItems) {
      lines.push(`- ${item.title}: ${item.detail}`);
    }
  }

  lines.push("", "Recovery queue:");
  if (summary.recoveryItems.length === 0) {
    lines.push("- none");
  } else {
    for (const item of summary.recoveryItems) {
      lines.push(`- ${item.title}: ${item.reason}`, `  Prompt: ${item.prompt}`);
    }
  }

  lines.push("", "Evidence queue:");
  if (summary.evidenceItems.length === 0) {
    lines.push("- none");
  } else {
    for (const item of summary.evidenceItems) {
      lines.push(`- ${item.title}: ${item.evidence}${item.artifact ? ` (${item.artifact})` : ""}`);
    }
  }

  lines.push("", "Attention queue:");
  if (summary.attentionItems.length === 0) {
    lines.push("- none");
  } else {
    for (const item of summary.attentionItems) {
      lines.push(`- ${item.title}: ${item.label} (${item.detail})`);
    }
  }

  lines.push("", "Review queue:");
  if (summary.reviewItems.length === 0) {
    lines.push("- none");
  } else {
    for (const item of summary.reviewItems) {
      lines.push(`- ${item.title}: ${item.proofStatus} · ${item.handoffStatus} · ${item.summary} (${item.detail})`);
    }
  }

  lines.push("", "Agent runs:");
  if (summary.workstreams.length === 0) {
    lines.push("- none");
  } else {
    for (const { tab, workstream } of summary.workstreams) {
      const task = workstream.mission ?? workstream.prompt ?? tab.title;
      const status = `${workstream.status} / ${workstream.phase ?? "unknown"}`;
      const activity = workstreamActivityText(workstream, "No current activity");
      const next = workstream.nextAction ?? "Watch provider response";
      const memory = workstream.memory ?? NO_AGENT_MEMORY;
      const cockpitAsk = latestMissionControlAskText(workstream);
      lines.push(
        `- ${tab.title}: ${providerLabel(workstream.provider)} · ${status} · ${formatWorkstreamIsolation(workstream.isolationMode, workstream.isolationStatus)}`,
        `  Task: ${task}`,
        `  Cockpit ask: ${cockpitAsk || "none"}`,
        `  Now: ${activity}`,
        `  Next: ${next}`,
        `  Memory: ${memory}`,
        `  Worktree cleanup: ${workstream.worktreeCleanupStatus ?? "unknown"}`
      );
    }
  }

  return lines.join("\n");
}

export function formatAgentMissionControlBrief(summary: AgentLaneSummary) {
  const lines = [
    "Agent mission control brief",
    `Headline: ${summary.cockpitHeadline.label} - ${summary.cockpitHeadline.detail}`,
    `Queue: ${summary.missionItemCount} mission rows · ${summary.hiddenMissionItemCount} hidden rows · ${summary.missionActionCount} actions · ${summary.hiddenMissionActionCount} hidden actions · ${summary.total} agents`,
    `Provider mix: ${providerBreakdownText(summary)}`,
    `Isolation mix: ${isolationBreakdownText(summary)}`,
    `Cleanup mix: ${cleanupBreakdownText(summary)}`,
    `Readiness mix: ${readinessBreakdownText(summary)}`,
    `Closeout mix: ${closeoutBreakdownText(summary)}`,
    `Dispatch: ${missionControlDispatchText(summary)}`,
    `Dispatch mix: ${missionControlDispatchBreakdownText(summary)}`,
    `Breakdown: ${missionBreakdownText(summary)}`,
    "",
    "Mission control:",
  ];

  if (summary.supervisorItems.length === 0) {
    lines.push("- none");
  } else {
    for (const item of summary.supervisorItems) {
      lines.push(`- ${item.title}: ${item.label} (${item.detail})`);
      lines.push(`  Run: ${item.runIdentity}`);
      lines.push(`  Workspace: ${item.workspaceIdentity}`);
      lines.push(`  Now: ${item.activity}`);
      lines.push(`  Signal: ${item.signalAge}`);
      lines.push(`  Source: ${item.signalSource}`);
      if (item.action === "queue-prompt" && item.prompt) {
        lines.push("  Action: send prompt", `  Prompt: ${item.prompt}`);
      } else if (item.action === "review") {
        lines.push("  Action: mark reviewed");
      } else {
        lines.push(`  Action: ${item.actionText ?? "focus run"}`);
      }
      const alternateText = missionControlAlternateText(item);
      if (alternateText) lines.push(`  Also: ${alternateText}`);
    }
    if (summary.hiddenMissionItemCount > 0) {
      lines.push(`- +${summary.hiddenMissionItemCount} more mission rows hidden (${summary.hiddenMissionActionCount} actions)`);
    }
  }

  lines.push("", "Hidden mission control:");
  if (summary.hiddenSupervisorItems.length === 0) {
    lines.push("- none");
  } else {
    for (const item of summary.hiddenSupervisorItems) {
      lines.push(`- ${item.title}: ${item.label} (${item.detail})`);
      lines.push(`  Run: ${item.runIdentity}`);
      lines.push(`  Workspace: ${item.workspaceIdentity}`);
      lines.push(`  Now: ${item.activity}`);
      lines.push(`  Signal: ${item.signalAge}`);
      lines.push(`  Source: ${item.signalSource}`);
      if (item.action === "queue-prompt" && item.prompt) {
        lines.push("  Action: send prompt", `  Prompt: ${item.prompt}`);
      } else if (item.action === "review") {
        lines.push("  Action: mark reviewed");
      } else {
        lines.push(`  Action: ${item.actionText ?? "focus run"}`);
      }
      const alternateText = missionControlAlternateText(item);
      if (alternateText) lines.push(`  Also: ${alternateText}`);
    }
  }

  return lines.join("\n");
}
