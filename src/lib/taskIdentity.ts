import type {
  TaskLineupItem,
  TerminalMainUserAsk,
  TerminalPurposeSource,
  WorkstreamStatusSummary,
} from "./types";
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
  return value?.replace(/\s+/g, " ").trim() || undefined;
}

function activeTodoTask(items: TaskLineupItem[] | undefined, activeRunId?: string) {
  const visible = visibleTaskLineup(items, activeRunId).filter((item) => item.source === "todo-write");
  return visible.find((item) => item.status === "in_progress") ?? visible.find((item) => item.status === "pending") ?? visible[0];
}

function scopedAsk(ask: TerminalMainUserAsk | null | undefined, activeRunId?: string) {
  if (!ask) return undefined;
  if (ask.runId && activeRunId && ask.runId !== activeRunId) return undefined;
  return clean(ask.text);
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
  if (taskToolTask?.content) {
    return { text: taskToolTask.content, rawText: taskToolTask.content, source: "task-tool" };
  }

  if (ask && input.mainUserAsk?.source === "task-tool") return { text: ask, rawText: ask, source: "task-tool" };
  if (ask && input.mainUserAsk?.source === "terminal-prompt") return { text: ask, rawText: ask, source: "user-prompt" };

  const planBinding = input.planBindingSource === "task-binding" || input.planBindingSource === "inferred"
    ? clean(input.planBindingTitle)
    : undefined;
  if (planBinding) return { text: planBinding, rawText: planBinding, source: "plan-binding" };

  if (ask && input.mainUserAsk?.source === "status-sidecar") return { text: ask, rawText: ask, source: "sidecar-todo" };
  if (input.statusSummary?.tasksFromTodoWrite) {
    const sidecarTask = clean(input.statusSummary.userTask) ?? clean(input.statusSummary.task);
    if (sidecarTask) return { text: sidecarTask, rawText: sidecarTask, source: "sidecar-todo" };
  }

  if (ask && input.mainUserAsk?.source === "workstream") return { text: ask, rawText: ask, source: "workstream" };
  const workstreamTitle = clean(input.workstreamTitle);
  if (workstreamTitle) return { text: workstreamTitle, rawText: workstreamTitle, source: "workstream" };

  return { text: TASK_NOT_CAPTURED, source: "missing" };
}
