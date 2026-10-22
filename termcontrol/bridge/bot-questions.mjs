/**
 * The bots' question tool (Noam 2026-10-20: "use the question tool always + in
 * english for grill me and any other questions"). A bot asks by ending its reply
 * with a block like
 *
 *   [question]
 *   Where should the bots run?
 *   - Contabo VPS (recommended)
 *   - This PC
 *   [/question]
 *
 * Plain text works for every brain (Claude, Codex, OpenCode). The bridge lifts the
 * block out of the reply into { text, options, recommended }; the chat shows it as a
 * card with one button per answer plus "write my own", and a tap is sent back as
 * Noam's next message. A block with fewer than two answers stays as plain text.
 */
// A card written in a Hebrew conversation (Noam 2026-10-21) carries invisible direction
// marks, Hebrew tags or a code fence around it; all still count as the same card.
const MARKS = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
const M = '[\\u200e\\u200f\\u202a-\\u202e\\u2066-\\u2069]*';
const TAG = '(?:question|שאלה)';
const BLOCK = new RegExp(`(?:\`\`\`[a-z]*[ \\t]*\\r?\\n)?${M}\\[${TAG}\\]${M}\\s*\\n([\\s\\S]*?)\\n\\s*${M}\\[\\/${TAG}\\]${M}[ \\t]*(?:\\r?\\n\\s*\`\`\`)?\\s*`, 'i');
const OPTION = /^\s*(?:[-*•–—]|\d+[.)])\s+(.+?)\s*$/;
const RECOMMENDED = /\s*\((?:recommended|my recommendation|מומלץ|מומלצת|ההמלצה שלי)\)\s*$/i;

export function parseQuestion(reply) {
  const text = String(reply || '');
  const m = BLOCK.exec(text);
  if (!m) return { text, question: null };
  const asked = [], options = [];
  let recommended = null;
  for (const line of m[1].replace(MARKS, '').split('\n')) {
    const opt = OPTION.exec(line);
    if (opt && options.length < 4) {
      const label = opt[1].replace(RECOMMENDED, '').trim().slice(0, 200);
      if (!label) continue;
      if (RECOMMENDED.test(opt[1]) && recommended === null) recommended = options.length;
      options.push(label);
    } else if (!opt && line.trim()) asked.push(line.trim());
  }
  if (options.length < 2 || !asked.length) return { text, question: null };
  return {
    text: (text.slice(0, m.index) + text.slice(m.index + m[0].length)).trim(),
    question: { text: asked.join('\n').slice(0, 1200), options, ...(recommended === null ? {} : { recommended }) },
  };
}

// The same question asked again (Noam 2026-10-20: "the questions show twice for nothing"):
// the words mostly match once a "Question 2:" prefix and punctuation are dropped, or the
// answers are the same and half the words match.
const words = (s) => String(s || '').toLowerCase().replace(/^\s*question\s*\d+\s*[:.)-]\s*/i, '').replace(/[^\p{L}\p{N}\s]+/gu, ' ').split(/\s+/).filter(Boolean);
const overlap = (a, b) => { const A = new Set(words(a)), B = new Set(words(b)); if (!A.size || !B.size) return 0; let n = 0; for (const w of A) if (B.has(w)) n++; return n / Math.max(A.size, B.size); };
const sameAnswers = (a = [], b = []) => a.length === b.length && a.every((o, i) => words(o).join(' ') === words(b[i]).join(' '));
export function sameQuestion(a, b) {
  if (!a || !b) return false;
  const share = overlap(a.text, b.text);
  return share >= 0.8 || (share >= 0.5 && sameAnswers(a.options, b.options));
}

/**
 * Marks a question card that is asked again later, before Noam replied, as `repeated`:
 * the chat then shows only the newest card. His reply in between keeps both.
 */
export function markRepeatedQuestions(messages) {
  return messages.map((m, i) => {
    if (m.role !== 'bot' || !m.question) return m;
    for (const later of messages.slice(i + 1)) {
      if (later.role === 'operator') break;
      if (later.role === 'bot' && sameQuestion(later.question, m.question)) return { ...m, repeated: true };
    }
    return m;
  });
}

/**
 * The same terminal prompt posted twice before Noam replied (Noam 2026-10-22: "אין צורך
 * בהודעות כפולות") shows once, the newest card; the "is waiting for Noam" note repeated
 * with it shows once too.
 */
export function markRepeatedTerminalAsks(messages) {
  const key = (m) => m.role === 'terminal-ask' ? `ask|${m.pane}|${m.text}|${(m.options || []).map((o) => o.label).join('|')}` : m.role === 'event' ? `event|${m.text}` : null;
  return messages.map((m, i) => {
    const k = key(m);
    if (!k) return m;
    for (const later of messages.slice(i + 1)) {
      if (later.role === 'operator') break;
      if (key(later) === k) return { ...m, repeated: true };
    }
    return m;
  });
}

/** The rule every bot gets, so any question to Noam arrives as a card, in English. */
export const QUESTION_RULE = [
  '- Your question tool: every time you ask Noam something (a choice, a yes/no, a clarification, each question in a skill such as grill-me), ask it in English as a question card; the chat turns it into tap buttons. This card IS the bots\' question tool: when Noam says "use the question tool" (in Hebrew: "כלי השאלות"), he means this card. You have no other question tool (no AskUserQuestion), so never tell him bots cannot ask with buttons. Put the question at the END of your message in exactly this form, one question per message, then stop and wait:',
  '  [question]',
  '  <the question in one or two short English sentences>',
  '  - <short answer> (recommended)',
  '  - <short answer>',
  '  [/question]',
  '  Give 2 to 4 short answers and mark the one you recommend with "(recommended)". He taps one or writes his own; it arrives as his next message. Even when the rest of your message is in Hebrew, keep the [question] and [/question] lines exactly as written, each on its own line, and do not put the card inside a code block.',
  '  A question he has not answered yet stays on his screen with its buttons: never ask it again (Noam: "the questions show twice for nothing"). If you are woken before he answers, say in one plain line that you are still waiting for his answer above, with no new card.',
].join('\n');
