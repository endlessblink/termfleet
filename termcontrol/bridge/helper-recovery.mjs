import { createHash } from 'node:crypto';
import { stateOf } from './orchestrate.mjs';
import { conversationMtime } from './session-status.mjs';
import { screenPromptAsk } from './asks.mjs';
import { screenStillAsks, stuckOnScreen } from './bot-events.mjs';

export const RECOVERY_AFTER_MS = 9 * 60_000;
const active = new Set(['new', 'assigned', 'partial']);
const progressAt = (pane) => Math.max(conversationMtime(pane), Number(pane.updatedAt) || 0);

/** One safe continuation message per assignment and conversation, with durable receipts.
 * A nudge is delivery evidence, never proof that the agent resumed. No process is killed.
 */
export async function recoverBotHelpers({ bots, panes, items, readAsk, readScreen, nudge,
  now = Date.now(), lastAt = progressAt, log = console.error, recheck = null }) {
  const receipts = [];
  for (const bot of bots.list()) {
    const helpers = new Map((bot.helpers || []).filter((h) => h?.paneId && !h.ended && !h.followed).map((h) => [h.paneId, h]));
    for (const [id, helper] of helpers) {
      const pane = panes.find((p) => p.id === id);
      if (!pane?.alive || pane.sleeping || pane.attention || !pane.sessionId || !['codex', 'claude', 'opencode'].includes(pane.provider)) continue;
      const state = stateOf(pane);
      if (!['idle', 'stuck'].includes(state)) continue;
      const work = items.filter((item) => !item.locked && active.has(item.status) && item.source === `bot:${bot.id}` && item.assigned?.at(-1)?.pane === id);
      if (!work.length && (state !== 'stuck' || !helper.task)) continue;
      const last = lastAt(pane);
      const assignedAt = Math.max(...work.map((item) => Number(item.assigned.at(-1).at) || 0), Number(helper.at) || 0);
      if (!(last > 0) || !(assignedAt > 0) || now - Math.max(last, assignedAt) < RECOVERY_AFTER_MS) continue;
      // Read both authorities immediately before delivery, including idle screens.
      // A status hook can say idle while an approval menu still waits for Noam.
      let screen;
      try {
        if (await readAsk(pane)) continue;
        screen = await readScreen(pane);
      } catch { continue; }
      if (typeof screen !== 'string' || !screen.trim() || screenPromptAsk(pane, screen) || screenStillAsks(screen) || stuckOnScreen(screen)) continue;
      if (recheck && !await recheck(pane, work)) continue;
      const assignments = work.map((item) => `${item.id}:${item.assigned.at(-1).at}`).sort();
      const episode = createHash('sha256').update(JSON.stringify([id, pane.sessionId, assignments])).digest('hex');
      if ((bots.messages(bot.id) || []).some((m) => m.role === 'helper-recovery' && m.episode === episode)) continue;
      // Save before the asynchronous send: crashes and overlapping timer ticks cannot retry it.
      bots.append(bot.id, { role: 'helper-recovery', pane: id, sessionId: pane.sessionId, episode, state: 'attempting', text: `Checking ${state} helper with unfinished assigned work.` });
      const remaining = work.length ? `Your assigned requests ${work.map((w) => w.id).join(', ')} remain unfinished.` : `Your original task is: ${helper.task}.`;
      const text = `Continue your existing task in this same conversation. ${remaining} Read the task ledger and your latest result, continue the next safe step, and record evidence. If blocked on Noam, ask him and wait; do not answer approvals yourself.`;
      let result;
      try { result = await nudge(pane, text, bot); } catch (error) { result = { error: error.message }; }
      const delivered = result?.delivered === true && !result.error;
      const receipt = { pane: id, sessionId: pane.sessionId, reason: state, episode, delivered, at: now, error: delivered ? null : result?.error || 'delivery unconfirmed' };
      const status = delivered ? 'nudge delivered; resumption is not yet confirmed' : `nudge failed: ${receipt.error}`;
      bots.append(bot.id, { role: 'helper-recovery', ...receipt, text: `Your ${state} terminal ${id}: ${status}.` });
      bots.wake(bot.id, `Automatic helper recovery: ${id} was ${state} with unfinished assigned work; ${status}. Read its result and verify progress. Preserve this conversation and its work. If it remains blocked, inspect the cause before replacing it; never answer Noam's approvals yourself.`);
      log(`[helper recovery] ${JSON.stringify(receipt)}`);
      receipts.push(receipt);
    }
  }
  return receipts;
}
