// Noam 2026-10-27: "I already told you" — a rule he states in chat was never saved; only a bot-written
// proposal could become a rule, and all 15 sat unapproved. A plainly lasting statement is now kept in
// the bot's standing rules at once, and he is told once ("Saved as a rule").
const MARKER = new RegExp([
  String.raw`\b(?:always|never|from now on|going forward|every time|don'?t ever|do not ever|i (?:have )?already told you|i said (?:this|that|it) (?:before|already)|important rule|new rule|add (?:it|this) to the rules)\b`,
  String.raw`(?:חוק(?:\s+חשוב)?|מעכשיו|תמיד|אף פעם|לעולם|אסור|כבר אמרתי|אמרתי (?:את )?זה כבר|אמרתי לך|בחוקים)`,
].join('|'), 'i');
const MAX_RULE = 300;

/** The lasting rule(s) a message states, [] when it only asks for something now. */
export function statedRules(text) {
  const body = String(text || '').replace(/\s+/g, ' ').trim();
  if (!body || body.length > 1500 || !MARKER.test(body)) return [];
  // A short message is one rule in full; a long one yields only the sentences that carry the marker.
  const parts = body.length <= MAX_RULE ? [body] : body.split(/(?<=[.!?])\s+/).filter((s) => MARKER.test(s));
  return parts
    .map((s) => s.replace(/^[\s\-–—•]+/, '').slice(0, MAX_RULE).trim())
    .filter((s) => s.length >= 8 && !/\?\s*$/.test(s));
}

/** The bot's rules with the new ones added; null when nothing is new. */
export function withRules(current, found) {
  const have = String(current || '');
  const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const known = new Set(have.split('\n').map(norm));
  const fresh = found.filter((r) => !known.has(norm(r)));
  return fresh.length ? { rules: [have.trim(), ...fresh].filter(Boolean).join('\n'), added: fresh } : null;
}
