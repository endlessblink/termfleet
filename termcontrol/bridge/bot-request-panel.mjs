/** Every unfinished owner item belongs in the bot panel, regardless of provider or transcript. */
export function botAsksFromItems(items = []) {
  const seen = new Set();
  return items.filter(it => {
    if (it.locked || !['new', 'assigned', 'partial', 'ready', 'waiting'].includes(it.status) || seen.has(it.id)) return false;
    seen.add(it.id);
    return true;
  }).map(it => ({
    id: it.id, n: it.n, text: it.words, title: `${it.id} ${it.words}`,
    status: ['new', 'assigned'].includes(it.status) ? 'open' : it.status === 'waiting' ? 'partial' : it.status,
    note: it.note || '', items: [it],
  }));
}

/** The bot appends this harness-only block after the actual owner message. */
export const stripOpenRequestReminder = text => String(text || '').replace(/(?:^|\n)\s*\[Your open requests from Noam:[\s\S]*$/, '').trim();
