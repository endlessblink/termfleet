import { linkProblem, loadLedger, record } from './requirements.mjs';
import { hasBrowserReceipt } from './browser-receipts.mjs';

import { testingInstructions } from './testing-instructions.mjs';
export { testingInstructions } from './testing-instructions.mjs';

export function reportsDelivery(text) {
  // Negated/future sentences report work still open, rather than a delivered change.
  return String(text || '').split(/[.!?;\n]/).some((line) => {
    if (/\b(?:not|isn't|aren't|wasn't|never|will|unverified|pending)\b|(?:עדיין לא|לא מוכן|לא תוקן)/i.test(line)) return false;
    return /\b(?:ready|fixed|deployed|released|shipped|version\s+\w|fix\s+(?:is|works))\b|(?:תוקן|תיקנתי|תיקנו|מוכן לבדיקה|גרסה\s+\S)/i.test(line);
  });
}

/** A browser receipt proves the bot opened it; the GET check rejects broken pages now. */
export function testingHandoffProblem(text, { botId, since = Date.now() - 30 * 60_000, markedReady = false, hasReceipt = hasBrowserReceipt, checkLink = linkProblem, receiptDir } = {}) {
  if (!botId || (!markedReady && !reportsDelivery(text))) return null;
  const instruction = testingInstructions(text);
  if (!instruction?.link) return 'Before reporting a fix, version or ready item, include one plain line: Try: <specific action> <working https://link>. Open that link yourself with the browser first.';
  if (instruction.tryText.length < 8 || instruction.tryText.split(/\s+/).length < 2) return 'The Try: line needs a specific action Noam can perform, beside the link.';
  if (!hasReceipt({ botId, url: instruction.link, since }, receiptDir ? { dir: receiptDir } : {})) return 'Open the Try: link yourself with the browser in this turn before reporting it ready; no successful browser receipt exists for this bot and link.';
  const bad = checkLink(instruction.link);
  return bad ? `The Try: link must work: ${bad}` : null;
}

/** The requirements ledger remains the sole authority, including legacy incomplete handoffs. */
export function tryNowItems(items) {
  return items.filter((it) => it.status === 'ready').map((it) => {
    const instruction = it.testing || testingInstructions(it.note) || testingInstructions(it.evidence?.at(-1)?.what);
    return { id: it.id, words: it.words, link: instruction?.link || null, tryText: instruction?.tryText || null };
  });
}

export function readyThisTurn(items, botId, since) {
  return items.filter((it) => it.source === `bot:${botId}` && it.status === 'ready' && (Number(it.statusAt) || Date.parse(it.statusAt)) >= since);
}

export function saveTestingHandoff(text, botId, since, options = {}) {
  const instruction = testingInstructions(text);
  if (!instruction?.link) return;
  const items = readyThisTurn([...loadLedger(options).items.values()], botId, since);
  if (items.length === 1) record(items.map((it) => ({ e: 'testing-handoff', id: it.id, ...instruction, by: `bot:${botId}` })), options);
}
