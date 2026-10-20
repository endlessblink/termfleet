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
const BLOCK = /\[question\]\s*\n([\s\S]*?)\n\s*\[\/question\]\s*/i;
const OPTION = /^\s*(?:[-*•]|\d+[.)])\s+(.+?)\s*$/;
const RECOMMENDED = /\s*\((?:recommended|my recommendation)\)\s*$/i;

export function parseQuestion(reply) {
  const text = String(reply || '');
  const m = BLOCK.exec(text);
  if (!m) return { text, question: null };
  const asked = [], options = [];
  let recommended = null;
  for (const line of m[1].split('\n')) {
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

/** The rule every bot gets, so any question to Noam arrives as a card, in English. */
export const QUESTION_RULE = [
  '- Questions to Noam: every time you ask him something (a choice, a yes/no, a clarification, each question in a skill such as grill-me), ask it in English as a question card. Put the question at the END of your message in exactly this form, one question per message, then stop and wait:',
  '  [question]',
  '  <the question in one or two short English sentences>',
  '  - <short answer> (recommended)',
  '  - <short answer>',
  '  [/question]',
  '  Give 2 to 4 short answers and mark the one you recommend with "(recommended)". He taps one or writes his own; it arrives as his next message.',
].join('\n');
