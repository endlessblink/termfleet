import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * A bot's lasting memory (TF-096 part 3). Research (docs/teammates-research-
 * 2026-10-16.md section 2): keep the verbatim conversation and search it; keep a
 * small card of preferences, decisions and lessons that the operator approves.
 * Agent-proposed entries are never used until he approves them (memory poisoning),
 * and replaced entries are filtered out, not just labelled.
 *
 *   <bot folder>/memory.json   the card: proposed, approved and forgotten entries
 *   <bot folder>/chat.jsonl    the whole conversation, verbatim (searched)
 */

export const KINDS = ['preference', 'decision', 'fact', 'lesson'];
export const CARD_CHAR_LIMIT = 6000;
const ENTRY_LIMIT = 600;

const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };

export class BotMemory {
  constructor(folder, { now = () => Date.now() } = {}) {
    this.folder = folder;
    this.file = path.join(folder, 'memory.json');
    this.now = now;
  }

  entries() {
    const data = readJson(this.file, { entries: [] });
    return Array.isArray(data.entries) ? data.entries : [];
  }

  save(entries) {
    fs.mkdirSync(this.folder, { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ entries }, null, 1), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  /** The bot suggests something worth remembering; it waits for Noam. */
  propose({ text, kind = 'fact', source = null }) {
    const body = String(text || '').replace(/\s+/g, ' ').trim().slice(0, ENTRY_LIMIT);
    if (body.length < 6) return { error: 'Say what should be remembered, in one or two sentences.' };
    const entries = this.entries();
    if (entries.some((e) => e.status !== 'forgotten' && e.text.toLowerCase() === body.toLowerCase())) return { ok: true, duplicate: true };
    const entry = { id: crypto.randomBytes(5).toString('hex'), text: body, kind: KINDS.includes(kind) ? kind : 'fact', status: 'proposed', source, at: this.now() };
    entries.push(entry);
    this.save(entries);
    return { ok: true, entry };
  }

  /** Noam adds or approves (optionally reworded) an entry; it now guides the bot. */
  approve(id, text) {
    const entries = this.entries();
    const e = entries.find((x) => x.id === id);
    if (!e) return { error: 'That memory no longer exists.' };
    if (typeof text === 'string' && text.trim()) e.text = text.replace(/\s+/g, ' ').trim().slice(0, ENTRY_LIMIT);
    e.status = 'approved';
    e.approvedAt = this.now();
    this.save(entries);
    return { ok: true, entry: e };
  }

  add({ text, kind = 'preference' }) {
    const made = this.propose({ text, kind, source: 'operator' });
    if (made.error || made.duplicate) return made;
    return this.approve(made.entry.id);
  }

  /** Rejected or forgotten entries never reach the bot again. */
  forget(id) {
    const entries = this.entries();
    const e = entries.find((x) => x.id === id);
    if (!e) return { error: 'That memory no longer exists.' };
    e.status = 'forgotten';
    e.forgottenAt = this.now();
    this.save(entries);
    return { ok: true };
  }

  /** What the bot is always told: only approved entries, newest kept when over the limit. */
  card() {
    const approved = this.entries().filter((e) => e.status === 'approved');
    if (!approved.length) return '';
    const titles = { preference: "Noam's preferences", decision: 'Decisions', fact: 'Facts', lesson: 'Lessons learned' };
    const lines = ['Your memory card (approved by Noam; it outranks your own guesses):'];
    let size = lines[0].length;
    const kept = [];
    for (const e of [...approved].reverse()) {
      size += e.text.length + 4;
      if (size > CARD_CHAR_LIMIT) break;
      kept.push(e);
    }
    for (const kind of KINDS) {
      const items = kept.filter((e) => e.kind === kind).reverse();
      if (!items.length) continue;
      lines.push(`${titles[kind]}:`);
      for (const e of items) lines.push(`- ${e.text}`);
    }
    return lines.join('\n');
  }

  pendingCount() { return this.entries().filter((e) => e.status === 'proposed').length; }
}

const tokens = (text) => String(text || '').toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || [];

/**
 * Search a bot's whole conversation, verbatim. Keyword scoring (rare words count
 * more) plus a small boost for recent messages; Hebrew and English alike.
 */
export function searchChat(messages, query, { limit = 8, now = Date.now() } = {}) {
  const terms = [...new Set(tokens(query))];
  if (!terms.length) return [];
  const docs = messages.filter((m) => (m.role === 'operator' || m.role === 'bot') && m.text).map((m) => ({ m, words: tokens(m.text) }));
  const df = new Map(terms.map((t) => [t, docs.filter((d) => d.words.some((w) => w.includes(t))).length]));
  const scored = [];
  for (const d of docs) {
    let score = 0;
    for (const t of terms) {
      const hits = d.words.filter((w) => w.includes(t)).length;
      if (hits) score += (1 + Math.log(hits)) * Math.log(1 + docs.length / (df.get(t) || 1));
    }
    if (!score) continue;
    const ageDays = d.m.at ? Math.max(0, (now - d.m.at) / 86_400_000) : 365;
    score *= 1 + 0.5 / (1 + ageDays / 7);
    scored.push({ score, m: d.m });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map(({ m }) => {
    const lower = m.text.toLowerCase();
    const at = Math.max(0, Math.min(...terms.map((t) => { const i = lower.indexOf(t); return i < 0 ? Infinity : i; })) - 120);
    const snippet = (at > 0 ? '…' : '') + m.text.slice(at, at + 400).replace(/\s+/g, ' ') + (m.text.length > at + 400 ? '…' : '');
    return { at: m.at, who: m.role === 'operator' ? 'Noam' : 'bot', snippet };
  });
}
