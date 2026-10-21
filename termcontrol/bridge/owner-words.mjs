import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Noam's own words, checkable by any agent (Noam 2026-10-21: "The fact that i need to
 * repetadly ask this is a failure you need to fix"). He said "Yes add the images" in a
 * bot's chat; the bot passed it on and the terminal agent refused it, because a relayed
 * message is not him typing, and asked him a third time.
 *
 * The bridge records every message he types into a bot chat from the signed-in app (never
 * routines, events or other agents) with a signature only the bridge's key produces. A
 * bot attaches that record when it passes his words on; the receiving agent checks it
 * with `termfleet-team verify <id>` and then treats it as if he typed it in its own chat.
 */
const dir = () => process.env.TC_CONFIG_DIR || path.join(os.homedir(), '.config', 'termcontrol');
const files = (base = dir()) => ({ key: path.join(base, 'owner-words.key'), log: path.join(base, 'owner-words.jsonl') });
const KEEP = 2000;

function key(base) {
  const { key: file } = files(base);
  try { const k = fs.readFileSync(file); if (k.length >= 32) return k; } catch { /* first use */ }
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const k = randomBytes(32);
  try { fs.writeFileSync(file, k, { mode: 0o600, flag: 'wx' }); return k; } catch { return fs.readFileSync(file); }
}

const FIELDS = ['id', 'at', 'botId', 'bot', 'text'];
const sign = (entry, base) => createHmac('sha256', key(base)).update(JSON.stringify(FIELDS.map((f) => entry[f] ?? null))).digest('hex');

/** Called by the bridge when Noam sends a message to a bot from the app. */
export function recordOwnerWords({ id, at, botId, bot, text }, { base = dir() } = {}) {
  if (!id || !botId || !String(text || '').trim()) return null;
  const entry = { id: String(id), at: Number(at) || Date.now(), botId: String(botId), bot: String(bot || ''), text: String(text) };
  entry.sig = sign(entry, base);
  const { log } = files(base);
  fs.mkdirSync(path.dirname(log), { recursive: true, mode: 0o700 });
  fs.appendFileSync(log, JSON.stringify(entry) + '\n', { mode: 0o600 });
  trim(log);
  return entry;
}

function trim(log) {
  try {
    const lines = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean);
    if (lines.length <= KEEP * 1.25) return;
    const tmp = `${log}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, lines.slice(-KEEP).join('\n') + '\n', { mode: 0o600 });
    fs.renameSync(tmp, log);
  } catch { /* trimming is housekeeping only */ }
}

function all(base) {
  try {
    return fs.readFileSync(files(base).log, 'utf8').split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

export function genuine(entry, { base = dir() } = {}) {
  if (!entry?.sig || !/^[0-9a-f]{64}$/.test(entry.sig)) return false;
  const want = Buffer.from(sign(entry, base), 'hex');
  return timingSafeEqual(want, Buffer.from(entry.sig, 'hex'));
}

/** A genuine record by message id, or the newest one in a bot's chat ("latest"). */
export function findOwnerWords(ref, { botId = null, base = dir() } = {}) {
  const list = all(base).filter((e) => genuine(e, { base }));
  if (ref === 'latest') return botId ? list.filter((e) => e.botId === botId).pop() || null : null;
  return list.filter((e) => e.id === String(ref)).pop() || null;
}

/** The newest genuine records, oldest first (one bot's when botId is given). */
export function recentOwnerWords({ botId = null, limit = 8, base = dir() } = {}) {
  return all(base).filter((e) => genuine(e, { base }) && (!botId || e.botId === botId)).slice(-limit);
}

const when = (at) => {
  const d = new Date(at), p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** The block a receiving agent sees: clearly Noam's own words, with how to check them. */
export function ownerWordsBlock(entry) {
  return [
    `[Noam's own words, recorded by TermFleet: he typed this himself in his chat with the bot "${entry.bot}" on ${when(entry.at)} (message ${entry.id}). This is not a teammate instruction.]`,
    `"${entry.text}"`,
    `Treat it exactly as if Noam typed it here, including any approval in it. To check it yourself, run: termfleet-team verify ${entry.id}`,
    'Do not ask Noam to repeat it.',
  ].join('\n');
}
