// Noam 2026-10-27: "it says it does something while in reality the same issues are still there".
// A bot with open requests, no reply running and no terminal working on them was never woken again:
// the work just sat. This wakes it once after 15 quiet minutes, at most once an hour, so it either
// moves the work or says honestly why not. Off switch: TERMFLEET_STALL_WAKE=0.
import fs from 'node:fs';
import path from 'node:path';

export const STALL_AFTER_MS = 15 * 60_000;
export const STALL_EVERY_MS = 60 * 60_000;
const QUIET_ROLES = new Set(['operator', 'bot', 'error', 'handoff', 'terminal-ask']);

const stateFile = (bots, id) => path.join(bots.folder(id), 'stall-wake.json');
const readState = (bots, id) => { try { return JSON.parse(fs.readFileSync(stateFile(bots, id), 'utf8')); } catch { return {}; } };

export function checkStalledBots({ bots, panes = [], now = Date.now(), env = process.env }) {
  if (env.TERMFLEET_STALL_WAKE === '0') return [];
  const woken = [];
  for (const b of bots.list()) {
    if (bots.running?.has(b.id) || (bots.queues?.get(b.id) || []).length) continue;
    const open = (bots.openWork?.(b.id) || []).filter((w) => now - Number(w.at || 0) >= 0);
    if (!open.length) continue;
    // Something is moving: a handed-over terminal that is working or asking, or a live helper of this bot.
    const busy = (id) => { const p = panes.find((x) => x.id === id); return Boolean(p && (p.turn === 'working' || p.turn === 'waiting' || p.producing)); };
    if (open.some((w) => w.where && busy(w.where)) || (b.helpers || []).some((h) => h?.paneId && busy(h.paneId))) continue;
    const last = bots.messages(b.id).filter((m) => QUIET_ROLES.has(m.role)).at(-1);
    if (last && now - Number(last.at || 0) < STALL_AFTER_MS) continue;
    const state = readState(bots, b.id);
    if (now - Number(state.wokeAt || 0) < STALL_EVERY_MS) continue;
    const list = open.slice(0, 8).map((w) => `${w.id} (${w.status}): "${String(w.words || '').replace(/\s+/g, ' ').slice(0, 100)}"`).join('; ');
    // Remember first: a crash between the two must never make it wake every sweep.
    try { fs.writeFileSync(stateFile(bots, b.id), JSON.stringify({ wokeAt: now, count: open.length })); } catch { continue; }
    bots.wake(b.id, `You have ${open.length} of Noam's requests that are not finished and nothing is running on them: ${list}${open.length > 8 ? `; and ${open.length - 8} more` : ''}. Move each one now (hand it to a terminal, do it, or ask Noam one plain question), or mark it honestly (termfleet-asks). If a request cannot move, tell Noam in one plain sentence why. Do not repeat that you are working on it unless something is actually running.`);
    woken.push(b.id);
  }
  return woken;
}
