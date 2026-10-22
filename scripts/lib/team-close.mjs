// `termfleet-team close <who>` (Noam 2026-10-20: "כדאי לתת לסוכן את היכולת להרוג טרמינל שהוא
// פתח אחרי שהוא סיים ... כדי לא ליצור אין סוף טרמינלים זומבים"). A bot, or a terminal agent,
// may close only a terminal it started itself, and only once that terminal is done: not
// working, not waiting on a prompt for Noam, and with no unsaved work it made. Closing goes
// through the TermFleet app's own close (the card's X).
import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { claudeTranscript as claudeTranscriptPath } from '../../termcontrol/bridge/paths.mjs';
import { transcriptPath as codexTranscriptPath } from '../../termcontrol/bridge/adapters/codex.mjs';

const COMMIT = /\bgit\s+(?:-C\s+\S+\s+)?commit\b/;
const WRITES = /\bsed\s+-i|>>?|\btee\b|\bcp\b|\bmv\b|\bpatch\b|\bgit\s+(?:apply|checkout|restore|stash)\b|\bperl\s+-[a-z]*i/;

/**
 * Files an agent changed itself, read from its own session record: Claude's Edit/Write
 * tools and shell commands that write a named file; Codex's patches. null when there is
 * no record (a plain shell): then only the time rule applies. Noam 2026-10-21: another
 * agent's unsaved files in a shared folder blocked closing every terminal there.
 */
export function filesTheAgentChanged(pane, { transcriptOf = defaultTranscript, read = (file) => readFileSync(file, 'utf8') } = {}) {
  const file = transcriptOf(pane);
  if (!file) return null;
  let text;
  try { text = read(file); } catch { return null; }
  const paths = new Set(), commands = [];
  for (const line of text.split('\n')) {
    if (!line.includes('"tool_use"') && !line.includes('apply_patch') && !line.includes('exec_command') && !line.includes('"shell"')) continue;
    let entry; try { entry = JSON.parse(line); } catch { continue; }
    for (const part of entry?.message?.content || []) {
      if (part?.type !== 'tool_use') continue;
      const input = part.input || {};
      // A commit saves what came before it: whatever is still uncommitted in those files
      // afterwards is someone else's (Agent-Manager for Noam 2026-10-22: a finished agent
      // was refused over MASTER_PLAN.md after committing its own part).
      if (part.name === 'Bash' && COMMIT.test(String(input.command || ''))) { paths.clear(); commands.length = 0; continue; }
      if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(part.name) && (input.file_path || input.notebook_path)) paths.add(String(input.file_path || input.notebook_path));
      if (part.name === 'Bash' && WRITES.test(String(input.command || ''))) commands.push(String(input.command));
    }
    for (const m of line.matchAll(/\*\*\* (?:Update|Add|Delete) File: ([^\\\n"]+)/g)) paths.add(m[1].trim());
    if (/exec_command|"shell"/.test(line)) {
      const cmd = JSON.stringify(entry?.payload || entry);
      if (COMMIT.test(cmd)) { paths.clear(); commands.length = 0; continue; }
      if (WRITES.test(cmd)) commands.push(cmd);
    }
  }
  return { paths, commands };
}

function defaultTranscript(pane) {
  if (!pane?.sessionId) return null;
  try {
    if (pane.provider === 'claude') return claudeTranscriptPath(pane.cwd, pane.sessionId);
    if (pane.provider === 'codex') return codexTranscriptPath(pane);
  } catch { /* unknown */ }
  return null;
}

/** The files a shell command writes: redirect targets, in-place edits, copy/move destinations. */
export function shellWriteTargets(command) {
  const out = [], cmd = String(command).replace(/\\n/g, '\n').replace(/\\"/g, '"');
  const clean = (t) => String(t || '').replace(/^['"]|['";)]+$/g, '');
  for (const m of cmd.matchAll(/(?<![0-9&<>])>>?\s*([^\s;&|<>()]+)/g)) out.push(clean(m[1]));
  for (const seg of cmd.split(/&&|\|\||;|\||\n/)) {
    const words = seg.trim().split(/\s+/).map(clean).filter(Boolean);
    const at = (name) => words.findIndex((w) => w === name || w.endsWith('/' + name));
    const files = (from) => words.slice(from).filter((w) => !w.startsWith('-') && /[./]/.test(w) && !/^['"]?s[/|#]/.test(w));
    if (at('sed') >= 0 && words.some((w) => /^-[a-zA-Z]*i/.test(w))) out.push(...files(at('sed') + 1));
    if (at('perl') >= 0 && words.some((w) => /^-[a-zA-Z]*i/.test(w))) out.push(...files(at('perl') + 1));
    if (at('tee') >= 0) out.push(...files(at('tee') + 1));
    for (const name of ['cp', 'mv', 'install']) if (at(name) >= 0) { const f = files(at(name) + 1); if (f.length >= 2) out.push(f.at(-1)); }
    if (at('git') >= 0 && /^(checkout|restore)$/.test(words[at('git') + 1] || '')) out.push(...files(at('git') + 2));
  }
  return out.filter((t) => t && t !== '/dev/null' && !t.startsWith('/dev/'));
}

/** Is this changed file the agent's own? By its edit tools, or as a write target of its shell commands. */
export function changedByAgent(file, top, changes) {
  const abs = join(top, file);
  const same = (p) => p === abs || p === file || p.replace(/^\.\//, '') === file || (!p.startsWith('/') && abs.endsWith('/' + p.replace(/^\.\//, '')));
  if ([...changes.paths].some(same)) return true;
  return changes.commands.some((cmd) => shellWriteTargets(cmd).some(same));
}

/** Files changed but not committed in that folder since the terminal started (and, when its record is known, made by that terminal's agent). */
export function unsavedWork(cwd, since, run = (args) => spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout: 5000 }), changes = null, until = Infinity) {
  if (!cwd) return [];
  const status = run(['status', '--porcelain', '--untracked-files=normal']);
  if (status.status !== 0) return []; // not a git folder: nothing to protect here
  const top = run(['rev-parse', '--show-toplevel']).stdout?.trim() || cwd;
  const files = String(status.stdout || '').split('\n').filter(Boolean).map((line) => line.slice(3).replace(/^.* -> /, '').replace(/^"|"$/g, ''));
  // A shared folder often holds other people's unfinished edits; only what changed after
  // this terminal started can be its own.
  // With no record of what it changed (a plain shell), a file changed after the terminal
  // went quiet cannot be its own either.
  const recent = files.filter((file) => { try { const t = statSync(join(top, file)).mtimeMs; return t >= since && (changes || t <= until); } catch { return true; } });
  return changes ? recent.filter((file) => changedByAgent(file, top, changes)) : recent;
}

/**
 * "Is it printing?" needs two looks: one look from a fresh command never sees output move,
 * so a busy plain shell read as idle (live check 2026-10-20). Look, wait, look again.
 */
export async function panesAfterTwoLooks(look, pause = (ms) => new Promise((r) => setTimeout(r, ms))) {
  await look();
  await pause(2500);
  return look();
}

/**
 * Decide and do. `owned` lists the terminals this caller started: [{ paneId, task, at }].
 * Returns { ok, text } for the caller to print; never closes on a refusal.
 */
export async function closeOwnTerminal({ query, panes, owned, resolvePane, stateOf, request, record, unsaved = unsavedWork, changes = filesTheAgentChanged, by }) {
  const found = resolvePane(panes, query, {});
  if (found.error) return { ok: false, text: found.error };
  const pane = found.pane, mine = owned.find((h) => h.paneId === pane.id);
  const name = mine?.task || pane.profile?.name || pane.title || pane.project || pane.id;
  if (!mine) return { ok: false, text: `Not closed: you did not start "${name}". Only Noam can close it.` };
  const state = stateOf(pane);
  if (state === 'closed') return { ok: false, text: `"${name}" is already closed.` };
  if (state === 'working') return { ok: false, text: `Not closed: "${name}" is still working. Wait for it to finish (termfleet-team wait ${pane.id}).` };
  if (state === 'waiting') return { ok: false, text: `Not closed: "${name}" is waiting on a prompt for Noam. He has to answer it first.` };
  const files = unsaved(pane.cwd, Number(mine.at) || 0, undefined, changes(pane));
  if (files.length) return { ok: false, text: `Not closed: "${name}" has unsaved work (${files.slice(0, 3).join(', ')}${files.length > 3 ? ` and ${files.length - 3} more` : ''}). Have it commit or hand it over first.` };
  const result = await request(pane.id, { by });
  if (!result.ok) return { ok: false, text: `Not closed: ${result.error}` };
  record({ role: 'note', text: `Closed the "${name}" terminal; its work was finished.` });
  return { ok: true, text: `Closed "${name}".` };
}

/** Terminals this agent started itself (its children on the map), as the owned list closeOwnTerminal takes. */
export function ownedChildren(panes, selfId) {
  if (!selfId) return [];
  return panes.filter((p) => p.parentPaneId === selfId).map((p) => ({ paneId: p.id, task: p.statedTask || p.profile?.name || p.title || null, at: Number(p.startedAt) || 0 }));
}

/**
 * `termfleet-team close self` (Agent-Manager for Noam 2026-10-22: agents know best when their
 * own work is finished). Refuses while the terminal waits for Noam or holds unsaved work of its
 * own; otherwise hands the close to a separate waiter that closes it once this reply is saved.
 */
export async function closeSelf({ pane, unsaved = unsavedWork, changes = filesTheAgentChanged, schedule }) {
  if (!pane) return { ok: false, text: 'Not closed: TermFleet cannot tell which terminal you are in.' };
  if (pane.turn === 'waiting' || pane.attention) return { ok: false, text: 'Not closed: this terminal is waiting for Noam to answer a prompt.' };
  const files = unsaved(pane.cwd, Number(pane.startedAt) || 0, undefined, changes(pane));
  if (files.length) return { ok: false, text: `Not closed: you have unsaved work (${files.slice(0, 3).join(', ')}${files.length > 3 ? ` and ${files.length - 3} more` : ''}). Commit it or hand it over first.` };
  const r = await schedule(pane.id);
  if (!r?.ok) return { ok: false, text: `Not closed: ${r?.error || 'the close could not be started.'}` };
  return { ok: true, text: 'Closing: this terminal closes as soon as this reply is saved. Finish your reply now; do not start new work.' };
}

/**
 * The waiter behind `close self`: look until the agent's turn has ended (two idle looks in a
 * row, so the final reply is written), then close. Gives up if Noam is asked something.
 */
export async function closeWhenIdle(paneId, { look, request, stateOf, pause = (ms) => new Promise((r) => setTimeout(r, ms)), timeoutMs = 15 * 60_000, now = Date.now }) {
  const until = now() + timeoutMs;
  let idleLooks = 0;
  while (now() < until) {
    await pause(2000);
    const pane = (await look()).find((p) => p.id === paneId);
    if (!pane || pane.alive === false) return { ok: true, text: 'Already closed.' };
    if (pane.attention) return { ok: false, text: 'Not closed: it is waiting for Noam.' };
    const state = stateOf(pane);
    if (state === 'waiting') return { ok: false, text: 'Not closed: it is waiting for Noam.' };
    idleLooks = state === 'idle' ? idleLooks + 1 : 0;
    if (idleLooks >= 2) {
      const r = await request(paneId, { by: 'self' });
      return r.ok ? { ok: true, text: 'Closed.' } : { ok: false, text: `Not closed: ${r.error}` };
    }
  }
  return { ok: false, text: 'Not closed: it was still busy after 15 minutes.' };
}
