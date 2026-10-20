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
export function collectWaiting({ panes = [], bots = [], asksOf = () => null }) {
  const items = [];
  const ready = (who, kind, id, go) => {
    for (const a of asksOf({ kind, id }) || []) {
      if (a.status !== 'ready') continue;
      items.push({ key: `ready:${kind}:${id}:${a.n}`, kind: 'try', source: kind, who, what: plainAsk(a.text), todo: clip(a.note, 120), go, n: a.n });
    }
  };
  for (const b of bots) {
    if (b.hidden) continue;
    if (b.blocked?.ask) items.push({ key: `botask:${b.id}:${hash(b.blocked.ask)}`, kind: 'answer', source: 'bot', who: clip(b.name, 40), what: clip(b.blocked.ask, 140), todo: 'Answer it in the chat', go: `#bot:${b.id}` });
    ready(clip(b.name, 40), 'bot', b.id, `#bot:${b.id}`);
  }
  for (const p of panes) {
    if (p.alive === false) continue;
    if (p.turn === 'waiting' || p.attention) {
      const approval = /permission|approv|allow/i.test(String(p.attention?.title || p.attention?.kind || ''));
      items.push({ key: `term:${p.id}:${hash(p.attention?.title || 'waiting')}`, kind: approval ? 'approve' : 'answer', source: 'terminal', who: paneName(p), what: clip(p.attention?.title || 'Waiting for your answer', 140), todo: approval ? 'Approve or decline it' : 'Answer it', go: `#${p.id}` });
    }
    ready(paneName(p), 'terminal', p.id, `#${p.id}`);
  }
  // Things to answer first (they block an agent), then things to try.
  const order = { approve: 0, answer: 1, try: 2 };
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
    for (const i of fresh) {
      const title = i.kind === 'try' ? `Ready for you: ${i.who}` : `${i.who} is waiting for you`;
      const body = i.kind === 'try' ? `${i.what}\nTry: ${i.todo}` : `${i.what}\n${i.todo}`;
      await Promise.allSettled([push({ title, body, url: `/${i.go}` }), desktop({ title, body })]);
    }
    return fresh;
  };
}

/** A desktop notification on the computer (Noam: "this must be reachable on the computer too"). */
export function desktopNotify({ title, body }) {
  return new Promise((resolve) => execFile('notify-send', ['--app-name=TermFleet', '--icon=termfleet', String(title).slice(0, 80), String(body).slice(0, 240)], { timeout: 5000 }, () => resolve()));
}
