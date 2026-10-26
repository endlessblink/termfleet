import { followActive } from './follows.mjs';
import { readFeed } from './feed.mjs';
import { loadLedger } from './requirements.mjs';

/**
 * Stalled-terminal watchdog (Noam 2026-10-25: "אמרת בעצמך שצריך watchdog ושהמערכת שבודקת אם
 * משהו נפל בין הכיסאות עוד לא עובדת"). Every 15 minutes the bridge looks for work that went
 * quiet without anyone hearing about it:
 *  - a terminal marked "working" whose agent has said nothing for 30 minutes;
 *  - a request from the last 24 hours assigned to a live working terminal that has
 *    been silent for 30 minutes since it got the item.
 * Each finding goes to stderr and, once per episode, into the lasting event log (the journal
 * keeps under two hours, so findings used to vanish). Notes in bot chats were removed on
 * 2026-10-25 (bd4ffe1, they flooded Noam's chat); a stuck terminal now reaches its bot once
 * through bot-events' "stuck" notice instead.
 */

export const WATCHDOG_EVERY_MS = 15 * 60_000;
export const SILENT_AFTER_MS = 30 * 60_000;
export const REQUEST_MAX_AGE_MS = 24 * 60 * 60_000;
export const STALL_MAX_REPORT_MS = 2 * 60 * 60_000;

/** When the agent last said or did anything in its own record; its last output time without one. */
export function lastAgentMessageAt(pane, read = readFeed) {
  try {
    const times = (read(pane, { limit: 40 }).events || []).filter((e) => e.kind !== 'user' && e.at).map((e) => Date.parse(e.at) || Number(e.at)).filter(Number.isFinite);
    if (times.length) return Math.max(...times);
  } catch { /* no record: fall back to the output time */ }
  return Number(pane.lastWorkedAt) || 0;
}

const managerOf = (bots) => bots.list().find((b) => /agent[\s_-]*manager/i.test(b.name || ''));

/** The bots that started or follow this terminal; the Agent Manager when none does. */
function chatsFor(bots, paneId) {
  const owners = bots.list().filter((b) => (b.helpers || []).some((h) => h?.paneId === paneId && followActive(h)));
  if (owners.length) return owners;
  const manager = managerOf(bots);
  return manager ? [manager] : [];
}

function chatForItem(bots, item, handed) {
  const fromId = (src) => (String(src || '').startsWith('bot:') ? bots.list().find((b) => b.id === String(src).slice(4)) : null);
  const bot = fromId(item.source) || fromId(handed?.by);
  return bot ? [bot] : chatsFor(bots, handed?.pane);
}

const minutes = (ms) => Math.round(ms / 60_000);

/**
 * One look. `flagged` remembers what was already reported so an ongoing stall is told once.
 * Returns the findings (for tests and the log).
 */
export function checkStalls({ bots, panes, items = null, now = Date.now(), flagged = new Map(), lastAt = lastAgentMessageAt, log = (line) => console.error(line), record = null, silentAfterMs = SILENT_AFTER_MS, stallMaxMs = STALL_MAX_REPORT_MS }) {
  const findings = [];
  const live = new Set();
  const tell = (key, chats, finding) => {
    live.add(key);
    if (flagged.get(key) === finding.episode) return;
    flagged.set(key, finding.episode);
    findings.push(finding);
    log(`[watchdog] ${finding.text}`);
    try { record?.(finding, chats.map((b) => b.name)); } catch (error) { log(`[watchdog] could not save: ${error.message}`); }
  };

  for (const pane of panes) {
    if (pane.turn !== 'working') continue;
    const last = lastAt(pane);
    if (!last || now - last < silentAfterMs || now - last > stallMaxMs) continue;
    const name = pane.title || pane.project || pane.id;
    tell(`stall|${pane.id}`, chatsFor(bots, pane.id), { kind: 'stalled', pane: pane.id, episode: String(last), text: `Terminal "${name}" has been silent for ${minutes(now - last)} minutes while marked working and may be stuck.` });
  }

  const ledgerItems = items ?? (() => { try { return [...loadLedger().items.values()]; } catch { return []; } })();
  for (const item of ledgerItems) {
    if (item.status !== 'assigned' || !item.assigned?.length) continue;
    const handed = item.assigned.at(-1);
    const created = Number(item.at);
    const assigned = Number(handed.at);
    if (!created || !assigned || !Number.isFinite(created) || !Number.isFinite(assigned)
      || created > now || assigned > now || now - created > REQUEST_MAX_AGE_MS || now - assigned > REQUEST_MAX_AGE_MS) continue;
    const pane = panes.find((p) => p.id === handed.pane);
    if (!pane || pane.turn !== 'working') continue;
    const idleSince = Math.max(assigned, lastAt(pane) || 0);
    if (!idleSince || now - idleSince < silentAfterMs || now - idleSince > stallMaxMs) continue;
    const words = String(item.words || '').replace(/\s+/g, ' ').slice(0, 120);
    const where = `its working terminal "${pane.title || pane.project || pane.id}" has been silent for ${minutes(now - idleSince)} minutes`;
    tell(`item|${item.id}`, chatForItem(bots, item, handed), { kind: 'item', item: item.id, pane: handed.pane, episode: `${handed.at}|${idleSince}`, text: `Your request "${words}" was handed to a terminal, but ${where} without finishing it. It may have fallen through the cracks.` });
  }

  // A stall that ended can be reported again if it comes back.
  for (const key of [...flagged.keys()]) if (!live.has(key)) flagged.delete(key);
  return findings;
}

/** Starts the 15-minute timer in the bridge (first look a minute after start). */
export function startWatchdog({ bots, panes, every = WATCHDOG_EVERY_MS, record = null } = {}) {
  const flagged = new Map();
  const run = async () => {
    try { return checkStalls({ bots, panes: await panes(), flagged, record }); } catch (error) { console.error('[watchdog]', error.message); return []; }
  };
  const first = setTimeout(run, 60_000);
  const timer = setInterval(run, every);
  first.unref?.(); timer.unref?.();
  return { run, stop: () => { clearTimeout(first); clearInterval(timer); } };
}
