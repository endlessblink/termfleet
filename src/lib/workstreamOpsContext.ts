import { invoke } from "@tauri-apps/api/core";
import type { WorkstreamIsolationMode, WorkstreamIsolationStatus, WorkstreamLaunchProfile } from "./types";

export interface WorkstreamOpsContext {
  runId?: string;
  createdAt?: number;
  cwd?: string;
  cwdLabel?: string;
  gitRoot?: string;
  gitBranch?: string;
  gitDirty?: boolean;
  worktreePath?: string;
  isolationMode?: WorkstreamIsolationMode;
  isolationStatus?: WorkstreamIsolationStatus;
  isolationNote?: string;
}

interface GitContextResult {
  cwd: string;
  gitRoot?: string;
  gitBranch?: string;
  gitDirty?: boolean;
  worktreePath?: string;
  isolationStatus?: WorkstreamOpsContext["isolationStatus"];
  isolationNote?: string;
}

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function pathLabel(path?: string) {
  if (!path) return "workspace root unknown";
  return path.split("/").filter(Boolean).pop() ?? path;
}

export function formatWorkstreamIsolation(mode?: WorkstreamIsolationMode, status?: WorkstreamIsolationStatus) {
  if (mode === "dedicated-worktree") {
    if (status === "ready") return "dedicated worktree ready";
    if (status === "requested") return "dedicated worktree requested";
    if (status === "unavailable") return "dedicated worktree unavailable";
    return "dedicated worktree";
  }
  if (mode === "shared-worktree") return "shared workspace";
  return "unknown isolation";
}

export function formatWorkstreamBranch(context: WorkstreamOpsContext) {
  const branch = context.gitBranch ?? "branch unknown";
  const dirty = context.gitDirty ? "dirty" : context.gitDirty === false ? "clean" : "state unknown";
  return `${branch} · ${dirty}`;
}

export function formatWorkstreamOpsContext(context: WorkstreamOpsContext) {
  return `${context.cwdLabel ?? pathLabel(context.cwd)} · ${formatWorkstreamBranch(context)} · ${formatWorkstreamIsolation(context.isolationMode, context.isolationStatus)}`;
}

export function promptWorkstreamIsolation(label: string): WorkstreamIsolationMode | null {
  const answer = window.prompt(
    `Isolation for ${label} agent: shared or dedicated`,
    "shared"
  );
  if (answer === null) return null;
  return answer.trim().toLowerCase().startsWith("d") ? "dedicated-worktree" : "shared-worktree";
}

export function promptWorkstreamLaunchProfile(label: string): WorkstreamLaunchProfile | null {
  const answer = window.prompt(
    `Launch mode for ${label} agent: terminal or headless`,
    "terminal"
  );
  if (answer === null) return null;
  return answer.trim().toLowerCase().startsWith("h") ? "headless" : "terminal";
}

export async function resolveWorkstreamOpsContext(
  cwd?: string,
  isolationMode: WorkstreamIsolationMode = "shared-worktree",
  runId?: string,
  createdAt?: number
): Promise<WorkstreamOpsContext> {
  const isolationStatus: WorkstreamIsolationStatus = isolationMode === "dedicated-worktree" ? "requested" : "shared";
  const isolationNote = isolationMode === "dedicated-worktree"
    ? "Dedicated worktree requested; desktop will prepare a Git worktree when possible."
    : "Agent shares the selected workspace checkout.";
  const fallback: WorkstreamOpsContext = {
    runId,
    createdAt,
    cwd,
    cwdLabel: pathLabel(cwd),
    worktreePath: cwd,
    isolationMode,
    isolationStatus,
    isolationNote,
  };

  if (!isTauriRuntime()) return fallback;

  try {
    const context = isolationMode === "dedicated-worktree" && runId
      ? await invoke<GitContextResult>("workstream_prepare_dedicated_worktree", { cwd, runId })
      : await invoke<GitContextResult>("workstream_git_context", { cwd });
    return {
      runId,
      createdAt,
      cwd: context.cwd || cwd,
      cwdLabel: pathLabel(context.cwd || cwd),
      gitRoot: context.gitRoot,
      gitBranch: context.gitBranch,
      gitDirty: context.gitDirty,
      worktreePath: context.worktreePath ?? context.cwd ?? cwd,
      isolationMode,
      isolationStatus: context.isolationStatus ?? isolationStatus,
      isolationNote: context.isolationNote ?? isolationNote,
    };
  } catch {
    return fallback;
  }
}
