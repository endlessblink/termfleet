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
import { cardLink } from './question-view.mjs';

// A card written in a Hebrew conversation (Noam 2026-10-21) carries invisible direction
// marks, Hebrew tags or a code fence around it; all still count as the same card.
const MARKS = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
const M = '[\\u200e\\u200f\\u202a-\\u202e\\u2066-\\u2069]*';
const TAG = '(?:question|שאלה)';
const BLOCK = new RegExp(`(?:\`\`\`[a-z]*[ \\t]*\\r?\\n)?${M}\\[${TAG}\\]${M}\\s*\\n([\\s\\S]*?)\\n\\s*${M}\\[\\/${TAG}\\]${M}[ \\t]*(?:\\r?\\n\\s*\`\`\`)?\\s*`, 'i');
const OPTION = /^\s*(?:[-*•–—]|\d+[.)])\s+(.+?)\s*$/;
const RECOMMENDED = /\s*\((?:recommended|my recommendation|מומלץ|מומלצת|ההמלצה שלי)\)\s*$/i;
// Links on the card (Noam 2026-10-24: "שתמיד יהיה לינק עם אופציות"): a "link: <address or
// file>" line opens the comparison, "- Look A | <link>" opens that one answer's preview.
const LINK_LINE = /^\s*(?:link|links|open to compare|compare|preview|קישור|לינק)\s*:\s*(\S+)\s*$/i;
const OPTION_LINK = /^(.*?)\s+\|\s+(\S+)\s*$/;
const URL_IN_TEXT = /https?:\/\/[^\s<>"')\]]+/i;

export function parseQuestion(reply, linkOpts) {
  const text = String(reply || '');
  const m = BLOCK.exec(text);
  if (!m) return { text, question: null };
  const asked = [], options = [], optionLinks = [];
  let recommended = null, link = null;
  for (const line of m[1].replace(MARKS, '').split('\n')) {
    const linked = LINK_LINE.exec(line);
    if (linked) { link = link || cardLink(linked[1], linkOpts); continue; }
    const opt = OPTION.exec(line);
    if (opt && options.length < 4) {
      const isRecommended = RECOMMENDED.test(opt[1]);
      let label = opt[1].replace(RECOMMENDED, '').trim(), own = null;
      const split = OPTION_LINK.exec(label);
      if (split) { own = cardLink(split[2].replace(RECOMMENDED, ''), linkOpts); if (own) label = split[1].replace(RECOMMENDED, '').trim(); }
      label = label.slice(0, 200);
      if (!label) continue;
      if ((isRecommended || RECOMMENDED.test(split?.[1] || '')) && recommended === null) recommended = options.length;
      options.push(label);
      optionLinks.push(own);
    } else if (!opt && line.trim()) asked.push(line.trim());
  }
  if (options.length < 2 || !asked.length) return { text, question: null };
  const rest = (text.slice(0, m.index) + text.slice(m.index + m[0].length)).trim();
  // A link written in the question itself, or in the reply just above the card, opens it too.
  link = link || cardLink((URL_IN_TEXT.exec(asked.join(' ')) || [])[0], linkOpts) || cardLink((URL_IN_TEXT.exec(rest) || [])[0], linkOpts);
  return {
    text: rest,
    question: { text: asked.join('\n').slice(0, 1200), options, ...(recommended === null ? {} : { recommended }), ...(link ? { link } : {}), ...(optionLinks.some(Boolean) ? { optionLinks } : {}) },
  };
}

// A choice between things to look at (looks, designs, versions, pages, pictures…): he cannot
// pick what he cannot see, so such a card needs a link (Noam 2026-10-24).
const VIEWABLE = /\b(?:looks?|designs?|versions?|mock-?ups?|layouts?|styles?|themes?|palettes?|colou?r (?:options?|schemes?)|previews?|images?|pictures?|photos?|logos?|banners?|thumbnails?|covers?|icons?|comparison|compare|variants?|directions?|concepts?|sketch(?:es)?)\b|(?:עיצוב|גרס|מראה|תמונ|השווא|לוגו|באנר|סקיצ|כיוון)/i;
const CHOOSING = /\b(?:which|pick|choose|prefer|continue with|go with|keep|between)\b|(?:איזה|איזו|איזהו|לבחור|תבחר|להמשיך עם)/i;
const LABELLED = /^(?:looks?|versions?|options?|designs?|mock-?ups?|directions?|variants?|styles?|concepts?|drafts?|layouts?|themes?|palettes?|עיצוב|גרסה|כיוון|אפשרות)\s*[A-Za-z0-9א-ת](?:\b|$)/i;
export function needsLink(q) {
  if (!q || q.link || (q.optionLinks || []).some(Boolean)) return false;
  const text = String(q.text || '');
  return (CHOOSING.test(text) && VIEWABLE.test(text)) || (q.options || []).filter((o) => LABELLED.test(String(o).trim())).length >= 2;
}

// The bot takes a question back (Noam 2026-10-24: an old Look A/B/C card stayed live after
// "ignore the question above"): the card shows as no longer needed, its buttons off.
const WITHDRAWS = /\b(?:ignore|disregard|skip|forget)\b[^.\n]{0,40}\bquestions?\b|\bquestions?\b[^.\n]{0,30}\b(?:is|are)\s+no longer\s+(?:needed|relevant)|\bno longer need (?:an |your )?answer|(?:תתעלם|התעלם|תתעלמו|התעלמו)[^.\n]{0,20}שאלה|השאלה[^.\n]{0,20}(?:כבר לא רלוונטית|לא נחוצה)/i;
export const withdrawsQuestion = (text) => WITHDRAWS.test(String(text || ''));
export function markWithdrawnQuestions(messages) {
  const out = messages.map((m) => m);
  messages.forEach((m, i) => {
    if (m.role !== 'bot' || !withdrawsQuestion(m.text)) return;
    // Earlier cards still waiting for him (none after his last reply) are withdrawn...
    for (let j = i - 1; j >= 0; j--) {
      const e = messages[j];
      if (e.role === 'operator') break;
      if (e.role === 'bot' && e.question) out[j] = { ...out[j], withdrawn: true };
    }
    // ...and the same card re-attached to the message that takes it back.
    if (m.question) {
      for (let j = 0; j < i; j++) {
        const earlier = messages[j];
        if (earlier.role === 'bot' && sameQuestion(earlier.question, m.question)) { out[i] = { ...out[i], withdrawn: true }; break; }
      }
    }
  });
  return out;
}

// The same question asked again (Noam 2026-10-20: "the questions show twice for nothing"):
// the words mostly match once a "Question 2:" prefix and punctuation are dropped, or the
// answers are the same and half the words match.
const words = (s) => String(s || '').toLowerCase().replace(/^\s*question\s*\d+\s*[:.)-]\s*/i, '').replace(/[^\p{L}\p{N}\s]+/gu, ' ').split(/\s+/).filter(Boolean);
const overlap = (a, b) => { const A = new Set(words(a)), B = new Set(words(b)); if (!A.size || !B.size) return 0; let n = 0; for (const w of A) if (B.has(w)) n++; return n / Math.max(A.size, B.size); };
/** A reply that says nearly the same as the one before it (Noam 2026-10-24: "אין שום סיבה לחזרה הזו!!!!"). */
export function nearDuplicate(a, b) {
  const A = words(a), B = words(b);
  if (A.length < 6 || B.length < 6) return false;
  return overlap(a, b) >= 0.8;
}
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
    for (let j = i + 1; j < messages.length; j++) {
      const later = messages[j];
      if (later.role === 'operator') break;
      if (later.role === 'bot' && sameQuestion(later.question, m.question)) return { ...m, repeated: true };
    }
    return m;
  });
}

/** Reconcile durable answers before trimming history. Legacy choice buttons sent
 * the exact option as the next operator message without an answerTo field.
 * Unrelated free text, routed messages and cancelled answers remain ambiguous.
 */
export function markQuestionResolutions(messages) {
  const resolutions = new Map();
  let latest = null;
  for (const m of messages) {
    if (m.role !== 'operator') latest = null;
    if (m.role === 'bot' && m.question) latest = m;
    if (m.role === 'question-resolution' && m.resolution === 'answered')
      resolutions.set(m.questionId, { state: 'answered', source: 'owner', id: m.id, text: '' });
    if (m.role !== 'operator') continue;
    if (m.deleted?.cancelled !== true) {
      if (m.answerTo) resolutions.set(m.answerTo, { state: 'answered', source: 'answerTo', id: m.id, text: m.text });
      else if (latest && !m.from && !m.replyTo && !m.goAheadTo && !m.listTo &&
        latest.question.options?.includes(m.text))
        resolutions.set(latest.id, { state: 'answered', source: 'legacy-exact-choice', id: m.id, text: m.text });
    }
    latest = null;
  }
  return messages.map(m => m.role === 'bot' && m.question && resolutions.has(m.id)
    ? { ...m, questionResolution: resolutions.get(m.id) } : m);
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

/**
 * Messages that waited behind a busy turn which already replied after they arrived (the
 * requirements reminder shows his words to that turn): the next turn must not say it again.
 */
export const NOTHING_NEW = 'NOTHING_NEW';
export const alreadyAnsweredNote = (reply) => `[These messages from Noam arrived while you were busy, and you already replied after they arrived: "${String(reply || '').replace(/\s+/g, ' ').slice(0, 600)}". Do not repeat or re-confirm that reply. Do only what it did not cover yet (for example a picture you have not opened, or a message it did not answer) and say only that. If nothing is new, reply with exactly ${NOTHING_NEW} and nothing else.]`;

/**
 * Pictures, GIFs and videos a bot made, shown right in the chat (Noam 2026-10-24: "כדי שאראה
 * דברים שהוא מג'נרט והוא לא יצטרך לשלוח אותי החוצה"). A file path or web address of one
 * becomes { kind, href, name }; a line that is only that address leaves the text.
 */
const MEDIA_EXT = { png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image', avif: 'image', mp4: 'video', m4v: 'video', webm: 'video', mov: 'video' };
const MEDIA_FIND = /https?:\/\/[^\s<>"'`)\]]+?\.(?:png|jpe?g|webp|gif|avif|mp4|m4v|webm|mov)(?:\?[^\s<>"'`)\]]*)?(?![\w.])|(?<![\w.:/])~?\/(?:[\w.@+-]+\/)+[\w.@+-]+\.(?:png|jpe?g|webp|gif|avif|mp4|m4v|webm|mov)(?![\w.])/gi;
export function mediaKind(href) {
  const clean = String(href || '').split(/[?#]/)[0];
  return MEDIA_EXT[(clean.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase()] || null;
}
export function findMedia(text, linkOpts) {
  const media = [], seen = new Set(), shown = new Set();
  const own = (line) => line.trim().replace(/^[-*•]\s+/, '').replace(/^([`"'])(.*)\1$/, '$2').replace(/^!?\[[^\]]*\]\(\s*<?(.+?)>?\s*\)$/, '$1').trim();
  // A whole path on its own line may contain spaces, parentheses or non-Latin
  // names. Do not tokenize it at whitespace; cardLink still checks the real
  // file, allowed roots and hidden-folder restrictions before signing it.
  const candidates = String(text || '').split('\n').flatMap(line => {
    const full = own(line);
    return [ ...(/^(?:~?\/)/.test(full) && mediaKind(full) ? [full] : []), ...(line.match(MEDIA_FIND) || []) ];
  });
  for (const raw of candidates) {
    const href = cardLink(raw, linkOpts);
    if (!href) continue;
    shown.add(raw);
    if (seen.has(href) || media.length >= 6) continue;
    seen.add(href);
    let name = raw.split(/[?#]/)[0].split('/').pop();
    try { name = decodeURIComponent(name); } catch { /* as written */ }
    media.push({ kind: mediaKind(raw), href, name });
  }
  const rest = String(text || '').split('\n').filter((line) => !shown.has(own(line))).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { text: media.length ? rest : String(text || ''), media };
}
export const MEDIA_RULE = '- To show Noam a picture, GIF or video (something you made, a screenshot, a design), put its full file path or web address on its own line in your message: the chat shows it right there, so he never has to leave the chat to see it. On a question card, `- <answer> | <path or address of its picture or video>` shows that answer\'s picture on the card.';

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
  '  Links (Noam: "always a link with the options, in every conversation"): never ask him to choose between things he cannot see. When the answers are things to look at (looks, designs, versions, pages, mockups, pictures, files, a deploy), add a line `link: <web address or full file path>` under the question for the page that shows them all, and when each answer has its own preview write it as `- <short answer> | <link>`. A file on this PC opens on his phone too. A card about looks or designs with no link is held back until you add one.',
  '  To take a question back (it is no longer needed), say so in one plain line, e.g. "ignore the question above": its card is then marked no longer needed. Never re-attach a card you are taking back.',
].join('\n');
