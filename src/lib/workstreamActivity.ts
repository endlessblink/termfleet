import type { WorkstreamActivityKind, WorkstreamActivitySource, WorkstreamMetadata } from "./types";

const ANSI_PATTERN = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;
const STRUCTURED_MARKER_PATTERN = /\[\[TERMFLEET_AGENT_EVENT\s+{.*?}\]\]/g;

export interface InferredWorkstreamActivity {
  currentActivity: string;
  activityKind: WorkstreamActivityKind;
  activitySource: WorkstreamActivitySource;
}

export function isWorkstreamActivityKind(value: unknown): value is WorkstreamActivityKind {
  return value === "starting" ||
    value === "running" ||
    value === "thinking" ||
    value === "testing" ||
    value === "editing" ||
    value === "waiting" ||
    value === "blocked" ||
    value === "complete" ||
    value === "idle";
}

export function normalizeActivityText(value: string, maxLength = 140) {
  const normalized = value
    .replace(ANSI_PATTERN, "")
    .replace(STRUCTURED_MARKER_PATTERN, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return undefined;
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized;
}

function isPromptOnlyLine(line: string) {
  return /^[>$#]\s*$/.test(line) ||
    /^[\w./~:-]+[$#]\s*$/.test(line) ||
    /^[\w.-]+@[\w.-]+:.*[$#]\s*$/.test(line) ||
    /^➜\s+\S+/.test(line) ||
    /^›\s*use\s+\/\w+/i.test(line) ||
    /^use\s+\/\w+/i.test(line) ||
    /^gpt[-\w. ]+\s+default\b/i.test(line) ||
    /^[«‹›|│┃¦\s•·-]*gpt[-\w. ]+\s+default\b/i.test(line) ||
    /^«\s*gpt[-\w. ]+\s+default\b/i.test(line) ||
    /\besc to interrupt\b/i.test(line);
}

export function activityKindForText(text: string): WorkstreamActivityKind {
  const lower = text.toLowerCase();
  if (/\b(failed|error|panic|exception|fatal|blocked|unavailable|not available|not on path)\b/.test(lower)) return "blocked";
  if (/\b(waiting for input|needs input|press enter|continue\?|yes\/no|y\/n|authenticate|login|sign in|api key)\b/.test(lower)) return "waiting";
  if (/\b(done|completed|complete|successfully|all tests passed|exited cleanly|reviewed)\b/.test(lower)) return "complete";
  if (/\b(test|tests|testing|playwright|vitest|jest|cargo test|pytest|checking|compiling|build)\b/.test(lower)) return "testing";
  if (/\b(apply_patch|patched|writing|updated|modified|created|deleted|renamed|saved)\b/.test(lower)) return "editing";
  if (/\b(thinking|planning|analyzing|investigating|searching|reading|inspecting)\b/.test(lower)) return "thinking";
  if (/\b(starting|launching|launched|boot|ready in|running devcommand)\b/.test(lower)) return "starting";
  return "running";
}

export function inferActivityFromOutput(output: string): InferredWorkstreamActivity | null {
  const lines = output
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => normalizeActivityText(line))
    .filter((line): line is string => Boolean(line))
    .filter((line) => !isPromptOnlyLine(line));

  const currentActivity = lines[lines.length - 1];
  if (!currentActivity) return null;

  return {
    currentActivity,
    activityKind: activityKindForText(currentActivity),
    activitySource: "terminal",
  };
}

export function workstreamActivityText(workstream?: WorkstreamMetadata, fallback = "Waiting for terminal output") {
  return workstream?.currentActivity ??
    workstream?.lastSummary ??
    workstream?.mission ??
    workstream?.prompt ??
    fallback;
}

export function workstreamActivityMeta(workstream?: WorkstreamMetadata) {
  const kind = workstream?.activityKind ?? "idle";
  const source = workstream?.activitySource ?? "system";
  return `${kind} · ${source}`;
}
