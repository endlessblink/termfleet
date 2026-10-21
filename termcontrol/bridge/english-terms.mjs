/**
 * English words inside Hebrew dictation (Noam 2026-10-21: "כשאני מקליט בעברית אבל משתמש
 * במושגים ובמילים באנגלית תוך כדי, הם צריכים להופיע באנגלית בלי שגיאות במקום הנכון").
 * The Hebrew speech model writes them as Hebrew sounds ("קלוד", "אפטר אפקטס"); these
 * put the English word back in the same place. A Hebrew prefix letter stays in front
 * with a dash, as Hebrew writes it: "שקלוד" -> "ש-Claude", "בדשבורד" -> "ב-dashboard".
 * Only names and terms with no Hebrew meaning. Noam's own word-fix list runs first and wins.
 */
export const ENGLISH_TERMS = [
  ['Claude Code', ['קלוד קוד', 'כלוד קוד', 'כלאוד קוד', 'קלאוד קוד']],
  ['Claude', ['קלוד', 'כלוד', 'כלאוד', 'קלאוד']],
  ['Codex', ['קודקס']],
  ['n8n', ['אן אייט אן', 'אן אייטאן', 'אנאייטאן', 'אן 8 אן', 'N8N']],
  ['After Effects', ['אפטר אפקטס', 'אפתר אפקטס', 'אפטר אפקט', 'אפטר-אפקטס']],
  ['Premiere', ['פרימייר', 'פרמייר']],
  ['Photoshop', ['פוטושופ']],
  ['grill me', ['גריל מי', 'גריל me', 'גרילמי']],
  ['dashboard', ['דשבורד', 'דשבורת', 'דאשבורד']],
  ['Rough Cut', ['ראף קאט', 'ראפ קאט', 'רף קאט', 'רעף קאט']],
  ['Freelance Desk', ['פרילנס דסק', 'פרילנס, דסק', 'פרילנס-דסק']],
  ['TermFleet', ['טרמפליט', 'טרם פליט', 'טרמ פליט']],
  ['workflow', ['וורקפלו', 'וורק פלו', 'ורקפלו', 'וורקפלואו']],
];

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const HEBREW = /[֐-׿]/;
// One or two Hebrew prefix letters (and, the, in, to, from, that, like).
const PREFIXES = '[והבלמשכ]{0,2}?';
const squash = (s) => s.replace(/[\s,]+/g, ' ').toLocaleLowerCase();

const table = new Map();
for (const [english, heard] of ENGLISH_TERMS) for (const h of heard) table.set(squash(h), english);
const keys = [...table.keys()].sort((a, b) => b.length - a.length);
const pattern = new RegExp(
  `(?<![\\p{L}\\p{M}\\p{N}_])(${PREFIXES})(${keys.map((k) => k.split(' ').map(escape).join(',?\\s+')).join('|')})(?![\\p{L}\\p{M}\\p{N}_])`,
  'giu',
);

/** Puts the English terms back into a Hebrew dictation. English text is left alone. */
export function applyEnglishTerms(text) {
  if (typeof text !== 'string' || !HEBREW.test(text)) return { text, changed: 0 };
  let changed = 0;
  const out = text.replace(pattern, (whole, prefix, word) => {
    const english = table.get(squash(word));
    if (!english) return whole;
    changed++;
    return prefix ? `${prefix}-${english}` : english;
  });
  return { text: out, changed };
}

