import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Words the dictation keeps getting wrong, as "heard -> correct" pairs the
 * owner adds himself (2026-10-21: "I need a way to fix common words the
 * transcription model gets wrong"). Kept on the PC so the PC and the phone
 * share one list. Applied to every dictation result, and the correct words
 * are handed to the local model as a hint where it accepts one.
 */
const dir = () => process.env.TC_CONFIG_DIR || path.join(os.homedir(), '.config', 'termcontrol');
const file = () => path.join(dir(), 'word-fixes.json');

export const MAX_FIXES = 300;
const MAX_LEN = 80;

const clean = (value) => (typeof value === 'string' ? value.normalize('NFC').replace(/\s+/g, ' ').trim() : '');
const key = (value) => clean(value).toLocaleLowerCase();

export function readWordFixes() {
  try {
    const saved = JSON.parse(fs.readFileSync(file(), 'utf8'));
    const list = Array.isArray(saved?.fixes) ? saved.fixes : [];
    return list.map((f) => ({ heard: clean(f?.heard), correct: clean(f?.correct) }))
      .filter((f) => f.heard && f.correct && f.heard.length <= MAX_LEN && f.correct.length <= MAX_LEN)
      .slice(0, MAX_FIXES);
  } catch {
    return [];
  }
}

function save(fixes) {
  fs.mkdirSync(dir(), { recursive: true, mode: 0o700 });
  const tmp = file() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ fixes }, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file());
  return fixes;
}

/** Adds or replaces one pair. Returns { fixes } or { error }. */
export function addWordFix(heard, correct) {
  heard = clean(heard); correct = clean(correct);
  if (!heard || !correct) return { error: 'Write both the wrong word and the right one.' };
  if (heard.length > MAX_LEN || correct.length > MAX_LEN) return { error: 'That is too long for a word fix.' };
  if (heard === correct) return { error: 'The two words are the same.' };
  const rest = readWordFixes().filter((f) => key(f.heard) !== key(heard));
  if (rest.length >= MAX_FIXES) return { error: 'The list is full. Remove an old fix first.' };
  return { fixes: save([{ heard, correct }, ...rest]) };
}

export function removeWordFix(heard) {
  const fixes = readWordFixes();
  const rest = fixes.filter((f) => key(f.heard) !== key(heard));
  return { fixes: rest.length === fixes.length ? fixes : save(rest) };
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const HEBREW = /^[֐-׿]/;
// One-letter Hebrew prefixes (and, the, in, to, from, that, like) stay in
// front of a fixed word: "וקלוד" -> "וClaude". Only for words of 3+ letters,
// so a short fix such as "רק" does not eat the middle of "ברק".
const PREFIXES = '[והבלמשכ]{0,2}';

/** Applies every fix as a whole word or phrase, longest first, in one pass. */
export function applyWordFixes(text, fixes = readWordFixes()) {
  if (typeof text !== 'string' || !text || !fixes.length) return { text, changed: 0 };
  const ordered = [...fixes].sort((a, b) => b.heard.length - a.heard.length);
  const byKey = new Map(ordered.map((f) => [key(f.heard), f.correct]));
  const parts = ordered.map((f) => {
    const body = f.heard.split(' ').map(escape).join('\\s+');
    return HEBREW.test(f.heard) && f.heard.length >= 3 ? `(${PREFIXES})(${body})` : `()(${body})`;
  });
  // Each alternative has two groups: prefix, word.
  const pattern = new RegExp(`(?<![\\p{L}\\p{M}\\p{N}_])(?:${parts.join('|')})(?![\\p{L}\\p{M}\\p{N}_])`, 'giu');
  let changed = 0;
  const out = text.replace(pattern, (...m) => {
    const groups = m.slice(1, 1 + parts.length * 2);
    for (let i = 0; i < groups.length; i += 2) {
      if (groups[i + 1] === undefined) continue;
      const correct = byKey.get(key(groups[i + 1]));
      if (correct === undefined) return m[0];
      changed++;
      return groups[i] + correct;
    }
    return m[0];
  });
  return { text: out, changed };
}

/** The correct words as one short hint line for the speech model. */
export function wordFixHint(fixes = readWordFixes(), limit = 400) {
  const seen = new Set(), words = [];
  let size = 0;
  for (const { correct } of fixes) {
    const k = key(correct);
    if (seen.has(k)) continue;
    if (size + correct.length + 2 > limit) break;
    seen.add(k); words.push(correct); size += correct.length + 2;
  }
  return words.join(', ');
}
