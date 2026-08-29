import fs from 'node:fs';
import path from 'node:path';
import { PATHS, claudeSlug } from './paths.mjs';
import { tailLines } from './tail.mjs';

/**
 * What an agent is waiting for you to answer, if anything.
 *
 * Two shapes exist. A multiple-choice question (Claude's question tool) is in
 * the transcript with its own options. A permission request ("may I run this
 * command?") is not — it is drawn on screen only — but the status hooks record
 * that the pane is waiting and why, so we can still offer the standard
 * answers.
 */
export function pendingAsk(pane) {
  if (pane.provider === 'claude') {
    const question = questionFromTranscript(pane);
    if (question) return question;
  }
  if (pane.turn === 'waiting') {
    return {
      kind: 'permission',
      title: 'This agent is asking permission to continue.',
      options: [
        { key: 'yes', label: 'Yes' },
        { key: 'yesAlways', label: "Yes, don't ask again" },
        { key: 'no', label: 'No' },
      ],
    };
  }
  return null;
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

      return {
        kind: 'question',
        title: String(q.question || 'The agent is asking you something.').slice(0, 200),
        header: String(q.header || '').slice(0, 40),
        options,
      };
    }
  }
  return null;
}
