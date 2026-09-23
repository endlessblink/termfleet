import fs from 'node:fs';
import path from 'node:path';
import { PATHS, claudeSlug } from './paths.mjs';
import { tailLines } from './tail.mjs';
import {
  pendingApproval as codexPendingApproval,
  transcriptPath as codexTranscriptPath,
} from './adapters/codex.mjs';

/**
 * What an agent is waiting for you to answer, if anything.
 *
 * Two shapes exist. A multiple-choice question (Claude's question tool) is in
 * the transcript with its own options. A permission request ("may I run this
 * command?") is not — it is drawn on screen only — but the status hooks record
 * that the pane is waiting and why, so we can still offer the standard
 * answers.
 */
export function pendingAsk(pane, {
  codexApproval = codexPendingApproval,
  codexTranscript = codexTranscriptPath,
} = {}) {
  if (pane.provider === 'codex') {
    const approval = codexApproval(pane);
    if (approval) return permissionAsk(pane, approval);
    // Once a rollout exists it is the authority: an unmatched call is pending,
    // and a matching output means it is finished. Status sidecars can lag behind
    // and must not resurrect that completed permission on the phone.
    if (codexTranscript(pane)) return null;
  }
  if (pane.provider === 'claude') {
    const question = questionFromTranscript(pane);
    if (question) return question;
  }
  if (pane.provider === 'opencode') {
    // OpenCode's status plugin publishes `turn: "waiting"` only for a permission
    // request, so its sidecar is the authority — there is no separate reason
    // string to cross-check and no permission ledger to re-read. A pane that is
    // not waiting is not asking, so nothing is offered.
    if (String(pane.turn || '').toLowerCase() !== 'waiting') return null;
    return permissionAsk(pane, {
      title: 'This agent is asking permission to continue.',
      detail: pane.task || undefined,
    });
  }
  const explicitPermission = new Set([
    'permission_prompt',
    'permission_request',
    'approval_request',
    'approval-requested',
  ]).has(String(pane.turnReason || '').toLowerCase());
  if (pane.turn === 'waiting' && explicitPermission) {
    return permissionAsk(pane, { title: 'This agent is asking permission to continue.' });
  }
  return null;
}

function askId(pane, ask) {
  return [pane.provider, pane.sessionId, pane.updatedAt, pane.turnReason, ask.sourceId, ask.kind, ask.title]
    .map((value) => String(value || ''))
    .join(':');
}

function permissionAsk(pane, details) {
  const ask = {
    kind: 'permission',
    ...details,
    options: [
      { key: 'yes', label: 'Yes, proceed' },
      { key: 'yesAlways', label: "Yes, and don't ask again" },
      { key: 'no', label: 'No, tell the agent what to do differently' },
    ],
  };
  return { ...ask, id: askId(pane, ask) };
}

export function matchesCurrentAsk(pane, id, choice) {
  const ask = pendingAsk(pane);
  return matchesAsk(ask, id, choice);
}

export function matchesAsk(ask, id, choice) {
  return Boolean(ask && ask.id === id && ask.options.some((option) => option.key === String(choice)));
}

/**
 * Some provider approvals are rendered by the terminal UI and never reach the
 * rollout transcript or status hook. Keep an explicit, narrow detector for
 * that screen so the phone can show the same choices the operator sees.
 */
export function screenPermissionAsk(pane, screen) {
  const text = String(screen || '');
  const match = text.match(/Allow the (.+?) server to run tool ["']([^"']+)["']\?/i);
  if (!match || !/\b(?:1\.\s*)?Allow\b/i.test(text) || !/\bCancel\b/i.test(text)) return null;
  const ask = {
    kind: 'permission',
    title: `Allow ${match[2]}?`,
    detail: `${match[1]} server is requesting this tool approval.`,
    sourceId: `screen:${match[2]}`,
    options: [
      { key: '1', label: 'Allow' },
      { key: '2', label: 'Allow for this session' },
      { key: '3', label: 'Always allow' },
      { key: '4', label: 'Cancel' },
    ],
  };
  return { ...ask, id: askId(pane, ask) };
}

function questionFromTranscript(pane) {
  const file = path.join(PATHS.claudeProjects, claudeSlug(pane.cwd), `${pane.sessionId}.jsonl`);
  if (!fs.existsSync(file)) return null;

  const lines = tailLines(file, 256 * 1024);
  const answered = new Set();

  for (let i = lines.length - 1; i >= 0; i--) {
    let o;
    try { o = JSON.parse(lines[i]); } catch { continue; }
    const msg = o.message;
    if (!msg) continue;
    const blocks = Array.isArray(msg.content) ? msg.content : [];

    if (msg.role === 'user') {
      for (const b of blocks) if (b.type === 'tool_result' && b.tool_use_id) answered.add(b.tool_use_id);
      continue;
    }

    if (msg.role !== 'assistant') continue;
    for (const b of blocks) {
      if (b.type !== 'tool_use' || b.name !== 'AskUserQuestion') continue;
      if (answered.has(b.id)) return null;          // already answered

      const q = b.input?.questions?.[0];
      if (!q) continue;
      const options = (q.options || []).slice(0, 4).map((opt, index) => ({
        key: String(index + 1),
        label: String(opt.label || '').slice(0, 60),
        detail: String(opt.description || '').slice(0, 140),
      }));
      if (!options.length) continue;

      const ask = {
        kind: 'question',
        title: String(q.question || 'The agent is asking you something.').slice(0, 200),
        header: String(q.header || '').slice(0, 40),
        options,
      };
      return { ...ask, id: askId(pane, ask) };
    }
  }
  return null;
}
