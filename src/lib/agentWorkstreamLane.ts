import type { Tab, WorkstreamMetadata } from "./types";

export interface AgentLaneWorkstream {
  tab: Tab;
  workstream: WorkstreamMetadata;
}

export interface AgentLaneSummary {
  workstreams: AgentLaneWorkstream[];
  total: number;
  active: number;
  waiting: number;
  blocked: number;
  complete: number;
  interrupted: number;
  attention: number;
  primaryAttention?: {
    tabId: string;
    title: string;
    label: string;
    detail: string;
  };
}

function attentionForWorkstream(item: AgentLaneWorkstream) {
  const { tab, workstream } = item;
  if (workstream.phase === "reviewed") return null;
  if (workstream.readiness === "auth-required") {
    return {
      tabId: tab.id,
      title: tab.title,
      label: "Auth required",
      detail: workstream.nextAction ?? "Authenticate the provider CLI",
      priority: 0,
    };
  }
  if (workstream.phase === "needs-input" || workstream.status === "waiting") {
    return {
      tabId: tab.id,
      title: tab.title,
      label: "Needs input",
      detail: workstream.nextAction ?? "Send a follow-up prompt",
      priority: 1,
    };
  }
  if (workstream.phase === "cancelling") {
    return {
      tabId: tab.id,
      title: tab.title,
      label: "Cancelling",
      detail: workstream.nextAction ?? "Wait for provider acknowledgement",
      priority: 2,
    };
  }
  if (workstream.phase === "blocked" || workstream.status === "failed" || workstream.providerAvailable === false) {
    return {
      tabId: tab.id,
      title: tab.title,
      label: "Blocked",
      detail: workstream.lastSummary ?? workstream.providerAvailabilityMessage ?? "Provider blocked",
      priority: 3,
    };
  }
  if (workstream.phase === "complete" || workstream.status === "done") {
    return {
      tabId: tab.id,
      title: tab.title,
      label: "Complete",
      detail: workstream.nextAction ?? "Review output",
      priority: 4,
    };
  }
  return null;
}

export function summarizeAgentLane(tabs: Tab[]): AgentLaneSummary {
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
    const active =
      !waiting &&
      !blocked &&
      !complete &&
      !interrupted &&
      (workstream.phase === "queued" ||
        workstream.phase === "launching" ||
        workstream.phase === "active" ||
        workstream.status === "ready" ||
        workstream.status === "running");

    return {
      workstreams: summary.workstreams,
      total: summary.total + 1,
      active: summary.active + (active ? 1 : 0),
      waiting: summary.waiting + (waiting ? 1 : 0),
      blocked: summary.blocked + (blocked ? 1 : 0),
      complete: summary.complete + (complete ? 1 : 0),
      interrupted: summary.interrupted + (interrupted ? 1 : 0),
      attention: summary.attention + (attention ? 1 : 0),
      primaryAttention: summary.primaryAttention,
    };
  }, {
    workstreams,
    total: 0,
    active: 0,
    waiting: 0,
    blocked: 0,
    complete: 0,
    interrupted: 0,
    attention: 0,
  });

  const primaryAttention = workstreams
    .map(attentionForWorkstream)
    .filter((item): item is NonNullable<ReturnType<typeof attentionForWorkstream>> => Boolean(item))
    .sort((a, b) => a.priority - b.priority)[0];

  return primaryAttention
    ? {
        ...summary,
        primaryAttention: {
          tabId: primaryAttention.tabId,
          title: primaryAttention.title,
          label: primaryAttention.label,
          detail: primaryAttention.detail,
        },
      }
    : summary;
}

export function agentLaneStatusText(summary: AgentLaneSummary) {
  if (summary.total === 0) return "No agent runs";
  return `${summary.total} agents · ${summary.active} active · ${summary.waiting} waiting · ${summary.blocked} blocked · ${summary.complete} complete · ${summary.attention} need attention`;
}
