import fs from 'node:fs';
import path from 'node:path';
import { isNoise, clean } from '../noise.mjs';
import { tailLines } from '../tail.mjs';
import { PATHS, claudeSlug } from '../paths.mjs';

export const provider = 'claude';

export function transcriptPath(pane) {
  const p = path.join(PATHS.claudeProjects, claudeSlug(pane.cwd), `${pane.sessionId}.jsonl`);
  return fs.existsSync(p) ? p : null;
}

const textOf = (blocks) =>
  blocks.filter((b) => b.type === 'text').map((b) => String(b.text || '')).join('\n').trim();

function summariseTool(block) {
  const i = block.input || {};
  const first = (v) => String(v).split('\n')[0].slice(0, 140);
  if (i.command) return first(i.command);
  if (i.file_path) return first(i.file_path);
  if (i.pattern) return first(i.pattern);
  if (i.prompt) return first(i.prompt);
  if (i.query) return first(i.query);
  return '';
}

/**
 * Walk backwards so a long session costs the same as a short one, then reverse.
 * `pending` = tools the assistant asked for that have no result yet, which is
 * how "still running / waiting on you" shows up in the transcript.
 */
export function readFeed(pane, { limit = 60, bytes = 512 * 1024 } = {}) {
  const file = transcriptPath(pane);
  if (!file) return { events: [], pending: [] };

  const lines = tailLines(file, bytes);
  const collected = [];
  const resultsSeen = new Set();
  const unresolved = new Map();

  for (let i = lines.length - 1; i >= 0 && collected.length < limit; i--) {
    let o;
    try { o = JSON.parse(lines[i]); } catch { continue; }
    const msg = o.message;
    if (!msg) continue;
    const at = o.timestamp || null;
    const blocks = Array.isArray(msg.content) ? msg.content : [];

    if (msg.role === 'user') {
      for (const b of blocks) if (b.type === 'tool_result' && b.tool_use_id) resultsSeen.add(b.tool_use_id);
      const raw = typeof msg.content === 'string' ? msg.content.trim() : textOf(blocks);
      const text = clean(raw);
      if (text && !isNoise(raw)) collected.push({ kind: 'user', at, text });
      continue;
    }

    if (msg.role === 'assistant') {
      for (let j = blocks.length - 1; j >= 0; j--) {
        const b = blocks[j];
        if (b.type === 'tool_use') {
          if (!resultsSeen.has(b.id)) unresolved.set(b.id, b.name);
          collected.push({ kind: 'tool', at, name: b.name, summary: summariseTool(b) });
        }
      }
      const text = textOf(blocks);
      if (text) collected.push({ kind: 'assistant', at, text });
    }
  }

  return { events: collected.reverse(), pending: [...unresolved.values()] };
}

/** What to send into the PTY to answer a permission prompt. */
export const approval = { yes: '\r', yesAlways: '2\r', no: '\x1b' };
