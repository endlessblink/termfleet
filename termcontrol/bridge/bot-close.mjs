// "Close this bot" (Noam 2026-10-20: "צריך להיות לי תפריט right click על סוכנים שיאפשר לי לסגור
// אותם ... זה יסגור את כל מה שקשור אליהם כדי שלי יתפוס זיכרון, אבל בביטחה ואולי גם ישאל אותי אם
// להרוג פעילות מסויימת (עם הסבר ברור ולא טכני שלה)"). Everything tied to a bot that takes
// memory, one plain line each; anything mid-work starts unticked and says what would be lost.
// Closing never deletes the bot, its chat or its memory: the next message starts it again.
import path from 'node:path';

const clip = (s, n = 90) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const daysText = (days = []) => days.length === 7 ? 'every day' : days.join(',') === '1,2,3,4,5' ? 'weekdays' : days.map((d) => DAYS[d]).join(', ');

export function isManagerBot(bot) {
  return /manager/i.test(`${bot?.name || ''} ${bot?.job || ''}`);
}

export function botClosePlan({ bot, panes = [], routines = [], watches = [] }) {
  const items = [];
  if (bot.state === 'working') {
    items.push({ id: 'turn', kind: 'turn', label: 'Its reply right now', now: clip(bot.activity || 'Thinking'), busy: true, checked: false,
      loses: 'The reply it is writing stops halfway. You can ask again any time.' });
  }
  for (const h of bot.helpers || []) {
    if (h.followed) continue; // Noam's own agents the bot only watches are not the bot's to close
    const pane = panes.find((p) => p.id === h.paneId);
    if (!pane || pane.alive === false) continue;
    const waiting = pane.turn === 'waiting', working = !waiting && (pane.turn === 'working' || pane.producing);
    const doing = pane.sessionViewV2?.now?.label || pane.statedTask || pane.task || '';
    items.push({
      id: `terminal:${pane.id}`, kind: 'terminal', label: clip(h.task || pane.profile?.name || pane.title || pane.project, 70),
      now: waiting ? 'Waiting for your answer' : working ? `Working${doing ? `: ${clip(doing, 70)}` : ''}` : `Finished${doing ? `: ${clip(doing, 70)}` : ''}`,
      busy: working || waiting, checked: !(working || waiting),
      ...(waiting ? { loses: 'Its question to you is dropped, and the work behind it stops.' } : working ? { loses: 'It stops in the middle; anything it has not saved is lost.' } : {}),
    });
  }
  for (const r of routines) {
    if (!r.enabled) continue;
    items.push({ id: `routine:${r.id}`, kind: 'routine', label: `Scheduled message, ${daysText(r.days)} at ${r.time}`, now: clip(r.text, 80), busy: false, checked: true, note: 'Paused, not deleted.' });
  }
  for (const w of watches) {
    if (w.paused) continue;
    items.push({ id: `watch:${w.path}`, kind: 'watch', label: `Watching ${path.basename(w.path)} for new code`, now: w.path, busy: false, checked: true, note: 'Paused, not deleted.' });
  }
  return {
    bot: { id: bot.id, name: bot.name },
    items,
    ...(isManagerBot(bot) ? { warning: `${bot.name} manages your other agents. While it is closed nothing checks on them; message it to start it again.` } : {}),
  };
}

/** Close what Noam ticked. Each item gets a plain result; nothing else is touched. */
export async function closeBotItems({ botId, ids, plan, bots, routines, requestClose }) {
  const wanted = new Set(ids), results = [];
  for (const item of plan.items.filter((i) => wanted.has(i.id))) {
    let r;
    if (item.kind === 'turn') r = bots.stop(botId);
    else if (item.kind === 'terminal') r = await requestClose(item.id.slice('terminal:'.length), { by: `phone:close-bot:${botId}` });
    else if (item.kind === 'routine') r = routines.setEnabled(item.id.slice('routine:'.length), false);
    else if (item.kind === 'watch') { bots.setWatch(botId, { path: item.id.slice('watch:'.length), paused: true, head: bots.watches(botId).find((w) => w.path === item.id.slice(6))?.head }); r = { ok: true }; }
    results.push({ id: item.id, label: item.label, ok: Boolean(r?.ok), ...(r?.ok ? {} : { error: r?.error || 'Not closed.' }) });
  }
  const done = results.filter((r) => r.ok).map((r) => r.label);
  if (done.length) bots.append(botId, { role: 'note', text: `Noam closed: ${done.join('; ')}. The chat and memory are kept; a new message starts it again.` });
  return { ok: results.every((r) => r.ok), results };
}
