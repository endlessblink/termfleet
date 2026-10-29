// What was said in earlier agent sessions in a folder (complaint #6: "there should be a system that can
// always give you context"). Reads the vendors' own on-disk records, read-only, on this computer:
// Claude (~/.claude/projects/<folder>/*.jsonl) and Codex (~/.codex/sessions/Y/M/D/rollout-*.jsonl).
// Nothing is copied or stored anywhere else.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DAY = 86_400_000;

/** Claude names a folder's record directory by turning every non-alphanumeric character into "-". */
export const claudeSlug = (cwd) => String(cwd || '').replace(/[^A-Za-z0-9]/g, '-');

const NOISE = /^\s*(?:<[a-z-]+[ >]|# AGENTS\.md|\[Your open requests|Caveat:|\[Request interrupted)/i;

/** The visible words of one message, or '' for tool plumbing and injected boilerplate. */
function wordsOf(content) {
  const parts = typeof content === 'string' ? [content]
    : Array.isArray(content) ? content.filter((c) => c && (c.type === 'text' || c.type === 'input_text' || c.type === 'output_text')).map((c) => c.text) : [];
  const text = parts.filter((t) => typeof t === 'string').join('\n').trim();
  return !text || NOISE.test(text) ? '' : text;
}

const clip = (text, n) => {
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  return flat.length > n ? `${flat.slice(0, n - 1)}…` : flat;
};

function readLines(file, maxBytes = 12 * 1024 * 1024) {
  try {
    const stat = fs.statSync(file);
    const fd = fs.openSync(file, 'r');
    try {
      const size = Math.min(stat.size, maxBytes);
      const buf = Buffer.alloc(size);
      fs.readSync(fd, buf, 0, size, Math.max(0, stat.size - size));   // the newest part of a very big record
      return buf.toString('utf8').split('\n').filter(Boolean);
    } finally { fs.closeSync(fd); }
  } catch { return []; }
}

const parse = (line) => { try { return JSON.parse(line); } catch { return null; } };

/** One session's messages, oldest first: [{ role: 'user' | 'assistant', text, at }]. */
export function readSession(file, provider) {
  const messages = [];
  let title = '', id = path.basename(file, '.jsonl').replace(/^rollout-.*?-(?=[0-9a-f]{8}-)/, ''), cwd = '';
  for (const line of readLines(file)) {
    const e = parse(line);
    if (!e) continue;
    if (provider === 'claude') {
      if (e.type === 'ai-title' || e.type === 'custom-title') title = e.aiTitle || e.title || e.customTitle || title;
      if (e.cwd && !cwd) cwd = e.cwd;
      if ((e.type === 'user' || e.type === 'assistant') && !e.isMeta && !e.isSidechain && e.message) {
        const text = wordsOf(e.message.content);
        if (text) messages.push({ role: e.type, text, at: Date.parse(e.timestamp) || 0 });
      }
    } else {
      if (e.type === 'session_meta') { id = e.payload?.id || id; cwd = e.payload?.cwd || cwd; }
      if (e.type === 'response_item' && e.payload?.type === 'message' && (e.payload.role === 'user' || e.payload.role === 'assistant')) {
        const text = wordsOf(e.payload.content);
        if (text) messages.push({ role: e.payload.role, text, at: Date.parse(e.timestamp) || 0 });
      }
    }
  }
  return { provider, id, file, cwd, title: clip(title, 120), messages };
}

function codexFilesFor(cwd, { home, sinceMs, now }) {
  const root = path.join(home, '.codex', 'sessions');
  const out = [];
  const days = Math.ceil((now - sinceMs) / DAY) + 1;
  for (let i = 0; i <= days; i++) {
    const d = new Date(now - i * DAY);
    const dir = path.join(root, String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'));
    let names = [];
    try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.jsonl')); } catch { continue; }
    for (const name of names) {
      const file = path.join(dir, name);
      try {
        const fd = fs.openSync(file, 'r');
        const buf = Buffer.alloc(8192);
        const n = fs.readSync(fd, buf, 0, 8192, 0);
        fs.closeSync(fd);
        const first = parse(buf.toString('utf8', 0, n).split('\n')[0]);
        if (first?.type === 'session_meta' && first.payload?.cwd === cwd) out.push(file);
      } catch { /* unreadable: skip it */ }
    }
  }
  return out;
}

/** Every session record for a folder from the last `days` days, newest first (read lazily by the caller). */
export function sessionFiles(cwd, { home = os.homedir(), days = 30, now = Date.now(), exclude = [] } = {}) {
  const sinceMs = now - days * DAY;
  const files = [];
  const dir = path.join(home, '.claude', 'projects', claudeSlug(cwd));
  try {
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.jsonl')) continue;
      const file = path.join(dir, name);
      const mtime = fs.statSync(file).mtimeMs;
      if (mtime >= sinceMs) files.push({ file, provider: 'claude', mtime });
    }
  } catch { /* no Claude record for this folder */ }
  for (const file of codexFilesFor(cwd, { home, sinceMs, now })) {
    try { files.push({ file, provider: 'codex', mtime: fs.statSync(file).mtimeMs }); } catch { /* gone */ }
  }
  return files.filter((f) => !exclude.some((x) => x && f.file.includes(x))).sort((a, b) => b.mtime - a.mtime);
}

const stamp = (ms) => (ms ? new Date(ms).toISOString().slice(0, 16).replace('T', ' ') : 'unknown time');

/** A short account of the folder's recent sessions: what was asked first and last, and how each ended. */
export function recentDigest(cwd, opts = {}) {
  const { limit = 8, perSession = 3 } = opts;
  const lines = [];
  for (const f of sessionFiles(cwd, opts)) {
    if (lines.length >= limit) break;
    const s = readSession(f.file, f.provider);
    const users = s.messages.filter((m) => m.role === 'user');
    const bots = s.messages.filter((m) => m.role === 'assistant');
    if (!users.length) continue;
    const head = `${stamp(f.mtime)} ${f.provider} ${String(s.id).slice(0, 8)}${s.title ? ` "${s.title}"` : ''} (${s.messages.length} messages)`;
    const asked = [users[0], ...users.slice(-(perSession - 1))].filter((m, i, a) => a.indexOf(m) === i);
    lines.push([head, ...asked.map((m) => `  asked: ${clip(m.text, 220)}`), bots.length ? `  ended: ${clip(bots.at(-1).text, 360)}` : ''].filter(Boolean).join('\n'));
  }
  return lines;
}

/** Messages in the folder's sessions that contain every word, with the words around them. */
export function searchSessions(cwd, query, opts = {}) {
  const { limit = 12, days = 60 } = opts;
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hits = [];
  for (const f of sessionFiles(cwd, { ...opts, days })) {
    if (hits.length >= limit) break;
    const s = readSession(f.file, f.provider);
    for (const m of s.messages) {
      const low = m.text.toLowerCase();
      if (!words.every((w) => low.includes(w))) continue;
      const at = low.indexOf(words[0]);
      hits.push(`${stamp(m.at || f.mtime)} ${f.provider} ${String(s.id).slice(0, 8)} ${m.role === 'user' ? 'Noam' : 'agent'}: …${clip(m.text.slice(Math.max(0, at - 120), at + 280), 400)}`);
      if (hits.length >= limit) break;
    }
  }
  return hits;
}

/** The last `tail` messages of one session (by the start of its id), word for word but trimmed. */
export function showSession(cwd, idStart, { tail = 20, ...opts } = {}) {
  for (const f of sessionFiles(cwd, { days: 365, ...opts })) {
    const s = readSession(f.file, f.provider);
    if (!String(s.id).startsWith(idStart)) continue;
    return s.messages.slice(-tail).map((m) => `${stamp(m.at)} ${m.role === 'user' ? 'Noam' : 'agent'}: ${clip(m.text, 900)}`);
  }
  return [];
}
