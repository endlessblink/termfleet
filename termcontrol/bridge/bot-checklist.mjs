/**
 * The bots' list tool (Noam 2026-10-22, pc-helper chat: "זו צריכה להיות רשימה אינטרקטיבית
 * שאני יכול לסמן / ללחוץ / להוסיף הערות"). A bot sends rows for him to tick by ending its
 * reply with a block like
 *
 *   [checklist]
 *   Which idle terminals should I close?
 *   - [x] rough-cut-mvp | video editing | idle 3 hours
 *   - [ ] health-app | health app
 *   [/checklist]
 *
 * The bridge lifts it into { title, rows: [{ label, detail[], checked }] }; the chat shows
 * one row per line he can tick or tap, a note per row, an overall note and one Send.
 * His Send arrives as his own message, written by checklistAnswer. Same plain-text idea
 * (and the same Hebrew/direction-mark tolerance) as the [question] card.
 */
const MARKS = /[‎‏‪-‮⁦-⁩]/g;
const M = '[\\u200e\\u200f\\u202a-\\u202e\\u2066-\\u2069]*';
const TAG = '(?:checklist|רשימה)';
const BLOCK = new RegExp(`(?:\`\`\`[a-z]*[ \\t]*\\r?\\n)?${M}\\[${TAG}\\]${M}\\s*\\n([\\s\\S]*?)\\n\\s*${M}\\[\\/${TAG}\\]${M}[ \\t]*(?:\\r?\\n\\s*\`\`\`)?\\s*`, 'i');
const ROW = /^\s*(?:[-*•–]|\d+[.)])\s+(?:\[( |x|X|✓|v)?\]\s*)?(.+?)\s*$/;
const MAX_ROWS = 40;

export function parseChecklist(reply) {
  const text = String(reply || '');
  const m = BLOCK.exec(text);
  if (!m) return { text, checklist: null };
  const title = [], rows = [];
  for (const line of m[1].replace(MARKS, '').split('\n')) {
    const row = ROW.exec(line);
    if (row) {
      if (rows.length >= MAX_ROWS) continue;
      // Columns split on " | "; a single " — " also separates the name from its detail.
      let parts = row[2].split(/\s+\|\s+/).map((s) => s.trim()).filter(Boolean);
      if (parts.length === 1) parts = parts[0].split(/\s+[—–]\s+/).map((s) => s.trim()).filter(Boolean);
      if (!parts.length) continue;
      rows.push({ label: parts[0].slice(0, 200), detail: parts.slice(1, 4).map((s) => s.slice(0, 200)), checked: Boolean(row[1] && row[1] !== ' ') });
    } else if (line.trim()) title.push(line.trim());
  }
  if (!rows.length) return { text, checklist: null };
  return {
    text: (text.slice(0, m.index) + text.slice(m.index + m[0].length)).trim(),
    checklist: { title: title.join('\n').slice(0, 600), rows },
  };
}

/** His choices as one plain message the bot can act on: ticked, not ticked, his notes. */
export function checklistAnswer(list, { checked = [], notes = [], note = '' } = {}) {
  const line = (r, i) => `- ${r.label}${String(notes[i] || '').trim() ? ` (my note: ${String(notes[i]).trim()})` : ''}`;
  const on = [], off = [];
  list.rows.forEach((r, i) => (checked[i] ? on : off).push(line(r, i)));
  return [
    `My choices on your list${list.title ? ` "${list.title.split('\n')[0]}"` : ''}:`,
    `Ticked (${on.length}):`, ...(on.length ? on : ['- none']),
    `Not ticked (${off.length}):`, ...(off.length ? off : ['- none']),
    ...(String(note).trim() ? [`My note: ${String(note).trim()}`] : []),
  ].join('\n');
}

const CARD = /\[(?:checklist|רשימה|question|שאלה)\][\s\S]*?\[\/(?:checklist|רשימה|question|שאלה)\]/i;
/**
 * Claude keeps only the last text of a turn, so a list or question written before the bot's
 * last step never reached Noam ("לא רואה רשימה"). The newest card from earlier in the turn is
 * added to the final reply when that reply has none of its own.
 */
export function carryCard(finalText, earlier = []) {
  const text = String(finalText || '');
  if (CARD.test(text.replace(MARKS, ''))) return text;
  for (let i = earlier.length - 1; i >= 0; i--) {
    const card = CARD.exec(String(earlier[i] || '').replace(MARKS, ''));
    if (card) return text ? `${text}\n\n${card[0].trim()}` : card[0].trim();
  }
  return text;
}

/** The rule every bot gets, next to the question tool. */
export const CHECKLIST_RULE = [
  '- Your list tool: when Noam should pick several items from a list (what to close, keep, approve, fix), never send a table or a numbered list for him to answer by typing. End your message with this block; the chat shows each row with a tick box, a note box per row, an overall note and one Send button, on the PC and the phone:',
  '  [checklist]',
  '  <one short line saying what the ticks mean, e.g. "Tick the terminals to close">',
  '  - [x] <name> | <short detail> | <another short detail>   (ticked in advance = your suggestion)',
  '  - [ ] <name> | <short detail>',
  '  [/checklist]',
  '  Up to 40 rows, one card per message, in your FINAL message (text you write before using a tool is not shown to him). His choices arrive as his next message, listing ticked rows, unticked rows and his notes. Keep [checklist] and [/checklist] exactly as written, each on its own line, not in a code block.',
].join('\n');
