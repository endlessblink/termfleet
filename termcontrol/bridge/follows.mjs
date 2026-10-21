/**
 * A bot following another agent is woken when that agent finishes. Noam
 * (2026-10-21): "למה אתה ממשיך לעדכן על פעולות של בוטים אחרים בלי שנתבקשת?"
 * So a follow is for one job: it ends by itself after the first finished turn,
 * and a bot can end it early with `termfleet-team unfollow <who>` (or --all).
 * Ended entries stay in the list (the chat still shows who it worked with) but
 * never wake the bot or post that agent's prompts again.
 */
export const followActive = (h) => !h?.ended;

/** Mark matching entries ended. `paneId: null` with `all` ends every one; started helpers end only when named. */
export function endFollows(list, { paneId = null, all = false, followedOnly = false, at = Date.now() } = {}) {
  let count = 0;
  const next = (Array.isArray(list) ? list : []).map((h) => {
    if (!h?.paneId || h.ended) return h;
    if (followedOnly && !h.followed) return h;
    if (all ? !h.followed : h.paneId !== paneId) return h;
    count++;
    return { ...h, ended: at };
  });
  return { list: next, count };
}
