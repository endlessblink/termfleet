export interface AgentBudgetSnapshot {
  model?: string;
  reasoningEffort?: string;
  contextTokens?: number;
  contextWindow?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  rateLimitUsedPercent?: number;
}

export type AgentBudgetLevel = "normal" | "elevated" | "critical";

export interface AgentBudgetSignal {
  level: AgentBudgetLevel;
  contextPercent: number;
  modelLabel: string;
  reasoningLabel?: string;
  recommendation: string;
  direction: "lighter" | "stronger" | "keep";
  confidence: "low" | "medium" | "high";
  why: string;
  tradeoff: string;
  detail: string;
}

const HIGH_STAKES_WORK =
  /\b(?:security|threat|migration|data loss|corrupt|production|payment|billing|auth|permission|privacy)\b/i;
const INVESTIGATION_WORK =
  /\b(?:root[- ]cause|race|concurren|debug|investigat|regression|flaky|repeated fail|intermittent|recovery)\b/i;
const SYSTEM_WORK =
  /\b(?:architect|architecture|performance|benchmark|protocol|distributed|refactor|redesign|tradeoff|multi[- ]step)\b/i;

function complexityAssessment(activity: string) {
  const highStakes = HIGH_STAKES_WORK.test(activity);
  const investigation = INVESTIGATION_WORK.test(activity);
  const systemWork = SYSTEM_WORK.test(activity);
  const signalCount = [highStakes, investigation, systemWork].filter(
    Boolean,
  ).length;
  const reason = highStakes
    ? "This task has high-stakes failure or data-risk signals."
    : investigation
      ? "This task needs diagnosis across uncertain or repeated failures."
      : systemWork
        ? "This task needs broader system judgment or multi-step reasoning."
        : undefined;
  return { reason, signalCount };
}

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, value)
    : undefined;
}

function compactTokens(value: number | undefined): string {
  if (value === undefined) return "—";
  if (value >= 1_000_000)
    return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1_000)
    return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}K`;
  return String(Math.round(value));
}

export function agentModelLabel(model: string | undefined): string {
  const normalized = String(model ?? "").toLowerCase();
  if (normalized.includes("sol")) return "Sol";
  if (normalized.includes("luna")) return "Luna";
  const version = normalized.match(/gpt-(\d+(?:\.\d+)?)/)?.[1];
  return version ?? (model || "Model");
}

export function agentBudgetSignal(
  snapshot: AgentBudgetSnapshot,
  activity = "",
): AgentBudgetSignal {
  const contextTokens = finite(snapshot.contextTokens);
  const contextWindow = finite(snapshot.contextWindow);
  const contextPercent =
    contextTokens !== undefined && contextWindow
      ? Math.min(100, Math.round((contextTokens / contextWindow) * 100))
      : 0;
  const rateLimitUsedPercent = finite(snapshot.rateLimitUsedPercent) ?? 0;
  const pressure = Math.max(contextPercent, rateLimitUsedPercent);
  const modelLabel = agentModelLabel(snapshot.model);
  const reasoningLabel =
    String(snapshot.reasoningEffort ?? "").trim() || undefined;
  const complexity = complexityAssessment(activity);
  const complexReason = complexity.reason;
  const deepWork = Boolean(complexReason);

  let recommendation: string;
  let direction: AgentBudgetSignal["direction"];
  if (modelLabel === "Sol") {
    recommendation = deepWork
      ? "Keep Sol"
      : pressure >= 35
        ? "Switch to Luna"
        : "Sol is optional";
    direction = deepWork ? "keep" : pressure >= 35 ? "lighter" : "keep";
  } else if (modelLabel === "Luna") {
    recommendation = deepWork ? "Switch to Sol" : "Keep Luna";
    direction = deepWork ? "stronger" : "keep";
  } else if (modelLabel === "5.5") {
    recommendation = deepWork ? "Switch to Sol" : "5.5 is enough";
    direction = deepWork ? "stronger" : "keep";
  } else {
    recommendation = deepWork
      ? "Use a stronger model"
      : "A lighter model may be enough";
    direction = deepWork ? "stronger" : "lighter";
  }
  const level: AgentBudgetLevel =
    direction === "stronger"
      ? "elevated"
      : pressure >= 78
        ? "critical"
        : pressure >= 55
          ? "elevated"
          : "normal";
  const why =
    complexReason ??
    (direction === "lighter"
      ? "The current task looks clear and repeatable."
      : "The current model matches the task's apparent complexity.");
  const tradeoff =
    direction === "lighter"
      ? "Minimal downside for clear work; a lighter model may need more guidance on ambiguous edge cases."
      : direction === "stronger"
        ? "Higher token use and slower responses, in exchange for deeper judgment on risky or uncertain work."
        : "No model change is likely to improve the cost-quality balance right now.";
  const confidence: AgentBudgetSignal["confidence"] =
    complexity.signalCount >= 2
      ? "high"
      : direction === "keep" && pressure < 35
        ? "low"
        : "medium";

  return {
    level,
    contextPercent,
    modelLabel,
    reasoningLabel,
    recommendation,
    direction,
    confidence,
    why,
    tradeoff,
    detail: [
      `${compactTokens(contextTokens)} / ${compactTokens(contextWindow)} context`,
      reasoningLabel ? `${reasoningLabel} reasoning` : "",
      rateLimitUsedPercent
        ? `${Math.round(rateLimitUsedPercent)}% account budget`
        : "",
    ]
      .filter(Boolean)
      .join(" · "),
  };
}
