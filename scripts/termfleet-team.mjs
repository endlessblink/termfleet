#!/usr/bin/env node
// TF-096: every agent in TermFleet is a teammate that can see the others, hand
// one of them work, read its answer, and start helpers of its own — the way Grok
// Bot's bots message each other and manage coding agents. There is no single
// lead: any agent can use this. Terminals stay visible cards (FEATURE-64).
//
//   termfleet-team list                      who is here, what each is doing
//   termfleet-team read <who> [--last N]     an agent's latest messages (or its screen)
//   termfleet-team send <who> <text>         hand work over (queued if it is busy;
//                                            --interrupt stops its current turn first)
//                                            --owner-words latest|<id> attaches Noam's own
//                                            message (as TermFleet recorded it) so the
//                                            receiver can act on his approval without asking again
//                                            --req R-12,R-13 names Noam's items (TF-102): his exact words for
//                                            them, plus his open and approved words on the same topic, go
//                                            with it (required inside a bot; --no-req "<why>" for a plain
//                                            question). It fails (exit 3) unless the agent really received it.
//   termfleet-team verify [<id>]             check a "Noam's own words" record (no id: list recent)
//   termfleet-team ask <who> <text>          send, wait for the answer, print it
//   termfleet-team wait <who>                wait for its current turn to finish
//   termfleet-team start --provider P --task T [--cwd D] [--title X]
//                                            a new helper terminal (termfleet-child); takes --req too,
//                                            answers Codex's hook review for TermFleet's own hooks, and
//                                            fails unless the agent really started its task (--no-wait skips)
//   termfleet-team routine add --time 09:00 --days daily|weekdays|sun-thu|0,1,2
//                          --message T [--for <who>]   a scheduled message (default: you)
//   termfleet-team routine list [--for <who>] | routine remove <id>
//   termfleet-team watch add|remove|list <folder>   (inside a bot) new code there wakes it
//   termfleet-team follow <who> [--why T]  (inside a bot) wake me once when that agent finishes its turn
//   termfleet-team unfollow <who> | --all  (inside a bot) stop being woken by that agent (or by every one I follow)
//   termfleet-team close <who>             close a terminal YOU started (a bot's helper, or your own child
//                                          terminal), once it is done; refused while it works, waits
//                                          for Noam, or has unsaved work of its own
//   termfleet-team close self              close YOUR OWN terminal once your work is done, checked and
//                                          saved; it closes right after this reply is saved
//
// <who> is a teammate's name, a terminal id, a unique part of one, or a project name.
// Add --json for machine-readable output; --file F reads the text from a file.
import { readFileSync, realpathSync, writeSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  fleetPanes, resolvePane, stateOf, recentMessages, delegate, waitForReply, framedMessage,
} from '../termcontrol/bridge/orchestrate.mjs';
import { endFollows } from '../termcontrol/bridge/follows.mjs';
import { resolveCaller } from './termfleet-child.mjs';
import { findOwnerWords, recentOwnerWords } from '../termcontrol/bridge/owner-words.mjs';
import { Routines, describeDays } from '../termcontrol/bridge/routines.mjs';
import { screenOf } from '../termcontrol/bridge/liveness.mjs';
import { appendFileSync, existsSync, writeFileSync as writeFile } from 'node:fs';
import { randomBytes } from 'node:crypto';
import os from 'node:os';

/** Inside a bot (TF-096 part 6): its chat shows what it handed over and to whom. */
function botFolder(env = process.env) {
  const id = String(env.TERMFLEET_BOT_ID || '');
  if (!/^[0-9a-f]{12}$/.test(id)) return null;
  const dir = join(env.TC_CONFIG_DIR || join(os.homedir(), '.config', 'termcontrol'), 'bots', id);
  return existsSync(dir) ? dir : null;
}
export function recordInBot(entry, env = process.env) {
  const dir = botFolder(env);
  if (!dir) return false;
  try { appendFileSync(join(dir, 'chat.jsonl'), JSON.stringify({ id: randomBytes(6).toString('hex'), at: Date.now(), ...entry }) + '\n', { mode: 0o600 }); return true; } catch { return false; }
}
export function recordHelper(helper, env = process.env) {
  const dir = botFolder(env);
  if (!dir) return false;
  const file = join(dir, 'helpers.json');
  let list = [];
  try { list = JSON.parse(readFileSync(file, 'utf8')); } catch { list = []; }
  list.push({ ...helper, at: Date.now() });
  try { writeFile(file, JSON.stringify(list.slice(-50), null, 1), { mode: 0o600 }); return true; } catch { return false; }
}
import { requestDaemon, defaultDaemonSocket } from './termfleetctl.mjs';
import { briefItems, briefBlock, newDeliveryId, normId, idsIn, record as recordRequirement, loadLedger } from '../termcontrol/bridge/requirements.mjs';
import { confirmReceipt, confirmStarted, trustDecision } from '../termcontrol/bridge/delivery.mjs';
import { adapterFor } from '../termcontrol/bridge/feed.mjs';
import { PATHS } from '../termcontrol/bridge/paths.mjs';
import { mkdirSync } from 'node:fs';
import { botTerminalLimit, liveBotTerminals } from './lib/spawn-guards.mjs';

/** How the receipt checks see the fleet (real daemon and records; tests pass their own). */
export const receiptDeps = () => ({
  panes: fleetPanes,
  screen: (id) => screenOf(id, 40),
  transcript: (p) => { try { return adapterFor(p)?.transcriptPath(p) || null; } catch { return null; } },
  write: (id, data) => requestDaemon({ type: 'writeSession', id, data }, defaultDaemonSocket()),
});

/** Noam's items in the sender's own conversation that nobody has taken yet (TF-102). */
export function untakenItems({ env = process.env, selfId = null } = {}) {
  let items;
  try { items = [...loadLedger().items.values()]; } catch { return []; }
  if (/^[0-9a-f]{12}$/.test(String(env.TERMFLEET_BOT_ID || ''))) return items.filter((it) => it.source === `bot:${env.TERMFLEET_BOT_ID}` && it.status === 'new');
  if (!selfId) return [];
  let session = '';
  try { session = String(JSON.parse(readFileSync(join(PATHS.agentStatus, `pane-${selfId}.json`), 'utf8'))?.sessionId || ''); } catch { session = ''; }
  return session ? items.filter((it) => it.status === 'new' && String(it.source).includes(session)) : [];
}

/**
 * Which of Noam's items a hand-off is for: --req R-1,R-2 and any R-n named in the text.
 * A bot must always name them (or say why not with --no-req); so must an agent that holds
 * untaken items. Returns { ids } or { error }.
 */
export function requirementIds(flags, text, { env = process.env, selfId = null, untaken = untakenItems, ownerWords = null, itemsOf = (msgId) => { try { return [...loadLedger().items.values()].filter((it) => it.msgId === msgId).map((it) => it.id); } catch { return []; } } } = {}) {
  const listed = typeof flags.req === 'string' ? flags.req.split(',').map((x) => normId(x)) : [];
  if (listed.some((x) => !x)) return { error: '--req takes item ids like R-12,R-13 (termfleet-asks items shows them).' };
  // Passing his own message on (--owner-words) carries the items that message was split into.
  const fromOwner = ownerWords?.id ? itemsOf(ownerWords.id) : [];
  const ids = [...new Set([...listed, ...idsIn(text), ...fromOwner])];
  if (ids.length) return { ids };
  if (ownerWords) return { ids: [] };   // a message from before the ledger: his words still travel
  if (flags['no-req'] === true) return { error: '--no-req needs a reason, e.g. --no-req "only asking whether it is free".' };
  if (typeof flags['no-req'] === 'string') return { ids: [] };
  const open = untaken({ env, selfId });
  const inBot = /^[0-9a-f]{12}$/.test(String(env.TERMFLEET_BOT_ID || ''));
  if (inBot || open.length) {
    const hint = open.length ? ` Noam's items not taken yet: ${open.slice(0, 6).map((it) => `${it.id} "${String(it.words).slice(0, 60)}"`).join('; ')}.` : '';
    return { error: `Name the items of Noam's this hand-off is for, so his exact words go with it: --req R-<n>[,R-<n>].${hint} If it is not work on his items (a plain question), add --no-req "<why>".` };
  }
  return { ids: [] };
}

const here = dirname(fileURLToPath(import.meta.url));
const out = (text) => writeSync(1, `${text}\n`);
const fail = (text, code = 1) => { writeSync(2, `${text}\n`); process.exit(code); };

// On/off switches never take the next word: `--dry-run "text"` once swallowed the text,
// so the switch was off and a test message went to a real terminal (2026-10-21).
const SWITCHES = new Set(['interrupt', 'json', 'all', 'dry-run', 'no-wait']);

export function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (SWITCHES.has(key) || next === undefined || next.startsWith('--')) flags[key] = true;
      else { flags[key] = next; i++; }
    } else positional.push(a);
  }
  return { positional, flags };
}

function textArg(positional, flags) {
  if (typeof flags.file === 'string') return readFileSync(flags.file, 'utf8');
  return positional.join(' ');
}

const short = (s, n = 90) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

export function describe(pane, selfId) {
  const who = pane.id === selfId ? ' (you)' : '';
  const parent = pane.parentPaneId ? `  started by ${pane.parentPaneId}` : '';
  return [
    `${pane.id}${who}`,
    `  ${pane.profile?.name ? `${pane.profile.name}${pane.profile.job ? ` (${pane.profile.job})` : ''} · ` : ''}${pane.project} · ${pane.provider} · ${stateOf(pane)}${parent}`,
    pane.goal ? `  Goal: ${short(pane.goal)}` : null,
    pane.statedTask ? `  Task: ${short(pane.statedTask)}` : null,
  ].filter(Boolean).join('\n');
}

async function target(query, selfId) {
  const panes = await fleetPanes();
  const found = resolvePane(panes, query, { selfId });
  if (found.error) fail(found.error);
  return { pane: found.pane, panes };
}

async function main(argv) {
  const [command, ...rest] = argv;
  const { positional, flags } = parseArgs(rest);
  const caller = resolveCaller();
  const selfId = typeof flags.from === 'string' ? flags.from : caller.paneId || null;
  const json = flags.json === true;


  if (command === 'context') {
    const { fleetContextHealth } = await import('./lib/context-health.mjs');
    const health = await fleetContextHealth();
    if (!health.length) return out('No agent terminals with context data.');
    if (json) return out(JSON.stringify(health, null, 2));
    const lines = health.map(h => {
      const bar = h.level === 'critical' ? '🔴' : h.level === 'elevated' ? '🟡' : '🟢';
      const name = h.name || h.paneId.slice(-8);
      const pct = `${Math.round(h.percent)}%`;
      return `${bar} ${name} (${h.provider}) ${pct} context used`;
    });
    return out(lines.join('\n'));
  }
  if (command === 'list') {
    const panes = (await fleetPanes()).filter((p) => flags.all === true || p.alive);
    if (json) return out(JSON.stringify(panes.map((p) => ({ id: p.id, name: p.profile?.name || null, job: p.profile?.job || null, project: p.project, provider: p.provider, state: stateOf(p), goal: p.goal, task: p.statedTask, parentPaneId: p.parentPaneId, self: p.id === selfId })), null, 2));
    if (!panes.length) return out('No agents are running.');
    return out(panes.map((p) => describe(p, selfId)).join('\n\n'));
  }

  if (command === 'read') {
    const { pane } = await target(positional[0], null);
    const messages = recentMessages(pane, { last: Number(flags.last) || 6 });
    // A plain terminal (or an agent with no saved conversation yet) has no messages
    // to read: show what its screen says instead.
    const screen = messages.length ? null : await screenOf(pane.id, Number(flags.lines) || 30);
    if (json) return out(JSON.stringify({ id: pane.id, state: stateOf(pane), messages, screen }, null, 2));
    out(describe(pane, selfId));
    for (const m of messages) out(`\n[${m.kind === 'assistant' ? 'agent' : 'person'}${m.at ? ` ${m.at}` : ''}]\n${m.text}`);
    if (screen != null) out(`\n[screen]\n${screen || '(empty)'}`);
    return;
  }

  if (command === 'send' || command === 'ask') {
    const [who, ...words] = positional;
    // --owner-words latest|<id>: attach Noam's own message, as the bridge recorded it.
    // Checked first, so a missing record never interrupts or reaches anyone.
    let ownerWords = null;
    if (flags['owner-words'] !== undefined) {
      const ref = typeof flags['owner-words'] === 'string' ? flags['owner-words'] : 'latest';
      ownerWords = findOwnerWords(ref, { botId: process.env.TERMFLEET_BOT_ID || null });
      if (!ownerWords) fail(ref === 'latest' && !process.env.TERMFLEET_BOT_ID
        ? 'Use a message id: "latest" works inside a bot. termfleet-team verify lists them.'
        : `No message from Noam matches "${ref}". termfleet-team verify lists the recorded ones.`);
    }
    const text = textArg(words, flags) || (ownerWords ? 'Noam\'s message below is for you.' : '');
    if (!text.trim()) fail('Nothing to send.');
    // TF-102: the hand-off names Noam's items, and his exact words for them (plus his open and
    // approved words on the same topic) are attached; the receipt mark proves it arrived.
    const reqs = requirementIds(flags, text, { selfId, ownerWords });
    if (reqs.error) fail(reqs.error);
    const delivery = newDeliveryId();
    let requirements = null;
    if (reqs.ids.length) {
      const brief = briefItems(reqs.ids);
      if (brief.error) fail(brief.error);
      requirements = briefBlock(brief, { delivery });
    }
    // --dry-run: print exactly what the receiver would get, send nothing.
    if (flags['dry-run'] === true) {
      const sender = process.env.TERMFLEET_BOT_NAME ? { id: `bot:${process.env.TERMFLEET_BOT_ID || ''}`, bot: process.env.TERMFLEET_BOT_NAME } : (selfId ? { id: selfId } : null);
      return out(framedMessage(text, sender, { ownerWords, requirements, delivery }));
    }
    const { pane, panes } = await target(who, selfId);
    // A plain shell terminal has no agent to receive and queue a message; typing text into it
    // as commands is a safety bug. Refuse the send entirely.
    if (pane.provider === 'shell') fail(`Cannot send to ${pane.profile?.name || pane.project || pane.id} (${pane.id}): it is a plain shell with no agent. Text typed into it would run as commands. Hand it over first, or start an agent in it.`);
    // A bot runs outside the terminals; its messages say which bot sent them.
    const bot = process.env.TERMFLEET_BOT_NAME && !caller.paneId ? { id: `bot:${process.env.TERMFLEET_BOT_ID || ''}`, bot: process.env.TERMFLEET_BOT_NAME } : null;
    const from = bot || panes.find((p) => p.id === selfId) || (selfId ? { id: selfId } : null);
    if (flags.interrupt === true) {
      // Esc stops the running turn in Claude, Codex and OpenCode; the message then
      // starts a fresh one instead of waiting in the queue (Grok Bot's "interrupt").
      await requestDaemon({ type: 'writeSession', id: pane.id, data: '\u001b' }, defaultDaemonSocket());
      await new Promise((r) => setTimeout(r, 600));
    }
    // A startup question on screen (Claude's folder trust, Codex's hook review) is answered or
    // reported first: typed text and Enter went into it and chose "No, exit" (2026-10-23).
    if (['claude', 'codex'].includes(pane.provider)) {
      const startup = trustDecision(await screenOf(pane.id, 40), { cwd: pane.cwd || null });
      if (startup?.error) fail(`NOT sent to ${pane.profile?.name || pane.project} (${pane.id}). ${startup.error}`, 3);
      if (startup?.press) {
        await requestDaemon({ type: 'writeSession', id: pane.id, data: startup.press }, defaultDaemonSocket());
        await new Promise((r) => setTimeout(r, 200));
        await requestDaemon({ type: 'writeSession', id: pane.id, data: '\r' }, defaultDaemonSocket());
        await new Promise((r) => setTimeout(r, 2500));
        out(startup.note);
      }
    }
    const since = Date.now();
    const wasBusy = pane.turn === 'working' || pane.producing === true;
    const sent = await delegate(pane, text, { from, ownerWords, requirements, delivery });
    if (sent.error) fail(sent.message || sent.error);
    // Delivered means received: the mark is in its conversation, or it started a turn.
    const receipt = await confirmReceipt(pane, { token: `[delivery ${delivery}]`, wasBusy, timeoutMs: (Number(flags['receipt-timeout']) || 25) * 1000, deps: receiptDeps() });
    for (const note of receipt.notes) out(note);
    const name = pane.profile?.name || pane.project;
    if (!receipt.received && !receipt.queued) {
      recordInBot({ role: 'handoff', pane: pane.id, to: name, text: `NOT delivered: ${receipt.message}`.slice(0, 600) });
      fail(`NOT delivered to ${name} (${pane.id}). ${receipt.message}`, 3);
    }
    if (reqs.ids.length) recordRequirement(reqs.ids.map((id) => ({ e: 'assign', id, pane: pane.id, delivery: receipt.queued ? `${delivery}:queued` : delivery, by: from?.id || selfId || null })));
    recordInBot({ role: 'handoff', pane: pane.id, to: name, text: text.trim().slice(0, 600) });
    if (receipt.queued && botFolder()) recordHelper({ paneId: pane.id, provider: pane.provider || null, task: String(text).trim().slice(0, 200), cwd: pane.cwd || null, followed: true });
    const items = reqs.ids.length ? ` with Noam's items ${reqs.ids.join(', ')}` : '';
    if (command === 'send') return out(json ? JSON.stringify({ ok: true, id: pane.id, received: receipt.received, queued: Boolean(receipt.queued), delivery, items: reqs.ids }) : receipt.received
      ? `Sent to ${name} (${pane.id})${items}; it received it.`
      : `Typed into ${name} (${pane.id})${items}, NOT read yet: ${receipt.message}${botFolder() ? ' You are following it and will be woken when its turn ends.' : ''}`);
    // A bot that waits silently looks stuck (paper-bot_dev sat 10 minutes on "Checking
    // something"): inside a bot, wait at most 2 minutes, then follow the agent instead.
    const inBot = Boolean(botFolder());
    const limit = Number(flags.timeout) || (inBot ? 120 : 600);
    const result = await waitForReply(pane.id, { since, timeoutMs: limit * 1000 });
    if (inBot && result.error && /time/i.test(`${result.error} ${result.note || ''}`)) {
      recordHelper({ paneId: pane.id, provider: pane.provider || null, task: String(text).trim().slice(0, 200), cwd: pane.cwd || null, followed: true });
      return out(`${pane.profile?.name || pane.project} is still working after ${Math.round(limit / 60)} minutes. You are now following it and will be woken when it finishes its turn. Tell Noam in one plain sentence that it is in progress, then end your turn.`);
    }
    if (json) return out(JSON.stringify(result.error ? result : { state: result.state, reply: result.reply, note: result.note || null }, null, 2));
    if (result.error) fail(result.note || result.error, 2);
    if (result.note) out(result.note);
    return out(result.reply ? result.reply.text : 'It finished without a written answer; use read to look.');
  }

  if (command === 'wait') {
    const { pane } = await target(positional[0], null);
    const inBotWait = Boolean(botFolder());
    const waitLimit = Number(flags.timeout) || (inBotWait ? 120 : 600);
    const result = await waitForReply(pane.id, { since: 0, timeoutMs: waitLimit * 1000 });
    if (inBotWait && result.error && /time/i.test(`${result.error} ${result.note || ''}`)) {
      recordHelper({ paneId: pane.id, provider: pane.provider || null, task: pane.title || pane.project || '', cwd: pane.cwd || null, followed: true });
      return out(`${pane.profile?.name || pane.project} is still working after ${Math.round(waitLimit / 60)} minutes. You are now following it and will be woken when it finishes. Tell Noam it is in progress, then end your turn.`);
    }
    if (json) return out(JSON.stringify(result, null, 2));
    if (result.error) fail(result.note || result.error, 2);
    return out(result.reply ? result.reply.text : `${pane.project} is ${result.state}.`);
  }

  if (command === 'start') {
    // One bot runs at most a few terminals at once (default 3): past that it closes one first.
    const ownDir = botFolder();
    if (ownDir) {
      let helpers = [], bot = null;
      try { helpers = JSON.parse(readFileSync(join(ownDir, 'helpers.json'), 'utf8')); } catch { helpers = []; }
      try { bot = JSON.parse(readFileSync(join(ownDir, 'bot.json'), 'utf8')); } catch { bot = null; }
      const limit = botTerminalLimit({ bot });
      const running = liveBotTerminals(helpers, await fleetPanes());
      if (running.length >= limit) fail(`Not started: you already run ${running.length} terminals (${running.join(', ')}) and the limit is ${limit}. Close one you are done with (termfleet-team close <who>) or wait for one to finish, then start again.`, 4);
    }
    // TF-102: the task carries Noam's items in his words and a receipt mark, so the start is
    // confirmed only once the new agent has really begun (not stuck on a startup prompt).
    let taskText = typeof flags['task-file'] === 'string' ? readFileSync(flags['task-file'], 'utf8') : typeof flags.task === 'string' ? flags.task : '';
    const reqs = taskText ? requirementIds(flags, taskText, { selfId }) : { ids: [] };
    if (reqs.error) fail(reqs.error);
    const delivery = taskText ? newDeliveryId() : null;
    if (taskText) {
      if (reqs.ids.length) { const brief = briefItems(reqs.ids); if (brief.error) fail(brief.error); taskText = `${taskText.trim()}\n\n${briefBlock(brief, { delivery })}`; }
      else taskText = `${taskText.trim()}\n\n[delivery ${delivery}]`;
    }
    const args = ['spawn'];
    for (const key of ['provider', 'model', 'cwd', 'title', 'goal', 'near']) if (typeof flags[key] === 'string') args.push(`--${key}`, flags[key]);
    if (taskText) {
      const dir = join(os.homedir(), '.cache', 'termfleet', 'tasks');
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const file = join(dir, `${delivery}.md`);
      writeFile(file, taskText, { mode: 0o600 });
      args.push('--task-file', file);
    }
    const run = spawnSync(process.execPath, [join(here, 'termfleet-child.mjs'), ...args], { stdio: ['inherit', 'pipe', 'inherit'], encoding: 'utf8' });
    process.stdout.write(run.stdout || '');
    let made = {};
    try { made = JSON.parse(String(run.stdout || '').trim().split('\n').filter((l) => l.startsWith('{')).pop() || '{}'); } catch { made = {}; }
    if (made.childPaneId) {
      recordHelper({ paneId: made.childPaneId, provider: flags.provider || null, task: String(flags.task || flags.title || '').slice(0, 300), cwd: flags.cwd || null });
      recordInBot({ role: 'handoff', pane: made.childPaneId, to: 'a new terminal agent', text: String(flags.task || flags.title || '').slice(0, 600) });
      if (taskText && flags['no-wait'] !== true) {
        const started = await confirmStarted(made.childPaneId, { token: `[delivery ${delivery}]`, timeoutMs: (Number(flags['start-timeout']) || 90) * 1000, deps: receiptDeps() });
        for (const note of started.notes) out(note);
        if (!started.started) {
          recordInBot({ role: 'handoff', pane: made.childPaneId, to: 'a new terminal agent', text: `NOT started: ${started.message}`.slice(0, 600) });
          fail(`The new terminal (${made.childPaneId}) did NOT start its task. ${started.message}`, 3);
        }
        if (reqs.ids.length) recordRequirement(reqs.ids.map((id) => ({ e: 'assign', id, pane: made.childPaneId, delivery, by: selfId || null })));
        out(`It started its task${reqs.ids.length ? ` with Noam's items ${reqs.ids.join(', ')}` : ''}.`);
      }
    }
    process.exit(run.status ?? 1);
  }

  if (command === 'follow') {
    // A bot that says it will check back must be woken: following an agent wakes the
    // bot when that agent next finishes (any agent, not only ones it started).
    if (!botFolder()) fail('Following works inside a bot.');
    const { pane } = await target(positional[0], null);
    const why = String(flags.why || pane.title || pane.project || '').slice(0, 300);
    recordHelper({ paneId: pane.id, provider: pane.provider || null, task: why, cwd: pane.cwd || null, followed: true });
    return out(`Following ${pane.profile?.name || pane.project} (${pane.id}): you will be woken when it finishes its turn.`);
  }

  if (command === 'unfollow') {
    // Noam 2026-10-21: bots kept reporting other bots' work he never asked about.
    const dir = botFolder();
    if (!dir) fail('Unfollowing works inside a bot.');
    const file = join(dir, 'helpers.json');
    let list = [];
    try { list = JSON.parse(readFileSync(file, 'utf8')); } catch { list = []; }
    let paneId = null, name = 'every agent you follow';
    if (flags.all !== true) {
      const query = positional.join(' ').trim();
      if (!query) fail('Say whom to unfollow, or use --all.');
      // A closed terminal is no longer in the fleet, so its id is matched straight from the list.
      const known = list.find((h) => h?.paneId === query);
      if (known) paneId = known.paneId;
      else { const { pane } = await target(query, null); paneId = pane.id; name = pane.profile?.name || pane.project || pane.id; }
      if (known) name = known.task || known.paneId;
    }
    const { list: next, count } = endFollows(list, { paneId, all: flags.all === true });
    if (!count) return out(flags.all === true ? 'You were not following anyone.' : `You were not following ${name}.`);
    writeFile(file, JSON.stringify(next, null, 1), { mode: 0o600 });
    return out(`Stopped following ${name}${count > 1 && flags.all === true ? ` (${count})` : ''}: its turns will not wake you.`);
  }

  if (command === 'close') {
    // A bot closes terminals it started; a terminal agent closes its own children, or itself
    // ("close self") once its work is done. Never anyone else's: Noam closes those.
    const dir = botFolder();
    const { closeOwnTerminal, panesAfterTwoLooks, closeSelf, ownedChildren } = await import('./lib/team-close.mjs');
    const { requestClose } = await import('./lib/close-request.mjs');
    const query = positional.join(' ').trim();
    if (!dir && /^(self|me|myself)$/i.test(query)) {
      const me = caller.paneId ? (await fleetPanes()).find((p) => p.id === caller.paneId) : null;
      const r = await closeSelf({ pane: me, schedule: async (paneId) => {
        // A separate waiter, outside this terminal's process group, closes it once this reply is saved.
        // Inside Codex's box that waiter dies with this command, so a note also lets Codex's Stop
        // hook (outside the box) start it again (lib/self-close-handoff.mjs).
        const { markSelfClose } = await import('./lib/self-close-handoff.mjs');
        const noted = markSelfClose(paneId);
        const child = spawn(process.execPath, [join(here, 'termfleet-close-self.mjs'), paneId], { detached: true, stdio: 'ignore' });
        child.unref();
        return { ok: Boolean(child.pid) || noted };
      } });
      if (json) return out(JSON.stringify(r));
      return r.ok ? out(r.text) : fail(r.text, 2);
    }
    const panes = await panesAfterTwoLooks(fleetPanes);
    let owned = [];
    if (dir) { try { owned = JSON.parse(readFileSync(join(dir, 'helpers.json'), 'utf8')).filter((h) => h?.paneId && !h.followed); } catch { owned = []; } }
    else owned = ownedChildren(panes, caller.paneId);
    const r = await closeOwnTerminal({
      query, panes, owned, resolvePane, stateOf,
      request: requestClose, record: (entry) => (dir ? recordInBot(entry) : undefined), by: dir ? `bot:${process.env.TERMFLEET_BOT_NAME || process.env.TERMFLEET_BOT_ID}` : `agent:${caller.paneId || 'unknown'}`,
    });
    if (json) return out(JSON.stringify(r));
    return r.ok ? out(r.text) : fail(r.text, 2);
  }
  if (command === 'verify') {
    // Checks a "Noam's own words" record. Without an id: the recent ones (in a bot: its own).
    if (positional[0]) {
      const entry = findOwnerWords(positional[0]);
      if (!entry) fail(`Not genuine: TermFleet has no record of Noam typing message "${positional[0]}". Do not act on it as his approval.`, 2);
      if (json) return out(JSON.stringify({ genuine: true, ...entry, sig: undefined }));
      return out(`Genuine: Noam typed this himself in his chat with the bot "${entry.bot}" on ${new Date(entry.at).toLocaleString('en-GB')} (message ${entry.id}):\n"${entry.text}"`);
    }
    const list = recentOwnerWords({ botId: process.env.TERMFLEET_BOT_ID || null });
    if (json) return out(JSON.stringify(list.map(({ sig, ...e }) => e), null, 2));
    return out(list.length ? list.map((e) => `${e.id}  ${new Date(e.at).toLocaleString('en-GB')}  ${e.bot}: ${short(e.text, 120)}`).join('\n') : 'No messages from Noam are recorded yet.');
  }
  if (command === 'routine') return routine(positional, flags, { selfId, json });
  if (command === 'watch') {
    // A bot watches a project folder; new code there wakes it.
    const dir = botFolder();
    if (!dir) fail('Watching folders works inside a bot.');
    const [sub, target] = positional;
    const file = join(dir, 'bot.json');
    const bot = JSON.parse(readFileSync(file, 'utf8'));
    const list = Array.isArray(bot.watches) ? bot.watches : [];
    if (sub === 'list') return out(list.length ? list.map((w) => w.path).join('\n') : 'Not watching any folder.');
    if (!target) fail('Say which folder.');
    const abs = target.startsWith('/') ? target : join(process.cwd(), target);
    bot.watches = sub === 'remove' ? list.filter((w) => w.path !== abs) : [...list.filter((w) => w.path !== abs), { path: abs, head: null }].slice(-20);
    writeFile(file, JSON.stringify(bot, null, 1), { mode: 0o600 });
    return out(sub === 'remove' ? `Stopped watching ${abs}.` : `Watching ${abs}: new code there will wake you.`);
  }

  out(USAGE);
  process.exit(command ? 1 : 0);
}

export function parseDays(value) {
  const v = String(value || 'daily').toLowerCase();
  if (v === 'daily' || v === 'every day') return [0, 1, 2, 3, 4, 5, 6];
  if (v === 'weekdays' || v === 'mon-fri') return [1, 2, 3, 4, 5];
  if (v === 'sun-thu') return [0, 1, 2, 3, 4];
  const names = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  return v.split(',').map((d) => d.trim()).map((d) => (/^\d$/.test(d) ? Number(d) : names.indexOf(d.slice(0, 3)))).filter((d) => d >= 0 && d <= 6);
}

async function routine(positional, flags, { selfId, json }) {
  const [sub, ...words] = positional;
  const store = new Routines();
  const owner = async () => {
    // Inside a bot, its own schedules belong to the bot (TF-096 part 7).
    if (typeof flags.for !== 'string' && process.env.TERMFLEET_BOT_ID && !selfId) return { id: `bot:${process.env.TERMFLEET_BOT_ID}` };
    if (typeof flags.for !== 'string') return selfId ? { id: selfId } : fail('Run this inside a TermFleet terminal, or say --for <who>.');
    const found = resolvePane(await fleetPanes(), flags.for);
    return found.error ? fail(found.error) : found.pane;
  };
  if (sub === 'add') {
    const pane = await owner();
    const text = typeof flags.message === 'string' ? flags.message : textArg(words, flags);
    const made = store.create({ pane: pane.id, text, days: parseDays(flags.days), time: String(flags.time || ''), createdBy: selfId });
    if (made.error) fail(made.error);
    const r = made.routine;
    return out(json ? JSON.stringify(r, null, 2) : `Scheduled ${r.id}: ${describeDays(r.days)} at ${r.time}. Next run ${new Date(r.nextRunAt).toLocaleString()}.`);
  }
  if (sub === 'list' || !sub) {
    const pane = await owner();
    const items = store.forPane(pane.id);
    if (json) return out(JSON.stringify(items, null, 2));
    return out(items.length ? items.map((r) => `${r.id}  ${describeDays(r.days)} ${r.time}  ${r.enabled ? 'on' : 'paused'}  ${short(r.text, 60)}`).join('\n') : 'No schedules.');
  }
  if (sub === 'remove') {
    const removed = store.remove(words[0]);
    if (removed.error) fail(removed.error);
    return out('Removed.');
  }
  fail(`Unknown routine command "${sub}".`);
}

const USAGE = readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1).filter((l, i, all) => all.slice(0, i + 1).every((x) => x.startsWith('//'))).map((l) => l.replace(/^\/\/ ?/, '')).join('\n');

const startedAsCommand = (() => {
  try { return realpathSync(process.argv[1] ?? '') === realpathSync(fileURLToPath(import.meta.url)); } catch { return true; }
})();
if (startedAsCommand) {
  main(process.argv.slice(2)).then(() => process.exit(0), (error) => fail(String(error?.message || error)));
}
