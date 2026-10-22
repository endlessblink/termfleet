import fs from 'node:fs';
import path from 'node:path';
import { followActive } from './follows.mjs';

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
export function helperState(bot, panes, now = Date.now()) {
  const ids = new Set((bot.helpers || []).filter((h) => h?.paneId && followActive(h) && now - Number(h.at || 0) < 12 * 3600_000).map((h) => h.paneId));
  let waitingOn = 0, helpersAsking = 0;
  for (const id of ids) {
    const state = stateOf(panes.find((p) => p.id === id));
    if (state === 'working') waitingOn++;
    else if (state === 'waiting') helpersAsking++;
  }
  return { waitingOn, helpersAsking };
}

/** The prompt as the bot chat shows it: the same choices the terminal offers. */
export function terminalAskMessage(paneId, label, ask) {
  return {
    role: 'terminal-ask', pane: paneId, label, askId: ask.id, kind: ask.kind,
    text: String(ask.title || 'The terminal agent is asking you something.').slice(0, 300),
    ...(ask.detail ? { detail: String(ask.detail).slice(0, 400) } : {}),
    options: ask.multiSelect ? [] : (ask.options || []).map((o) => ({ key: o.key, label: o.label })),
  };
}

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

export async function checkBotEvents({ bots, panes, now = Date.now(), seen, readAsk, head = gitHead }) {
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
      if (before.state === 'working' && state === 'idle') {
        // A follow is for one job: this finished turn ends it, so later turns of that agent stay quiet.
        if (h.followed) bots.endFollow?.(b.id, h.paneId);
        bots.wake(b.id, h.followed
          ? `The terminal agent you followed ("${label}") has finished its turn, and the follow has now ended. Read its result (termfleet-team read ${h.paneId}) and, only if it is the job you told Noam you would report on, tell him in plain words. Follow it again only if Noam asked you to keep watching it.`
          : `The terminal agent you started for "${label}" has finished. Read its result (termfleet-team read ${h.paneId}), check it, and tell Noam in plain words. Then close it (termfleet-team close ${h.paneId}) unless you are sending it more work now.`);
      }
      // One card per prompt until Noam answers it (Noam 2026-10-22: "להשאיר את אותה אחת עד
      // שאני אענה"). The open card lives in the chat itself, so a restart or a re-detected
      // prompt with a new id finds it; it closes only once the terminal has moved on.
      const open = openTerminalAsk(bots, b.id, h.paneId);
      const away = state === 'waiting' ? 0 : (before.away || 0) + 1;
      if (open && away >= 2) settleTerminalAsk(bots, b.id, open.id, {});
      if (state === 'waiting') {
        const ask = await readAsk(pane);
        if (ask?.id && open && samePrompt(open, ask)) {
          if (open.askId !== ask.id) settleTerminalAsk(bots, b.id, open.id, { askId: ask.id }, false);
        } else if (ask?.id) {
          if (open) settleTerminalAsk(bots, b.id, open.id, {});
          bots.append(b.id, terminalAskMessage(h.paneId, label, ask));
          bots.wake(b.id, `Your terminal agent for "${label}" is waiting for Noam: "${String(ask.title || '').slice(0, 160)}". The prompt and its buttons are already shown to Noam in this chat; his tap goes straight to that terminal. Tell him in one or two plain sentences what it is about and what you recommend. Never answer it yourself, and send nothing to that terminal while it waits.`);
        }
      }
      if (state === 'closed' && away >= 2) seen.delete(key);
      else seen.set(key, { state, away });
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
