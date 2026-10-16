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
//      termfleet-asks partial <n> "<what is still missing>"
//      termfleet-asks dropped <n> "<why, and who decided>"
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

const TAIL_BYTES = 8 * 1024 * 1024;
const STATUSES = ['done', 'partial', 'dropped'];

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
export const injected = (text) => /^\s*(<(system-reminder|command-|local-command|task-notification|user-prompt-submit-hook|environment_context|user_instructions|turn_aborted)|\[SYSTEM NOTIFICATION|\[Message from (the agent|the bot|an orchestrating)|Caveat:|# AGENTS\.md|This session is being continued from a previous conversation|\[Request interrupted)/i.test(text);

/** A short yes/go/continue is an answer, not a new request. */
export const acknowledgement = (text) => {
  const t = text.trim().toLowerCase().replace(/[.!?,]+$/g, '');
  if (t.split(/\s+/).length > 4) return false;
  return /^(y|yes|yeah|yep|ok|okay|go|go on|go ahead|do it|continue|proceed|sure|thanks|thank you|great|good|נו|כן|יאללה|סבבה|תמשיך|המשך|אוקיי|תודה|מעולה)$/.test(t);
};

const COMMAND = /termfleet-asks\s+(done|partial|dropped)\s+([\d,\s]+?)\s+(?:"([^"]*)"|'([^']*)'|(\S.*))$/m;

/** Every mark in one command line: agents often chain several with ; or &&. */
export function parseMarks(command) {
  return String(command || '').split(/\s*(?:;|&&|\n)\s*(?=termfleet-asks\b)/).map(parseMark).filter(Boolean);
}

export function parseMark(command) {
  const m = COMMAND.exec(String(command || ''));
  if (!m) return null;
  const nums = m[2].split(/[\s,]+/).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  const note = (m[3] ?? m[4] ?? m[5] ?? '').trim();
  return nums.length ? { status: m[1], nums, note } : null;
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
      const text = (typeof p === 'string' ? p : Array.isArray(p) ? p.filter((b) => b?.type === 'text').map((b) => b.text).join('\n') : '').trim();
      if (text && !injected(text) && !acknowledgement(text)) asks.push({ n: asks.length + 1, text, at: o.timestamp || null, status: 'open', note: '' });
      continue;
    }
    if (o?.type === 'user') {
      const content = o.message?.content;
      if (Array.isArray(content) && content.some((b) => b?.type === 'tool_result')) continue;
      const text = textOf(content).trim();
      if (text && !injected(text) && !acknowledgement(text)) asks.push({ n: asks.length + 1, text, at: o.timestamp || null, status: 'open', note: '' });
    } else if (o?.type === 'assistant' && Array.isArray(o.message?.content)) {
      for (const b of o.message.content) if (b?.type === 'tool_use') marks.push(...parseMarks(commandOf(b.input)));
    } else if (o?.type === 'response_item' && o.payload?.type === 'message' && o.payload.role === 'user') {
      const text = textOf(o.payload.content).trim();
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
  const cacheFile = join(cacheDir, `${createHash('sha1').update(file).digest('hex')}.json`);
  let state = { offset: 0, asks: [], marks: [] };
  try {
    const saved = JSON.parse(readFileSync(cacheFile, 'utf8'));
    if (saved && saved.v === 2 && saved.file === file && Number.isFinite(saved.offset) && saved.offset <= size) state = { offset: saved.offset, asks: saved.asks || [], marks: [] };
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
      writeFileSync(tmp, JSON.stringify({ v: 2, file, offset: state.offset, asks: state.asks.map((a) => ({ ...a, text: a.text.slice(0, 2000) })) }), { mode: 0o600 });
      renameSync(tmp, cacheFile);
    } catch { /* the cache only saves time */ }
  }
  return state.asks;
}

const clip = (s, n) => { const t = String(s).replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

export function summaryLine(asks) {
  const count = (s) => asks.filter((a) => a.status === s).length;
  return `${count('done')}/${asks.length} done${count('partial') ? `, ${count('partial')} partial` : ''}${count('dropped') ? `, ${count('dropped')} dropped` : ''}${count('open') ? `, ${count('open')} open` : ''}`;
}

/** What the agent is shown: every unfinished request verbatim, finished ones counted. */
export function ledgerText(asks, { newest = null, maxChars = 6000 } = {}) {
  if (!asks.length) return '';
  const unfinished = asks.filter((a) => a.status === 'open' || a.status === 'partial');
  const lines = [`Noam's requests in this conversation, in his own words (${summaryLine(asks)}). Keep them; do not replace them with your own summary.`];
  for (const a of unfinished.slice(-15)) lines.push(`#${a.n} [${a.status}${a.note ? `: ${clip(a.note, 120)}` : ''}] "${clip(a.text, 500)}"`);
  if (unfinished.length > 15) lines.push(`(${unfinished.length - 15} older unfinished requests not shown)`);
  if (newest) lines.push('', `#${newest.n} is new. If it is a new or unclear request, first read it back as a short numbered list in his words (mark implied parts), ask at most 2 questions about real gaps, then build.`);
  lines.push('When a request is finished, mark it: termfleet-asks done <n> "<proof: what ran and what it showed>"; or partial <n> "<what is missing>"; or dropped <n> "<why, who decided>". Never call something done without proof; if you did less than asked, say so in your first sentence.');
  const text = lines.join('\n');
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
}

export const CLAIMS_DONE = /\b(done|fixed|finished|completed?|works now|is live|all set|ready for you|shipped|resolved)\b|(?:^|\s)(סיימתי|תוקן|מוכן|עובד עכשיו|הושלם)(?:\s|$|[.!,])/i;

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
    const prompt = String(payload.prompt ?? payload.user_prompt ?? '').trim();
    let newest = null;
    // The new message is not in the record yet when this runs.
    if (prompt && !injected(prompt) && !acknowledgement(prompt) && !asks.some((a) => a.text === prompt && a === asks.at(-1))) {
      newest = { n: asks.length + 1, text: prompt, status: 'open', note: '' };
      asks.push(newest);
    }
    const text = ledgerText(asks, { newest });
    return text ? { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: text } } : null;
  }
  if (/^SessionStart$/i.test(event) || event === 'session_start') {
    // After a compaction or a resume, the summary may have lost his words.
    const source = payload.source || '';
    if (!/compact|resume|clear/.test(source) && asks.length === 0) return null;
    const text = ledgerText(asks);
    return text ? { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: `After ${source || 'a restart'}: ${text}` } } : null;
  }
  if (/^Stop$/i.test(event) || event === 'stop') {
    if (payload.stop_hook_active || payload.stopHookActive) return null;   // reminder mode: once per finish
    const last = String(payload.last_assistant_message || '') || lastAssistantText(lines);
    if (!CLAIMS_DONE.test(last)) return null;
    const unmarked = asks.filter((a) => a.status === 'open');
    if (!unmarked.length) return null;
    const list = unmarked.slice(-6).map((a) => `#${a.n} "${clip(a.text, 160)}"`).join('; ');
    return { decision: 'block', reason: `Before you say it is done: mark Noam's open requests with termfleet-asks — done <n> "<proof: what ran and what it showed>", partial <n> "<what is missing>", or dropped <n> "<why, who decided>". If anything is partial or not done, say so in your first sentence. Open: ${list}` };
  }
  return null;
}

export function cli(args) {
  const [status, nums, ...rest] = args;
  if (!STATUSES.includes(status)) return { ok: false, message: 'Use: termfleet-asks done|partial|dropped <n[,n]> "<proof or note>"' };
  const list = String(nums || '').split(',').map(Number);
  if (!list.length || list.some((n) => !Number.isInteger(n) || n < 1)) return { ok: false, message: 'Give the request number(s) shown in the list, e.g. 3 or 2,5.' };
  const note = rest.join(' ').trim();
  if (status === 'done' && note.length < 8) return { ok: false, message: 'A "done" needs proof: what ran and what it showed (a test result, a command\'s output, a screenshot you looked at).' };
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
    if (result) process.stdout.write(JSON.stringify(result) + '\n');
    process.exit(0);
  }
  const result = cli(args);
  process.stdout.write(result.message + '\n');
  process.exit(result.ok ? 0 : 1);
}
