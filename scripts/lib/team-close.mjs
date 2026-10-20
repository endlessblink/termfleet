// `termfleet-team close <who>` (Noam 2026-10-20: "כדאי לתת לסוכן את היכולת להרוג טרמינל שהוא
// פתח אחרי שהוא סיים ... כדי לא ליצור אין סוף טרמינלים זומבים"). A bot, or a terminal agent,
// may close only a terminal it started itself, and only once that terminal is done: not
// working, not waiting on a prompt for Noam, and with no unsaved work it made. Closing goes
// through the TermFleet app's own close (the card's X).
import { spawnSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { join } from 'node:path';

/** Files changed but not committed in that folder since the terminal started. */
export function unsavedWork(cwd, since, run = (args) => spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout: 5000 })) {
  if (!cwd) return [];
  const status = run(['status', '--porcelain', '--untracked-files=normal']);
  if (status.status !== 0) return []; // not a git folder: nothing to protect here
  const top = run(['rev-parse', '--show-toplevel']).stdout?.trim() || cwd;
  const files = String(status.stdout || '').split('\n').filter(Boolean).map((line) => line.slice(3).replace(/^.* -> /, '').replace(/^"|"$/g, ''));
  // A shared folder often holds other people's unfinished edits; only what changed after
  // this terminal started can be its own.
  return files.filter((file) => { try { return statSync(join(top, file)).mtimeMs >= since; } catch { return true; } });
}

/**
 * Decide and do. `owned` lists the terminals this caller started: [{ paneId, task, at }].
 * Returns { ok, text } for the caller to print; never closes on a refusal.
 */
export async function closeOwnTerminal({ query, panes, owned, resolvePane, stateOf, request, record, unsaved = unsavedWork, by }) {
  const found = resolvePane(panes, query, {});
  if (found.error) return { ok: false, text: found.error };
  const pane = found.pane, mine = owned.find((h) => h.paneId === pane.id);
  const name = mine?.task || pane.profile?.name || pane.title || pane.project || pane.id;
  if (!mine) return { ok: false, text: `Not closed: you did not start "${name}". Only Noam can close it.` };
  const state = stateOf(pane);
  if (state === 'closed') return { ok: false, text: `"${name}" is already closed.` };
  if (state === 'working') return { ok: false, text: `Not closed: "${name}" is still working. Wait for it to finish (termfleet-team wait ${pane.id}).` };
  if (state === 'waiting') return { ok: false, text: `Not closed: "${name}" is waiting on a prompt for Noam. He has to answer it first.` };
  const files = unsaved(pane.cwd, Number(mine.at) || 0);
  if (files.length) return { ok: false, text: `Not closed: "${name}" has unsaved work (${files.slice(0, 3).join(', ')}${files.length > 3 ? ` and ${files.length - 3} more` : ''}). Have it commit or hand it over first.` };
  const result = await request(pane.id, { by });
  if (!result.ok) return { ok: false, text: `Not closed: ${result.error}` };
  record({ role: 'note', text: `Closed the "${name}" terminal; its work was finished.` });
  return { ok: true, text: `Closed "${name}".` };
}
