import type { TerminalActivitySummary, WorkstreamStatusSummary } from "./types";

function cleanText(value?: string | null) {
  return value?.replace(/\s+/g, " ").trim() || undefined;
}

function comparableText(value: string) {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function repeatsTitle(title: string, detail: string) {
  const titleText = comparableText(title);
  const detailText = comparableText(detail);
  if (!titleText || !detailText) return false;
  return titleText === detailText ||
    detailText.startsWith(`${titleText} `) ||
    (titleText.startsWith(`${detailText} `) && detailText.length > 12);
}

export function terminalActivityDetail(activity: TerminalActivitySummary, idleFallback = "Awaiting command") {
  const subtitle = cleanText(activity.subtitle);
  if (subtitle && !repeatsTitle(activity.title, subtitle)) return subtitle;
  if (typeof activity.progress === "number") return `${Math.round(activity.progress)}% complete`;
  if (activity.status === "idle") return idleFallback;
  if (activity.status === "success") {
    return typeof activity.exitCode === "number" ? `Finished with exit ${activity.exitCode}` : "Completed";
  }
  if (activity.status === "error") {
    return typeof activity.exitCode === "number" ? `Stopped with exit ${activity.exitCode}` : "Needs attention";
  }
  if (activity.status === "cancelled") return "Cancelled";
  return activity.command ? "Command is running" : "Activity in progress";
}

export function summaryFromDurableActivity(
  activity: TerminalActivitySummary,
  path: string,
  extractedSummary?: WorkstreamStatusSummary,
): WorkstreamStatusSummary {
  return {
    ...extractedSummary,
    task: activity.title,
    path,
    now: terminalActivityDetail(activity),
    status: activity.status === "success"
      ? "done"
      : activity.status === "error"
        ? "blocked"
        : activity.status === "idle"
          ? "idle"
          : "working",
    provider: "shell",
    confidence: activity.status === "idle" ? "low" : "high",
  };
}
