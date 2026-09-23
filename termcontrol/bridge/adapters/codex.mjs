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

export function pendingApproval(pane, { bytes = 1024 * 1024 } = {}) {
  const file = transcriptPath(pane);
  if (!file) return null;
  const records = [];
  for (const line of tailLines(file, bytes)) {
    try { records.push(JSON.parse(line)); } catch { /* partial tail record */ }
  }
  return pendingApprovalFromRecords(records);
}

export function pendingApprovalFromRecords(records) {
  const completed = new Set();
  for (let i = records.length - 1; i >= 0; i--) {
    const payload = records[i]?.payload;
    if (!payload || typeof payload !== 'object') continue;
    if (payload.type === 'custom_tool_call_output' || payload.type === 'function_call_output') {
      if (payload.call_id) completed.add(payload.call_id);
      continue;
    }
    if (
      payload.type !== 'custom_tool_call'
      || (payload.name !== 'exec' && payload.name !== 'functions.exec')
      || completed.has(payload.call_id)
    ) continue;
    const request = escalatedExecRequest(payload.input);
    if (!request) continue;
    return {
      kind: 'permission',
      title: request.command || 'Run the requested command?',
      detail: request.justification || 'This command needs your approval.',
      sourceId: payload.call_id || records[i]?.timestamp || '',
    };
  }
  return null;
}

function escalatedExecRequest(input) {
  const source = String(input || '');
  let offset = 0;
  let found = null;
  while ((offset = source.indexOf('tools.exec_command(', offset)) >= 0) {
    const start = source.indexOf('{', offset);
    if (start < 0) break;
    const end = matchingBrace(source, start);
    if (end < 0) break;
    const object = source.slice(start, end + 1);
    if (stringField(object, 'sandbox_permissions') === 'require_escalated') {
      found = {
        command: stringField(object, 'cmd') || stringField(object, 'command'),
        justification: stringField(object, 'justification'),
      };
    }
    offset = end + 1;
  }
  return found;
}

function matchingBrace(source, start) {
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let i = start; i < source.length; i++) {
    const char = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return i;
  }
  return -1;
}

function stringField(object, name) {
  const match = object.match(new RegExp(`(?:^|[{,\\s])(?:["']?${name}["']?)\\s*:\\s*("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*')`));
  if (!match) return '';
  if (match[1][0] === '"') {
    try { return JSON.parse(match[1]); } catch { return ''; }
  }
  return match[1].slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, '\\');
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

export const approval = { yes: 'y\r', yesAlways: 'p\r', no: 'n\r' };
