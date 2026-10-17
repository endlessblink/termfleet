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
//   termfleet-team ask <who> <text>          send, wait for the answer, print it
//   termfleet-team wait <who>                wait for its current turn to finish
//   termfleet-team start --provider P --task T [--cwd D] [--title X]
//                                            a new helper terminal (termfleet-child)
//   termfleet-team routine add --time 09:00 --days daily|weekdays|sun-thu|0,1,2
//                          --message T [--for <who>]   a scheduled message (default: you)
//   termfleet-team routine list [--for <who>] | routine remove <id>
//   termfleet-team watch add|remove|list <folder>   (inside a bot) new code there wakes it
//   termfleet-team follow <who> [--why T]  (inside a bot) wake me when that agent finishes its turn
//
// <who> is a teammate's name, a terminal id, a unique part of one, or a project name.
// Add --json for machine-readable output; --file F reads the text from a file.
import { readFileSync, realpathSync, writeSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  fleetPanes, resolvePane, stateOf, recentMessages, delegate, waitForReply,
} from '../termcontrol/bridge/orchestrate.mjs';
import { resolveCaller } from './termfleet-child.mjs';
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

const here = dirname(fileURLToPath(import.meta.url));
const out = (text) => writeSync(1, `${text}\n`);
const fail = (text, code = 1) => { writeSync(2, `${text}\n`); process.exit(code); };

export function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) flags[key] = true;
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
    const text = textArg(words, flags);
    if (!text.trim()) fail('Nothing to send.');
    const { pane, panes } = await target(who, selfId);
    // A bot runs outside the terminals; its messages say which bot sent them.
    const bot = process.env.TERMFLEET_BOT_NAME && !caller.paneId ? { id: `bot:${process.env.TERMFLEET_BOT_ID || ''}`, bot: process.env.TERMFLEET_BOT_NAME } : null;
    const from = bot || panes.find((p) => p.id === selfId) || (selfId ? { id: selfId } : null);
    if (flags.interrupt === true) {
      // Esc stops the running turn in Claude, Codex and OpenCode; the message then
      // starts a fresh one instead of waiting in the queue (Grok Bot's "interrupt").
      await requestDaemon({ type: 'writeSession', id: pane.id, data: '\u001b' }, defaultDaemonSocket());
      await new Promise((r) => setTimeout(r, 600));
    }
    const since = Date.now();
    const sent = await delegate(pane, text, { from });
    if (sent.error) fail(sent.message || sent.error);
    recordInBot({ role: 'handoff', pane: pane.id, to: pane.profile?.name || pane.project, text: text.trim().slice(0, 600) });
    if (command === 'send') return out(json ? JSON.stringify({ ok: true, id: pane.id, delivered: sent.delivered }) : `Sent to ${pane.project} (${pane.id})${sent.delivered ? '' : ' — not yet visible on its screen; check with read'}.`);
    const result = await waitForReply(pane.id, { since, timeoutMs: (Number(flags.timeout) || 600) * 1000 });
    if (json) return out(JSON.stringify(result.error ? result : { state: result.state, reply: result.reply, note: result.note || null }, null, 2));
    if (result.error) fail(result.note || result.error, 2);
    if (result.note) out(result.note);
    return out(result.reply ? result.reply.text : 'It finished without a written answer; use read to look.');
  }

  if (command === 'wait') {
    const { pane } = await target(positional[0], null);
    const result = await waitForReply(pane.id, { since: 0, timeoutMs: (Number(flags.timeout) || 600) * 1000 });
    if (json) return out(JSON.stringify(result, null, 2));
    if (result.error) fail(result.note || result.error, 2);
    return out(result.reply ? result.reply.text : `${pane.project} is ${result.state}.`);
  }

  if (command === 'start') {
    const args = ['spawn'];
    for (const key of ['provider', 'task', 'task-file', 'cwd', 'title', 'goal', 'near']) if (typeof flags[key] === 'string') args.push(`--${key}`, flags[key]);
    const run = spawnSync(process.execPath, [join(here, 'termfleet-child.mjs'), ...args], { stdio: ['inherit', 'pipe', 'inherit'], encoding: 'utf8' });
    process.stdout.write(run.stdout || '');
    try {
      const made = JSON.parse(String(run.stdout || '').trim().split('\n').filter((l) => l.startsWith('{')).pop() || '{}');
      if (made.childPaneId) {
        recordHelper({ paneId: made.childPaneId, provider: flags.provider || null, task: String(flags.task || flags.title || '').slice(0, 300), cwd: flags.cwd || null });
        recordInBot({ role: 'handoff', pane: made.childPaneId, to: 'a new terminal agent', text: String(flags.task || flags.title || '').slice(0, 600) });
      }
    } catch { /* the helper still started; only the record is missing */ }
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
