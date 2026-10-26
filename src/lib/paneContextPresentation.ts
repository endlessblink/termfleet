import type {TerminalMainUserAsk, WorkstreamStatusSummary} from './types';
import type {PaneTaskLine} from './taskLine';
import type {AttentionState} from './terminalAttention';
import {isSupervisedMetaProcessTask, qualityCheckUserAskLabel} from './terminalHeaderQuality';
import {currentNarrationStep} from './agentNarration';
import {refersOnlyToExistingWork} from './sessionTranscript';

export interface PresentedGoal {
  text: string;
  kind: 'explicit' | 'captured' | 'inferred' | 'unknown';
  source: string;
  updatedAt?: number;
  stale: boolean;
  /** Presentation is never permission, including a captured or inferred request. */
  canAuthorize: false;
}

function usable(value?: string | null) {
  const text = value?.trim() ?? '';
  return text && !isSupervisedMetaProcessTask(text) && !refersOnlyToExistingWork(text) &&
    !/^(?:(?:so|please|lets|let's|can you|could you)\s+)*(?:make|fix|change|improve|run|do|start|stop|automate)\s+(?:it|this|that)(?:\s+(?:run|work|automatically|better|now))*[.!?]*$/i.test(text) &&
    !/^(?:marking|recording|updating|closing) (?:the )?(?:plan |checklist )?(?:task|step|item) (?:done|complete|completed)\b/i.test(text) &&
    !/\b(?:read .*handoff|continue exactly where|source_thread_id|codex_delegation)\b/i.test(text) &&
    qualityCheckUserAskLabel(text, {maxLength: 2000}).ok ? text : undefined;
}

function requestOutcome(text: string) {
  // Preserve a purpose clause the operator actually wrote; never supply an object
  // from a project name or rewrite a vague request into a fabricated product goal.
  const clause = text.match(/\bto (?:ensure|make sure|see) that\s+(.+)/i)?.[1] ??
    text.match(/כדי (?:לוודא|להבטיח) ש(.+)/)?.[1];
  return clause && usable(clause) ? clause[0].toLocaleUpperCase()+clause.slice(1) : text;
}

/** A display-only, pane-bound selection. No guesses from cwd, project names or Now. */
export function presentPaneGoal(input: {
  manualAsk?: TerminalMainUserAsk;
  capturedGoal?: string;
  capturedSource?: string;
  summary?: WorkstreamStatusSummary;
  taskLine?: PaneTaskLine | null;
  sessionId?: string;
  runId?: string;
  now?: number;
}): PresentedGoal {
  const now = input.now ?? Date.now();
  const result = (text: string, kind: PresentedGoal['kind'], source: string, updatedAt?: number): PresentedGoal =>
    ({text,kind,source,updatedAt,stale: !updatedAt || updatedAt > now || now-updatedAt > 120_000,canAuthorize:false});
  const ask = input.manualAsk;
  const askMatches = !ask?.runId || !input.runId || ask.runId === input.runId;
  const manual = ask?.source === 'manual' && usable(ask.text);
  if (manual) return result(manual, 'explicit', 'operator', ask!.updatedAt);
  const summary = input.summary && (!input.sessionId || !input.summary.sessionId || input.sessionId === input.summary.sessionId)
    ? input.summary : undefined;
  // TF-091: an agent pane shows only a DECLARED goal — the operator's goal command, the
  // agent's own "Goal:" line, or a helper brief's goal. Guesses from chat text (the
  // opening message, the latest complaint) are never a Goal (operator, 2026-10-15).
  if (isDeclaredOnlyPane(input.summary)) {
    const stated = summary?.statedGoal?.trim();
    return stated ? result(stated, 'explicit', 'stated-goal', summary!.updatedAt) : result('', 'unknown', 'missing');
  }
  // The text and provenance must come from the same pane-owned record. A cached
  // or generic shell-role header cannot masquerade as that record's captured Goal.
  const captured = summary && summary.mainTaskSource && usable(summary.mainTask);
  if (captured) return result(captured,['opening-request','user-prompt'].includes(summary!.mainTaskSource!) ? 'captured' : 'inferred',summary!.mainTaskSource!,summary!.updatedAt);
  const requested = summary && usable(summary.userTask);
  if (requested) return result(requestOutcome(requested),'inferred','latest-request',summary!.updatedAt);
  // The opening request can be unusable (a pasted menu choice); then the newest
  // request this pane recorded is the best grounded purpose (TF-094).
  const latest = summary && usable(summary.latestRequest);
  if (latest) return result(requestOutcome(latest),'inferred','latest-request',summary!.updatedAt);
  const paneAsk = askMatches && ask?.source === 'terminal-prompt' && usable(ask.text);
  if (paneAsk) return result(paneAsk,'inferred','pane-request',ask!.updatedAt);
  const line = input.taskLine;
  const declared = line && (!line.expiresAt || line.expiresAt>now) && ['opening-request','operator-request','declared','session-title'].includes(line.source) && usable(line.text);
  if (declared) return result(declared,'inferred',line!.source,line!.capturedAt);
  return result('','unknown','missing');
}

const DECLARED_ONLY_PROVIDERS = new Set(['claude', 'codex', 'opencode']);

/** Agent panes follow the declared-only rule (TF-091); shell panes keep their own ladder. */
export function isDeclaredOnlyPane(summary?: WorkstreamStatusSummary): boolean {
  return Boolean(summary?.provider && DECLARED_ONLY_PROVIDERS.has(summary.provider));
}

/** TF-091: an agent pane's Task is its newest "Task:" line, kept until the next one. */
export function presentPaneTask(summary: WorkstreamStatusSummary | undefined, fallback: string): string {
  if (!isDeclaredOnlyPane(summary)) return fallback;
  return summary?.statedTask?.trim() || 'No task yet';
}

/** A tool-level activity in words a non-developer reads at a glance. */
export function plainActivity(text?: string | null): string | undefined {
  const value = text?.trim();
  if (!value) return undefined;
  const edited = /^Editing\s+(\S+)$/i.exec(value)?.[1];
  if (edited) return /\.(?:md|txt|docx?)$/i.test(edited) ? 'Editing a document' : /\.json$/i.test(edited) ? 'Changing settings' : 'Editing code';
  if (/^Reading\s+(?!your\b)\S+$/i.test(value)) return 'Reading files';
  if (/^(?:Searching|Listing)\b/i.test(value)) return 'Searching the project';
  if (/^Researching\b/i.test(value)) return 'Looking things up online';
  if (/^Delegating\b/i.test(value)) return 'Handing part of the work to a helper';
  const tool = /^Using\s+(\S+)$/i.exec(value)?.[1];
  if (tool) {
    if (/AskUserQuestion/i.test(tool)) return 'Waiting for you';
    if (/(?:shell|bash|exec|execute)/i.test(tool)) return 'Running a command';
    if (/(?:read|tree|glob)/i.test(tool)) return 'Reading files';
    if (/(?:search|grep)/i.test(tool)) return 'Searching the project';
    if (/(?:patch|edit|write)/i.test(tool)) return 'Editing code';
    if (/(?:browser|chrome|playwright|navigate)/i.test(tool)) return 'Checking a page in the browser';
    return 'Working';
  }
  return value;
}

/** Current state wins over a carried-over narration or checklist step. */
export function presentPaneNow(input: {
  attention: AttentionState;
  reportedNow?: string;
  reportedStatus?: string;
  reportedAt?: number;
  screen?: string;
  screenAt?: number;
  now?: number;
}): string {
  if (input.attention === 'unavailable') return 'Current activity not yet known';
  if (input.attention === 'idle') return 'Finished — waiting for your next message';
  if (input.attention === 'waiting') return 'Waiting for you';
  const now = input.now ?? Date.now();
  const fresh = (at?: number) => Boolean(at && at <= now && now-at <= 120_000);
  // TF-091: Now is the live ACTION (what the agent is doing this moment), read from its
  // newest tool event first. Its own chat sentences are a fallback: they go stale while
  // it keeps working ("Still waiting for the new session to open" during a long turn).
  const action = input.reportedStatus === 'working' && fresh(input.reportedAt) ? plainActivity(input.reportedNow) : undefined;
  if (action && usable(action)) return action;
  const narrated = fresh(input.screenAt) && currentNarrationStep(input.screen);
  if (narrated && !isSupervisedMetaProcessTask(narrated)) return narrated;
  return 'Working';
}
