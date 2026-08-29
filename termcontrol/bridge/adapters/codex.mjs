import fs from 'node:fs';
import path from 'node:path';
import { isNoise, clean } from '../noise.mjs';
import { tailLines } from '../tail.mjs';
import { PATHS } from '../paths.mjs';

export const provider = 'codex';

let index = null;
let indexedAt = 0;

/** Codex files are date-foldered; index once, refresh at most every 30s. */
function rolloutIndex() {
  if (index && Date.now() - indexedAt < 30_000) return index;
  const found = new Map();
  const walk = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.jsonl')) {
        const m = e.name.match(/([0-9a-f-]{36})\.jsonl$/i);
        if (m) found.set(m[1], p);
      }
    }
  };
  walk(PATHS.codexSessions);
  index = found;
  indexedAt = Date.now();
  return index;
}

export function transcriptPath(pane) {
  return rolloutIndex().get(pane.sessionId) || null;
}

const textOf = (content) => {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content
    .map((c) => c.text || c.input_text || c.output_text || '')
    .join('\n')
    .trim();
};

/**
 * Rollout files are mostly noise (reasoning blobs, token counts, turn context).
 * Walk backwards and stop as soon as we have enough real conversation, so a
 * 1000-line file costs the same as a short one.
 */
export function readFeed(pane, { limit = 60, bytes = 512 * 1024 } = {}) {
  const file = transcriptPath(pane);
  if (!file) return { events: [], pending: [] };

  const lines = tailLines(file, bytes);
  const collected = [];

  for (let i = lines.length - 1; i >= 0 && collected.length < limit; i--) {
    let o;
    try { o = JSON.parse(lines[i]); } catch { continue; }
    const payload = o.payload || {};
    const kind = payload.type;
    const at = o.timestamp || null;

    if (kind === 'message' && payload.role) {
      const raw = textOf(payload.content);
      if (!raw || isNoise(raw)) continue;
      const text = clean(raw);
      if (!text) continue;
      collected.push({ kind: payload.role === 'user' ? 'user' : 'assistant', at, text });
      continue;
    }

    if (kind === 'function_call' || kind === 'local_shell_call' || kind === 'custom_tool_call') {
      collected.push({
        kind: 'tool',
        at,
        name: payload.name || 'shell',
        summary: summariseCall(payload),
      });
    }
  }

  return { events: collected.reverse(), pending: [] };
}


/**
 * Codex tool input arrives in three shapes: a JSON string of arguments, an
 * arguments object, or (for `exec`) a snippet of JS calling another tool.
 * Pull out the most human-readable line from whichever it is.
 */
function summariseCall(payload) {
  const raw = payload.arguments ?? payload.input;
  if (!raw) return '';

  if (typeof raw === 'object') return firstLine(raw.command ?? raw.path ?? raw.file_path ?? '');

  const text = String(raw);
  try {
    const args = JSON.parse(text);
    const c = args?.command;
    return firstLine(Array.isArray(c) ? c.join(' ') : (c ?? args?.path ?? args?.file_path ?? ''));
  } catch {
    // A JS snippet: prefer an inner command/pattern/name argument, else the call itself.
    const inner = text.match(/(?:command|pattern|name|path|file_path)\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (inner) return firstLine(inner[1].replace(/\\"/g, '"'));
    const call = text.match(/tools\.([A-Za-z0-9_]+)/);
    if (call) return call[1];
    return firstLine(text);
  }
}

function firstLine(v) {
  return String(v).split('\n').find((l) => l.trim()) ?.trim().slice(0, 140) ?? '';
}

export const approval = { yes: 'y\r', yesAlways: 'a\r', no: 'n\r' };
