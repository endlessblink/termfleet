import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listPanes, reconcileLivePanes, readWorkspace } from './inventory.mjs';
import { withSleepingLives } from './sleep.mjs';
import { liveness } from './liveness.mjs';
import { readSessionStatus, applyVendorStatus } from './session-status.mjs';
import { readFeed } from './feed.mjs';
import { sendToPane } from './send.mjs';
import { PATHS } from './paths.mjs';
import { profiles } from './profiles.mjs';
import { ownerWordsBlock } from './owner-words.mjs';

/**
 * Teammates (TF-096, following Grok Bot's architecture): any agent sees every
 * terminal, hands one of them work and reads the answer. There is no single lead.
 * The CLI agents call (`termfleet-team`) and the
 * TermControl app (desktop Agents view and phone) both go through this file, so
 * the two never disagree about who is doing what.
 */

const home = os.homedir();
const dataHome = process.env.XDG_DATA_HOME || path.join(home, '.local', 'share');

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };

function sidecarOf(id) {
  return readJson(path.join(PATHS.agentStatus, `pane-${id}.json`)) || {};
}

/** Which card started which: helper terminals record their parent pane. */
export function parentsByPane(workspace = readWorkspace()) {
  const parents = new Map();
  for (const tab of workspace?.tabs || []) {
    const parent = tab?.childOf?.parentPaneId;
    if (!parent) continue;
    for (const terminal of tab.terminals || []) if (terminal?.id && terminal.id !== parent) parents.set(terminal.id, parent);
  }
  return parents;
}

/** Every terminal with its state, its declared Goal/Task, and who started it. */
function processStart(pid) {
  try { return fs.statSync(`/proc/${pid}`).ctimeMs; } catch { return null; }
}

export async function fleetPanes({ workspace = readWorkspace() } = {}) {
  const panes = listPanes({ maxAgeMs: null, workspace });
  const { reachable, byId } = await liveness();
  const parents = parentsByPane(workspace);
  const named = profiles.all();
  // Sleeping terminals stay reachable: sending to one wakes it (sleep.mjs).
  if (reachable) withSleepingLives(byId);
  const base = reachable ? reconcileLivePanes(panes, byId, workspace) : panes;
  return base.map((p) => {
    const pane = applyVendorStatus({ ...p, ...readSessionStatus(p) });
    const life = byId.get(p.id);
    const side = sidecarOf(p.id);
    return {
      ...pane,
      alive: Boolean(life),
      producing: life?.producing ?? false,
      ...(life?.sleeping ? { sleeping: true, turn: 'idle' } : {}),
      goal: pane.operatorGoal?.text || side.declaredGoal || side.statedGoal || null,
      statedTask: side.statedTask || null,
      now: side.now || null,
      parentPaneId: parents.get(p.id) || null,
      profile: named[p.id] || null,
      // When its terminal process started: the unsaved-work check counts only files changed since.
      startedAt: life?.pid ? processStart(life.pid) : null,
    };
  });
}

/** Plain state word for one pane: working, waiting (needs a person), idle, closed. */
export function stateOf(pane) {
  if (!pane.alive) return 'closed';
  if (pane.turn === 'waiting') return 'waiting';
  if (pane.turn === 'working' || pane.producing) return 'working';
  return 'idle';
}

/**
 * Find a pane by full id, an unambiguous id fragment, or a project name. The
 * caller's own pane is never a target: an agent typing into itself loops.
 */
export function resolvePane(panes, query, { selfId = null } = {}) {
  const q = String(query || '').trim();
  if (!q) return { error: 'Say which terminal.' };
  const pool = panes.filter((p) => p.id !== selfId);
  const exact = pool.find((p) => p.id === q || p.id === `terminal-${q}`);
  if (exact) return { pane: exact };
  const byId = pool.filter((p) => p.id.includes(q));
  if (byId.length === 1) return { pane: byId[0] };
  const lower = q.replace(/^@/, '').toLowerCase();
  const byName = pool.filter((p) => p.alive && String(p.profile?.name || '').toLowerCase() === lower);
  if (byName.length === 1) return { pane: byName[0] };
  const byProject = pool.filter((p) => p.alive && String(p.project || '').toLowerCase() === lower);
  if (byProject.length === 1) return { pane: byProject[0] };
  const matches = byId.length ? byId : byProject;
  if (matches.length > 1) return { error: `"${q}" matches ${matches.length} terminals; use the id.`, matches };
  if (selfId && (selfId === q || selfId.includes(q))) return { error: 'That is your own terminal.' };
  return { error: `No terminal matches "${q}".` };
}

/** The conversation's last messages, oldest first: what the agent actually said. */
export function recentMessages(pane, { last = 6 } = {}) {
  const feed = readFeed(pane, { limit: Math.max(last * 3, 20) });
  return (feed.events || [])
    .filter((e) => e.kind === 'assistant' || e.kind === 'user')
    .slice(-last)
    .map((e) => ({ kind: e.kind, at: e.at || null, text: e.text }));
}

export function lastReply(pane, { since = 0 } = {}) {
  const messages = recentMessages(pane, { last: 12 });
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.kind !== 'assistant') continue;
    const at = m.at ? Date.parse(m.at) : NaN;
    if (since && Number.isFinite(at) && at < since) return null;
    return m;
  }
  return null;
}

/**
 * The receiving agent has to know the message came from another agent and
 * where its answer goes, or it treats the text as the operator's own words.
 */
export function framedMessage(text, from, { ownerWords = null } = {}) {
  const who = from?.bot ? `the bot "${from.bot}" (${from.id})`
    : from ? `the agent in "${from.profile?.name || from.project || 'another'}" terminal (${from.id})` : 'an orchestrating agent';
  // Noam's own words travel as their own checkable block, apart from the sender's text.
  const owner = ownerWords ? `\n\n${ownerWordsBlock(ownerWords)}` : '';
  return `[Message from ${who}, sent through TermFleet.] ${String(text).trim()}${owner}\n\n` +
    '(Answer in this conversation as usual; the sender reads your reply here. Ask the operator before anything risky or public.)';
}

export async function delegate(target, text, { from = null, ownerWords = null } = {}) {
  if (!target.alive) return { error: 'That terminal is not running any more.' };
  return sendToPane(target, framedMessage(text, from, { ownerWords }));
}

/**
 * Wait until the target has finished the turn our message started, then return
 * its reply. "Finished" is the agent's own status plus a quiet screen, checked
 * twice in a row so a pause between tool calls does not count.
 */
export async function waitForReply(paneId, { since = Date.now(), timeoutMs = 10 * 60 * 1000, pollMs = 3000, panesFn = fleetPanes } = {}) {
  const deadline = Date.now() + timeoutMs;
  let calm = 0;
  let sawWork = false;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollMs));
    const pane = (await panesFn()).find((p) => p.id === paneId);
    if (!pane) return { error: 'That terminal closed while waiting.' };
    const state = stateOf(pane);
    if (state === 'working') { sawWork = true; calm = 0; continue; }
    if (state === 'waiting') return { state, pane, reply: lastReply(pane, { since }), note: 'The agent is waiting for a person (a question or an approval).' };
    calm += 1;
    const reply = lastReply(pane, { since });
    if (calm >= 2 && (reply || sawWork)) return { state, pane, reply };
  }
  return { error: 'timeout', note: 'Still working; check again later.' };
}
