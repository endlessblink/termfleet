import type { TaskLineupItem, TerminalMainUserAsk, TerminalPurposeSource, WorkstreamStatusSummary } from "./types";
import { visibleTaskLineup } from "./taskLineup";

export const TASK_NOT_CAPTURED = "Task not captured";

export type TaskIdentitySource =
  | "manual"
  | "task-tool"
  | "user-prompt"
  | "plan-binding"
  | "sidecar-todo"
  | "workstream"
  | "missing";

export interface TaskIdentity {
  text: string;
  source: TaskIdentitySource;
  rawText?: string;
}

function clean(value?: string | null) {
  const text = value
    ?.replace(/\s+/g, " ")
    .replace(/\[Image\s+#?\d+\]\s*/gi, "")
    .trim();
  return text || undefined;
}

// Real task text is shown as the agent wrote it. The header never invents a label:
// it either shows captured task text or reports that no task was captured.
function normalizedOperatorAsk(value: string) {
  return value;
}

// Conversational lead-ins ("ok so go over everything…") are filler, not part of
// the ask. Stripping them is cleanup, not rewriting: the words that remain are
// still the user's own.
function stripLeadIn(text: string) {
  let out = text;
  for (let i = 0; i < 3; i += 1) {
    const next = out.replace(/^(?:ok(?:ay)?|so|and|well|alright|hey)[\s,]+/i, "");
    if (next === out) break;
    out = next;
  }
  return out.trim() || text;
}

function cleanPromptText(value?: string | null) {
  const raw = stripLeadIn(clean(value) ?? "");
  if (!raw) return undefined;
  const promptMatches = [...raw.matchAll(/[›❯»▸]\s*([^›❯»▸]+)/g)]
    .map((match) => match[1]?.replace(/^[>$#|\s]+/, "").replace(/^[-–—]\s*/, "").trim())
    .filter((text): text is string => Boolean(text));
  const lastPrompt = promptMatches[promptMatches.length - 1];
  if (lastPrompt && !/^use\s+\/[a-z]/i.test(lastPrompt)) {
    const text = clean(lastPrompt
      .replace(/\bgpt[-\w. ]+\s+default\b.*$/i, "")
      .replace(/\s*[-–—]\s*(?:[ivx]{1,4}|\d{1,3})\s*$/i, ""));
    return text ? normalizedOperatorAsk(text) : undefined;
  }
  const segments = raw
    .split(/[›❯»▸]/)
    .map((segment) => segment.replace(/^[>$#|\s]+/, "").replace(/^[-–—]\s*/, "").trim())
    .filter(Boolean);
  const text = clean((segments[0] ?? raw).replace(/\s*[-–—]\s*(?:[ivx]{1,4}|\d{1,3})\s*$/i, ""));
  return text ? normalizedOperatorAsk(text) : undefined;
}

// A placeholder in_progress row ("Answering latest prompt") must not mask a real
// task further down the list — otherwise the header falls all the way back to the
// raw prompt when the agent has actually declared what it is doing.
function activeTodoTask(items: TaskLineupItem[] | undefined, activeRunId?: string) {
  const visible = visibleTaskLineup(items, activeRunId).filter((item) => item.source === "todo-write");
  const real = visible.filter((item) => !isGenericDeclaredTask(item.content));
  const pick = (list: TaskLineupItem[]) =>
    list.find((item) => item.status === "in_progress") ?? list.find((item) => item.status === "pending") ?? list[0];
  return pick(real) ?? pick(visible);
}

function isGenericDeclaredTask(value?: string | null) {
  const text = clean(value);
  return Boolean(text && /^(?:Answering latest prompt|Answering user question|Implement the plan\.?)$/i.test(text));
}

// A bare conversational question the operator typed AT the agent ("what will this
// plugin cover?", "how does this work?") is not a task — echoing it as the Task row
// reads as "this is just what I wrote". Drop it so the agent's own activity, or an
// honest "not captured", shows instead. A directive that merely contains a "?" is
// kept; only an interrogative-opener + trailing "?" is treated as a bare question.
function looksLikeBareQuestion(text?: string | null) {
  const t = String(text ?? "").trim();
  if (!t.endsWith("?")) return false;
  return /^(?:what|why|how|when|where|who|whom|whose|which|should|shall|can|could|would|will|do|does|did|is|are|was|were|am|may|might|any)\b/i.test(t);
}

function scopedAsk(ask: TerminalMainUserAsk | null | undefined, activeRunId?: string) {
  if (!ask) return undefined;
  if (ask.runId && activeRunId && ask.runId !== activeRunId) return undefined;
  const text = ask.source === "terminal-prompt" || ask.source === "status-sidecar"
    ? cleanPromptText(ask.text)
    : clean(ask.text);
  return text ? normalizedOperatorAsk(text) : undefined;
}

export function resolveTaskIdentity(input: {
  taskLineup?: TaskLineupItem[];
  activeRunId?: string;
  mainUserAsk?: TerminalMainUserAsk | null;
  planBindingTitle?: string | null;
  planBindingSource?: TerminalPurposeSource | null;
  workstreamTitle?: string | null;
  statusSummary?: WorkstreamStatusSummary | null;
}): TaskIdentity {
  const ask = scopedAsk(input.mainUserAsk, input.activeRunId);
  if (ask && input.mainUserAsk?.source === "manual") return { text: ask, rawText: ask, source: "manual" };

  const taskToolTask = activeTodoTask(input.taskLineup, input.activeRunId);
  if (taskToolTask?.content && !isGenericDeclaredTask(taskToolTask.content)) {
    return { text: normalizedOperatorAsk(taskToolTask.content), rawText: taskToolTask.content, source: "task-tool" };
  }

  if (ask && input.mainUserAsk?.source === "task-tool") return { text: normalizedOperatorAsk(ask), rawText: ask, source: "task-tool" };
  if (ask && input.mainUserAsk?.source === "terminal-prompt" && !looksLikeBareQuestion(ask)) {
    return { text: normalizedOperatorAsk(ask), rawText: ask, source: "user-prompt" };
  }

  const planBinding = input.planBindingSource === "task-binding"
    ? clean(input.planBindingTitle)
    : undefined;
  if (planBinding) return { text: planBinding, rawText: planBinding, source: "plan-binding" };

  const sidecarUserTask = input.statusSummary?.tasksFromTodoWrite ? clean(input.statusSummary.userTask) : undefined;
  const sidecarSummaryTask = input.statusSummary?.tasksFromTodoWrite ? clean(input.statusSummary.task) : undefined;
  const sidecarTask =
    sidecarUserTask && !/^should we add that\??$/i.test(sidecarUserTask) && !isGenericDeclaredTask(sidecarUserTask)
      ? sidecarUserTask
      : sidecarSummaryTask ?? sidecarUserTask;
  if (sidecarTask && !isGenericDeclaredTask(sidecarTask)) {
    return { text: normalizedOperatorAsk(sidecarTask), rawText: sidecarTask, source: "sidecar-todo" };
  }

  if (
    ask &&
    input.mainUserAsk?.source === "status-sidecar" &&
    !/^should we add that\??$/i.test(ask) &&
    !looksLikeBareQuestion(ask)
  ) {
    return { text: normalizedOperatorAsk(ask), rawText: ask, source: "sidecar-todo" };
  }

  if (ask && input.mainUserAsk?.source === "workstream") return { text: ask, rawText: ask, source: "workstream" };
  const workstreamTitle = clean(input.workstreamTitle);
  if (workstreamTitle) return { text: workstreamTitle, rawText: workstreamTitle, source: "workstream" };

  return { text: TASK_NOT_CAPTURED, source: "missing" };
}
