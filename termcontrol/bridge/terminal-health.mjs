import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { stateOf } from './orchestrate.mjs';

export const HEALTH_INTERVAL_MS = 120_000;
export const DEAD_GRACE_MS = 300_000;

/** The workspace owns the task and map membership; stale hook-only panes do not.
 * Keep the original pane id so bot helpers, SQL history and provider checkpoints
 * retain their links when its process is replaced.
 */
export function healthPanes(workspace, panes, starters = new Map()) {
  const byId = new Map(panes.map((pane) => [pane.id, pane]));
  const retired = new Set(workspace?.closedSessionIds || []);
  for (const tab of workspace?.tabs || []) for (const earlier of tab.earlierSessions || [])
    for (const id of earlier.ptyIds || []) retired.add(id);
  return (workspace?.tabs || []).flatMap((tab) => (tab.terminals || []).filter((t) => t.id && !retired.has(t.id) && !t.manualStopRequested && t.recoveryLifecycle !== 'closed-by-user').map((t) => {
    const p = byId.get(t.id) || {};
    const bot = starters.get(t.id);
    return { ...p, id: t.id, provider: p.provider || t.agentProvider || tab.workstream?.provider,
      sessionId: p.sessionId || t.providerSessionId || null,
      identityConflict: Boolean(p.sessionId && t.providerSessionId && p.sessionId !== t.providerSessionId),
      cwd: p.cwd || t.initialCwd || tab.initialCwd || null,
      project: p.project || tab.title || 'Terminal',
      task: p.task || t.mainUserAsk?.text || t.taskLine?.label || tab.workstream?.task || null,
      finished: Boolean(t.runClosed),
      bot: bot ? { id: bot.id, name: bot.name } : null };
  }));
}

/** null means permission/inspection failure, never permission to terminate. */
export function processAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === 'ESRCH' ? false : null; }
}

/** Read only commit identities, never file contents or private transcripts. */
export function recentCommits(cwd) {
  try {
    return execFileSync('git', ['-C', cwd, 'log', '-5', '--format=%H'],
      { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n').filter(Boolean);
  } catch { return []; }
}

/** Recreate the process under the SAME durable pane identity. The daemon owns
 * exact conversation restore, checkpoint replay, cwd and duplicate-writer locks.
 * Never intentionally close a pane before recovery: that tombstones its history.
 */
export async function recoverTerminal(pane, { ask, dir = path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local/share'), 'terminal-workspace/sessions') }) {
  // The daemon prefers saved recovery metadata to ensureSession arguments.
  // Verify that exact identity without opening any conversation contents.
  try {
    const stem = path.join(dir, Buffer.from(pane.id).toString('hex'));
    const meta = JSON.parse(fs.readFileSync(`${stem}.meta.json`, 'utf8'));
    const lifecycle = JSON.parse(fs.readFileSync(`${stem}.lifecycle.json`, 'utf8'));
    if (lifecycle !== 'recoverable' || !fs.existsSync(`${stem}.scrollback`) || meta.recoveryKind !== 'agent-terminal' ||
      meta.providerSessionId !== pane.sessionId || meta.provider !== pane.provider || meta.cwd !== pane.cwd ||
      ![undefined, null, 'terminal', 'headless'].includes(meta.launchProfile) ||
      (meta.sanitizedResumeCommand && !meta.sanitizedResumeCommand.includes(pane.sessionId)) ||
      ['resume-failed', 'needs-auth'].includes(meta.restoreStatus) || /auth/i.test(meta.restoreFailureReason || ''))
      return { ok: false, error: 'Saved recovery identity needs attention.' };
  } catch { return { ok: false, error: 'Saved recovery identity is unavailable.' }; }
  const result = await ask({ type: 'ensureSession', id: pane.id, cwd: pane.cwd, command: null });
  return result?.ok && !result.value?.error ? { ok: true } : { ok: false, error: 'The terminal could not be restored.' };
}

export function createTerminalHealth({ snapshot, activity, recover, retire, alive = processAlive,
  now = Date.now, file = null, commits = recentCommits, log = () => {} }) {
  let saved = {};
  let journalError = false;
  if (file) {
    try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') journalError = true; }
    if (!saved || Array.isArray(saved) || typeof saved !== 'object' || Object.values(saved).some((r) => !r || typeof r !== 'object')) { saved = {}; journalError = true; }
  }
  const records = new Map(Object.entries(saved));
  let running;
  function persist() {
    if (!file || journalError) return;
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(Object.fromEntries(records)), { mode: 0o600 });
    fs.renameSync(`${file}.tmp`, file);
  }
  function inspect(pane, state) {
    const at = now(), life = state.byId.get(pane.id);
    const row = { id: pane.id, project: pane.project, task: pane.task || null,
      bot: pane.bot || null, sessionId: pane.sessionId || null, cwd: pane.cwd || null,
      checkedAt: at, status: 'unknown', reason: 'The terminal service could not be reached.' };
    if (journalError) return { ...row, reason: 'Recovery journal is unreadable; automatic recovery is paused. Check the PC.' };
    if (!state.reachable) {
      if (!records.get(pane.id)?.action) records.delete(pane.id);
      return row;
    }
    if (pane.sleeping || life?.sleeping) { records.delete(pane.id); return { ...row, status: 'sleeping', reason: 'Intentionally sleeping; will stay closed until needed.' }; }
    const attempt = records.get(pane.id);
    const owner = state.agents.get(pane.id);
    if (attempt?.action === 'recover') {
      // A replacement shell is not a restored conversation. Keep the no-retry
      // journal until the independent process inventory proves the exact owner.
      if (owner?.sessionId !== attempt.sessionId || owner?.provider !== attempt.provider) {
        const expired = at - attempt.attemptAt > DEAD_GRACE_MS;
        return { ...row, status: expired || attempt.status === 'blocked' ? 'blocked' : 'recovering',
          reason: expired ? 'The original conversation has not returned. Check the PC; no repeated automatic attempt.' : attempt.reason,
          commits: attempt.commits || [] };
      }
      records.delete(pane.id);
    }
    const processState = life?.pid ? alive(life.pid) : life && !life.exited ? null : false;
    if (processState !== false || state.agents.has(pane.id)) {
      records.delete(pane.id);
      let last = null;
      try { last = activity(pane.id); } catch { /* unknown activity is protected */ }
      const stuck = stateOf(pane) === 'stuck';
      return { ...row, status: processState === null ? 'unknown' : stuck ? 'stuck' : 'alive',
        lastActivityAt: last,
        reason: processState === null ? 'Process ownership is uncertain; no automatic action.' : stuck ? 'Process is alive but quiet; check its screen. It will not be killed.' : 'Process is running.' };
    }
    let last;
    try { last = activity(pane.id); } catch { /* unavailable SQL is not proof of death */ }
    if (!Number.isFinite(last) || last <= 0) {
      if (!records.get(pane.id)?.action) records.delete(pane.id);
      return { ...row, reason: 'Activity history is unavailable; no automatic action.' };
    }
    const prior = records.get(pane.id);
    const record = prior?.sessionId === pane.sessionId ? prior : { since: at, sessionId: pane.sessionId };
    records.set(pane.id, record);
    row.lastActivityAt = Math.max(last, Number(pane.updatedAt) || 0);
    if (at - record.since < DEAD_GRACE_MS || at - row.lastActivityAt < DEAD_GRACE_MS)
      return { ...row, status: 'checking', reason: 'Process is absent; waiting five minutes before recovery.' };
    if (record.action) return { ...row, status: record.status === 'recovering' && at - record.attemptAt > DEAD_GRACE_MS ? 'blocked' : record.status,
      reason: record.status === 'recovering' && at - record.attemptAt > DEAD_GRACE_MS ? 'Replacement has not become live. Check the PC; no repeated automatic attempt.' : record.reason, commits: record.commits || [] };
    if ([...state.agents.values()].some((agent) => pane.sessionId && agent.sessionId === pane.sessionId))
      return { ...row, status: 'blocked', reason: 'This conversation is running in another terminal.' };
    return { ...row, status: 'dead', reason: 'Process is gone and recorded activity is over five minutes old.' };
  }
  async function run(repair) {
    const state = await snapshot();
    const ids = new Set(state.panes.map((p) => p.id));
    for (const id of records.keys()) if (!ids.has(id)) records.delete(id);
    const terminals = [];
    for (const pane of state.panes) {
      let row = inspect(pane, state);
      if (repair && row.status === 'dead') {
        // The daemon/provider and SQL facts must still agree immediately before action.
        const fresh = await snapshot();
        const current = fresh.panes.find((p) => p.id === pane.id);
        if (!current) { records.delete(pane.id); continue; }
        row = inspect(current, fresh);
        if (row.status === 'dead') {
          const unfinished = !current.finished && (current.turn === 'working' || current.turn === 'waiting' || (current.todos || []).some((t) => t.status !== 'completed') || Boolean(current.task));
          if (unfinished && (current.identityConflict || !current.sessionId || !current.cwd || !['codex', 'claude', 'opencode'].includes(current.provider))) {
            row = { ...row, status: 'blocked', reason: 'Task identity is incomplete; automatic recovery would lose context.' };
          } else {
            const record = records.get(pane.id);
            record.action = unfinished ? 'recover' : 'retire';
            record.attemptAt = now();
            record.task = current.task; record.cwd = current.cwd; record.bot = current.bot; record.provider = current.provider;
            // Repository history proves saved work exists, not which agent
            // authored it. Include commits preceding the last activity too.
            record.commits = commits(current.cwd);
            // Persist before acting: a bridge restart must not create a restart loop.
            record.status = 'blocked'; record.reason = 'Recovery started; awaiting confirmation. No repeated automatic attempt.';
            persist();
            try {
              const result = await (unfinished ? recover(current) : retire(current));
              record.status = result?.ok ? unfinished ? 'recovering' : 'retired' : 'blocked';
              record.reason = result?.ok ? unfinished ? 'Replacement process requested in the same conversation; awaiting a live process.' : 'Dead terminal closed; no unfinished task was recorded.' : 'Recovery could not be confirmed. Check the PC.';
            } catch { record.status = 'blocked'; record.reason = 'Recovery failed. Check the PC; no repeated automatic attempt.'; }
            row = { ...row, status: record.status, reason: record.reason, commits: record.commits };
            log(current, { predecessor_terminal_id: current.id, session_id: current.sessionId, action: record.action, status: record.status, commits: record.commits });
          }
        }
      }
      terminals.push(row);
    }
    persist();
    return { checkedAt: now(), daemon: state.reachable, intervalMs: HEALTH_INTERVAL_MS, graceMs: DEAD_GRACE_MS, terminals };
  }
  return { sweep({ repair = false } = {}) {
    if (running) return running;
    running = run(repair).finally(() => { running = null; });
    return running;
  } };
}
