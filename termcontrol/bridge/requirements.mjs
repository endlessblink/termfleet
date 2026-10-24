import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { findOwnerWords } from './owner-words.mjs';

/**
 * Owner requirements ledger (TF-102). Noam 2026-10-23: "ותבנה מערכת שתבטיח ב100% שאתה לא
 * יכול לפספס דברים שאני אומר ושמחייבת אותך ליישם אותם מקצה לקצה". Spec:
 * docs/specs/owner-requirements-ledger.md.
 *
 * Every message Noam types (a terminal prompt, or a bot chat message) is split into atomic
 * items, each with his exact words, a stable id (R-12), the message id, the project and
 * topic tags. Items live in one append-only event file; the per-project ledger is a view of
 * it. Ids are global so a bot's R-12 means the same thing in the terminal it briefs.
 *
 * The gates that make dropping an item impossible (termfleet-asks Stop hook, the CLI's
 * evidence and lock checks, termfleet-team's --req briefs and delivery receipts) all read
 * this file through the functions below. Splitting is deterministic: numbering, bullets,
 * lines and sentences, never a model.
 */

export const STORE_VERSION = 1;
const dataHome = () => process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
// A private bridge (tests, TC_CONFIG_DIR) keeps a private ledger; the real one has no TC_CONFIG_DIR.
export const ledgerDir = (env = process.env) => env.TERMFLEET_REQ_DIR || (env.TC_CONFIG_DIR ? path.join(env.TC_CONFIG_DIR, 'requirements') : path.join(env.XDG_DATA_HOME || dataHome(), 'termfleet', 'requirements'));
const ledgerFile = (dir) => path.join(dir, 'ledger.jsonl');

// What each status means for "can the turn end?". new = nobody has looked at it yet.
export const RESOLVED_FOR_STOP = new Set(['assigned', 'answered', 'waiting', 'context', 'ready', 'done', 'partial', 'dropped']);
export const ITEM_STATUSES = ['assigned', 'answered', 'waiting', 'context', 'ready', 'done', 'partial', 'dropped'];

// Screen topics (R-15307, Noam 2026-10-24: agents marked UI work "done" when the code was
// committed, before he ever saw it). An item on a visual topic can be marked ready by an agent,
// never done: only his own verified message (owner-words) closes it. Each topic carries a
// "visual" flag; these are the defaults, and a topic-meta event overrides them. Turning a
// topic's flag OFF needs his verified message too, so the guard cannot be switched off quietly.
export const DEFAULT_VISUAL_TOPICS = new Set(['eyes-emoji', 'sidebar-folders', 'bot-menu-display', 'chat-jitter', 'scroll-jump-to-top', 'image-back-black-screen', 'inline-media', 'duplicate-messages', 'counter-card']);
export const DEFAULT_NON_VISUAL_TOPICS = new Set(['model-routing', 'resource-balancing', 'token-optimization', 'codex-routing', 'reliability']);
export function isVisualTopic(topic, topicMeta = new Map()) {
  const meta = topicMeta.get(topic);
  if (meta && typeof meta.visual === 'boolean') return meta.visual;
  return DEFAULT_VISUAL_TOPICS.has(topic);
}
/** His genuine message by id, or null (a typed "--noam-said" is not proof). */
export function ownerConfirmation(msgId, { base } = {}) {
  if (!msgId) return null;
  try { return findOwnerWords(String(msgId), base ? { base } : {}) || null; } catch { return null; }
}
const visualDoneProblem = (it) => `${it.id} is on a screen topic (${it.visualTopics.join(', ')}): an agent can mark it ready, never done. Only Noam seeing it work closes it: termfleet-asks ready ${it.id} --evidence "<screenshot>", then after his own message says it works, termfleet-asks lock ${it.id} --owner-words <his message id>.`;

// ---------------------------------------------------------------------------------------
// Splitting a message into atomic items

const ACK = /^(y|yes|yeah|yep|ok|okay|go|go on|go ahead|do it|continue|proceed|sure|thanks|thank you|great|good|perfect|nice|cool|נו|כן|יאללה|סבבה|תמשיך|המשך|אוקיי|תודה|מעולה|יופי|אחלה|טוב)$/i;
const squashEnd = (s) => s.toLowerCase().replace(/[.!?,…:;]+$/g, '').trim();
export const isAck = (s) => ACK.test(squashEnd(String(s || '')));

// A picture note Noam wrote on an attachment is its own item ("[Noam's note on picture 2: …]").
const PICTURE_NOTE = /^\s*\[(?:Noam'?s )?(?:note|annotation|comment) on (?:picture|image|screenshot)[^\]:]*:\s*([^\]]+)\]\s*$/i;
const ATTACH_LINE = /^\s*\[Noam attached [^\]]*\]\s*$/i;
// Numbered parts: (1) 1. 1) #1 and Hebrew letters א. א) at a line start, or (1) inline.
const NUM_AT_LINE = /^\s*(?:\((\d{1,2}|[א-י])\)|(\d{1,2})[.)]|#(\d{1,2})\b|([א-י])[.)])\s+/;
const NUM_INLINE = /(?:^|\s)\((\d{1,2})\)\s+/g;
const BULLET = /^\s*(?:[-*•▪◦]|–)\s+/;

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const wordsIn = (s) => clean(s).split(' ').filter(Boolean).length;

function sentences(text) {
  // Keep decimals, versions and abbreviations together: split only on an end mark followed by space.
  return String(text).split(/(?<=[.!?。…])\s+(?=\S)/).map(clean).filter(Boolean);
}

/** True for a fragment that is only a greeting, a thanks or a one-word ack. */
function filler(s) {
  const t = clean(s);
  return !t || isAck(t) || (wordsIn(t) < 2 && !/[?]/.test(t) && t.length < 12);
}

/**
 * Noam's message → atomic items, each { words, part, kind }. Rules, in order:
 *  1. Picture notes are always their own items.
 *  2. Two or more numbered parts → one item per part (text before the first part is its own
 *     item when it asks something).
 *  3. Two or more bullets → one item per bullet.
 *  4. Otherwise every line, and every sentence within a line, is an item (fillers dropped).
 * Over-splitting is the safe side: an item that is only context is marked "context" by the
 * agent in one command; an item merged into another can be dropped silently.
 */
export function splitMessage(raw) {
  const text = String(raw || '').replace(/\r/g, '');
  const items = [];
  const notes = [];
  const body = [];
  for (const l of text.split('\n')) {
    const note = PICTURE_NOTE.exec(l);
    if (note) { notes.push(clean(note[1])); continue; }
    if (ATTACH_LINE.test(l) || /^\s*>/.test(l)) continue;
    body.push(l);
  }
  const joined = body.join('\n').trim();
  if (joined && !(isAck(joined) && wordsIn(joined) <= 4)) items.push(...splitBody(joined));
  for (const n of notes) items.push({ words: n, kind: 'picture-note' });
  return items.map((it, i) => ({ ...it, part: i + 1, of: items.length }));
}

function partsAt(lines, starts, marker) {
  const out = [];
  const pre = lines.slice(0, starts[0]).join(' ');
  if (!filler(pre)) out.push({ words: clean(pre), kind: 'preamble' });
  starts.forEach((start, k) => {
    const end = k + 1 < starts.length ? starts[k + 1] : lines.length;
    const part = clean(lines.slice(start, end).join(' ').replace(marker, ''));
    if (part) out.push({ words: part, kind: marker === BULLET ? 'bullet' : 'numbered' });
  });
  return out;
}

function splitBody(text) {
  const lines = text.split('\n');
  const numbered = lines.map((l, i) => (NUM_AT_LINE.test(l) ? i : -1)).filter((i) => i >= 0);
  if (numbered.length >= 2) return partsAt(lines, numbered, NUM_AT_LINE);
  // Inline numbering: "do this (1) foo (2) bar"
  const flat = clean(text);
  const marks = [...flat.matchAll(NUM_INLINE)];
  if (marks.length >= 2) {
    const out = [];
    const pre = flat.slice(0, marks[0].index).trim();
    if (!filler(pre)) out.push({ words: pre, kind: 'preamble' });
    marks.forEach((m, k) => {
      const from = m.index + m[0].length;
      const to = k + 1 < marks.length ? marks[k + 1].index : flat.length;
      const part = clean(flat.slice(from, to));
      if (part) out.push({ words: part, kind: 'numbered' });
    });
    return out;
  }
  const bullets = lines.map((l, i) => (BULLET.test(l) ? i : -1)).filter((i) => i >= 0);
  if (bullets.length >= 2) return partsAt(lines, bullets, BULLET);
  const out = [];
  for (const l of lines) for (const s of sentences(l)) {
    if (filler(s)) continue;
    // A very short fragment ("and fast.") belongs to the sentence before it.
    if (out.length && wordsIn(s) < 3 && !/[?]/.test(s)) { out[out.length - 1].words += ` ${s}`; continue; }
    out.push({ words: s, kind: 'sentence' });
  }
  if (!out.length && !filler(text)) out.push({ words: clean(text), kind: 'sentence' });
  return out;
}

/**
 * Only Noam's own words are captured. A teammate's relayed message is not him; his verified
 * words inside it (a "[Noam's own words, recorded by TermFleet" block) are, with that record's id.
 */
export function ownerTextOf(prompt) {
  // A teammate's message can arrive wrapped as one pasted block; unwrap it so it is still known as
  // a teammate's (2026-10-24: a relayed status message became 77 of "Noam's" items).
  const wrapped = /^\s*<pasted_content[^>]*>([\s\S]*)<\/pasted_content[^>]*>\s*$/.exec(String(prompt || ''));
  const text = wrapped ? wrapped[1].trim() : String(prompt || '');
  const block = /\[Noam's own words, recorded by TermFleet:[^\]]*\(message ([0-9a-f]{6,})\)[^\]]*\]\s*\n"([\s\S]*?)"\s*\nTreat it exactly/.exec(text);
  if (block) return { text: block[2], msgId: block[1], relayed: true };
  if (/^\s*\[Message from /.test(text)) return null;
  if (/^\s*(<(system-reminder|command-|local-command|task-notification|user-prompt-submit-hook|environment_context|user_instructions|turn_aborted)|\[SYSTEM NOTIFICATION|\[Event, not from|\(You were cut off by a restart|\[System notice|Caveat:|This session is being continued)/i.test(text)) return null;
  // Pasted blocks are someone else's text; what he typed around them is his.
  const own = text.replace(/<pasted_content[^>]*>[\s\S]*?<\/pasted_content[^>]*>/g, ' ').trim();
  return own ? { text: own, msgId: null, relayed: false } : null;
}

// ---------------------------------------------------------------------------------------
// Store

function readEvents(dir) {
  try {
    return fs.readFileSync(ledgerFile(dir), 'utf8').split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

function withLock(dir, fn) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const lock = path.join(dir, '.lock');
  const until = Date.now() + 5000;
  for (;;) {
    try { fs.mkdirSync(lock); break; } catch {
      // A lock left by a crashed writer is stale after 10 s.
      try { if (Date.now() - fs.statSync(lock).mtimeMs > 10000) { fs.rmdirSync(lock); continue; } } catch { /* raced */ }
      if (Date.now() > until) throw new Error('The requirements ledger is busy; try again.');
      const t = Date.now() + 15; while (Date.now() < t) { /* writers hold the lock for microseconds */ }
    }
  }
  try { return fn(); } finally { try { fs.rmdirSync(lock); } catch { /* gone */ } }
}

function append(dir, events) {
  fs.appendFileSync(ledgerFile(dir), events.map((e) => JSON.stringify(e)).join('\n') + '\n', { mode: 0o600 });
}

/** Folds the event file into items by id, plus the topic aliases. */
// The bridge asks for the ledger for every terminal every few seconds; folding the whole file
// each time kept it at 100% CPU and the phone stuck on "loading" (2026-10-24, 9.5 MB / 23k lines).
// The folded result is reused until the file's size or change time moves (every write appends).
const folded = new Map();
export function loadLedger({ dir = ledgerDir() } = {}) {
  let stamp = 'none';
  try { const st = fs.statSync(ledgerFile(dir)); stamp = `${st.size}:${st.mtimeMs}`; } catch { /* no ledger yet */ }
  const hit = folded.get(dir);
  if (hit && hit.stamp === stamp) return hit.value;
  const value = foldLedger(dir);
  folded.set(dir, { stamp, value });
  return value;
}

function foldLedger(dir) {
  const items = new Map();
  const topics = new Map(); // slug -> Set(aliases)
  const topicMeta = new Map(); // slug -> { visual, by, at }
  const escalations = [];
  for (const e of readEvents(dir)) {
    if (e.e === 'topic-meta') { topicMeta.set(e.topic, { ...(topicMeta.get(e.topic) || {}), ...(typeof e.visual === 'boolean' ? { visual: e.visual } : {}), by: e.by || null, at: e.at }); if (!topics.has(e.topic)) topics.set(e.topic, new Set()); continue; }
    if (e.e === 'topic-alias') { const s = topics.get(e.topic) || new Set(); for (const a of e.aliases || []) s.add(a); topics.set(e.topic, s); continue; }
    if (e.e === 'escalated') { escalations.push(e); continue; }
    if (e.e === 'capture') {
      items.set(e.id, { id: e.id, n: e.n, words: e.words, msgId: e.msgId, at: e.at, project: e.project, source: e.source, askN: e.askN ?? null, part: e.part, of: e.of, kind: e.kind, topics: e.topics || [], status: 'new', note: '', evidence: [], open: [], assigned: [], locked: false, lockedAt: null, lockedBy: null, reverified: [], updatedAt: e.at });
      for (const t of e.topics || []) if (!topics.has(t)) topics.set(t, new Set());
      continue;
    }
    const it = items.get(e.id);
    if (!it) continue;
    it.updatedAt = e.at;
    if (e.e === 'topic') { it.topics = [...new Set([...(e.replace ? [] : it.topics), ...(e.topics || [])])]; for (const t of e.topics || []) if (!topics.has(t)) topics.set(t, new Set()); }
    else if (e.e === 'assign') { it.assigned.push({ pane: e.pane, delivery: e.delivery || null, at: e.at, by: e.by || null }); if (!['ready', 'done', 'dropped'].includes(it.status)) it.status = 'assigned'; }
    else if (e.e === 'status') { it.statusAt = e.at; it.status = e.status; it.confirmedBy = e.status === 'done' ? e.ownerMsg || null : null; it.note = e.note || ''; if (e.evidence) it.evidence.push({ at: e.at, what: e.evidence, by: e.by || null }); it.open = e.open || []; }
    else if (e.e === 'lock') { it.locked = true; it.lockedAt = e.at; it.lockedBy = e.by || null; if (e.ownerMsg) it.confirmedBy = e.ownerMsg; }
    else if (e.e === 'unlock') { it.locked = false; }
    else if (e.e === 'reverify') it.reverified.push({ at: e.at, evidence: e.evidence, forId: e.forId || null });
  }
  // A "done" on a screen item that Noam did not confirm (written around the command, or before
  // the topic was known to be visual) reads as ready: built, waiting for his eyes.
  for (const it of items.values()) {
    it.visualTopics = it.topics.filter((t) => isVisualTopic(t, topicMeta));
    it.visual = it.visualTopics.length > 0;
    if (it.visual && it.status === 'done' && !it.locked && !it.confirmedBy) { it.status = 'ready'; it.awaitingNoam = true; }
  }
  return { items, topics, topicMeta, escalations };
}

export const projectOf = (cwd) => {
  let dir = path.resolve(cwd || process.cwd());
  for (let d = dir; d && d !== path.dirname(d); d = path.dirname(d)) if (fs.existsSync(path.join(d, '.git'))) { dir = d; break; }
  return path.basename(dir).toLowerCase();
};

export const slug = (t) => String(t || '').toLowerCase().trim().replace(/[\s_]+/g, '-').replace(/[^\p{L}\p{N}-]/gu, '').replace(/-+/g, '-').replace(/^-|-$/g, '');

/** Topics whose name or alias appears in the words (title-strip ↔ "title strip"). */
export function topicsFor(words, topics) {
  const hay = ` ${String(words || '').toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')} `;
  const found = [];
  for (const [t, aliases] of topics) {
    const names = [t.replace(/-/g, ' '), ...[...(aliases || [])].map((a) => String(a).toLowerCase().replace(/[_-]+/g, ' '))];
    if (names.some((n) => n.trim() && hay.includes(n.trim()))) found.push(t);
  }
  return found;
}

const msgIdFor = (source, askN, text) => createHash('sha1').update(`${source}\n${askN ?? ''}\n${text}`).digest('hex').slice(0, 12);

/**
 * Records one message from Noam. Idempotent per message id: a hook that runs twice, or a bot
 * message seen by both the bridge and the brain's hook, never makes duplicate items.
 */
export function captureMessage({ text, msgId = null, at = Date.now(), project, source, askN = null, topics: extraTopics = [] }, { dir = ledgerDir() } = {}) {
  const own = String(text || '').trim();
  if (!own || !project || !source) return [];
  const id = msgId || msgIdFor(source, askN, own);
  return withLock(dir, () => {
    const { items, topics } = loadLedger({ dir });
    const already = [...items.values()].filter((it) => it.msgId === id);
    if (already.length) return already;
    const parts = splitMessage(own);
    if (!parts.length) return [];
    let n = Math.max(0, ...[...items.values()].map((it) => it.n || 0));
    const events = parts.map((p) => {
      n += 1;
      return { v: STORE_VERSION, e: 'capture', id: `R-${n}`, n, words: p.words, msgId: id, at, project, source, askN, part: p.part, of: p.of, kind: p.kind, topics: [...new Set([...topicsFor(p.words, topics), ...extraTopics.map(slug).filter(Boolean)])] };
    });
    append(dir, events);
    const after = loadLedger({ dir }).items;
    return events.map((e) => after.get(e.id));
  });
}

export function normId(s) {
  const m = /^R-?(\d+)$/i.exec(String(s || '').trim());
  return m ? `R-${Number(m[1])}` : null;
}
export const idsIn = (text) => [...new Set([...String(text || '').matchAll(/\bR-(\d+)\b/g)].map((m) => `R-${Number(m[1])}`))];

/** Appends events for existing items; throws a plain sentence when an id is unknown. */
export function record(events, { dir = ledgerDir(), ownerBase = undefined } = {}) {
  return withLock(dir, () => {
    const { items } = loadLedger({ dir });
    for (const e of events) if (e.id && !items.has(e.id)) throw new Error(`${e.id} is not in Noam's list. termfleet-asks items shows the ids.`);
    // Every writer goes through here, so the screen guard holds for bots and scripts too.
    for (const e of events) {
      const it = e.id && items.get(e.id);
      if (!it?.visual) continue;
      if ((e.e === 'status' && e.status === 'done') || (e.e === 'lock' && !it.locked)) {
        if (!ownerConfirmation(e.ownerMsg, { base: ownerBase })) throw new Error(visualDoneProblem(it));
      }
    }
    const at = Date.now();
    append(dir, events.map((e) => ({ v: STORE_VERSION, at, ...e })));
    return true;
  });
}

export function addTopic(ids, topic, { aliases = [], dir = ledgerDir() } = {}) {
  const t = slug(topic);
  if (!t) throw new Error('Give a topic name, e.g. title-strip.');
  record(ids.map((id) => ({ e: 'topic', id, topics: [t] })), { dir });
  if (aliases.length) withLock(dir, () => append(dir, [{ v: STORE_VERSION, at: Date.now(), e: 'topic-alias', topic: t, aliases: aliases.map((a) => String(a).toLowerCase().trim()).filter(Boolean) }]));
  return t;
}

/** Sets a topic's visual flag. Turning a screen topic into a non-screen one needs his message. */
export function setTopicVisual(topic, visual, { ownerMsg = null, by = null, dir = ledgerDir(), ownerBase = undefined } = {}) {
  const t = slug(topic);
  if (!t) throw new Error('Give a topic name, e.g. sidebar-folders.');
  if (typeof visual !== 'boolean') throw new Error('Say --visual true or --visual false.');
  return withLock(dir, () => {
    const { topicMeta } = loadLedger({ dir });
    if (!visual && isVisualTopic(t, topicMeta) && !ownerConfirmation(ownerMsg, { base: ownerBase })) {
      throw new Error(`${t} is a screen topic: only Noam can say it is not. Add --owner-words <his message id> where he said so.`);
    }
    append(dir, [{ v: STORE_VERSION, at: Date.now(), e: 'topic-meta', topic: t, visual, ...(ownerMsg ? { ownerMsg: String(ownerMsg) } : {}), by }]);
    return t;
  });
}

// ---------------------------------------------------------------------------------------
// The rules

export const clip = (s, n) => { const t = clean(s); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/** Evidence is a file that exists (a screenshot, a test log) or a concrete description. */
export function evidenceProblem(evidence) {
  const e = String(evidence || '').trim();
  if (!e) return 'needs evidence attached to this item: --evidence "<screenshot path, or the test output>"';
  const looksLikePath = /^(?:~|\.{0,2})?\/\S+$/.test(e) || /^\S+\.(png|jpe?g|webp|gif|log|txt|json|html|mp4)$/i.test(e);
  if (looksLikePath) {
    const p = e.replace(/^~(?=\/)/, os.homedir());
    return fs.existsSync(p) ? null : `the evidence file ${e} does not exist`;
  }
  if (/^(done|works|working|fixed|ok|tested|verified|checked|see above|as discussed|all good)\b[.!]?$/i.test(e)) return 'the evidence only repeats a claim: say what ran and what it showed';
  if (e.length < 12) return 'the evidence is too thin: say what ran and what it showed, or give a screenshot path';
  return null;
}

/** Locked items on the same topics (same project) not yet re-checked for this delivery. */
export function lockedToReverify(item, items) {
  if (!item?.topics?.length) return [];
  const since = Math.max(item.at || 0, ...item.assigned.map((a) => a.at || 0));
  return [...items.values()].filter((o) => o.id !== item.id && o.locked && o.project === item.project
    && o.topics.some((t) => item.topics.includes(t))
    && !o.reverified.some((r) => r.at >= since && (!r.forId || r.forId === item.id)));
}

/**
 * Validates one mark against the ledger. Returns { events } or { error }.
 * done/ready: evidence required, and every locked item on its topics re-checked.
 * partial: must list exactly which parts are still open.
 */
export function markItem({ status, id, note = '', evidence = '', open = [], by = null }, { dir = ledgerDir() } = {}) {
  const { items } = loadLedger({ dir });
  const it = items.get(id);
  if (!it) return { error: `${id} is not in Noam's list. termfleet-asks items shows the ids.` };
  if (!ITEM_STATUSES.includes(status)) return { error: `Unknown status "${status}".` };
  if (status === 'done' && it.visual) return { error: visualDoneProblem(it) };
  if (status === 'done' || status === 'ready') {
    const problem = evidenceProblem(evidence);
    if (problem) return { error: `${id} ${problem}.` };
    const stale = lockedToReverify(it, items);
    if (stale.length) return { error: `${id} touches ${it.topics.join(', ')}, where Noam already approved ${stale.map((s) => s.id).join(', ')}. Re-check each one on the live result first: ${stale.map((s) => `termfleet-asks reverify ${s.id} --for ${id} --evidence "<screenshot or test output>" (${s.id}: "${clip(s.words, 70)}")`).join('; ')}` };
  }
  if (status === 'partial') {
    const parts = open.map(clean).filter(Boolean);
    if (!parts.length) return { error: `A partial ${id} must list exactly which parts are still open: --open "<part one>; <part two>"` };
    return { events: [{ e: 'status', id, status, note, open: parts, evidence: evidence || null, by }] };
  }
  if (['answered', 'waiting', 'context', 'dropped'].includes(status) && clean(note).length < 4) {
    const want = { answered: 'what you answered', waiting: 'what you are waiting for Noam to say', context: 'why it is background, not a request', dropped: 'why, and who decided' }[status];
    return { error: `Say ${want}.` };
  }
  return { events: [{ e: 'status', id, status, note, evidence: evidence || null, by }] };
}

// ---------------------------------------------------------------------------------------
// Briefs: Noam's exact words travel with the work

export const BRIEF_HEADER = "[Noam's requirements for this work: his exact words, recorded by TermFleet.";

/** The named items, plus every open and locked item on the same topics in the same project. */
export function briefItems(ids, { dir = ledgerDir() } = {}) {
  const { items } = loadLedger({ dir });
  const named = ids.map((id) => items.get(id));
  const missing = ids.filter((id, i) => !named[i]);
  if (missing.length) return { error: `${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not in Noam's list. termfleet-asks items shows the ids.` };
  const topics = new Set(named.flatMap((it) => it.topics));
  const projects = new Set(named.map((it) => it.project));
  const related = [...items.values()].filter((o) => !ids.includes(o.id) && projects.has(o.project) && o.topics.some((t) => topics.has(t)));
  return {
    named,
    open: related.filter((o) => !o.locked && !['done', 'dropped', 'context', 'answered'].includes(o.status)),
    locked: related.filter((o) => o.locked),
  };
}

const itemLine = (it) => `- ${it.id}${it.topics.length ? ` (${it.topics.join(', ')})` : ''}: "${it.words}"`;

export function briefBlock({ named, open, locked }, { delivery = null } = {}) {
  const out = [
    `${BRIEF_HEADER} Work through EVERY item below. Attach the evidence to each item in the list (below); your final reply is 1-3 plain sentences: what is now true, what is not done yet, what to try. No item ids, no quoted words, no table: the chat shows the per-item list under Details.]`,
    ...named.map(itemLine),
  ];
  if (open.length) out.push('Still open on the same topic (his earlier words, keep them in mind):', ...open.map(itemLine));
  if (locked.length) out.push('Locked: Noam confirmed these work. Re-check each one on the live result before you mark anything on this topic ready:', ...locked.map(itemLine));
  out.push('Mark each item: termfleet-asks ready|done <id> --evidence "<screenshot path or test output>"; partial needs --open "<what is still open>"; a question for Noam: termfleet-asks waiting <id> "<question>". Re-check a locked item: termfleet-asks reverify <id> --for <your id> --evidence "<proof>".');
  if (delivery) out.push(`[delivery ${delivery}]`);
  return out.join('\n');
}

export const newDeliveryId = () => `D-${randomBytes(4).toString('hex')}`;

/** Ids named in brief blocks inside a conversation's user messages (what this agent was handed). */
export function briefedIds(userTexts) {
  const ids = new Set();
  for (const t of userTexts) {
    const s = String(t);
    const at = s.indexOf(BRIEF_HEADER);
    if (at < 0) continue;
    const block = s.slice(at).split('\nStill open on the same topic')[0].split('\nLocked:')[0].split('\nMark each item:')[0];
    for (const m of block.matchAll(/^- (R-\d+)\b/gm)) ids.add(m[1]);
  }
  return [...ids];
}

// ---------------------------------------------------------------------------------------
// The Stop gate

const CLAIMS = /\b(done|fixed|finished|completed?|works now|is live|all set|ready for you|shipped|resolved)\b|(?:^|\s)(סיימתי|תוקן|מוכן|עובד עכשיו|הושלם)(?:\s|$|[.!,])/i;

/**
 * What blocks ending a turn, as one plain reason, or null:
 *  - an item Noam said in this conversation that nobody has taken (new);
 *  - an item this agent was handed that it has not marked;
 *  - an old-style "#n done" over a message whose parts are not all resolved;
 *  - a reply that claims it is finished while a delivered item has no evidence in the ledger;
 *  - a reply that lists item ids or a per-item table (Noam 2026-10-23: "המסך הזה לא כלכך עוזר לי").
 *    He reads 1-3 plain sentences; the per-item list is under the reply's Details toggle.
 */
export function stopProblem({ source, briefed = [], lastMessage = '', askMarks = [] }, { dir = ledgerDir() } = {}) {
  const { items } = loadLedger({ dir });
  const mine = [...items.values()].filter((it) => it.source === source);
  const unseen = mine.filter((it) => it.status === 'new');
  if (unseen.length) {
    return `Noam's message has ${unseen.length} item${unseen.length === 1 ? '' : 's'} nobody has taken yet. For each one: do it and mark it (termfleet-asks ready|done <id> --evidence "..."), hand it over (termfleet-team send <who> --req <id> "..."), answer it (termfleet-asks answered <id> "..."), ask him (termfleet-asks waiting <id> "..."), or mark it background (termfleet-asks context <id> "..."). Items: ${unseen.slice(0, 8).map((it) => `${it.id} "${clip(it.words, 70)}"`).join('; ')}${unseen.length > 8 ? ` (+${unseen.length - 8} more)` : ''}`;
  }
  const handed = briefed.map((id) => items.get(id)).filter(Boolean);
  const unmarked = handed.filter((it) => it.status === 'assigned' || it.status === 'new');
  if (unmarked.length) {
    return `You were handed ${unmarked.map((it) => it.id).join(', ')} and have not marked ${unmarked.length === 1 ? 'it' : 'them'}. Mark each: termfleet-asks ready|done <id> --evidence "...", partial <id> --open "...", or waiting <id> "<question for Noam>". ${unmarked.slice(0, 6).map((it) => `${it.id} "${clip(it.words, 70)}"`).join('; ')}`;
  }
  for (const m of askMarks) {
    if (!['done', 'ready'].includes(m.status)) continue;
    for (const n of m.nums || [m.n]) {
      const parts = mine.filter((it) => it.askN === n && !['done', 'ready', 'dropped', 'context', 'answered'].includes(it.status));
      if (parts.length) return `Request #${n} is marked ${m.status}, but its parts ${parts.map((it) => `${it.id} [${it.status}]`).join(', ')} are not. Mark each part with its own evidence, or mark #${n} partial and list the open parts.`;
    }
  }
  const delivered = [...new Map([...mine, ...handed].map((it) => [it.id, it])).values()].filter((it) => ['done', 'ready', 'partial'].includes(it.status));
  if (delivered.length && CLAIMS.test(lastMessage)) {
    const bare = delivered.filter((it) => ['done', 'ready'].includes(it.status) && !it.evidence.length);
    if (bare.length) return `Your reply says the work is finished, but ${bare.map((it) => it.id).join(', ')} ${bare.length === 1 ? 'has' : 'have'} no evidence attached. Mark each again with it: termfleet-asks ready|done <id> --evidence "<screenshot path or test output>".`;
  }
  if (delivered.length && (idsIn(lastMessage).length || /^\s*\|.*\|\s*$/m.test(String(lastMessage)))) {
    return 'Noam reads this reply: write it again in 1-3 plain sentences without item ids or a table (what is now true, what is not done yet, what to try). The per-item list with his words and the evidence already shows under the reply\'s Details toggle.';
  }
  return null;
}

const REPORTED = new Set(['done', 'ready', 'partial', 'answered', 'waiting', 'dropped']);

/**
 * The Details toggle under a bot reply (Noam 2026-10-23): the items reported during that turn,
 * each with his words, what was done and the evidence. An item marked after reply A goes under the
 * first later reply that says the work is finished, else under the newest reply after the mark.
 * Returns { [botMessageId]: [{ id, words, status, did, evidence }] }.
 */
export function replyDetails(messages, items) {
  const replies = (messages || []).filter((m) => m.role === 'bot' && m.text && m.id && Number(m.at)).sort((a, b) => a.at - b.at);
  const out = {};
  for (const it of items || []) {
    if (!REPORTED.has(it.status) || !it.statusAt) continue;
    const after = replies.filter((m) => m.at >= it.statusAt);
    const home = after.find((m) => CLAIMS.test(m.text)) || after[after.length - 1];
    if (!home) continue;
    const last = it.evidence[it.evidence.length - 1];
    const did = clip([it.note, it.open.length ? `Still open: ${it.open.join('; ')}` : ''].filter(Boolean).join('. '), 300);
    (out[home.id] ||= []).push({ id: it.id, words: clip(it.words, 300), status: it.locked ? 'locked' : it.status, did, evidence: last ? clip(last.what, 300) : '' });
  }
  for (const k of Object.keys(out)) out[k].sort((a, b) => Number(a.id.slice(2)) - Number(b.id.slice(2)));
  return out;
}

/** When the gate gives up after repeated blocks it is never silent: it shows in Noam's list. */
export function escalate({ source, reason }, { dir = ledgerDir() } = {}) {
  withLock(dir, () => append(dir, [{ v: STORE_VERSION, e: 'escalated', at: Date.now(), source, reason: clip(reason, 400) }]));
}

/** Noam's view: items by project and topic, newest first. */
export function itemsView({ project = null, topic = null, includeClosed = false, source = null } = {}, { dir = ledgerDir() } = {}) {
  const { items, escalations } = loadLedger({ dir });
  const list = [...items.values()]
    .filter((it) => (!project || it.project === project) && (!topic || it.topics.includes(topic)) && (!source || it.source === source))
    .filter((it) => includeClosed || it.locked || !['done', 'dropped', 'context'].includes(it.status))
    .sort((a, b) => b.n - a.n);
  const sources = new Set([...items.values()].filter((it) => !project || it.project === project).map((it) => it.source));
  return { items: list, escalations: escalations.filter((e) => sources.has(e.source)) };
}

export function itemsText(view, { max = 30 } = {}) {
  if (!view.items.length) return 'No items in Noam\'s list here.';
  const byProject = new Map();
  for (const it of view.items.slice(0, max)) { const k = it.project; if (!byProject.has(k)) byProject.set(k, []); byProject.get(k).push(it); }
  const out = [];
  for (const [p, list] of byProject) {
    out.push(`${p}:`);
    for (const it of list) out.push(`  ${it.id} [${it.locked ? 'locked' : it.status}${it.open.length ? `: open ${it.open.join('; ')}` : ''}]${it.topics.length ? ` (${it.topics.join(', ')})` : ''} "${clip(it.words, 140)}"`);
  }
  if (view.items.length > max) out.push(`(${view.items.length - max} more)`);
  for (const e of view.escalations.slice(-3)) out.push(`Needs attention: an agent stopped with items unresolved: ${e.reason}`);
  return out.join('\n');
}
