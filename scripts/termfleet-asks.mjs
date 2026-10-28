#!/usr/bin/env node
// TF-096 part 2: keep Noam's requests in his exact words, read them back before
// building, and never say "done" without proof. Research: agents lose track of the
// ask over long and compacted chats, misread new asks, and claim "done" with no
// proof behind it (docs/teammates-research-2026-10-16.md section 2).
//
// One script, three jobs:
//  - Hook (Claude Code and Codex): UserPromptSubmit and SessionStart (after a
//    compaction or resume) re-show his requests, verbatim, with their status;
//    Stop refuses one "done" while requests are unmarked (reminder mode).
//  - Command for agents and bots:
//      termfleet-asks done <n[,n]> "<proof: what ran and what it showed>"
//      termfleet-asks ready <n> "<exactly what Noam should try, in a few words>"
//      termfleet-asks ready R-<n> --try "<specific action>" --expected "<observable result>" --artifact "<working URL>" --evidence "<delivered result and same URL>" [--test-kind experience|choice|machine]
//      termfleet-asks partial <n> "<what is still missing>"
//      termfleet-asks dropped <n> "<why, and who decided>"
//      termfleet-asks topic-meta <topic> --visual true|false [--owner-words <id>]
//    Screen topics (visual: true) can be marked ready by an agent, never done: only
//    termfleet-asks lock <id> --owner-words <his genuine message id> closes them.
//    The command only checks its own wording; the record is the command itself in
//    the conversation, which is always saved (a plain reply sometimes is not).
//
// The list is rebuilt from the conversation record each time, so it survives
// compaction and fresh starts. Off switch: TERMFLEET_ASKS=off.
import { closeSync, mkdirSync, openSync, readFileSync, readSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeHookResults, projectSyncHook } from './lib/agent-sync-hook.mjs';
import { stripOpenRequestReminder } from '../termcontrol/bridge/bot-request-panel.mjs';
import { testingHandoffProblem, readyThisTurn } from '../termcontrol/bridge/bot-testing.mjs';
import {
  captureMessage, ownerTextOf, stripMachinePrompt, projectOf, stopProblem, escalate, briefedIds, briefItems, briefBlock, ledgerDir,
  markItem, record, addTopic, setTopicVisual, normId, itemsView, itemsText, evidenceProblem, answerProblem, loadLedger, clip as clipItem,
} from '../termcontrol/bridge/requirements.mjs';
import { writeRequestDoc, requestDocsDir } from '../termcontrol/bridge/request-docs.mjs';
import { findOwnerWords } from '../termcontrol/bridge/owner-words.mjs';

const TAIL_BYTES = 8 * 1024 * 1024;
// ready = built and live, waiting for Noam to try it (Noam 2026-10-20: "how will I know what
// is ready and waiting for me?"). It stays quiet: not in his Waiting-for-you list, no notification.
const STATUSES = ['done', 'ready', 'partial', 'dropped'];

function tail(file, bytes = TAIL_BYTES) {
  const size = statSync(file).size;
  const start = Math.max(0, size - bytes);
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(size - start);
    readSync(fd, buf, 0, buf.length, start);
    const text = buf.toString('utf8');
    return start > 0 ? text.slice(text.indexOf('\n') + 1) : text;
  } finally { closeSync(fd); }
}

const textOf = (content) => typeof content === 'string' ? content
  : Array.isArray(content) ? content.filter((b) => ['text', 'input_text', 'output_text'].includes(b?.type)).map((b) => b.text || '').join('\n') : '';

/** Text the harness or a hook puts in a user turn is not Noam speaking. */
export const injected = (text) => {
  const own = stripMachinePrompt(text);
  return (Boolean(String(text || '').trim()) && !own) || /^\s*(<(hook_prompt|system-reminder|agent-message|command-|local-command|task-notification|user-prompt-submit-hook|environment_context|user_instructions|turn_aborted)|\[SYSTEM NOTIFICATION|\[Message from (the agent|the bot|an orchestrating)|Caveat:|# AGENTS\.md|This session is being continued from a previous conversation|\[Request interrupted)/i.test(own);
};

/** A short yes/go/continue is an answer, not a new request. */
export const acknowledgement = (text) => {
  const t = text.trim().toLowerCase().replace(/[.!?,]+$/g, '');
  if (t.split(/\s+/).length > 4) return false;
  return /^(y|yes|yeah|yep|ok|okay|go|go on|go ahead|do it|continue|proceed|sure|thanks|thank you|great|good|נו|כן|יאללה|סבבה|תמשיך|המשך|אוקיי|תודה|מעולה)$/.test(t);
};

/**
 * A command line read the way the shell reads it: words (quotes and backslashes resolved)
 * and the operators between them (| ; & && || newline, redirections). 2026-10-20: the note
 * was taken from the raw line, so `... "note" | tail -3` showed "| tail -3" in Noam's list,
 * and a mark called by path, or after another command, was missed.
 */
function shellWords(command) {
  const out = [];
  const s = String(command || '');
  let word = null, i = 0;
  const end = () => { if (word !== null) out.push({ word }); word = null; };
  while (i < s.length) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length) { if (s[i + 1] !== '\n') word = (word ?? '') + s[i + 1]; i += 2; continue; }
    if (c === "'") { const j = s.indexOf("'", i + 1); const k = j < 0 ? s.length : j; word = (word ?? '') + s.slice(i + 1, k); i = k + 1; continue; }
    if (c === '"') {
      let j = i + 1, t = '';
      while (j < s.length && s[j] !== '"') { if (s[j] === '\\' && /["\\$`\n]/.test(s[j + 1] || '')) { if (s[j + 1] !== '\n') t += s[j + 1]; j += 2; } else t += s[j++]; }
      word = (word ?? '') + t; i = j + 1; continue;
    }
    if (c === ' ' || c === '\t') { end(); i++; continue; }
    if (/[|;&\n()<>]/.test(c)) {
      // A redirection like 2>&1 or 2>/dev/null takes its digits and its target with it.
      if ((c === '>' || c === '<') && word !== null && /^\d+$/.test(word)) word = null;
      end();
      const op = /^(?:&&|\|\||>>|>&|<<|&>|[|;&\n()<>])/.exec(s.slice(i))[0];
      out.push({ op }); i += op.length;
      if (/[<>]/.test(op)) { while (s[i] === ' ' || s[i] === '\t') i++; i += /^[^\s|;&()<>]*/.exec(s.slice(i))[0].length; }
      continue;
    }
    if (c === '#' && word === null) { while (i < s.length && s[i] !== '\n') i++; continue; }
    word = (word ?? '') + c; i++;
  }
  end();
  return out;
}

const isAsksCommand = (w) => /(?:^|\/)termfleet-asks(?:\.mjs)?$/.test(w);

/** Every mark in one command line (agents chain several with ; && or pipes); each takes only its own words. */
export function parseMarks(command) {
  const tokens = shellWords(command), marks = [];
  for (let i = 0; i < tokens.length; i++) {
    if (!isAsksCommand(tokens[i].word ?? '')) continue;
    const args = [];
    for (let j = i + 1; j < tokens.length && tokens[j].word !== undefined; j++) args.push(tokens[j].word);
    const [status, numText = '', ...rest] = args;
    if (!STATUSES.includes(status)) continue;
    const nums = numText.split(',').filter(Boolean).map(Number);
    if (!nums.length || !nums.every((n) => Number.isInteger(n) && n > 0)) continue;
    marks.push({ status, nums, note: rest.join(' ').replace(/\s+/g, ' ').trim() });
  }
  return marks;
}

export function parseMark(command) {
  return parseMarks(command)[0] ?? null;
}

const commandOf = (input) => {
  if (!input) return '';
  if (typeof input === 'string') { try { return commandOf(JSON.parse(input)); } catch { return input; } }
  const c = input.command ?? input.cmd ?? input.input;
  return Array.isArray(c) ? c.join(' ') : typeof c === 'string' ? c : '';
};

/** Noam's requests in this conversation, numbered, with the latest mark on each. */
export function asksFrom(lines) {
  return applyLines({ asks: [], marks: [] }, lines).asks;
}

/**
 * Adds a stretch of the record to a running state. Requests are numbered from the
 * start of the conversation, and marks are kept so a later mark can still find its
 * request; asksFrom and the incremental reader share this.
 */
function applyLines(state, lines) {
  const { asks, marks } = state;
  const before = marks.length;
  for (const line of lines) {
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (o?.isSidechain || o?.isMeta) continue;
    if (o?.type === 'attachment' && o.attachment?.type === 'queued_command' && (o.attachment.origin?.kind === 'human' || o.attachment.humanTurn === true)) {
      const p = o.attachment.prompt;
      const text = stripMachinePrompt(stripOpenRequestReminder(typeof p === 'string' ? p : Array.isArray(p) ? p.filter((b) => b?.type === 'text').map((b) => b.text).join('\n') : ''));
      if (text && !injected(text) && !acknowledgement(text)) asks.push({ n: asks.length + 1, text, at: o.timestamp || null, status: 'open', note: '' });
      continue;
    }
    if (o?.type === 'user') {
      const content = o.message?.content;
      if (Array.isArray(content) && content.some((b) => b?.type === 'tool_result')) continue;
      const text = stripMachinePrompt(stripOpenRequestReminder(textOf(content)));
      if (text && !injected(text) && !acknowledgement(text)) asks.push({ n: asks.length + 1, text, at: o.timestamp || null, status: 'open', note: '' });
    } else if (o?.type === 'assistant' && Array.isArray(o.message?.content)) {
      for (const b of o.message.content) if (b?.type === 'tool_use') marks.push(...parseMarks(commandOf(b.input)));
    } else if (o?.type === 'response_item' && o.payload?.type === 'message' && o.payload.role === 'user') {
      const text = stripMachinePrompt(stripOpenRequestReminder(textOf(o.payload.content)));
      if (text && !injected(text) && !acknowledgement(text)) asks.push({ n: asks.length + 1, text, at: o.timestamp || null, status: 'open', note: '' });
    } else if (o?.type === 'response_item' && ['function_call', 'local_shell_call', 'custom_tool_call'].includes(o.payload?.type)) {
      marks.push(...parseMarks(commandOf(o.payload.arguments ?? o.payload.action ?? o.payload.input)));
    }
  }
  for (const m of marks.slice(before)) for (const n of m.nums) { const a = asks[n - 1]; if (a) { a.status = m.status; a.note = m.note; } }
  return state;
}

/**
 * Requests for one conversation record, numbered from its very start. Records
 * grow to tens or hundreds of megabytes, so only the new part is read each time:
 * the requests so far and the byte reached are cached per record (2026-10-16:
 * counting inside a tail made numbers shift, so a mark could land on the wrong
 * request). A record that shrank (rewritten) is read again from the start.
 */
export function asksForFile(file, { cacheDir = join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'termfleet', 'asks') } = {}) {
  const size = statSync(file).size;
  // The format version is in the name: an older copy still running (a forgotten test
  // bridge, 2026-10-20) used to overwrite this file with its own format, so each side
  // threw the other's away and re-read every record whole every few seconds.
  const cacheFile = join(cacheDir, `${createHash('sha1').update(file).digest('hex')}.v3.json`);
  let state = { offset: 0, asks: [], marks: [] };
  try {
    const saved = JSON.parse(readFileSync(cacheFile, 'utf8'));
    if (saved && saved.v === 3 && saved.file === file && Number.isFinite(saved.offset) && saved.offset <= size) state = { offset: saved.offset, asks: saved.asks || [], marks: [] };
  } catch { /* first look at this record */ }
  if (state.offset < size) {
    const fd = openSync(file, 'r');
    try {
      const CHUNK = 4 * 1024 * 1024;
      let carry = '';
      let pos = state.offset;
      while (pos < size) {
        const buf = Buffer.alloc(Math.min(CHUNK, size - pos));
        const got = readSync(fd, buf, 0, buf.length, pos);
        if (got <= 0) break;
        pos += got;
        const text = carry + buf.subarray(0, got).toString('utf8');
        const cut = text.lastIndexOf('\n');
        if (cut < 0) { carry = text; continue; }
        // Only lines that can hold a request or a mark are parsed: fast on huge records.
        const lines = text.slice(0, cut).split('\n').filter((l) => l.includes('"user"') || l.includes('queued_command') || l.includes('termfleet-asks'));
        applyLines(state, lines);
        carry = text.slice(cut + 1);
        state.offset = pos - Buffer.byteLength(carry, 'utf8');
      }
    } finally { closeSync(fd); }
    try {
      mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
      const tmp = `${cacheFile}.${process.pid}.tmp`;
      // A long paste keeps its end too: his own words usually come after it.
      const kept = (t) => (t.length > 2000 ? `${t.slice(0, 1300)}\n…\n${t.slice(-600)}` : t);
      writeFileSync(tmp, JSON.stringify({ v: 3, file, offset: state.offset, asks: state.asks.map((a) => ({ ...a, text: kept(a.text) })) }), { mode: 0o600 });
      renameSync(tmp, cacheFile);
    } catch { /* the cache only saves time */ }
  }
  const gone = dismissedFor(file);
  return gone.size ? state.asks.map((a) => (gone.has(a.n) ? { ...a, status: 'dropped', note: 'Noam removed it from his list', dismissed: true } : a)) : state.asks;
}

const clip = (s, n) => { const t = String(s).replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

// Wake-ups and restart notices land in the conversation as "user" lines but are not requests from Noam.
// Kept in the record (so numbers never shift); left out of everything he or the agent is shown.
export const isRealRequest = (text) => !/^\s*(?:\(\d+\)\s*)?(?:\[Event, not from|\(You were cut off by a restart|\[System notice)/i.test(String(text || '')) && !followUp(text);

/** His own words: without "[Noam attached …]" notes and without lines quoting the agent back ("> …"). */
export function ownWords(text) {
  return String(text || '').split('\n').filter((l) => !/^\s*\[Noam attached [^\]]*\]\s*$/.test(l) && !/^\s*>/.test(l)).join('\n').trim();
}

// Noam 2026-10-20 ("it shows as open tasks, not clear why"): "Well?" or "התחברתי" answers the
// request before it; it is not new work. A closed word list, so a short real request is never hidden.
const FOLLOW_UP = /^(?:well|so|and|nu|any news|news|update|still nothing|i'?m in|connected|logged in|i did it|did it|tried it|i tried|נו|ו|אז|מה קורה|יש חדש|התחברתי|עשיתי|ניסיתי|מחובר|הנה)$/i;
export function followUp(text) {
  const raw = String(text || '');
  const own = ownWords(raw);
  if (!own) return /^\s*>/m.test(raw); // only quoted the agent back
  const t = own.toLowerCase().replace(/[.!?,…]+$/g, '').trim();
  return t.split(/\s+/).length <= 3 && FOLLOW_UP.test(t);
}

// Notes TermFleet wraps around his words ("[While you were busy, Noam asked …]", "[Noam is replying
// to your earlier message …]", "[Noam's answer to your question …]"). Noam 2026-10-24: the bot
// menu showed these instead of what he wrote.
const NOTE_START = /^\[(?:While you were busy|Noam is replying to|Noam's answer to your question|Noam tagged you|Noam's requirements for this work|delivery D-|Message from the bot)/;
/** The end of the bracket that opens at `from`, counting nested brackets; -1 if it never closes. */
function bracketEnd(text, from) {
  let depth = 0;
  for (let i = from; i < text.length; i++) {
    if (text[i] === '[') depth++;
    else if (text[i] === ']' && --depth === 0) return i;
  }
  return -1;
}
/** His words without the notes TermFleet added around them. */
export function stripSystemNotes(text) {
  let rest = stripOpenRequestReminder(text);
  // A tag from another chat: only what follows "Noam's message:" is his message to this bot.
  const tagged = /\n\s*Noam's message:\s*\n([\s\S]*)$/.exec(rest);
  if (/^\s*\[Noam tagged you/.test(rest) && tagged) rest = tagged[1];
  const asked = [];
  let out = '';
  for (;;) {
    const at = rest.search(/(^|\n)[ \t]*\[/);
    if (at < 0) { out += rest; break; }
    const open = rest.indexOf('[', at);
    const end = NOTE_START.test(rest.slice(open)) ? bracketEnd(rest, open) : -1;
    if (end < 0) {
      // A "[Event, not from Noam]" paragraph is not his at all.
      if (/^\[Event, not from/.test(rest.slice(open))) { const stop = rest.indexOf('\n\n', open); out += rest.slice(0, open); rest = stop < 0 ? '' : rest.slice(stop); continue; }
      out += rest.slice(0, open + 1); rest = rest.slice(open + 1); continue;
    }
    // A side question he asked while the agent was busy: kept in case nothing else is left.
    for (const m of rest.slice(open, end).matchAll(/^\s*- Noam: "([\s\S]*?)"\s*$/gm)) asked.push(m[1]);
    out += rest.slice(0, open); rest = rest.slice(end + 1);
  }
  const own = out.replace(/\n{3,}/g, '\n\n').trim();
  return own || asked.join(' · ').trim();
}

// Noam 2026-10-24 ("items marked done still show as open"): agents now mark his split items
// (R-12: answered, done, context) instead of the numbered request, so a request whose items are
// all taken read "open" forever. Its status now follows its items unless it was marked itself.
const ITEM_CLOSED = new Set(['done', 'ready', 'locked', 'answered', 'context', 'dropped']);
const squash = (s) => String(s || '').replace(/\s+/g, ' ').trim();
/** The items (from the requirements ledger) that came from each request: by number, else by his words. */
export function itemsByAsk(asks, items) {
  const texts = asks.map((a) => squash(a.text));
  const by = new Map();
  for (const it of items || []) {
    let n = Number.isInteger(it.askN) ? it.askN : null;
    if (n === null) {
      const words = squash(it.words).replace(/…$/, '').slice(0, 120);
      if (words.length < 2) continue;
      for (let i = asks.length - 1; i >= 0; i--) if (texts[i].includes(words)) { n = asks[i].n; break; }
    }
    if (n === null) continue;
    if (!by.has(n)) by.set(n, []);
    by.get(n).push(it);
  }
  return by;
}
export function statusFromItems(ask, parts) {
  const state = (it) => (it.locked ? 'locked' : it.status);
  // A request with a screen part Noam has not confirmed is never "done", whatever the agent marked.
  const unconfirmedScreen = (parts || []).some((it) => it.visual && !['done', 'locked', 'dropped', 'answered', 'context'].includes(state(it)));
  if (ask.status === 'done' && unconfirmedScreen) {
    const derived = statusFromItems({ ...ask, status: 'open' }, parts);
    return derived === 'done' || derived === 'open' ? 'ready' : derived;
  }
  if (!parts?.length || !['open', 'partial'].includes(ask.status)) return ask.status;
  const open = parts.filter((it) => !ITEM_CLOSED.has(state(it))).length;
  if (parts.every((it) => state(it) === 'dropped')) return 'dropped';
  if (!open) return parts.some((it) => state(it) === 'ready') ? 'ready' : 'done';
  return open < parts.length ? 'partial' : ask.status;
}

/**
 * What a list shows for a request: his own words first. A job post or a log he pasted sits
 * above his one line ("jobs like this should not pass the filter"), and the list showed the
 * pasted title instead. Pasted text is recognised by script: an English block, his Hebrew line.
 */
export function askTitle(text) {
  const plain = stripSystemNotes(text);
  const lines = (ownWords(plain) || plain).split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length < 3) return lines.join(' ');
  const hebrew = (s) => /[֐-׿]/.test(s);
  const last = lines[lines.length - 1];
  return hebrew(last) && !hebrew(lines[0]) ? `${last} — ${lines[0]}` : lines.join(' ');
}

// Requests Noam removed from his list himself, per conversation record: {"<record path>": [n, …]}.
const dismissFile = (env = process.env) => join(env.TC_CONFIG_DIR || join(homedir(), '.config', 'termcontrol'), 'asks-dismissed.json');
function dismissedAll(env) { try { return JSON.parse(readFileSync(dismissFile(env), 'utf8')) || {}; } catch { return {}; } }
export const dismissedFor = (file, env = process.env) => new Set((dismissedAll(env)[file] || []).map(Number));
export function dismissAsk(file, n, env = process.env) {
  const all = dismissedAll(env);
  all[file] = [...new Set([...(all[file] || []), Number(n)])].sort((a, b) => a - b);
  const target = dismissFile(env);
  mkdirSync(join(target, '..'), { recursive: true, mode: 0o700 });
  const tmp = `${target}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(all, null, 1), { mode: 0o600 });
  renameSync(tmp, target);
  return true;
}

export function summaryLine(asks) {
  const count = (s) => asks.filter((a) => a.status === s).length;
  return `${count('done')}/${asks.length} done${count('ready') ? `, ${count('ready')} ready for Noam` : ''}${count('partial') ? `, ${count('partial')} partial` : ''}${count('dropped') ? `, ${count('dropped')} dropped` : ''}${count('open') ? `, ${count('open')} open` : ''}`;
}

/** What the agent is shown: every unfinished request verbatim, finished ones counted. */
export function ledgerText(allAsks, { newest = null, maxChars = 6000, limit = 15 } = {}) {
  const asks = allAsks.filter((a) => isRealRequest(a.text));
  if (!asks.length) return '';
  const unfinished = asks.filter((a) => a.status === 'open' || a.status === 'partial' || a.status === 'ready');
  const lines = [`Noam's requests, his words (${summaryLine(asks)}):`];
  for (const a of unfinished.slice(-limit)) lines.push(`#${a.n} [${a.status}${a.note ? `: ${clip(a.note, 80)}` : ''}]${a.itemIds?.length ? ` (items ${a.itemIds.join(', ')})` : ''} "${clip(askTitle(a.text), 200)}"`);
  if (unfinished.length > limit) lines.push(`(${unfinished.length - limit} older unfinished requests not shown)`);
  if (newest) lines.push(`#${newest.n} is new. If it is a new or unclear request, first read it back in his words; ask at most 2 questions about real gaps.`);
  lines.push('Mark them: termfleet-asks done|ready|partial|dropped <n> "<proof or note>". Use ready (not partial) when it is built and live but Noam has not tried it yet; the note says exactly what he should try, in a few words. It stays quiet (no notification, not in his "Waiting for you" list, which is only for approvals and questions that block work). When he says it works, mark it done.');
  const text = lines.join('\n');
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
}

export const CLAIMS_DONE = /\b(done|fixed|finished|completed?|works now|is live|all set|ready for you|shipped|resolved)\b|(?:^|\s)(סיימתי|תוקן|מוכן|עובד עכשיו|הושלם)(?:\s|$|[.!,])/i;

// A next step the agent says it will take (English or Hebrew), unless it is plainly
// waiting for Noam or has a wake-up set (then stopping is honest).
const PROMISE = /(next,? i'?m (doing|going to)[^.\n]*|next,? i'?ll [^.\n]*|i'?ll (now|next|then)? ?(do|check|run|fix|look|start|build|test|verify|add|write|update|finish|try|retry|deploy|commit|push|watch|investigate|continue)\b[^.\n]*|i will (now |next |then )?(do|check|run|fix|look|start|build|test|verify|add|write|update|finish|try|continue)\b[^.\n]*|\bnext( step)?:[^\n]*|הצעד הבא[^.\n]*|אני (הולך|אמשיך|אבדוק|אתקן|אריץ)[^.\n]*)/i;
const HONEST_WAIT = /waiting (for|on) (noam|you|your)|once you|until you|as soon as you|nothing (until|for now|more)|when you (tap|reply|answer|approve|confirm|send|run)|after you (tap|reply|answer|approve|confirm)|if you (want|approve|say)|your (ok|okay|approval|go)|\?\s*$|background (job|task|check|watcher)|will (wake|notify|ping) me|wakes? me|woken|(routine|schedule|follow) (is )?(set|added)|termfleet-team (follow|routine)|ממתין ל|מחכה ל|כשתאשר|אחרי שתאשר/i;
export function promisedStep(text) {
  const t = String(text || '');
  if (!t.trim() || HONEST_WAIT.test(t)) return null;
  // Only the closing part counts: an agent that did the step earlier in the reply is fine.
  const tail = t.slice(-600);
  const m = PROMISE.exec(tail);
  return m ? m[0].trim() : null;
}

// Noam 2026-10-23: "זו לא סיבה שהיא יעצור". Stopping to wait for his go is honest only for
// money, posting, messaging people, deleting, a step only he can do, or a real choice.
const WAITS_FOR_GO = /(waiting (for|on) (noam|you)|ממתין ל|מחכה ל)[^\n]*(\bgo\b|go-?ahead|\bok(ay)?\b|approv|permission|green light|say (go|yes)|when you want|אישור|לאשר|שאמשיך|להתחיל)|\b(want me to|should i|shall i|do you want me to|ok if i)\b[^\n?]*\?|let me know (when|if) you('d| would)? (want|like) me to|say (go|yes) (when|and|if)|(once|when|after|until) you (say|give( me)?) (go|yes|the word|the go-?ahead)|תגיד מתי|שאמשיך\?/i;
const REAL_REASON = /\b(pay|paid|spend|purchase|buy|cost|money|credits?|billing|price|post(ing)?|publish|tweet|send|email|message (him|her|them|people)|dm|delete|remove|wipe|erase|irreversible|undone|sign(ing)? in|log ?in|password|(verification|login|sms) code|captcha|for you to try|you('ll| can) try|tap|click|review|deploy|release|production|push|merge|approval of|the list|prompt|which|choose|pick|prefer|or the)\b|\$|₪|תשלום|לשלם|לפרסם|לשלוח|למחוק|איזה|לבחור/i;
export function needlessWait(text) {
  const tail = String(text || '').slice(-600);
  const m = WAITS_FOR_GO.exec(tail);
  if (!m) return null;
  const line = tail.slice(tail.lastIndexOf('\n', m.index) + 1).split('\n')[0] || m[0];
  return REAL_REASON.test(line) ? null : line.trim();
}
const STOP_REASONS = 'spending money, posting publicly, messaging people, deleting, a step only he can do (signing in, a code, trying it), or a real choice between two truly different outcomes (ask that as a question card)';

function lastAssistantText(lines) {
  for (let i = lines.length - 1; i >= 0; i--) {
    let o;
    try { o = JSON.parse(lines[i]); } catch { continue; }
    if (o?.type === 'assistant' && !o.isSidechain) { const t = textOf(o.message?.content).trim(); if (t) return t; }
    if (o?.type === 'response_item' && o.payload?.type === 'message' && o.payload.role === 'assistant') { const t = textOf(o.payload.content).trim(); if (t) return t; }
    if (o?.type === 'user' && !(Array.isArray(o.message?.content) && o.message.content.some((b) => b?.type === 'tool_result'))) return '';
  }
  return '';
}

export function hook(payload, { readLines = null, env = process.env, cacheDir } = {}) {
  if (env.TERMFLEET_ASKS === 'off') return null;
  const event = payload?.hook_event_name || payload?.hookEventName || '';
  const transcript = payload?.transcript_path;
  let lines = [];
  let asks = [];
  if (transcript) {
    try {
      if (readLines) { lines = readLines(transcript); asks = asksFrom(lines); }
      else { asks = asksForFile(transcript, cacheDir ? { cacheDir } : {}).map((a) => ({ ...a })); lines = /^Stop$/i.test(event) ? tail(transcript, 2 * 1024 * 1024).split('\n') : []; }
    } catch { asks = []; lines = []; }
  }

  if (/^UserPromptSubmit$/i.test(event) || event === 'user_prompt_submit') {
    const prompt = stripMachinePrompt(stripOpenRequestReminder(payload.prompt ?? payload.user_prompt ?? ''));
    let newest = null;
    // The new message is not in the record yet when this runs.
    if (prompt && !injected(prompt) && !acknowledgement(prompt) && !asks.some((a) => a.text === prompt && a === asks.at(-1))) {
      newest = { n: asks.length + 1, text: prompt, status: 'open', note: '' };
      asks.push(newest);
    }
    const inBotChat = String(sourceOf(payload, env) || '').startsWith('bot:');
    const items = ledgerOn(env, readLines) && (newest || inBotChat) ? captureItems(payload, prompt, newest?.n ?? null, env) : '';
    // Each request line names the item ids it was split into.
    if (ledgerOn(env, readLines) && !inBotChat) {
      try {
        const source = sourceOf(payload, env);
        const byAsk = new Map();
        for (const it of loadLedger({ dir: reqDir(env) }).items.values()) if (it.source === source && it.askN) byAsk.set(it.askN, [...(byAsk.get(it.askN) || []), it.id]);
        for (const a of asks) if (byAsk.has(a.n)) a.itemIds = byAsk.get(a.n);
      } catch { /* the requests still show */ }
    }
    // Only when he wrote something new, and short: the list on every prompt was most of what the
    // workers read (his words were under 2% of it, 2026-10-26; Noam chose lighter tracking).
    const text = [newest ? ledgerText(asks, { newest, limit: 5 }) : '', items].filter(Boolean).join('\n\n');
    return text ? { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: text } } : null;
  }
  if (/^SessionStart$/i.test(event) || event === 'session_start') {
    // After a compaction or a resume, the summary may have lost his words.
    const source = payload.source || '';
    // A resume keeps the conversation, so the list is not needed again (it was re-sent on every bot turn).
    if (/resume/.test(source) || (!/compact|clear/.test(source) && asks.length === 0)) return null;
    const text = ledgerText(asks, { limit: 5 });
    return text ? { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: `After ${source || 'a restart'}: ${text}` } } : null;
  }
  if (/^Stop$/i.test(event) || event === 'stop') {
    const last = String(payload.last_assistant_message || '') || lastAssistantText(lines);
    // Once per finish (Noam chose lighter tracking, 2026-10-26): repeated blocks cost about half of
    // the helpers' output (534 blocks in 91 sessions). Open items stay open and visible to the bot.
    if (payload.stop_hook_active || payload.stopHookActive) return null;
    if (env.TERMFLEET_BOT_ID) {
      const since = Number(env.TERMFLEET_BOT_TURN_STARTED_AT) || Date.now() - 30 * 60_000;
      const markedReady = readyThisTurn([...loadLedger({ dir: reqDir(env) }).items.values()], env.TERMFLEET_BOT_ID, since).length > 0;
      const problem = testingHandoffProblem(last, { botId: env.TERMFLEET_BOT_ID, since, markedReady, receiptDir: env.TERMFLEET_BROWSER_RECEIPTS_DIR });
      if (problem) return { decision: 'block', reason: problem };
    }
    // The requirements gate (TF-102) is not a reminder: it blocks every time until each of
    // Noam's items is taken, capped so a stuck agent cannot loop forever (then it is escalated
    // into Noam's own list instead of being dropped).
    const gate = ledgerOn(env, readLines) ? itemsGate(payload, lines, asks, last, env) : null;
    if (gate) return gate;
    if (payload.stop_hook_active || payload.stopHookActive) return null;   // reminder mode: once per finish
    // Noam 2026-10-17: "they say that they will do something and just never do it".
    // Nothing runs after an agent stops, so a promised next step must happen now.
    const promise = promisedStep(last);
    if (promise) return { decision: 'block', reason: `You promised "${clip(promise, 80)}" but nothing runs after you stop. Do it now. Stop with "Waiting for Noam: <what>" only for ${STOP_REASONS}; for work that runs later, set a wake-up.` };
    const wait = needlessWait(last);
    if (wait) return { decision: 'block', reason: `You stopped to wait for Noam's go ("${clip(wait, 80)}"). He asked you not to stop for that: when he asked for it or the next step is safe and can be undone, do it now. Stop only for ${STOP_REASONS}; if it is one of those, say which in the Waiting for Noam line.` };
    if (!CLAIMS_DONE.test(last)) return null;
    const unmarked = asks.filter((a) => a.status === 'open');
    if (!unmarked.length) return null;
    const list = unmarked.slice(-3).map((a) => `#${a.n} "${clip(a.text, 60)}"`).join('; ');
    return { decision: 'block', reason: `Mark open requests first (termfleet-asks done|ready|partial|dropped <n> "<proof>"); if anything is not done, say so in your first sentence. Open: ${list}` };
  }
  return null;
}

// ---------------------------------------------------------------------------------------
// TF-102 owner requirements ledger: every message split into items (R-n) that must each be
// taken, carried in his words, delivered with evidence and re-checked once he approved it.

/** Whose conversation this is: a bot's brain, or one terminal's conversation record. */
export function sourceOf(payload, env = process.env) {
  if (/^[0-9a-f]{12}$/.test(String(env.TERMFLEET_BOT_ID || ''))) return `bot:${env.TERMFLEET_BOT_ID}`;
  if (payload?.transcript_path) return payload.transcript_path;
  return payload?.session_id ? `session:${payload.session_id}` : null;
}
const projectFor = (payload, env = process.env) => env.TERMFLEET_PROJECT || projectOf(payload?.cwd || process.cwd());
const reqDir = (env) => ledgerDir(env);
// An in-memory hook call (tests pass readLines) only touches a ledger it was given explicitly.
const ledgerOn = (env, readLines) => env.TERMFLEET_REQUIREMENTS !== 'off' && (!readLines || Boolean(env.TERMFLEET_REQ_DIR));

/** Splits his new message into items and says so; returns the text the agent is shown. */
export function captureItems(payload, prompt, askN, env = process.env) {
  const source = sourceOf(payload, env);
  if (!source) return '';
  const dir = reqDir(env);
  let items = [];
  // A bot's messages are captured by the bridge with his real message id (bots.mjs); the
  // brain's hook only shows them, so nothing is recorded twice.
  if (!source.startsWith('bot:')) {
    const own = ownerTextOf(prompt);
    if (!own) return '';
    try { items = captureMessage({ text: own.text, msgId: own.msgId, project: projectFor(payload, env), source, askN }, { dir }); } catch { return ''; }
  } else {
    // A bot sees every unfinished item of its chat on every turn, with the ids its hand-offs must name.
    try { items = [...loadLedger({ dir }).items.values()].filter((it) => it.source === source && !it.locked && !['done', 'dropped', 'context', 'answered'].includes(it.status)).sort((a, b) => a.n - b.n).slice(-25); } catch { return ''; }
  }
  if (!items.length) return '';
  const bot = source.startsWith('bot:');
  const lines = [bot
    ? `Noam's unfinished items in this chat, his exact words (name them in hand-offs: termfleet-team send <who> --req <id,id> "..."; full list: termfleet-asks items; one item: termfleet-asks show <id>). Every "new" one must be taken before you stop.`
    : `Noam's message, split into ${items.length} item${items.length === 1 ? '' : 's'} (his exact words). Each one must be taken before you stop: done/ready with its own evidence, handed over with termfleet-team send --req <id>, answered, waiting for him, or marked background.`];
  for (const it of items) lines.push(`- ${it.id}${bot ? ` [${it.status}]` : ''}${it.topics.length ? ` (${it.topics.join(', ')})` : ''}: "${clipItem(it.words, 300)}"`);
  // His earlier words on the same screen travel with the new ones (the "it's empty" failure).
  try {
    const related = briefItems(items.map((it) => it.id), { dir });
    if (!related.error) {
      if (related.open.length) lines.push('Still open on the same topic:', ...related.open.slice(0, 10).map((it) => `- ${it.id}: "${clipItem(it.words, 200)}"`));
      if (related.locked.length) lines.push('Locked (Noam confirmed these work; re-check each before marking this topic ready):', ...related.locked.slice(0, 10).map((it) => `- ${it.id}: "${clipItem(it.words, 200)}"`));
    }
  } catch { /* the items themselves are shown */ }
  lines.push('Give an item a topic so his later words on the same screen find it: termfleet-asks topic <id[,id]> <topic-name>.');
  return lines.join('\n');
}

const userTextsOf = (lines) => {
  const out = [];
  for (const line of lines) {
    if (!line.includes('"user"')) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    if (o?.type === 'user') out.push(textOf(o.message?.content));
    else if (o?.type === 'response_item' && o.payload?.role === 'user') out.push(textOf(o.payload.content));
  }
  return out;
};

const MAX_BLOCKS = 4;
function blockCount(dir, source, change) {
  const file = join(dir, 'stop-blocks.json');
  let all = {};
  try { all = JSON.parse(readFileSync(file, 'utf8')) || {}; } catch { all = {}; }
  const now = Date.now();
  const prev = all[source] && now - all[source].at < 30 * 60 * 1000 ? all[source].count : 0;
  const count = change === 'reset' ? 0 : prev + 1;
  if (count) all[source] = { count, at: now }; else delete all[source];
  try { mkdirSync(dir, { recursive: true, mode: 0o700 }); writeFileSync(file, JSON.stringify(all), { mode: 0o600 }); } catch { /* counting only */ }
  return count;
}

export function itemsGate(payload, lines, asks, last, env = process.env) {
  const source = sourceOf(payload, env);
  if (!source) return null;
  const dir = reqDir(env);
  let problem = null;
  try {
    const pane = env.TERMFLEET_PANE_ID || '';
    const assignedHere = pane ? [...loadLedger({ dir }).items.values()].filter((it) => it.assigned.some((a) => a.pane === pane)).map((it) => it.id) : [];
    const briefed = [...new Set([...briefedIds(userTextsOf(lines)), ...assignedHere])];
    const askMarks = asks.filter((a) => a.status === 'done' || a.status === 'ready').map((a) => ({ status: a.status, n: a.n }));
    problem = stopProblem({ source, briefed, lastMessage: last, askMarks }, { dir });
  } catch { return null; }
  if (!problem) { blockCount(dir, source, 'reset'); return null; }
  const count = blockCount(dir, source, 'add');
  if (count > MAX_BLOCKS) {
    try { escalate({ source, reason: problem }, { dir }); } catch { /* best effort */ }
    blockCount(dir, source, 'reset');
    return null;
  }
  return { decision: 'block', reason: problem };
}

const visualFlag = (v) => (v === true || v === 'true' || v === 'yes' ? true : v === 'false' || v === 'no' ? false : null);

function flagsOf(args) {
  const flags = {}, rest = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) { const k = a.slice(2); const v = args[i + 1]; if (v === undefined || v.startsWith('--')) flags[k] = true; else { flags[k] = v; i++; } }
    else rest.push(a);
  }
  return { flags, rest };
}

/** termfleet-asks <status|topic|lock|reverify|items> R-n …  (the item half of the command) */
export function itemsCli(args, env = process.env) {
  const dir = reqDir(env);
  const [command, idText = '', ...tail] = args;
  const { flags, rest } = flagsOf(tail);
  const by = env.TERMFLEET_PANE_ID || (env.TERMFLEET_BOT_ID ? `bot:${env.TERMFLEET_BOT_ID}` : null);
  if (command === 'items' || command === 'list') {
    // Inside a bot: its own chat's items by default (the ids it must name in --req).
    const { flags: f } = flagsOf(args.slice(1));
    const botSource = /^[0-9a-f]{12}$/.test(String(env.TERMFLEET_BOT_ID || '')) ? `bot:${env.TERMFLEET_BOT_ID}` : null;
    const wide = f['all-projects'] === true || typeof f.project === 'string';
    const project = f['all-projects'] === true ? null : typeof f.project === 'string' ? f.project : botSource ? null : projectOf(process.cwd());
    const view = itemsView({ project, source: wide ? null : botSource, topic: typeof f.topic === 'string' ? f.topic : null, includeClosed: f.closed === true }, { dir });
    return { ok: true, message: f.json === true ? JSON.stringify(view, null, 2) : itemsText(view) };
  }
  if (command === 'show') {
    const { items } = loadLedger({ dir });
    const found = String(args[1] || '').split(',').map(normId).filter(Boolean).map((id) => items.get(id) || id);
    if (!found.length) return { ok: false, message: 'Give item ids like R-12 or R-12,R-13.' };
    const lines = found.map((it) => typeof it === 'string' ? `${it}: not in Noam's list.` : [
      `${it.id} [${it.locked ? 'locked' : it.status}] project ${it.project}${it.topics.length ? `, topic ${it.topics.join(', ')}` : ''}, part ${it.part} of ${it.of} of message ${it.msgId}`,
      `  Noam's words: "${it.words}"`,
      it.note ? `  Note: ${it.note}` : null,
      it.open.length ? `  Still open: ${it.open.join('; ')}` : null,
      ...it.evidence.map((e) => `  Evidence: ${e.what}`),
      ...it.assigned.map((a) => `  Handed to ${a.pane}${a.delivery ? ` (delivery ${a.delivery})` : ''}`),
      ...it.reverified.map((r) => `  Re-checked${r.forId ? ` for ${r.forId}` : ''}: ${r.evidence}`),
    ].filter(Boolean).join('\n'));
    return { ok: !found.some((it) => typeof it === 'string'), message: lines.join('\n') };
  }
  if (command === 'topic-meta') {
    try {
      const t = setTopicVisual(idText, visualFlag(flags.visual), { ownerMsg: typeof flags['owner-words'] === 'string' ? flags['owner-words'] : null, by, dir });
      return { ok: true, message: `Topic ${t} is now ${visualFlag(flags.visual) ? 'a screen topic: agents can mark its items ready, only Noam closes them' : 'not a screen topic: agents can mark its items done with evidence'}.` };
    } catch (error) { return { ok: false, message: String(error.message || error) }; }
  }
  const ids = idText.split(',').map(normId);
  if (!ids.length || ids.some((id) => !id)) return { ok: false, message: 'Give item ids like R-12 or R-12,R-13.' };
  const note = rest.join(' ').trim();
  try {
    if (command === 'topic') {
      const [topic] = rest;
      const aliases = typeof flags.alias === 'string' ? flags.alias.split(',').map((s) => s.trim()) : [];
      const t = addTopic(ids, topic, { aliases, dir });
      if (flags.visual !== undefined) setTopicVisual(t, visualFlag(flags.visual), { ownerMsg: typeof flags['owner-words'] === 'string' ? flags['owner-words'] : null, by, dir });
      return { ok: true, message: `${ids.join(', ')} now on topic ${t}.` };
    }
    if (command === 'lock') {
      let said = typeof flags['noam-said'] === 'string' ? flags['noam-said'].trim() : '';
      let ownerMsg = null;
      if (typeof flags['owner-words'] === 'string') {
        const ow = findOwnerWords(flags['owner-words']);
        if (!ow) return { ok: false, message: `No genuine message from Noam with id ${flags['owner-words']}.` };
        said = `${ow.text} (message ${ow.id})`;
        ownerMsg = ow.id;
      }
      if (said.length < 2) return { ok: false, message: 'A lock is Noam confirming it works: add --owner-words <his targeted confirmation message id>.' };
      const { items } = loadLedger({ dir });
      const notDelivered = ids.filter((id) => !['done', 'ready'].includes(items.get(id)?.status));
      if (notDelivered.length) return { ok: false, message: `${notDelivered.join(', ')} ${notDelivered.length === 1 ? 'is' : 'are'} not marked ready or done with evidence yet; only delivered items can be locked.` };
      if (!ownerMsg) return { ok: false, message: `${ids.join(', ')}: only Noam's own recorded message closes it. Use --owner-words <his message id>; agent-written --noam-said is not confirmation.` };
      // One transaction prevents a failed later item/status from leaving an earlier lock.
      record(ids.flatMap(id => [
        { e: 'lock', id, by: said, ownerMsg },
        { e: 'status', id, status: 'done', note: `Noam confirmed: ${clipItem(said, 160)}`, evidence: `Noam: ${said}`, by, ownerMsg },
      ]), { dir });
      return { ok: true, message: `Locked ${ids.join(', ')}: any later change on the same topic must re-check ${ids.length === 1 ? 'it' : 'them'} first.` };
    }
    if (command === 'reverify') {
      if (ids.length !== 1) return { ok: false, message: 'Re-check one locked item at a time, each with its own evidence.' };
      const problem = evidenceProblem(flags.evidence);
      if (problem) return { ok: false, message: `${ids[0]} ${problem}.` };
      const forId = typeof flags.for === 'string' ? normId(flags.for) : null;
      const { items } = loadLedger({ dir });
      if (!items.get(ids[0])?.locked) return { ok: false, message: `${ids[0]} is not locked; nothing to re-check.` };
      record([{ e: 'reverify', id: ids[0], evidence: flags.evidence, forId, by }], { dir });
      return { ok: true, message: `${ids[0]} re-checked${forId ? ` for ${forId}` : ''}.` };
    }
    if (command === 'assign') {
      const pane = rest[0];
      if (!pane) return { ok: false, message: 'Say which terminal: termfleet-asks assign R-12 <terminal id>.' };
      record(ids.map((id) => ({ e: 'assign', id, pane, by })), { dir });
      return { ok: true, message: `${ids.join(', ')} assigned to ${pane}.` };
    }
    if ((command === 'done' || command === 'ready' || command === 'partial') && ids.length !== 1) return { ok: false, message: `Mark ${command} one item at a time, each with its own evidence.` };
    const events = [];
    for (const id of ids) {
      const result = markItem({ status: command, id, note: note || (typeof flags.note === 'string' ? flags.note : ''), evidence: typeof flags.evidence === 'string' ? flags.evidence : '', open: typeof flags.open === 'string' ? flags.open.split(/\s*;\s*/) : [], by,
        tryText:typeof flags.try==='string'?flags.try:'',expected:typeof flags.expected==='string'?flags.expected:'',artifact:typeof flags.artifact==='string'?flags.artifact:'',testKind:typeof flags['test-kind']==='string'?flags['test-kind']:'experience' }, { dir });
      if (result.error) return { ok: false, message: result.error };
      events.push(...result.events);
    }
    record(events, { dir });
    // Ready and done items get their Obsidian note (request-docs.mjs); a failed write never undoes the mark.
    let docNote = '';
    if (command === 'ready' || command === 'done') {
      try {
        const { items: after } = loadLedger({ dir });
        const written = ids.map((id) => writeRequestDoc(after.get(id), { dir: requestDocsDir(env) })).filter(Boolean);
        if (written.length) docNote = ` Note: ${written.join(', ')}`;
      } catch (error) { docNote = ` (Obsidian note not written: ${error.message})`; }
    }
    return { ok: true, message: `Marked ${ids.join(', ')} ${command}.${docNote}` };
  } catch (error) {
    return { ok: false, message: String(error.message || error) };
  }
}

export function cli(args, env = process.env) {
  if (['items', 'list', 'show'].includes(args[0]) || ['topic', 'topic-meta', 'lock', 'reverify', 'assign'].includes(args[0]) || normId(String(args[1] || '').split(',')[0])) return itemsCli(args, env);
  const [status, nums, ...rest] = args;
  if (!STATUSES.includes(status)) return { ok: false, message: 'Use: termfleet-asks done|ready|partial|dropped <n[,n]> "<proof or note>"' };
  const list = String(nums || '').split(',').map(Number);
  if (!list.length || list.some((n) => !Number.isInteger(n) || n < 1)) return { ok: false, message: 'Give the request number(s) shown in the list, e.g. 3 or 2,5.' };
  const note = rest.join(' ').trim();
  if (status === 'done' && note.length < 8) return { ok: false, message: 'A "done" needs proof: what ran and what it showed (a test result, a command\'s output, a screenshot you looked at).' };
  if (status === 'ready' && note.length < 6) return { ok: false, message: 'Say exactly what Noam should try, in a few words (e.g. "open a bot chat on the phone and tap 25/30").' };
  if (!note) return { ok: false, message: `Say ${status === 'partial' ? 'what is still missing' : 'why, and who decided'}.` };
  return { ok: true, message: `Marked #${list.join(', #')} ${status}.` };
}

const startedAsCommand = (() => {
  try { return realpathSync(process.argv[1] ?? '') === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
})();
if (startedAsCommand) {
  const args = process.argv.slice(2);
  if (args[0] === '--hook') {
    let payload = {};
    try { payload = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { process.exit(0); }
    let result = null;
    try { result = hook(payload); } catch { result = null; }
    result = mergeHookResults(result, projectSyncHook(payload));
    if (result) process.stdout.write(JSON.stringify(result) + '\n');
    process.exit(0);
  }
  const result = cli(args);
  process.stdout.write(result.message + '\n');
  process.exit(result.ok ? 0 : 1);
}
