// Noam 2026-10-27 (Agent-Manager): he asked for "at least 3 mockups from the interface to choose from,
// designed with impeccable". The bot reinterpreted it, built a live change into the real UI and said ready
// with no options shown. Nothing checked the result against what he had asked. This pulls the explicit
// conditions out of his own words (plain rules, no model) and checks a "ready" reply against them.
const NUMBER_WORDS = { שתי: 2, שני: 2, שניים: 2, שתיים: 2, שלוש: 3, שלושה: 3, ארבע: 4, ארבעה: 4, חמש: 5, חמישה: 5, two: 2, three: 3, four: 4, five: 5 };
const THINGS = String.raw`(?:mock-?ups?|options?|variants?|versions?|designs?|directions?|alternatives?|concepts?|מוקאפ\S*|אפשרויות|אופציות|גרסאות|עיצובים|חלופות|כיוונים)`;
const COUNT = new RegExp(String.raw`(?:at least|minimum(?: of)?|לפחות)\s*(\d+|${Object.keys(NUMBER_WORDS).join('|')})\s*(?:different\s+)?${THINGS}|(\d+|${Object.keys(NUMBER_WORDS).join('|')})\s+(?:different\s+)?${THINGS}`, 'i');
const CHOOSE = /to choose from|to pick from|so (?:i|that i) can (?:choose|pick)|\bchoose (?:between|from)\b|לבחור|שאבחר|כדי לבחור|אפשרויות לבחירה/i;
const SKILLS = /(?:\b|[^a-z])(imp\w{0,3}(?:cc?|k)able|frontend-design|emil-design-eng|high-end-visual-design)\b/i;
const NOT_FINAL = /not (?:yet )?(?:live|ready|built)|עוד לא|טרם/i;
// An apology or admission is not a "ready" announcement.
const ADMISSION = /you'?re right|i was wrong|i made a mistake|sorry|טעיתי|אתה צודק|סליחה/i;
const LIVE_BUILD = /\b(?:is live|went live|deployed|shipped|integrated into|built into|merged)\b|שולב|עלה לאוויר|נפרס|הוטמע/i;

const asNumber = (raw) => (/^\d+$/.test(raw) ? Number(raw) : NUMBER_WORDS[raw.toLowerCase()] || 0);

/** The explicit conditions in his words: {min?, choose, skill?}. Empty object when he stated none. */
export function extractConditions(texts) {
  const out = {};
  for (const text of [].concat(texts || []).map(String)) {
    const m = COUNT.exec(text);
    const n = m ? asNumber(m[1] || m[2]) : 0;
    if (n >= 2 && n <= 12) out.min = Math.max(out.min || 0, n);
    if (CHOOSE.test(text)) out.choose = true;
    const s = SKILLS.exec(text);
    if (s) out.skill = /^imp/i.test(s[1]) ? 'impeccable' : s[1].toLowerCase();
  }
  if (out.min && !out.choose && /mock-?ups?|מוקאפ|options|אפשרויות/i.test([].concat(texts).join(' '))) out.choose = true;
  return out;
}

/**
 * Reasons a "ready" reply does not meet the conditions, [] when it does or says nothing is final.
 * `shown` = how many distinct things he can look at (pictures, option links, option answers) in this reply.
 */
export function unmetConditions(conditions, { reply = '', shown = 0 } = {}) {
  const text = String(reply);
  if (!conditions || !Object.keys(conditions).length || NOT_FINAL.test(text.slice(0, 80)) || ADMISSION.test(text.slice(0, 120))) return [];
  const reasons = [];
  if (conditions.min && shown < conditions.min) reasons.push(`He asked for at least ${conditions.min} to look at; this reply shows ${shown}.`);
  if (conditions.choose && shown < 2) reasons.push('He asked for options to choose from; none are shown.');
  if (conditions.choose && LIVE_BUILD.test(text) && !NOT_FINAL.test(text)) reasons.push('He asked to choose first, but the reply says a change is already built into the real thing. Nothing goes live until he picks.');
  return reasons;
}

const READY_WORD = /\b(?:ready|done|built|live|finished)\b|מוכנ|הושלם|שולב|סיימתי/i;
const FUTURE = /(?:^|[\s,(])(?:כש|ברגע|אחרי|יהיו|יהיה|אכין|אבנה|אעשה)|\b(?:when|once|until|will|soon|going to|after)\b|עוד לא|\bnot yet\b|טרם/i;
/** Does the reply announce that something is ready now (not "will be ready when...")? */
export function claimsReady(reply) {
  return String(reply || '').split(/(?<=[.!?])\s+|\n+/).some((sentence) => READY_WORD.test(sentence) && !FUTURE.test(sentence));
}
