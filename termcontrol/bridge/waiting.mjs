import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';

/**
 * "Waiting for you" (Noam 2026-10-20: "I need this from every agent when something waits
 * for me: a short summary that keeps itself up to date, with exactly what to do"). One list
 * gathered from every bot and every terminal: things built and ready for him to try (a
 * request marked `termfleet-asks ready`), terminals waiting for an answer or an approval,
 * and bots that stopped to ask him something. Each item says who, what, and what to do.
 */
const clip = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const hash = (s) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 10);
// A terminal is named by its project (its first message is often a long relayed brief).
const paneName = (p) => clip(p.project || path.basename(String(p.cwd || '')) || p.title || 'Terminal', 40);
/** A request in his own words: relay wrappers and pasted-text tags removed. */
export function plainAsk(text) {
  let t = String(text || '').replace(/<\/?pasted_content[^>]*>/g, ' ');
  t = t.replace(/^\s*\[Message from [^\]]*\]\s*/i, '');
  const his = /his words:\s*["“]([^"”]{3,})["”]/i.exec(t);
  return clip(his ? his[1] : t, 140);
}

/**
 * @param panes   terminals as the service lists them (id, title, project, turn, attention)
 * @param bots    bot summaries (id, name, hidden, blocked)
 * @param asksOf  ({kind, id}) => that conversation's requests, or null
 */
// Only what blocks work until Noam acts. Things built and ready to try are NOT listed
// (Noam 2026-10-20, pointing at the Try rows: "this shouldn't be in the list at all").
// `daemon: false` means the terminal service could not be reached, so the panes handed in are
// only old status records (every terminal ever, closed ones too). Then what the terminals were
// waiting for stays exactly as last seen in `previous` (TF-099: the list jumped to old ghosts
// and reset seconds later). Bot items do not depend on it and are always read fresh.
export function collectWaiting({ panes = [], bots = [], daemon = true, previous = [] }) {
  const items = [];
  for (const b of bots) {
    if (b.hidden) continue;
    if (b.blocked?.ask) items.push({ key: `botask:${b.id}:${hash(b.blocked.ask)}`, kind: 'answer', source: 'bot', who: clip(b.name, 40), what: clip(b.blocked.ask, 140), todo: 'Answer it in the chat', go: `#bot:${b.id}` });
  }
  // A terminal a bot started is that bot's work: listed once, named by the bot, and opening
  // the terminal where the prompt is on screen (Noam: "duplicates of the same thing").
  const ownerOf = new Map();
  for (const b of bots) for (const h of b.helpers || []) if (h?.paneId) ownerOf.set(h.paneId, b);
  const seen = new Set();
  if (daemon === false) items.push(...previous.filter((i) => i.source === 'terminal'));
  else for (let p of panes) {
    if (p.alive === false) continue;
    const owner = ownerOf.get(p.id);
    if (owner?.hidden) continue;
    const dup = `${owner?.id || p.id}:${p.attention?.title || ''}`;
    if (p.attention && seen.has(dup)) continue;
    seen.add(dup);
    if (owner) p = { ...p, project: owner.name };
    // Only a real question or approval prompt. A terminal that just finished its turn is idle,
    // not waiting for him (Noam 2026-10-20: "I'm drowning in notifications I don't need").
    if (p.attention) {
      const approval = /permission|approv|allow/i.test(String(p.attention?.title || p.attention?.kind || ''));
      items.push({ key: `term:${p.id}:${hash(p.attention?.title || 'waiting')}`, kind: approval ? 'approve' : 'answer', source: 'terminal', who: paneName(p), what: clip(p.attention?.title || 'Waiting for your answer', 140), todo: approval ? 'Approve or decline it' : 'Answer it', go: `#${p.id}` });
    }
  }
  // Approvals first, then questions.
  const order = { approve: 0, answer: 1 };
  return items.sort((a, b) => order[a.kind] - order[b.kind]);
}

/** One phone push and one desktop notification per item the first time it appears. */
export function createWaitingNotifier({ file, push = async () => {}, desktop = desktopNotify, now = () => Date.now() } = {}) {
  let seen = null;
  const load = () => { try { return new Set(JSON.parse(fs.readFileSync(file, 'utf8')).seen || []); } catch { return null; } };
  const save = () => { try { fs.mkdirSync(path.dirname(file), { recursive: true }); const tmp = `${file}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify({ seen: [...seen].slice(-500), at: now() }), { mode: 0o600 }); fs.renameSync(tmp, file); } catch { /* best effort */ } };
  return async function notifyNew(items) {
    if (!seen) {
      seen = load();
      // The very first run only learns what is already there: no burst of old news.
      if (!seen) { seen = new Set(items.map((i) => i.key)); save(); return []; }
    }
    const fresh = items.filter((i) => !seen.has(i.key));
    for (const i of fresh) seen.add(i.key);
    // Forget items that are gone, so the same thing coming back later is news again.
    const live = new Set(items.map((i) => i.key));
    for (const k of [...seen]) if (!live.has(k)) seen.delete(k);
    if (fresh.length || seen.size !== live.size) save();
    // Only what blocks work until he acts notifies; things ready to try wait quietly in the
    // list (Noam: "I know I need to check things, it isn't urgent"). Several at once = one.
    const blocking = fresh.filter((i) => i.kind !== 'try');
    if (blocking.length === 1) {
      const [i] = blocking;
      await Promise.allSettled([push({ title: `${i.who} is waiting for you`, body: `${i.what}\n${i.todo}`, url: `/${i.go}` }), desktop({ title: `${i.who} is waiting for you`, body: `${i.what}\n${i.todo}` })]);
    } else if (blocking.length > 1) {
      const title = `${blocking.length} agents are waiting for you`;
      const body = blocking.slice(0, 5).map((i) => `${i.who}: ${i.what}`).join('\n');
      await Promise.allSettled([push({ title, body, url: '/' }), desktop({ title, body })]);
    }
    return blocking;
  };
}

/** A desktop notification on the computer (Noam: "this must be reachable on the computer too"). */
export function desktopNotify({ title, body }) {
  return new Promise((resolve) => execFile('notify-send', ['--app-name=TermFleet', '--icon=termfleet', String(title).slice(0, 80), String(body).slice(0, 240)], { timeout: 5000 }, () => resolve()));
}
