import type { AgentProvider, WorkstreamMetadata, WorkstreamStatus, WorkstreamStatusSummary } from "./types";
import { workstreamActivityText } from "./workstreamActivity";
import { cleanExtractedText, normalizeExtractedItems } from "./workstreamExtraction";
import { formatWorkstreamIsolation, pathLabel } from "./workstreamOpsContext";

export type AgentStatusLifecycle = WorkstreamStatusSummary["status"];
export type AgentStatusConfidence = "low" | "medium" | "high";

export type AgentStatusSummary = WorkstreamStatusSummary & {
  provider: AgentProvider;
  confidence: AgentStatusConfidence;
};

const OSC_PATTERN = /\x1b\](?:[^\x07\x1b]*)(?:\x07|\x1b\\)/g;

export interface AgentStatusSummaryInput {
  mission?: string;
  prompt?: string;
  provider?: AgentProvider;
  status?: WorkstreamStatus;
  phase?: WorkstreamMetadata["phase"];
  cwd?: string;
  cwdLabel?: string;
  gitRoot?: string;
  gitBranch?: string;
  worktreePath?: string;
  isolationMode?: WorkstreamMetadata["isolationMode"];
  isolationStatus?: WorkstreamMetadata["isolationStatus"];
  currentActivity?: string;
  lastSummary?: string;
  nextAction?: string;
  terminalOutput?: string;
  events?: Array<{
    kind?: string;
    label?: string;
    detail?: string;
    status?: string;
  }>;
  evidence?: string;
  risk?: string;
}

const NOISY_ACTIVITY_PATTERNS = [
  /^\/clear$/i,
  /^hi[!.]?$/i,
  /^hello[!.]?$/i,
  /^(explored|search|read|working|verified|tasks?):?$/i,
  /^term$/i,
  /^running\s+\d+\s+tests?\s+using\s+\d+\s+workers?/i,
  /^(\d+\s+passed|\d+\s+failed|\d+\s+skipped)\b/i,
  /^passed\s+\([\d.]+s\)$/i,
  /^(search|read)\s+.+\.(tsx?|jsx?|rs|md|json|css|mjs|cjs)\b/i,
  /\b(read|search)\s+[\w./-]+\s+in\s+[\w./-]+\.(tsx?|jsx?|rs|md|json|css|mjs|cjs)\b/i,
  /\bnode\.type\b/i,
  /\b[A-Za-z][\w.]*\|[A-Za-z][\w.]*\b/,
  /^web\$ /i,
  /^bash[$#]?\s*/i,
  /^supervised agent run$/i,
  /^shell ready$/i,
  /^›\s*/i,
  /^›\s*use\s+\/\w+/i,
  /^use\s+\/\w+/i,
  /^F\d+\w+\s+F\d+/i,
  /\bF10Quit\b/i,
  /^[«‹›|│┃¦\s•·-]*gpt[-\w. ]+\s+default\b/i,
  /^«?\s*\|?\s*gpt[-\w. ]+\s+default\b/i,
  /^«?\s*\|?\s*[\w.-]+\s+default\b/i,
  /\|\|?>/,
  /\besc to interrupt\b/i,
  /^codex: command is not available/i,
  /^claude: command is not available/i,
  /^opencode: command is not available/i,
  /command is not available in browser preview/i,
  /^provider (acknowledged cancellation|process exited)/i,
];

function cleanText(value?: string | null) {
  return value?.replace(/\s+/g, " ").replace(/^[•*-]\s+/, "").trim() || undefined;
}

function isNoisyActivity(value?: string | null) {
  const text = cleanText(value);
  if (!text) return true;
  return NOISY_ACTIVITY_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Clean a raw terminal transcript before it is sent to the status summarizer:
 * drop prompt chrome / spinner noise and collapse consecutive duplicate lines so
 * repeated paste / verification payload can't dominate the summary (TC-033 T2).
 * Returns the trailing `maxChars` of the cleaned text.
 */
export function cleanTranscriptForSummary(output?: string | null, maxChars = 1800) {
  const lines = (output ?? "")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim());
  const kept: string[] = [];
  for (const line of lines) {
    if (!line || isNoisyActivity(line)) continue;
    if (kept.length > 0 && kept[kept.length - 1] === line) continue;
    kept.push(line);
  }
  const joined = kept.join("\n");
  return joined.length > maxChars ? joined.slice(joined.length - maxChars) : joined;
}

function rawTranscriptLines(input: AgentStatusSummaryInput) {
  return (input.terminalOutput ?? "")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function hasVisibleShellPrompt(input: AgentStatusSummaryInput) {
  return rawTranscriptLines(input).slice(-5).some((line) =>
    /^[\w.-]+@[\w.-]+:[^$#>]*[$#>]\s*$/.test(line) ||
    /^[~./\w -]+[$#>]\s*$/.test(line)
  );
}

function transcriptLines(input: AgentStatusSummaryInput) {
  return rawTranscriptLines(input)
    .filter((line) => !isNoisyActivity(line));
}

function explicitLineupTasks(input: AgentStatusSummaryInput) {
  const lines = (input.terminalOutput ?? "")
    .replace(/\r/g, "\n")
    .replace(OSC_PATTERN, "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim());
  let headerIndex = -1;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (
      /:\s*$/.test(line) &&
      (
        /\b(?:current|my|agent|working)\s+(?:task\s+)?(?:lineup|todo\s+list|task\s+list)\b/i.test(line) ||
        /\blineup\s+for\b/i.test(line)
      )
    ) {
      headerIndex = index;
      break;
    }
  }
  if (headerIndex < 0) return [];

  const tasks: string[] = [];
  for (const line of lines.slice(headerIndex + 1)) {
    if (!line) {
      if (tasks.length > 0) break;
      continue;
    }

    const listed = line.match(/^(?:\d+[.)]|[-*])\s+(?:\[(x|done|complete| |todo|pending|in[- ]?progress)\]\s*)?(.+)$/i);
    const stated = line.match(/^(done|complete|todo|pending|not done|in[- ]?progress|blocked)\s*:\s*(.+)$/i);
    if (!listed && !stated) {
      if (tasks.length > 0) break;
      continue;
    }

    const rawStatus = listed?.[1] ?? stated?.[1] ?? "";
    const rawText = listed?.[2] ?? stated?.[2] ?? "";
    const text = cleanText(rawText.replace(/\.$/, ""));
    if (!text) continue;
    if (/^(yes|no|switch to|clear context|continue planning|press enter|esc\b)/i.test(text)) continue;
    if (/\b(plan mode|default and start coding|confirm or esc)\b/i.test(text)) continue;
    const status = rawStatus.toLowerCase();
    tasks.push(/^(x|done|complete)$/.test(status) ? `Done: ${text}` : text);
    if (tasks.length >= 12) break;
  }
  return tasks;
}

function quotedFlagValue(command: string, flag: string) {
  const escaped = flag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = command.match(new RegExp(`${escaped}\\s+(?:"([^"]+)"|'([^']+)'|([^\\s]+))`));
  return cleanText(match?.[1] ?? match?.[2] ?? match?.[3]);
}

function fileNameFromCommand(command: string) {
  const match = command.match(/(?:^|\s)([\w./-]+\.(?:spec|test)\.(?:tsx?|jsx?))/i);
  return match?.[1]?.split("/").filter(Boolean).pop();
}

function shellCommandSummary(input: AgentStatusSummaryInput) {
  if (input.provider !== "shell") return null;
  const command = rawTranscriptLines(input)
    .reverse()
    .find((line) => /\b(?:npx\s+)?playwright\s+test\b|\b(?:npm|pnpm|yarn)\s+(?:run\s+)?(?:test|verify:[\w:-]+)\b/i.test(line));
  if (!command) return null;

  const grep = quotedFlagValue(command, "-g") ?? quotedFlagValue(command, "--grep");
  const fileName = fileNameFromCommand(command);
  if (/\bplaywright\s+test\b/i.test(command)) {
    const target = fileName ?? "Playwright suite";
    return {
      task: "Playwright test",
      now: grep ? `${target} · grep: ${grep}` : `Running ${target}`,
    };
  }

  const script = command.match(/\b(?:npm|pnpm|yarn)\s+(?:run\s+)?([^\s]+)/i)?.[1];
  return {
    task: script ? `Running ${script}` : "Running command",
    now: fileName ? `Target: ${fileName}` : command.replace(/^[›$#\s]+/, "").slice(0, 90),
  };
}

function inferTranscriptTask(lines: string[]) {
  const text = lines.join("\n");
  if (/\bTasks:\s*\d+/.test(text) && /\bLoad average:/.test(text)) return "Monitoring processes";
  return lines.find((line) =>
    /^[\p{L}\p{N}][\p{L}\p{N}\s:_/-]{3,90}$/u.test(line) &&
    !/^(what changed|verified|done|output|path|signal|now)$/i.test(line) &&
    !/\b(passed|failed|error|http|github\.com|https?:\/\/)\b/i.test(line)
  );
}

function inferTranscriptNow(lines: string[], task?: string) {
  const text = lines.join("\n");
  if (/\bTasks:\s*\d+/.test(text) && /\bLoad average:/.test(text)) return "htop live process table";
  return lines.find((line) =>
    line !== task &&
    !/^(what changed|verified|done|output|path|signal|now):?$/i.test(line) &&
    /\b(now runs|validates|repair|rewrite|checking|reviewing|translated|translation|quality-gate|regression|deployed|active|200 ok|passed|completed|hook|triage|prompt-routing|explored|search|read|apply_patch|touching|architecture|mirroring|mirror)\b/i.test(line)
  );
}

function stripExtractionPrefix(line: string) {
  return line.replace(/^(task|todo|blocker|blocked|evidence|proof|verified|next|next action)\s*[:=-]\s*/i, "").trim();
}

function extractionCandidates(input: AgentStatusSummaryInput, task: string, status: AgentStatusLifecycle) {
  const lines = transcriptLines(input);
  const lineupTasks = explicitLineupTasks(input);
  const taskLines = lines
    .filter((line) => /^(task|todo|fix|implement|add|update|review|wire|persist)\b/i.test(line))
    .map(stripExtractionPrefix);
  const blockerLines = lines
    .filter((line) => /\b(blocked|blocker|failed|failure|error|cannot|missing|auth|credential|permission)\b/i.test(line))
    .map(stripExtractionPrefix);
  const evidenceLines = lines
    .filter((line) => /\b(evidence|proof|verified|passed|screenshot|artifact|report|build passed|tests? passed)\b/i.test(line))
    .map(stripExtractionPrefix);
  const nextLines = lines
    .filter((line) => /^(next|next action|todo)\b/i.test(line))
    .map(stripExtractionPrefix);

  return {
    tasks: [
      ...(input.provider === "shell" ? [] : [
        ...(cleanExtractedText(input.mission) && cleanExtractedText(input.mission) !== "Terminal" ? [input.mission] : []),
        ...(cleanExtractedText(input.prompt) ? [input.prompt] : []),
        ...(task && task !== "Ready" && task !== "Supervised agent run" ? [task] : []),
        ...taskLines,
        ...lineupTasks,
      ]),
    ],
    blockers: [
      input.risk,
      status === "blocked" ? input.lastSummary : undefined,
      ...blockerLines,
    ],
    evidence: [
      input.evidence,
      ...evidenceLines,
    ],
    nextActions: [
      input.nextAction,
      ...nextLines,
    ],
  };
}

function normalizeLifecycle(input: Pick<AgentStatusSummaryInput, "status" | "phase">): AgentStatusLifecycle {
  if (input.status === "done" || input.phase === "complete" || input.phase === "reviewed") return "done";
  if (input.status === "failed" || input.phase === "blocked") return "blocked";
  if (input.status === "waiting" || input.phase === "needs-input") return "waiting";
  if (input.status === "stopped" || input.phase === "interrupted") return "stopped";
  if (input.status === "running" || input.phase === "active" || input.phase === "launching" || input.phase === "queued") return "working";
  return "idle";
}

function pathFromInput(input: AgentStatusSummaryInput) {
  const root = cleanText(input.worktreePath) ?? cleanText(input.gitRoot) ?? cleanText(input.cwd);
  const label = cleanText(input.cwdLabel) ?? pathLabel(root);
  const branch = cleanText(input.gitBranch);
  if (label && branch) return `${label} · ${branch}`;
  return label ?? "workspace path unknown";
}

function fallbackNow(input: AgentStatusSummaryInput, task: string, status: AgentStatusLifecycle, commandSummary?: { now: string } | null) {
  if (commandSummary?.now && !isNoisyActivity(commandSummary.now)) return commandSummary.now;

  const activity = cleanText(input.currentActivity);
  if (activity && !isNoisyActivity(activity)) return activity;

  const next = cleanText(input.nextAction);
  if (next && !isNoisyActivity(next)) return next;

  const summary = cleanText(input.lastSummary);
  if (summary && !isNoisyActivity(summary)) return summary;

  const transcriptNow = cleanText(inferTranscriptNow(transcriptLines(input), task));
  if (transcriptNow && !isNoisyActivity(transcriptNow)) return transcriptNow;

  if (status === "blocked") return "Needs operator attention";
  if (status === "done") return "Ready for review";
  if (status === "waiting") return "Waiting for input";
  if (status === "stopped") return "Stopped by operator";
  if (status === "idle") return "Idle until the next prompt";
  return `Working on ${task}`;
}

export function fallbackAgentStatusSummary(input: AgentStatusSummaryInput): AgentStatusSummary {
  const lines = transcriptLines(input);
  const commandSummary = shellCommandSummary(input);
  const transcriptTask = cleanText(inferTranscriptTask(lines));
  const promptVisible = hasVisibleShellPrompt(input);
  const task =
    promptVisible && !transcriptTask ? "Ready" :
    (cleanText(input.mission) && cleanText(input.mission) !== "Terminal" ? cleanText(input.mission) : undefined) ??
    cleanText(input.prompt) ??
    commandSummary?.task ??
    transcriptTask ??
    "Supervised agent run";
  const status = promptVisible && task === "Ready" ? "idle" : normalizeLifecycle(input);
  const excerpt = (input.terminalOutput ?? input.currentActivity ?? input.lastSummary ?? task).slice(-240);
  const extracted = extractionCandidates(input, task, status);
  return {
    task,
    path: pathFromInput(input),
    now: promptVisible && task === "Ready" ? "Awaiting command" : fallbackNow(input, task, status, commandSummary),
    status,
    provider: input.provider ?? "codex",
    confidence: commandSummary ? "high" : cleanText(input.currentActivity) && !isNoisyActivity(input.currentActivity) ? "medium" : "low",
    proof: cleanText(input.evidence),
    blocker: status === "blocked" ? cleanText(input.risk) ?? cleanText(input.lastSummary) : undefined,
    tasks: normalizeExtractedItems(extracted.tasks, "summary", excerpt),
    blockers: normalizeExtractedItems(extracted.blockers, "summary", excerpt),
    evidence: normalizeExtractedItems(extracted.evidence, "summary", excerpt),
    nextActions: normalizeExtractedItems(extracted.nextActions, "summary", excerpt),
  };
}

export function agentStatusSummaryInputFromWorkstream(workstream: WorkstreamMetadata): AgentStatusSummaryInput {
  return {
    mission: workstream.mission,
    prompt: workstream.prompt,
    provider: workstream.provider,
    status: workstream.status,
    phase: workstream.phase,
    cwd: workstream.cwd,
    cwdLabel: workstream.cwdLabel,
    gitRoot: workstream.gitRoot,
    gitBranch: workstream.gitBranch,
    worktreePath: workstream.worktreePath,
    isolationMode: workstream.isolationMode,
    isolationStatus: workstream.isolationStatus,
    currentActivity: workstreamActivityText(workstream, ""),
    lastSummary: workstream.lastSummary,
    nextAction: workstream.nextAction,
    terminalOutput: workstream.terminalOutput,
    events: (workstream.events ?? []).slice(-8).map((event) => ({
      kind: event.kind,
      label: event.label,
      detail: event.detail,
      status: event.status,
    })),
    evidence: workstream.evidence,
    risk: workstream.risk,
  };
}

export function parseAgentStatusSummaryResponse(raw: string, fallback: AgentStatusSummary): AgentStatusSummary {
  try {
    const parsed = JSON.parse(raw) as Partial<AgentStatusSummary>;
    const task = cleanText(parsed.task);
    const path = cleanText(parsed.path);
    const now = cleanText(parsed.now);
    if (!task || !path || !now) return fallback;
    return {
      ...fallback,
      ...parsed,
      task,
      path,
      now: isNoisyActivity(now) ? fallback.now : now,
      status: parsed.status ?? fallback.status,
      provider: parsed.provider ?? fallback.provider,
      confidence: parsed.confidence ?? "medium",
      tasks: normalizeExtractedItems(parsed.tasks ?? fallback.tasks, "summary", raw),
      blockers: normalizeExtractedItems(parsed.blockers ?? fallback.blockers, "summary", raw),
      evidence: normalizeExtractedItems(parsed.evidence ?? fallback.evidence, "summary", raw),
      nextActions: normalizeExtractedItems(parsed.nextActions ?? fallback.nextActions, "summary", raw),
      // Carry the sidecar's authoritative-list flag; coerce so a fallback never
      // leaks a stale `true`.
      tasksFromTodoWrite: Boolean(parsed.tasksFromTodoWrite),
      // Carry the agent's recent-activity log (validated shape).
      recent: Array.isArray(parsed.recent)
        ? parsed.recent
            .filter((entry): entry is { text: string; at: number } => Boolean(entry && typeof entry.text === "string"))
            .map((entry) => ({ text: entry.text.slice(0, 90), at: Number(entry.at) || 0 }))
            .slice(-8)
        : [],
    };
  } catch {
    return fallback;
  }
}

export function displayAgentStatusSummary(
  input: AgentStatusSummaryInput,
  persisted?: WorkstreamStatusSummary | null
): AgentStatusSummary {
  const fallback = fallbackAgentStatusSummary(input);
  const task = cleanText(persisted?.task);
  const path = cleanText(persisted?.path);
  const now = cleanText(persisted?.now);
  const persistedUsable =
    Boolean(task && path && now) && !isNoisyActivity(task) && !isNoisyActivity(path) && !isNoisyActivity(now);
  // A fresh, confident persisted summary (e.g. the sidecar worker reporting the
  // agent's REAL current activity/todos) wins over the local heuristic — even for
  // shells, where the heuristic is often "high" confidence but generic.
  const persistedWins = persistedUsable && persisted?.confidence === "high";
  if (input.provider === "shell" && fallback.confidence === "high" && !persistedWins) {
    return fallback;
  }
  if (!persistedUsable || !task || !path || !now) {
    return fallback;
  }
  return {
    ...fallback,
    ...persisted,
    task,
    path,
    now,
    status: persisted?.status ?? fallback.status,
    provider: persisted?.provider ?? fallback.provider,
    confidence: persisted?.confidence ?? fallback.confidence,
    tasks: persisted?.tasks?.length ? persisted.tasks : input.provider === "shell" ? fallback.tasks : persisted?.tasks ?? fallback.tasks,
    blockers: persisted?.blockers ?? fallback.blockers,
    evidence: persisted?.evidence ?? fallback.evidence,
    nextActions: persisted?.nextActions ?? fallback.nextActions,
  };
}

export function getDisplaySummary(
  input: AgentStatusSummaryInput,
  persisted?: WorkstreamStatusSummary | null
): AgentStatusSummary {
  const summary = displayAgentStatusSummary(input, persisted);
  if (input.provider === "shell" && summary.task === "Supervised agent run") {
    return {
      ...summary,
      task: "Ready",
      now: summary.status === "idle" ? "Awaiting command" : "Awaiting terminal output",
      confidence: "low",
    };
  }
  return summary;
}

function persistedAgentStatusSummary(workstream: WorkstreamMetadata, fallback: AgentStatusSummary): AgentStatusSummary | null {
  const persisted = workstream.statusSummary;
  if (!persisted) return null;
  const task = cleanText(persisted?.task);
  const path = cleanText(persisted?.path);
  const now = cleanText(persisted?.now);
  if (!task || !path || !now) return null;
  return {
    ...fallback,
    ...persisted,
    task,
    path,
    now: isNoisyActivity(now) ? fallback.now : now,
    status: persisted.status ?? fallback.status,
    provider: persisted.provider ?? fallback.provider,
    confidence: persisted.confidence ?? fallback.confidence,
  };
}

export function agentStatusSummaryFromWorkstream(workstream?: WorkstreamMetadata): AgentStatusSummary | null {
  if (!workstream || workstream.kind !== "agent") return null;
  const fallback = fallbackAgentStatusSummary(agentStatusSummaryInputFromWorkstream(workstream));
  return persistedAgentStatusSummary(workstream, fallback) ?? fallback;
}

export function agentStatusChipText(workstream: WorkstreamMetadata, summary: AgentStatusSummary) {
  return [
    summary.provider,
    summary.status,
    summary.proof ? "has proof" : summary.blocker ? "blocked" : formatWorkstreamIsolation(workstream.isolationMode, workstream.isolationStatus),
  ].join(" · ");
}
