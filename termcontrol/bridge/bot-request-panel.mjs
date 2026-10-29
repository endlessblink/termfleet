import { testingInstructions } from './testing-instructions.mjs';

// "Ready" counts as finished only when it tells Noam what to try (#16: the header said
// "109 done, 0 open" while 107 of those had never been given to him to check).
const checkable = (it) => Boolean(it.testing || testingInstructions(it.note) || testingInstructions(it.evidence?.at?.(-1)?.what));

/** Every unfinished owner item belongs in the bot panel, regardless of provider or transcript. */
export function botAsksFromItems(items = []) {
  const seen = new Set();
  return items.filter(it => {
    if (it.locked || !['new', 'assigned', 'partial', 'ready', 'waiting'].includes(it.status) || seen.has(it.id)) return false;
    seen.add(it.id);
    return true;
  }).map(it => {
    const unchecked = it.status === 'ready' && !checkable(it);
    return {
      id: it.id, n: it.n, text: it.words, title: `${it.id} ${it.words}`,
      status: unchecked || ['new', 'assigned'].includes(it.status) ? 'open' : it.status === 'waiting' ? 'partial' : it.status,
      note: unchecked ? `Not checked yet${it.note ? `: ${it.note}` : ''}` : it.note || '', items: [it],
    };
  });
}

/** The bot appends this harness-only block after the actual owner message. */
export const stripOpenRequestReminder = text => String(text || '').replace(/(?:^|\n)\s*\[Your open requests from Noam:[\s\S]*$/, '').trim();
