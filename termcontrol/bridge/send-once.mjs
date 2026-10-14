// A phone on a slow network can give up waiting after a message was already
// typed, and the retry then typed it twice. Each draft carries an id; a repeat of
// the same id returns the first outcome instead of typing again.
export function createSendOnce({ ttlMs = 30 * 60 * 1000, now = () => Date.now() } = {}) {
  const drafts = new Map();
  return async function sendOnce(sendId, text, run) {
    const key = typeof sendId === 'string' && sendId && sendId.length <= 80 ? sendId : null;
    if (!key) return run();
    for (const [id, entry] of drafts) if (now() - entry.at > ttlMs) drafts.delete(id);
    const prior = drafts.get(key);
    if (prior) {
      if (prior.text !== text) return { error: 'This message changed while it was being sent. Send it again.' };
      return { ...(await prior.result), repeated: true };
    }
    const result = Promise.resolve().then(run);
    drafts.set(key, { text, result, at: now() });
    let outcome;
    try { outcome = await result; } catch (error) { drafts.delete(key); throw error; }
    // Nothing was typed: the same draft may be tried again for real.
    if (!outcome?.ok) drafts.delete(key);
    return outcome;
  };
}
