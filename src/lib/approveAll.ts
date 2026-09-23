// "Approve all" for the Pending approval list (operator request 2026-09-23: always ask
// first — show every waiting request, then one click approves them).
//
// Safety rules:
//  - Nothing is typed from the list alone. Right before pressing a key, the pane's LIVE
//    screen is re-read; the key is sent only if that exact kind of approval prompt is
//    still the newest thing on screen. A stray "y" can never land in a chat box.
//  - Only permission prompts are approvable here. Plans, choices and questions need
//    the operator's own answer and are listed as "open it".
import { invoke } from "@tauri-apps/api/core";
import { terminalScreenAttention } from "./operatorQuestionState";
import type { PendingApprovalItem } from "./pendingApprovals";

export type ApprovalPromptKind = "codex-command" | "claude-permission";

function lastIndex(text: string, pattern: RegExp) {
  const matches = [...text.matchAll(pattern)];
  return matches[matches.length - 1]?.index ?? -1;
}

/**
 * Which approval prompt is open on this screen, if any. The prompt must be the newest
 * lifecycle marker (terminalScreenAttention says "waiting") and carry its own footer.
 */
export function approvalPromptOnScreen(screen: string): ApprovalPromptKind | null {
  const text = String(screen ?? "").replace(/\r/g, "\n").slice(-4000);
  if (terminalScreenAttention(text) !== "waiting") return null;
  const codex = lastIndex(text, /\bWould you like to (?:run the following command|make the following edits)\?/gi);
  const codexFooter = lastIndex(text, /\bPress enter to confirm or esc to cancel\b/gi);
  const claude = lastIndex(text, /\b(?:Do|Would) you (?:want|like) to (?:proceed|make this edit|create|run)\b[^\n?]*\?/gi);
  const claudeFooter = lastIndex(text, /\b(?:esc to cancel|tab to amend|enter to confirm)\b/gi);
  const codexOpen = codex >= 0 && codexFooter > codex;
  const claudeOpen = claude >= 0 && claudeFooter > claude;
  // Codex's wording also fits the Claude pattern ("Would you like to run…"), so the
  // same position is Codex's prompt.
  if (codexOpen && (!claudeOpen || codex >= claude)) return "codex-command";
  if (claudeOpen) return "claude-permission";
  return null;
}

/** The key that picks "Yes" in each agent's approval menu. */
export function approvalKey(kind: ApprovalPromptKind): string {
  // Codex: "1. Yes, proceed (y)". Claude: "❯ 1. Yes" — the number selects that option.
  return kind === "codex-command" ? "y" : "1";
}

const RISKS: Array<[RegExp, string]> = [
  [/\brm\s+(?:-\w*[rf]\w*\s+)?\S/i, "deletes files"],
  [/\bgit\s+push\b|--force\b|\breset\s+--hard\b/i, "changes git history or the remote"],
  [/\b(?:scp|rsync|ssh)\b.*@|root@/i, "touches a server"],
  [/\b(?:deploy|publish|release)\b/i, "publishes or deploys"],
  [/\b(?:kill|pkill|killall)\b/i, "stops a running program"],
  [/\bsudo\b|\bchmod\b|\bchown\b/i, "changes system permissions"],
  [/\bdrop\s+(?:table|database)\b|\bdelete\s+from\b|\btruncate\b/i, "deletes data"],
  [/\bcurl\b[^|]*\|\s*(?:sh|bash)\b/i, "runs a downloaded script"],
];

/** A plain-language warning when a request looks risky, or null. */
export function approvalRisk(item: Pick<PendingApprovalItem, "headline" | "detail">): string | null {
  const text = `${item.headline ?? ""} ${item.detail ?? ""}`;
  for (const [pattern, reason] of RISKS) if (pattern.test(text)) return reason;
  return null;
}

/**
 * Candidates for Approve all. The list's category is a best guess from possibly stale
 * screen text (off-screen Codex panes read "Action Required"), so both permission and
 * generic "input" rows are offered; the live-screen check in approveOne decides whether
 * a yes/no approval prompt is really open. Plans, choices and questions never are.
 */
export function isApprovable(item: PendingApprovalItem) {
  return (item.category === "permission" || item.category === "input") && Boolean(item.terminalId);
}

export interface ApproveResult {
  nodeId: string;
  ok: boolean;
  reason?: string;
}

export interface ApproveDeps {
  readScreen: (sessionId: string) => Promise<string | null>;
  write: (sessionId: string, data: string) => Promise<void>;
  wait: (ms: number) => Promise<void>;
}

const tauriDeps: ApproveDeps = {
  readScreen: async (sessionId) => {
    try {
      return await invoke<string>("grid_screen_text", { id: sessionId });
    } catch {
      return null;
    }
  },
  write: async (sessionId, data) => {
    await invoke("daemon_write_session", { id: sessionId, data });
  },
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** Approve one waiting request, re-checking the live screen before and after. */
export async function approveOne(item: PendingApprovalItem, deps: ApproveDeps = tauriDeps): Promise<ApproveResult> {
  const sessionId = item.terminalId;
  if (!sessionId || !isApprovable(item)) {
    return { nodeId: item.nodeId, ok: false, reason: "needs your own answer — open it" };
  }
  const before = await deps.readScreen(sessionId);
  if (before === null) {
    return { nodeId: item.nodeId, ok: false, reason: "terminal not open on screen — open it to approve" };
  }
  const kind = approvalPromptOnScreen(before);
  if (!kind) return { nodeId: item.nodeId, ok: false, reason: "no longer waiting — nothing sent" };
  await deps.write(sessionId, approvalKey(kind));
  await deps.wait(1200);
  const after = await deps.readScreen(sessionId);
  if (after !== null && approvalPromptOnScreen(after) === kind && after.trim() === before.trim()) {
    return { nodeId: item.nodeId, ok: false, reason: "the agent did not take the answer — open it" };
  }
  return { nodeId: item.nodeId, ok: true };
}

/** Approve the chosen requests one after another (never in parallel). */
export async function approveAll(items: PendingApprovalItem[], deps: ApproveDeps = tauriDeps) {
  const results: ApproveResult[] = [];
  for (const item of items) results.push(await approveOne(item, deps));
  return results;
}
