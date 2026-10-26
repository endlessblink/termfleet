import fs from 'node:fs';
import path from 'node:path';
import { followActive } from './follows.mjs';
import { unsavedWork, filesTheAgentChanged } from '../../scripts/lib/team-close.mjs';
import { readFeed } from './feed.mjs';
import { screenPromptAsk } from './asks.mjs';

/**
 * TF-096 part 7: things that wake a bot without Noam writing (Grok Bot's event
 * triggers). Checked every 30 seconds by the bridge:
 *  - a terminal agent the bot started has finished;
 *  - one of them is waiting on a prompt (an approval or a question): the prompt
 *    is posted in the bot's chat with its own choices for Noam to tap, and the
 *    bot is told. Nothing is ever answered for him (Noam 2026-10-20: his answer
 *    goes to the terminal "as if I pressed it at the PC");
 *  - new code landed in a folder the bot watches.
 */

export function gitHead(dir) {
  try {
    const head = fs.readFileSync(path.join(dir, '.git', 'HEAD'), 'utf8').trim();
    if (!head.startsWith('ref: ')) return head;
    const ref = head.slice(5);
    try { return fs.readFileSync(path.join(dir, '.git', ref), 'utf8').trim(); } catch {
      const packed = fs.readFileSync(path.join(dir, '.git', 'packed-refs'), 'utf8').split('\n').find((l) => l.endsWith(` ${ref}`));
      return packed ? packed.split(' ')[0] : null;
    }
  } catch { return null; }
}

const stateOf = (pane) => (!pane ? 'closed' : pane.turn === 'waiting' ? 'waiting' : (pane.producing || pane.turn === 'working') ? 'working' : 'idle');

/**
 * For the bot's row (Noam 2026-10-20): how many of the terminal agents it handed
 * work to (or follows) are still busy, and how many are asking Noam something.
 * Only hand-offs from the last 12 hours count, so a terminal the bot followed
 * yesterday and Noam now uses for something else does not show as "waiting".
 */
export function helperState(bot, panes, now = Date.now(), { bots } = {}) {
  const ids = new Set((bot.helpers || []).filter((h) => h?.paneId && followActive(h) && now - Number(h.at || 0) < 12 * 3600_000).map((h) => h.paneId));
  let waitingOn = 0, helpersAsking = 0;
  for (const id of ids) {
    const state = stateOf(panes.find((p) => p.id === id));
    if (state === 'working') waitingOn++;
    else if (state === 'waiting') {
      if (bots) { if (openTerminalAsk(bots, bot.id, id)) helpersAsking++; }
      else helpersAsking++;
    }
  }
  return { waitingOn, helpersAsking };
}

/**
 * Is a prompt still drawn at the bottom of the terminal? (Noam 2026-10-25: "שהכפתור תמיד יופיע
 * כאן", after an "Allow Edit?" sat for an hour with its card already shown as ended.) The agent's
 * status can read "working" or "idle" while the menu is still up (a queued message, a hook that
 * missed it), so the screen decides whether the card stays live.
 */
export function screenStillAsks(screen) {
  const tail = String(screen || '').split('\n').map((l) => l.trimEnd()).filter((l) => l.trim()).slice(-14).join('\n');
  if (!tail) return false;
  return /Esc to cancel/i.test(tail) && /(^|\n)\s*(❯\s*)?1\.\s+\S/.test(tail)
    || /Do you want to (proceed|make this edit|create|allow|run|overwrite|delete)\b[^\n]*\?/i.test(tail)
    || /Allow (command|this|the \S+ server)[^\n]*\?/i.test(tail) && /(^|\n)\s*(›|❯|>)?\s*1\.\s+\S/.test(tail);
}

// Where an agent stopped and cannot go on without someone (Noam 2026-10-25: "כל דבר שכל סוכן
// נתקע עליו צריך להגיע לכאן"): an error, a limit, or a command something blocked.
const STUCK_LINES = [
  [/\bAPI Error\b[^\n]*/i, 'error'],
  [/\b(usage|rate) limit[^\n]*/i, 'limit'],
  [/You've hit your[^\n]*limit[^\n]*/i, 'limit'],
  [/\bOverloaded\b[^\n]*/i, 'error'],
  [/\bstream (disconnected|error)[^\n]*/i, 'error'],
  [/\bRequest timed out[^\n]*/i, 'error'],
  [/\b(Blocked by (security )?policy|hook error)[^\n]*/i, 'blocked'],
];

/** The line an agent that stopped is stuck on, from the bottom of its screen, or null. */
export function stuckOnScreen(screen) {
  const tail = String(screen || '').split('\n').map((l) => l.trim()).filter(Boolean).slice(-12);
  for (const line of tail.reverse()) {
    for (const [re, kind] of STUCK_LINES) { const m = re.exec(line); if (m) return { kind, line: line.replace(/^[⎿●■•✗×\s]+/, '').slice(0, 220) }; }
  }
  return null;
}

export const REMIND_AFTER_MS = 5 * 60_000;
export const REMIND_EVERY_MS = 15 * 60_000;
export const MAX_REMINDERS = 3;

/** The prompt as the bot chat shows it: the same choices the terminal offers. */
export function terminalAskMessage(paneId, label, ask) {
  return {
    role: 'terminal-ask', pane: paneId, label, askId: ask.id, kind: ask.kind,
    text: String(ask.title || 'The terminal agent is asking you something.').slice(0, 300),
    ...(ask.detail ? { detail: String(ask.detail).slice(0, 400) } : {}),
    // Every choice with its description, pick-several too (Noam 2026-10-23: "I need to be able
    // to see and answer this in the agent view not only the terminal").
    options: (ask.options || []).map((o) => ({ key: o.key, label: o.label, ...(o.detail ? { detail: o.detail } : {}) })),
    ...(ask.links?.length ? { links: ask.links } : {}),
    ...(ask.kind === 'question' ? { multiSelect: Boolean(ask.multiSelect), questionIndex: ask.questionIndex ?? 0, questionCount: ask.questionCount ?? 1, ...(ask.header ? { header: ask.header } : {}), ...(ask.questions ? { questions: ask.questions } : {}), ...(ask.stage ? { stage: ask.stage } : {}) } : {}),
  };
}

// A prompt read off the screen answers with its digits; the record's form with yes / no.
const menuForm = (m) => (m.options || []).some((o) => /^[1-9]$/.test(String(o.key)));
const promptKey = (m) => [m.kind || '', String(m.text ?? m.title ?? '').trim(), ...(m.options || []).map((o) => o.label)].join('\u0001');
const samePrompt = (card, ask) => promptKey(card) === promptKey({ ...ask, text: String(ask.title || 'The terminal agent is asking you something.').slice(0, 300) });

/** The card still waiting for Noam's answer for this terminal, if any. */
function openTerminalAsk(bots, botId, paneId) {
  const card = bots.messages(botId).filter((m) => m.role === 'terminal-ask' && m.pane === paneId).at(-1);
  return card && !card.settled ? card : null;
}

/** Updates one card in place: closes it once answered, or follows the prompt's new id. */
function settleTerminalAsk(bots, botId, cardId, patch, settled = true) {
  const file = path.join(bots.folder(botId), 'chat.jsonl');
  try {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    const at = lines.findIndex((l) => l.includes(`"id":"${cardId}"`));
    if (at < 0) return;
    lines[at] = JSON.stringify({ ...JSON.parse(lines[at]), ...patch, ...(settled ? { settled: true } : {}) });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, lines.join('\n'), { mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch { /* best effort: at worst the card stays as it was */ }
}

/** The terminal's own unsaved files (what blocks `termfleet-team close`), [] when it can be closed. */
export function unsavedFor(pane, helper) {
  try { return unsavedWork(pane.cwd, Number(helper.at) || 0, undefined, filesTheAgentChanged(pane)); } catch { return []; }
}

/** Did the terminal get a new message (new work) after this moment? Its own record says. */
export function newPromptSince(pane, since) {
  try { return (readFeed(pane, { limit: 20 }).events || []).some((e) => e.kind === 'user' && Date.parse(e.at) > since); } catch { return false; }
}

export async function checkBotEvents({ bots, panes, now = Date.now(), seen, readAsk, readScreen = async () => '', head = gitHead, closeCheck = unsavedFor, prompted = newPromptSince, notify = (note) => bots.notify?.(note) }) {
  const alert = (note) => { try { notify(note); } catch { /* a notification never blocks the events */ } };
  for (const b of bots.list()) {
    // One entry per terminal: a bot that followed the same agent twice is woken once.
    const live = new Map();
    for (const h of b.helpers || []) if (h?.paneId && followActive(h)) live.set(h.paneId, h);
    for (const key of [...seen.keys()]) if (key.startsWith(`${b.id}|`) && !live.has(key.slice(b.id.length + 1))) seen.delete(key);
    for (const h of live.values()) {
      const pane = panes.find((p) => p.id === h.paneId);
      const key = `${b.id}|${h.paneId}`;
      const before = seen.get(key) || {};
      const state = stateOf(pane);
      const label = h.task || h.paneId;
      // "Finished, close it" goes out once per job (politic bot 2026-10-23: two finished terminals
      // that could not be closed woke it ~15 times each, every time every terminal briefly read
      // as busy at once). A new job is the agent's own status saying "working" on two looks in a
      // row, a new message in its own record, or the bot handing it more work; a flicker is none.
      let { finishedAt = 0, blocked = false } = before;
      const workRun = pane?.turn === 'working' ? (before.workRun || 0) + 1 : 0;
      if (finishedAt && state !== 'idle' && (workRun >= 2 || (bots.messages?.(b.id) || []).some((m) => m.role === 'handoff' && m.pane === h.paneId && Number(m.at) > finishedAt) || (pane && prompted(pane, finishedAt)))) { finishedAt = 0; blocked = false; }
      if (before.state === 'working' && state === 'idle') {
        // A follow is for one job: this finished turn ends it, so later turns of that agent stay quiet.
        if (h.followed) {
          bots.endFollow?.(b.id, h.paneId);
          bots.wake(b.id, `The terminal agent you followed ("${label}") has finished its turn, and the follow has now ended. Read its result (termfleet-team read ${h.paneId}) and, only if it is the job you told Noam you would report on, tell him in plain words. Follow it again only if Noam asked you to keep watching it.`);
        } else if (!finishedAt) {
          const files = closeCheck(pane, h);
          blocked = files.length > 0;
          finishedAt = now;
          bots.wake(b.id, `The terminal agent you started for "${label}" has finished. Read its result (termfleet-team read ${h.paneId}), check it, and tell Noam in plain words. ` + (blocked
            ? `It cannot be closed yet: it has unsaved work (${files.slice(0, 3).join(', ')}${files.length > 3 ? ` and ${files.length - 3} more` : ''}). Have it commit, or leave it; you will be told once, when it can be closed. Do not try to close it before that.`
            : `Then close it (termfleet-team close ${h.paneId}) unless you are sending it more work now.`));
        }
      } else if (finishedAt && blocked && state === 'idle' && !closeCheck(pane, h).length) {
        // The one reminder after that: closing has become possible.
        blocked = false;
        bots.wake(b.id, `The finished terminal agent for "${label}" has no unsaved work any more, so it can be closed now: termfleet-team close ${h.paneId} (unless you are sending it more work).`);
      }
      // One card per prompt until Noam answers it (Noam 2026-10-22: "להשאיר את אותה אחת עד
      // שאני אענה"). The open card lives in the chat itself, so a restart or a re-detected
      // prompt with a new id finds it; it closes only once the terminal has moved on.
      let open = openTerminalAsk(bots, b.id, h.paneId);
      const screen = pane && (state !== 'idle' || open || before.state !== 'idle') ? String(await readScreen(pane) || '') : '';
      // The status says it moved on, but the menu is still on screen: the prompt is still open.
      const onScreen = state !== 'waiting' && pane ? (screenPromptAsk(pane, screen) || (open && screenStillAsks(screen) ? true : null)) : null;
      const asking = state === 'waiting' || Boolean(onScreen);
      const away = asking ? 0 : (before.away || 0) + 1;
      if (open && away >= 2) { settleTerminalAsk(bots, b.id, open.id, {}); open = null; }
      if (asking) {
        const ask = state === 'waiting' ? await readAsk(pane) : (onScreen === true ? null : onScreen);
        if (ask?.id && open && samePrompt(open, ask)) {
          if (open.askId !== ask.id) settleTerminalAsk(bots, b.id, open.id, { askId: ask.id }, false);
        } else if (ask?.id && open && open.kind === 'permission' && ask.kind === 'permission' && menuForm(open) !== menuForm(ask)) {
          // The same permission read two ways (the menu on screen, "Do you want to make this edit…?"
          // 1/2/3, or the record's "Allow Edit?" Yes/No): the card follows it in place. Before, every
          // flip ended the card, posted a new one and woke the bot again (four cards in an hour).
          const fresh = terminalAskMessage(h.paneId, label, ask);
          settleTerminalAsk(bots, b.id, open.id, { askId: fresh.askId, text: fresh.text, options: fresh.options, detail: fresh.detail }, false);
        } else if (ask?.id) {
          if (open) settleTerminalAsk(bots, b.id, open.id, {});
          open = bots.append(b.id, terminalAskMessage(h.paneId, label, ask));
          bots.wake(b.id, `Your terminal agent for "${label}" is waiting for Noam: "${String(ask.title || '').slice(0, 160)}". The prompt and its buttons are pinned at the bottom of his chat with you until he answers, his phone was notified, and he is reminded after 5 minutes; his tap goes straight to that terminal. Tell him in one or two plain sentences what it is about and what you recommend. Never answer it yourself, and send nothing to that terminal while it waits.`);
          alert({ title: `${b.name}: a terminal is waiting for you`, body: `"${label}" asks: ${String(ask.title || '').slice(0, 160)}`, url: `/#bot:${b.id}` });
        }
        // Unanswered: remind him after 5 minutes, then every 15, up to MAX_REMINDERS times.
        // After that, stop — hours of buzzing is noise, not signal.
        if (open?.at) {
          const count = Number(open.reminderCount || 0);
          if (count < MAX_REMINDERS) {
            const last = Number(open.remindedAt || open.at);
            if (now - last >= (open.remindedAt ? REMIND_EVERY_MS : REMIND_AFTER_MS)) {
              const minutes = Math.max(1, Math.round((now - Number(open.at)) / 60_000));
              settleTerminalAsk(bots, b.id, open.id, { remindedAt: now, reminderCount: count + 1 }, false);
              bots.append(b.id, { role: 'reminder', pane: h.paneId, card: open.id, text: `Still waiting for your answer (${minutes} min): "${String(open.text || '').slice(0, 160)}"` });
              alert({ title: `${b.name}: still waiting for you (${minutes} min)`, body: `"${label}" asks: ${String(open.text || '').slice(0, 160)}`, url: `/#bot:${b.id}`, force: true });
            }
          }
        }
      }
      // Stopped on an error, a limit or a blocked command: Noam hears it now, once per problem.
      let { stuck = null } = before;
      if (state === 'idle' && pane) {
        const found = stuckOnScreen(screen);
        const stuckKey = found ? `${found.kind}|${found.line}` : null;
        if (found && stuckKey !== stuck) {
          const what = { error: 'stopped on an error', limit: 'stopped on a usage limit', blocked: 'was blocked' }[found.kind];
          bots.append(b.id, { role: 'stuck', pane: h.paneId, text: `Terminal "${label}" ${what}: ${found.line}` });
          bots.wake(b.id, `Your terminal agent for "${label}" ${what}: "${found.line}". Noam already sees this line in his chat. Read it (termfleet-team read ${h.paneId}), then tell him in plain words what is wrong and what you will do about it.`);
          alert({ title: `${b.name}: a terminal is stuck`, body: `"${label}" ${what}: ${found.line}`.slice(0, 200), url: `/#bot:${b.id}` });
        }
        stuck = stuckKey;
      } else if (state === 'working') stuck = null;
      if (state === 'closed' && away >= 2) seen.delete(key);
      else seen.set(key, { state, away, finishedAt, blocked, workRun, stuck });
    }
    for (const w of bots.watches(b.id)) {
      if (w.paused) continue; // paused when Noam closed the bot; kept so it can be turned back on
      const current = head(w.path);
      if (!current) continue;
      if (w.head && w.head !== current) bots.wake(b.id, `New code landed in ${w.path} (commit ${current.slice(0, 8)}). Look at what changed and act on it if it concerns your job.`);
      if (w.head !== current) bots.setWatch(b.id, { path: w.path, head: current });
    }
  }
}
