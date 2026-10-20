import fs from 'node:fs';
import path from 'node:path';

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
  const ids = new Set((bot.helpers || []).filter((h) => h?.paneId && now - Number(h.at || 0) < 12 * 3600_000).map((h) => h.paneId));
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

export async function checkBotEvents({ bots, panes, now = Date.now(), seen, readAsk, head = gitHead }) {
  for (const b of bots.list()) {
    for (const h of b.helpers || []) {
      const pane = panes.find((p) => p.id === h.paneId);
      const key = `${b.id}|${h.paneId}`;
      const before = seen.get(key) || {};
      const state = stateOf(pane);
      const label = h.task || h.paneId;
      if (before.state === 'working' && state === 'idle') {
        bots.wake(b.id, h.followed
          ? `The terminal agent you are following ("${label}") has finished its turn. Read its result (termfleet-team read ${h.paneId}), do what you told Noam you would do next, and tell him in plain words.`
          : `The terminal agent you started for "${label}" has finished. Read its result (termfleet-team read ${h.paneId}), check it, and tell Noam in plain words.`);
      }
      let posted = state === 'waiting' ? before.posted || null : null;
      if (state === 'waiting') {
        const ask = await readAsk(pane);
        if (ask?.id && ask.id !== posted) {
          posted = ask.id;
          bots.append(b.id, terminalAskMessage(h.paneId, label, ask));
          bots.wake(b.id, `Your terminal agent for "${label}" is waiting for Noam: "${String(ask.title || '').slice(0, 160)}". The prompt and its buttons are already shown to Noam in this chat; his tap goes straight to that terminal. Tell him in one or two plain sentences what it is about and what you recommend. Never answer it yourself, and send nothing to that terminal while it waits.`);
        }
      }
      if (state === 'closed') seen.delete(key);
      else seen.set(key, { state, posted });
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
