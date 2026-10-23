import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { requestDaemon, defaultDaemonSocket } from '../../scripts/termfleetctl.mjs';
import { visibleScreenOf, observedScreenOf } from './screen.mjs';
import { isSleeping, wakePane } from './sleep.mjs';

/**
 * Every keystroke this bridge puts into a live terminal is recorded. Without
 * it there is no way to answer "did my message actually arrive?" — which is
 * exactly the question a remote control has to be able to answer.
 */
const AUDIT = path.join(
  process.env.TC_CONFIG_DIR || path.join(os.homedir(), '.config', 'termcontrol'),
  'sent.log',
);

function audit(entry) {
  try {
    fs.mkdirSync(path.dirname(AUDIT), { recursive: true, mode: 0o700 });
    fs.appendFileSync(AUDIT, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n', { mode: 0o600 });
  } catch { /* never let logging break a send */ }
}

/** The daemon wraps every reply as { ok, value } — unwrap or throw. */
async function ask(request) {
  let res = await requestDaemon(request, defaultDaemonSocket());
  // A busy daemon sometimes refuses or closes a fresh connection before reading it (seen as
  // "write EPIPE" on a phone answer, 2026-10-21). Then nothing was received, so try again.
  for (let tries = 0; tries < 2 && res?.ok !== true && /EPIPE|ECONNREFUSED/.test(String(res?.error || '')); tries++) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    res = await requestDaemon(request, defaultDaemonSocket());
  }
  if (!res || res.ok !== true) throw new Error(res?.error || 'the terminal service refused');
  if(res.value?.error || (request.type==='writeSession' && res.value?.ok!==true))throw new Error(res.value?.error || 'The terminal did not acknowledge the write.');
  return res.value;
}

export async function liveSessionIds() {
  const value = await ask({ type: 'listSessions' });
  return new Set((value.sessions || []).map((s) => s.id));
}

/**
 * Typing into a live agent is the one thing here that can damage a session, so
 * every send is gated: the pane must exist in the daemon, must not be mid-turn,
 * and only one send may be in flight for it at a time.
 */
const inFlight = new Set();

// A pasted document is a normal thing to send, so the only cap is a guard
// against a runaway request, far above any real paste and well under the
// terminal service's own 16 MB request limit.
export const MAX_MESSAGE_CHARS = 2_000_000;

export async function sendToPane(pane, text, { force = false } = {}) {
  const body = String(text ?? '');
  if (!body.trim()) return { error: 'Nothing to send.' };
  if (body.length > MAX_MESSAGE_CHARS) return { error: 'That message is over 2 million characters. Send it as a file instead.' };

  if (inFlight.has(pane.id)) return { error: 'Still sending your last message.' };

  // A sleeping terminal is woken first (its conversation resumes), then the message goes in.
  if (isSleeping(pane.id)) {
    const woke = await wakePane(pane.id, { ask: (request) => requestDaemon(request, defaultDaemonSocket()) });
    if (!woke.ok) return { error: `That terminal is asleep and could not be woken: ${woke.error}` };
  }

  const live = await liveSessionIds();
  if (!live.has(pane.id)) {
    return { error: 'That terminal is not running any more.' };
  }

  // Busy means either the agent says it is working, or the terminal is
  // visibly producing output right now. The second is the more reliable of
  // the two, and catches an agent that never updates its own status.
  const busy = pane.turn === 'working' || pane.producing === true;
  // Agents queue a message typed mid-turn and read it next, so it is sent at once
  // (owner, 2026-10-11: "All should be sent now ... and appended"). Only a plain
  // shell still asks, since typing into a running command can feed that command.
  const agentQueues = ['claude', 'codex', 'opencode'].includes(pane.provider);
  if (busy && !force && !agentQueues) {
    return {
      error: 'busy',
      busy: true,
      message: pane.producing
        ? 'This terminal is working right now. Send anyway?'
        : 'The agent is still working. Send anyway?',
    };
  }

  inFlight.add(pane.id);
  try {
    const sizeBefore = await scrollbackBytes(pane.id);
    // A newline typed into an agent submits the line. Sending a two-line
    // message raw therefore delivers it as two prompts: the first starts a
    // turn and the second arrives mid-turn and queues, which is what "my
    // message got stuck" looks like. Wrapping it in bracketed paste tells the
    // terminal this is one pasted block, so the newlines stay inside it.
    const wire = body.includes('\n')
      ? `\u001b[200~${body.replace(/\r/g, '')}\u001b[201~`
      : body;

    // Text first, then Enter as its own write: agent TUIs redraw between
    // keystrokes, and a newline arriving inside the same chunk as the text is
    // routinely swallowed. The pause gives the prompt time to settle.
    await ask({ type: 'writeSession', id: pane.id, data: wire });
    await new Promise((r) => setTimeout(r, 120));
    await ask({ type: 'writeSession', id: pane.id, data: '\r' });

    // Don't claim success just because the write returned. Look at what the
    // terminal actually shows and report honestly if the text never appeared.
    const enterAt = Date.now();
    const delivered = await landedInTerminal(pane.id, body, sizeBefore);
    audit({
      pane: pane.id, project: pane.project, provider: pane.provider,
      turn: pane.turn, bytes: body.length, ok: true, delivered,
    });
    // Runs after the reply: the phone should not wait on the desktop's next look.
    confirmSubmitted(pane, body, enterAt).catch(() => {});
    return { ok: true, delivered, sentAt: Date.now() };
  } catch (error) {
    audit({ pane: pane.id, project: pane.project, bytes: body.length, ok: false, error: String(error.message || error) });
    return { error: String(error.message || error) };
  } finally {
    inFlight.delete(pane.id);
  }
}

/**
 * Did the message actually get into the terminal?
 *
 * Two independent signs, because neither alone is sound. The text may show up
 * on screen — but an agent swallows a short message instantly and clears its
 * box, so absence proves nothing. Output growing right after the write does
 * prove that something arrived and was acted upon.
 */
async function landedInTerminal(id, body, sizeBefore) {
  const squash = (s) => String(s)
    .replace(/\u001b\[[0-9;?]*[\u0020-\u002f]*[\u0040-\u007e]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();

  const needle = squash(body).slice(0, 60);

  for (const delay of [250, 500, 900, 1400]) {
    await new Promise((r) => setTimeout(r, delay));

    if (needle.length >= 4) {
      try {
        const snap = await ask({ type: 'snapshotSession', id });
        if (squash(snap.data || '').includes(needle)) return true;
      } catch { /* fall through to the other sign */ }
    }

    const now = await scrollbackBytes(id);
    if (now != null && sizeBefore != null && now > sizeBefore) return true;
  }
  return false;
}

/**
 * What the agent's input box holds on this screen, or null when the box cannot be
 * found. Claude's box sits between the last two horizontal rules after "❯"; Codex's
 * is the last "›" line, up to its status line.
 */
export function inputBoxText(screen, provider) {
  const lines = String(screen || '').split('\n');
  if (provider === 'claude') {
    // A rule can carry a stray damaged character (TF-093), so "mostly ─" counts.
    const isRule = (line) => { const t = line.trim(); return t.length >= 10 && (t.match(/─/g) || []).length >= t.length * 0.9; };
    const rules = lines.map((line, i) => (isRule(line) ? i : -1)).filter((i) => i >= 0);
    if (rules.length < 2) return null;
    const [top, bottom] = rules.slice(-2);
    if (bottom - top < 2) return null;
    return lines.slice(top + 1, bottom).join('\n').replace(/^\s*❯\s?/, '').trim();
  }
  if (provider === 'codex') {
    const start = lines.findLastIndex((line) => /^\s*›(\s|$)/.test(line));
    if (start < 0) return null;
    const end = lines.findIndex((line, i) => i > start && /% left|Context \d+% used|for shortcuts|esc to interrupt/.test(line));
    return lines.slice(start, end < 0 ? undefined : end).join('\n').replace(/^\s*›\s?/, '').trim();
  }
  return null;
}

/**
 * Is this message still sitting unsent in the input box? True only on positive
 * evidence — the message's own words, or the box's pasted-text / image marker.
 */
export function heldInInput(screen, body, provider) {
  const box = inputBoxText(screen, provider);
  if (box == null) return null;
  if (!box) return false;
  const squash = (s) => String(s).replace(/\S*\/\S+\.(?:png|jpe?g|webp|gif)\b/gi, '').replace(/\s+/g, '').toLowerCase();
  const words = squash(body);
  const tail = words.slice(-24);
  if (tail.length >= 3 && squash(box).includes(tail)) return true;
  if (body.includes('\n') && /\[Pasted text #\d+/.test(box)) return true;
  if (/\.(?:png|jpe?g|webp|gif)\b/i.test(body) && /\[Image #\d+\]/.test(box) && (tail.length < 3 || squash(box).includes(tail.slice(-8)))) return true;
  return false;
}

/**
 * A submit key can be swallowed while the agent is still taking in a pasted image
 * or a long paste; the message then sits in the box until the next one pushes it
 * out (owner report 2026-10-10: a photo + "Here" waited 30 minutes). Watch the next
 * fresh look at the pane and press submit again, at most twice, only while the
 * box still visibly holds this message.
 */
export async function confirmSubmitted(pane, body, enterAt, deps = {}) {
  const { screen = (since) => observedScreenOf(pane.id, { since }), write = (data) => ask({ type: 'writeSession', id: pane.id, data }),
    pause = (ms) => new Promise((r) => setTimeout(r, ms)), record = audit, deadlineMs = 15000 } = deps;
  let since = enterAt + 300, resubmits = 0;
  const started = Date.now();
  while (Date.now() - started < deadlineMs) {
    await pause(1000);
    const seen = screen(since);
    if (seen == null) continue;
    const held = heldInInput(seen, body, pane.provider);
    if (held === null || held === false) { if (resubmits) record({ pane: pane.id, submitRetry: resubmits, delivered: true, outcome: 'cleared' }); return { resubmits, held: false }; }
    if (resubmits >= 2) break;
    await write('\r');
    resubmits++;
    since = Date.now() + 300;
  }
  // A screen that never came into view after a clean submit is not worth a log line.
  if (resubmits) record({ pane: pane.id, submitRetry: resubmits, delivered: resubmits < 2, outcome: resubmits >= 2 ? 'still-held' : 'unobserved' });
  return { resubmits, held: resubmits >= 2 ? true : null };
}

/** How much this terminal has printed so far, or null if it cannot be read. */
async function scrollbackBytes(id) {
  try {
    const value = await ask({ type: 'listSessions' });
    const found = (value.sessions || []).find((s) => s.id === id);
    return found ? Number(found.scrollbackBytes || 0) : null;
  } catch {
    return null;
  }
}

/**
 * Answer whatever the agent is asking. A numbered choice picks that option in
 * the on-screen list; the named choices answer a permission prompt with the
 * provider's own keystroke.
 */
export function promptKey(pane, choice, approval, kind) {
  if(pane.provider==='claude' && kind==='question-submit' && choice==='submit')return '\r';
  if (/^[1-9]$/.test(String(choice))) {
    // Claude's standard single-select form and Codex select on the digit itself;
    // the installed Claude Select handler calls onChange directly for a digit.
    // Enter after it
    // can submit the next question before the operator sees that question.
    return ['claude','codex'].includes(pane.provider) && kind === 'question' ? String(choice) : `${choice}\r`;
  }
  return approval?.[choice];
}

export async function answerPrompt(pane, choice, approval, kind) {
  const key = promptKey(pane, choice, approval, kind);
  if (!key) return { error: 'Unknown choice.', notSent: true };
  const live = await liveSessionIds();
  if (!live.has(pane.id)) return { error: 'That terminal is not running any more.', notSent: true };
  try {
    await ask({ type: 'writeSession', id: pane.id, data: key });
    audit({ pane: pane.id, project: pane.project, choice, ok: true });
    return { ok: true, sentAt: Date.now() };
  } catch (error) {
    audit({ pane: pane.id, project: pane.project, choice, ok: false, error: String(error.message || error) });
    return { error: String(error.message || error), uncertain: true };
  }
}

/**
 * Press the digit of a numbered prompt read off the screen, as at the PC. Some
 * menus act on the digit; others only move their cursor to it. Enter is sent
 * only when this same prompt is still open with the cursor on that choice, so it
 * can never land on a different prompt.
 */
export async function answerScreenChoice(pane, prompt, choice, {
  screen = async () => (await import('./liveness.mjs')).screenOf(pane.id),
  write = (data) => ask({ type: 'writeSession', id: pane.id, data }),
  pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  live = liveSessionIds,
  record = audit,
} = {}) {
  const option = prompt.options.find((o) => o.key === String(choice));
  if (!option) return { error: 'Unknown choice.', notSent: true };
  if (!(await live()).has(pane.id)) return { error: 'That terminal is not running any more.', notSent: true };
  // Only the menu at the bottom of the screen counts: the same prompt can still be
  // in the text above after it was answered and the program moved on.
  const { screenPromptAsk } = await import('./asks.mjs');
  const open = (value) => screenPromptAsk(pane, value)?.id === prompt.id;
  const onChoice = (value) => {
    const lines = String(value || '').split('\n');
    const end = lines.findLastIndex((line) => /Esc to cancel/i.test(line));
    return lines.slice(Math.max(0, end - 12), end).some((line) => new RegExp(`^\\s*[❯›>]\\s*${option.key}\\.`).test(line.replace(/[│┃]/g, ' ')));
  };
  const done = () => { record({ pane: pane.id, project: pane.project, askId: prompt.id, choice: option.key, ok: true }); return { ok: true, sentAt: Date.now() }; };
  try {
    await write(option.key);
    let snapshot = '';
    for (let n = 0; n < 14; n++) { await pause(150); snapshot = await screen(); if (!open(snapshot)) return done(); if (onChoice(snapshot) && n >= 2) break; }
    if (!open(snapshot)) return done();
    if (!onChoice(snapshot)) return { error: 'The terminal did not take the choice. Check it before trying again.', uncertain: true };
    await write('\r');
    for (let n = 0; n < 14; n++) { await pause(150); snapshot = await screen(); if (!open(snapshot)) return done(); }
    return { error: 'The prompt is still open in the terminal. Check it before trying again.', uncertain: true };
  } catch (error) {
    record({ pane: pane.id, project: pane.project, askId: prompt.id, choice: option.key, ok: false, error: String(error.message || error) });
    return { error: String(error.message || error), uncertain: true };
  }
}

export async function sendCustomAnswer(pane, question, text, {
  screen = async options => visibleScreenOf(pane.id, options) || '',
  write = data => ask({type:'writeSession',id:pane.id,data}),
  pause = ms => new Promise(resolve => setTimeout(resolve, ms)),
  record = audit,
} = {}) {
  const answer = String(text ?? '').replace(/\r/g, '');
  if (!answer.trim() || answer.length > MAX_MESSAGE_CHARS || /[\x00-\x08\x0b-\x1f\x7f]/.test(answer)) return {error:'Use plain text (no control characters).',notSent:true};
  if (pane.provider !== 'claude') return {error:'This question needs the terminal’s own text field. Open Screen to answer.',notSent:true};
  if (question.multiSelect) return typeMultiCustomAnswer(pane, question, answer, { screen, write, pause, record });
  // Wrapped lines and the form's box borders must not hide the question (2026-10-20).
  const squash = value => String(value || '').replace(/[\u2500-\u257f\s]+/g,'');
  const sameQuestion = value => squash(value).includes(squash(question.title));
  // Claude Code 2.1.288 types into the numbered "Type something." row itself: focused, it reads
  // "❯ 3. Type something." with "4. Chat about this" still below (Noam 2026-10-21: "לא יכול לשלוח
  // את זה" — the older separate-field check refused every typed answer).
  const rows = value => String(value || '').replace(/[│┃]/g, ' ').split('\n');
  let snapshot = await screen();
  if (!sameQuestion(snapshot)) return {error:'That question is no longer on screen. Refresh before answering.',notSent:true};
  const chat = snapshot.match(/(?:^|\n)\s*(?:[›❯>]\s*)?([1-9])\.\s*Chat about this/i), other = snapshot.match(/(?:^|\n)\s*(?:[›❯>]\s*)?([1-9])\.\s*(?:Type something|Other)\b/i);
  const row = other ? other[1] : chat && Number(chat[1]) > 1 ? String(Number(chat[1]) - 1) : null;
  const rowText = value => { for (const line of rows(value)) { const m = line.match(new RegExp(`^\\s*[›❯>]\\s*${row}\\.\\s?(.*)$`)); if (m) return m[1].trim(); } return null; };
  const placeholder = text => /^(?:Type something|Other)\b/i.test(text);
  const inEditor = value => sameQuestion(value) && ((/Type something\.|Type your answer|Enter your answer/i.test(value) && !/\d+\.\s*(?:Type something|Other)|Chat about this/i.test(value)) || (row !== null && rowText(value) !== null));
  if (!inEditor(snapshot)) {
    if (!row) return {error:'The terminal has no verified custom-answer field. Open Screen to check it.',notSent:true};
    // The digit focuses Other. Never send Enter into a menu before verifying
    // the text field: Enter there can accept or decline the entire request.
    const focusedAt=Date.now(); await write(row);
    for (let i=0;i<24;i++) { await pause(150); snapshot=await screen({after:focusedAt}); if(inEditor(snapshot)) break; }
    if (!inEditor(snapshot)) return {error:'Could not confirm the custom-answer field. Your text was not sent. Check Screen.',notSent:true};
  }
  // Words left in that row (an earlier try, or typed at the PC) are cleared first, so the
  // answer arrives exactly as written. Ctrl+U empties the row; nothing is submitted.
  const typed = row !== null ? rowText(snapshot) : null;
  if (typed && !placeholder(typed)) {
    const clearedAt=Date.now(); await write('\u0015');
    for (let i=0;i<24;i++) { await pause(150); snapshot=await screen({after:clearedAt}); const now=rowText(snapshot); if(now!==null && (!now || placeholder(now))) break; }
    const now = rowText(snapshot);
    if (now === null || (now && !placeholder(now))) return {error:'Could not clear the earlier text in the answer field. Your text was not sent. Check Screen.',notSent:true};
  }
  const typedAt=Date.now(); await write(`\u001b[200~${answer}\u001b[201~`);
  for(let i=0;i<24;i++){await pause(150);snapshot=await screen({after:typedAt});if(sameQuestion(snapshot) && squash(snapshot).includes(squash(answer)))break;}
  if (!sameQuestion(snapshot) || !squash(snapshot).includes(squash(answer))) return {error:'Your text is not confirmed in the answer field. Check Screen before retrying.',uncertain:true};
  await write('\r');
  record({pane:pane.id,project:pane.project,askId:question.id,customAnswer:true,bytes:answer.length,ok:true});
  return {ok:true,sentAt:Date.now()};
}

/**
 * Claude's pick-several question (verified against the installed form's source):
 * a digit ticks or unticks that option without moving the focus; the "Type
 * something" row (last option) takes typed text and ticks itself once it has text;
 * Enter on that row would untick it, so it is never pressed there; Down from the
 * last option focuses Submit, and Enter there submits. Every step re-reads the
 * screen and stops before the next key unless the previous one is confirmed.
 */
export function multiSelectState(screen, optionCount) {
  const text = String(screen || '');
  const rows = [];
  for (let n = 1; n <= optionCount + 1; n++) {
    const match = text.match(new RegExp(`^[ \\t]*(❯)?[ \\t]*${n}\\.[ \\t]*\\[(.)\\][ \\t]*([^\\n]*)$`, 'm'));
    if (!match) return null;
    rows.push({ focused: Boolean(match[1]), checked: match[2].trim() !== '', label: match[3].trim() });
  }
  // The button reads "Next" on every question but the last.
  const submitFocused = /^[ \t]*❯[ \t]*(?:Submit|Next)[ \t]*$/m.test(text);
  const focusIndex = rows.findIndex((row) => row.focused);
  const input = rows[optionCount];
  return {
    rows,
    focus: submitFocused ? 'submit' : focusIndex >= 0 ? focusIndex + 1 : null,
    inputRow: optionCount + 1,
    checked: rows.slice(0, optionCount).flatMap((row, index) => (row.checked ? [String(index + 1)] : [])),
    customText: input && !/^Type something\b/i.test(input.label) ? input.label : '',
    customChecked: Boolean(input?.checked),
  };
}

const UP = '\u001b[A', DOWN = '\u001b[B';

async function waitFor(screen, pause, after, accept) {
  let snapshot = '';
  for (let i = 0; i < 24; i++) {
    await pause(150);
    snapshot = await screen({ after });
    if (accept(snapshot)) return snapshot;
  }
  return null;
}

function multiDeps(pane, deps = {}) {
  return {
    screen: deps.screen || (async (options) => visibleScreenOf(pane.id, options) || ''),
    write: deps.write || ((data) => ask({ type: 'writeSession', id: pane.id, data })),
    pause: deps.pause || ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    record: deps.record || audit,
  };
}

/** Leave the typing row (or Submit) so a digit ticks an option instead of being typed. */
async function focusAnOption(question, state, { screen, write, pause }) {
  const count = question.options.length;
  if (state.focus !== state.inputRow && state.focus !== 'submit') return state;
  const sentAt = Date.now();
  await write(UP);
  const moved = await waitFor(screen, pause, sentAt, (value) => {
    const next = multiSelectState(value, count);
    return next && next.focus !== state.inputRow && next.focus !== 'submit';
  });
  return moved ? multiSelectState(moved, count) : null;
}

export async function toggleMultiChoice(pane, question, key, deps) {
  const { screen, write, pause, record } = multiDeps(pane, deps);
  const count = question.options.length;
  if (!/^[1-9]$/.test(String(key)) || Number(key) > count) return { error: 'Unknown choice.', notSent: true };
  const sameQuestion = (value) => String(value).replace(/\s+/g, ' ').includes(question.title.replace(/\s+/g, ' '));
  let snapshot = await screen();
  let state = sameQuestion(snapshot) ? multiSelectState(snapshot, count) : null;
  if (!state) return { error: 'That question is no longer on screen. Refresh before answering.', notSent: true };
  state = await focusAnOption(question, state, { screen, write, pause });
  if (!state) return { error: 'Could not move off the typing field. Nothing was ticked. Check Screen.', notSent: true };
  const wasChecked = state.checked.includes(String(key));
  const sentAt = Date.now();
  await write(String(key));
  snapshot = await waitFor(screen, pause, sentAt, (value) => {
    const next = sameQuestion(value) && multiSelectState(value, count);
    return next && next.checked.includes(String(key)) !== wasChecked;
  });
  if (!snapshot) return { error: 'The tick did not show in the terminal. Check Screen before trying again.', uncertain: true };
  const next = multiSelectState(snapshot, count);
  record({ pane: pane.id, project: pane.project, askId: question.id, multiToggle: String(key), ok: true });
  return { ok: true, sentAt: Date.now(), checked: next.checked, customText: next.customText };
}

export async function typeMultiCustomAnswer(pane, question, answer, deps) {
  const { screen, write, pause, record } = multiDeps(pane, deps);
  const count = question.options.length;
  const sameQuestion = (value) => String(value).replace(/\s+/g, ' ').includes(question.title.replace(/\s+/g, ' '));
  let snapshot = await screen();
  let state = sameQuestion(snapshot) ? multiSelectState(snapshot, count) : null;
  if (!state) return { error: 'That question is no longer on screen. Refresh before answering.', notSent: true };
  if (state.customText) return { error: 'The typing field already has text. Edit it in the terminal.', notSent: true };
  if (state.focus !== state.inputRow) {
    // From Submit, Up lands on the typing row (the last option); from an option, Down.
    const keys = state.focus === 'submit' ? UP : state.focus === null ? '' : DOWN.repeat(state.inputRow - state.focus);
    if (!keys) return { error: 'Could not find the focused choice. Check Screen.', notSent: true };
    const sentAt = Date.now();
    await write(keys);
    snapshot = await waitFor(screen, pause, sentAt, (value) => multiSelectState(value, count)?.focus === state.inputRow);
    if (!snapshot) return { error: 'Could not confirm the typing field. Your text was not sent. Check Screen.', notSent: true };
  }
  const typedAt = Date.now();
  await write(`\u001b[200~${answer}\u001b[201~`);
  const flat = (value) => String(value).replace(/\s+/g, ' ');
  snapshot = await waitFor(screen, pause, typedAt, (value) => sameQuestion(value) && flat(value).includes(flat(answer)));
  if (!snapshot) return { error: 'Your text is not confirmed in the answer field. Check Screen before retrying.', uncertain: true };
  record({ pane: pane.id, project: pane.project, askId: question.id, customAnswer: true, multiSelect: true, bytes: answer.length, ok: true });
  const next = multiSelectState(snapshot, count);
  return { ok: true, sentAt: Date.now(), checked: next?.checked || [], customText: next?.customText || answer, kept: true };
}

export async function submitMultiChoice(pane, question, deps) {
  const { screen, write, pause, record } = multiDeps(pane, deps);
  const count = question.options.length;
  const sameQuestion = (value) => String(value).replace(/\s+/g, ' ').includes(question.title.replace(/\s+/g, ' '));
  let snapshot = await screen();
  const state = sameQuestion(snapshot) ? multiSelectState(snapshot, count) : null;
  if (!state) return { error: 'That question is no longer on screen. Refresh before answering.', notSent: true };
  if (!state.checked.length && !state.customChecked) return { error: 'Tick at least one choice first.', notSent: true };
  if (state.focus !== 'submit') {
    if (state.focus === null) return { error: 'Could not find the focused choice. Check Screen.', notSent: true };
    const sentAt = Date.now();
    await write(DOWN.repeat(state.inputRow - state.focus + 1));
    snapshot = await waitFor(screen, pause, sentAt, (value) => multiSelectState(value, count)?.focus === 'submit');
    if (!snapshot) return { error: 'Could not reach Submit. Nothing was submitted. Check Screen.', notSent: true };
  }
  await write('\r');
  record({ pane: pane.id, project: pane.project, askId: question.id, multiSubmit: true, ok: true });
  return { ok: true, sentAt: Date.now() };
}

/**
 * The whole pick-several answer in one go (Noam 2026-10-23: multi-select must work
 * better on the phone). The phone ticks locally; here the terminal's ticks are brought
 * to exactly that set one confirmed key at a time, an own answer is typed if given, and
 * Submit is pressed once. Any unconfirmed step stops before Submit.
 */
export async function answerMultiChoice(pane, question, { choices = [], customText = '' } = {}, deps) {
  const d = multiDeps(pane, deps);
  const count = question.options.length;
  const want = [...new Set((Array.isArray(choices) ? choices : []).map(String))];
  if (want.some((key) => !/^[1-9]$/.test(key) || Number(key) > count)) return { error: 'Unknown choice.', notSent: true };
  const own = String(customText ?? '').replace(/\r/g, '').trim();
  if (!want.length && !own) return { error: 'Tick at least one choice first.', notSent: true };
  const sameQuestion = (value) => String(value).replace(/\s+/g, ' ').includes(question.title.replace(/\s+/g, ' '));
  const read = async () => { const value = await d.screen(); return sameQuestion(value) ? multiSelectState(value, count) : null; };
  let state = await read();
  if (!state) return { error: 'That question is no longer on screen. Refresh before answering.', notSent: true };
  if (own && state.customText && state.customText.replace(/\s+/g, ' ') !== own.replace(/\s+/g, ' ')) return { error: 'The typing field in the terminal already has different text. Edit it there.', notSent: true };
  for (let key = 1; key <= count; key++) {
    if (state.checked.includes(String(key)) === want.includes(String(key))) continue;
    const step = await toggleMultiChoice(pane, question, String(key), d);
    if (!step.ok) return { ...step, error: `${step.error} Nothing was submitted.` };
    state = await read();
    if (!state) return { error: 'That question is no longer on screen. Nothing was submitted.', uncertain: true };
  }
  if (own && !state.customText) {
    const typed = await typeMultiCustomAnswer(pane, question, own, d);
    if (!typed.ok) return { ...typed, error: `${typed.error} Nothing was submitted.` };
  }
  return submitMultiChoice(pane, question, d);
}

/**
 * The keys a terminal needs that a phone keyboard does not offer. Sent as
 * themselves, immediately, without the idle checks that guard a message —
 * stopping a runaway agent must always be possible.
 */
const KEYS = {
  tab: '\t',
  esc: '\u001b',
  interrupt: '\u0003',
  enter: '\r',
  up: '\u001b[A',
  down: '\u001b[B',
};

export async function sendKey(pane, which) {
  // A literal character types itself; a named key sends its sequence. Typing
  // is how an agent's own menus are reached — a slash only opens the command
  // list if the terminal receives it as a keystroke.
  const data = which.startsWith('type:') ? which.slice(5) : KEYS[which];
  if (!data || data.length > 200) return { error: 'Unknown key.' };
  const live = await liveSessionIds();
  if (!live.has(pane.id)) return { error: 'That terminal is not running any more.' };
  try {
    await ask({ type: 'writeSession', id: pane.id, data });
    audit({ pane: pane.id, project: pane.project, key: which, ok: true });
    return { ok: true };
  } catch (error) {
    audit({ pane: pane.id, project: pane.project, key: which, ok: false, error: String(error.message || error) });
    return { error: String(error.message || error) };
  }
}
