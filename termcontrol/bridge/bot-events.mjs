import fs from 'node:fs';
import path from 'node:path';

/**
 * TF-096 part 7: things that wake a bot without Noam writing (Grok Bot's event
 * triggers). Checked every 30 seconds by the bridge:
 *  - a terminal agent the bot started has finished;
 *  - one of them has waited 10 minutes on an approval: it is denied, as Grok Bot
 *    does for unattended runs (questions are never answered automatically);
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

export const APPROVAL_EXPIRES_MS = 10 * 60 * 1000;

const stateOf = (pane) => (!pane ? 'closed' : pane.turn === 'waiting' ? 'waiting' : (pane.producing || pane.turn === 'working') ? 'working' : 'idle');

export async function checkBotEvents({ bots, panes, now = Date.now(), seen, readAsk, answer, head = gitHead }) {
  for (const b of bots.list()) {
    for (const h of b.helpers || []) {
      const pane = panes.find((p) => p.id === h.paneId);
      const key = `${b.id}|${h.paneId}`;
      const before = seen.get(key) || {};
      const state = stateOf(pane);
      const label = h.task || h.paneId;
      if (before.state === 'working' && state === 'idle') {
        bots.wake(b.id, `The terminal agent you started for "${label}" has finished. Read its result (termfleet-team read ${h.paneId}), check it, and tell Noam in plain words.`);
      }
      const waitingSince = state === 'waiting' ? (before.waitingSince ?? now) : null;
      let expired = state === 'waiting' ? Boolean(before.expired) : false;
      if (state === 'waiting' && !expired && now - waitingSince >= APPROVAL_EXPIRES_MS) {
        const ask = await readAsk(pane);
        if (ask && ask.kind !== 'question') {
          const result = await answer(pane, ask);
          expired = true;
          bots.wake(b.id, result?.ok
            ? `Your terminal agent for "${label}" waited 10 minutes for an approval nobody gave ("${String(ask.title || '').slice(0, 120)}"), so it was denied. Find another way, or ask Noam if it is really needed.`
            : `Your terminal agent for "${label}" has waited 10 minutes for an approval and it could not be answered automatically. Ask Noam.`);
        }
      }
      if (state === 'closed') seen.delete(key);
      else seen.set(key, { state, waitingSince, expired });
    }
    for (const w of bots.watches(b.id)) {
      const current = head(w.path);
      if (!current) continue;
      if (w.head && w.head !== current) bots.wake(b.id, `New code landed in ${w.path} (commit ${current.slice(0, 8)}). Look at what changed and act on it if it concerns your job.`);
      if (w.head !== current) bots.setWatch(b.id, { path: w.path, head: current });
    }
  }
}
