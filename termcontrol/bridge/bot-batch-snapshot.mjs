import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { botClosePlan } from './bot-close.mjs';

const defaultRunGit = (args, cwd) => spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout: 5000 });

// Unknown activity or unsaved-work state stays outside group operations.
export function createBotBatchSnapshot({ bots, routines, currentPanes, unsavedWork, filesTheAgentChanged, runGit = defaultRunGit }) {
  return async function snapshot(id) {
    const inventory = await currentPanes({ fresh: true });
    const bot = bots.summary(id), raw = bots.read(id);
    if (!bot || !raw) return null;
    const owned = (bot.helpers || []).filter(h => !h.followed);
    const panes = owned.map(h => inventory.panes.find(p => p.id === h.paneId)).filter(p => p && p.alive !== false);
    const plan = botClosePlan({ bot, panes: inventory.panes, routines: routines.forPane(`bot:${id}`), watches: bots.watches(id) });
    const side = bots.sides.get(id);
    let blocked = bots.running.has(id) || bot.state === 'needs-you' || raw.inflight || raw.retry || raw.providerSwitch || raw.handover || (raw.queued || []).length || (bots.queues.get(id) || []).length || side?.busy || side?.pending?.length || side?.inflight?.length
      ? 'It is working, waiting for you, or has queued work. Check it individually first.' : null;
    if (owned.some(h => !inventory.panes.some(p => p.id === h.paneId)) || (panes.length && !inventory.daemon)) blocked ||= 'A helper cannot be verified. Check its terminal first.';
    const sessions = panes.map(p => ({ id:p.id, session:p.sessionId || p.runtimeSessionId || null, pid:p.pid || null, startedAt:p.startedAt || null, turn:p.turn || null, producing:Boolean(p.producing), lastActiveAt:p.lastActiveAt || null }));
    for (const pane of panes) {
      if (!pane.sleeping && (pane.turn !== 'idle' || !pane.pid || !pane.startedAt)) blocked ||= 'A helper is not confirmed idle. Check its terminal first.';
      if (pane.turn === 'working' || pane.turn === 'waiting' || pane.producing || pane.attention) blocked ||= 'A helper is busy or waiting for your answer.';
      if (!pane.cwd) { blocked ||= 'Cannot verify a helper folder for unsaved work. Check it individually first.'; continue; }
      try {
        const status = runGit(['status', '--porcelain', '--untracked-files=normal'], pane.cwd);
        if (status?.status !== 0 || status.error) { blocked ||= 'Cannot verify a helper for unsaved work. Check it individually first.'; continue; }
        // unsavedWork's normal failure fallback means "none"; supply the already
        // checked status so unknown Git state cannot silently take that path.
        const checkedGit = args => { const result=args[0] === 'status' ? status : runGit(args, pane.cwd); if(result?.status!==0 || result.error)throw new Error('Git inspection failed'); return result; };
        const changed = unsavedWork(pane.cwd, Number(pane.startedAt) || 0, checkedGit, filesTheAgentChanged(pane), (Number(pane.lastActiveAt) || Date.now()) + 60_000);
        if (changed.length) blocked ||= 'A helper has unsaved work. Save or review it before closing.';
      } catch { blocked ||= 'Cannot verify a helper for unsaved work. Check it individually first.'; }
    }
    const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
    const config = hash([raw.name,raw.job,raw.provider,raw.model,raw.cwd,raw.helpers]);
    const conversation = hash(bots.messages(id).filter(m => !['note','activity','question-resolution'].includes(m.role)).map(m => m.id));
    return { id, name:bot.name, plan, blocked, identity:{ bot:hash(raw), config, conversation, sessions } };
  };
}
