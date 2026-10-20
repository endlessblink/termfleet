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
export const injected = (text) => /^\s*(<(system-reminder|command-|local-command|task-notification|user-prompt-submit-hook|environment_context|user_instructions|turn_aborted)|\[SYSTEM NOTIFICATION|\[Message from (the agent|the bot|an orchestrating)|Caveat:|# AGENTS\.md|This session is being continued from a previous conversation|\[Request interrupted)/i.test(text);

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

/**
 * What a list shows for a request: his own words first. A job post or a log he pasted sits
 * above his one line ("jobs like this should not pass the filter"), and the list showed the
 * pasted title instead. Pasted text is recognised by script: an English block, his Hebrew line.
 */
export function askTitle(text) {
  const lines = (ownWords(text) || String(text || '')).split('\n').map((l) => l.trim()).filter(Boolean);
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
export function ledgerText(allAsks, { newest = null, maxChars = 6000 } = {}) {
  const asks = allAsks.filter((a) => isRealRequest(a.text));
  if (!asks.length) return '';
  const unfinished = asks.filter((a) => a.status === 'open' || a.status === 'partial' || a.status === 'ready');
  const lines = [`Noam's requests, his words (${summaryLine(asks)}):`];
  for (const a of unfinished.slice(-15)) lines.push(`#${a.n} [${a.status}${a.note ? `: ${clip(a.note, 80)}` : ''}] "${clip(askTitle(a.text), 200)}"`);
  if (unfinished.length > 15) lines.push(`(${unfinished.length - 15} older unfinished requests not shown)`);
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
    // Noam 2026-10-17: "they say that they will do something and just never do it".
    // Nothing runs after an agent stops, so a promised next step must happen now.
    const promise = promisedStep(last);
    if (promise) return { decision: 'block', reason: `You promised "${clip(promise, 80)}" but nothing runs after you stop. Do it now, or end with "Waiting for Noam: <what>" / set a wake-up.` };
    if (!CLAIMS_DONE.test(last)) return null;
    const unmarked = asks.filter((a) => a.status === 'open');
    if (!unmarked.length) return null;
    const list = unmarked.slice(-3).map((a) => `#${a.n} "${clip(a.text, 60)}"`).join('; ');
    return { decision: 'block', reason: `Mark open requests first (termfleet-asks done|ready|partial|dropped <n> "<proof>"); if anything is not done, say so in your first sentence. Open: ${list}` };
  }
  return null;
}

export function cli(args) {
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
    if (result) process.stdout.write(JSON.stringify(result) + '\n');
    process.exit(0);
  }
  const result = cli(args);
  process.stdout.write(result.message + '\n');
  process.exit(result.ok ? 0 : 1);
}
