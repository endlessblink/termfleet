// Noam 2026-10-20: right-click a bot to close it: everything tied to it, one plain line each;
// anything mid-work starts unticked and says what would be lost; nothing is deleted.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { botClosePlan, closeBotItems, isManagerBot } from '../bridge/bot-close.mjs';
import { Bots } from '../bridge/bots.mjs';
import { Routines } from '../bridge/routines.mjs';

const bot = { id: 'b1', name: 'Quill', state: 'working', activity: 'Reading the photo upload code', helpers: [
  { paneId: 'terminal-done', task: 'Run the phone tests' },
  { paneId: 'terminal-busy', task: 'Fix the photo upload on your phone' },
  { paneId: 'terminal-ask', task: 'Render the intro' },
  { paneId: 'terminal-gone', task: 'Old job' },
  { paneId: 'terminal-noam', task: 'paper bot fix', followed: true },
] };
const panes = [
  { id: 'terminal-done', turn: 'idle', alive: true, task: 'All 14 checks pass' },
  { id: 'terminal-busy', turn: 'working', alive: true, sessionViewV2: { now: { label: 'Halfway: resizing the picture before upload' } } },
  { id: 'terminal-ask', turn: 'waiting', alive: true },
  { id: 'terminal-noam', turn: 'idle', alive: true },
];

test('the sheet lists what the bot runs, plain words, mid-work unticked with what is lost', () => {
  const plan = botClosePlan({ bot, panes, routines: [{ id: 'r1', enabled: true, days: [1, 2, 3, 4, 5], time: '09:00', text: 'Morning summary' }, { id: 'r2', enabled: false, days: [0], time: '10:00', text: 'x' }], watches: [{ path: '/repo/rough-cut-mvp' }] });
  assert.deepEqual(plan.items.map((i) => [i.id, i.checked]), [
    ['turn', false], ['terminal:terminal-done', true], ['terminal:terminal-busy', false], ['terminal:terminal-ask', false], ['routine:r1', true], ['watch:/repo/rough-cut-mvp', true],
  ]);
  const busy = plan.items.find((i) => i.id === 'terminal:terminal-busy');
  assert.equal(busy.label, 'Fix the photo upload on your phone');
  assert.equal(busy.now, 'Working: Halfway: resizing the picture before upload');
  assert.match(busy.loses, /anything it has not saved is lost/);
  assert.match(plan.items.find((i) => i.id === 'terminal:terminal-ask').loses, /question to you is dropped/);
  assert.equal(plan.items.find((i) => i.id === 'routine:r1').label, 'Scheduled message, weekdays at 09:00');
  assert.equal(plan.warning, undefined);
  assert.match(botClosePlan({ bot: { ...bot, name: 'Agent-Manager' } }).warning, /manages your other agents/);
  assert.equal(isManagerBot({ name: 'Quill' }), false);
});

test('closing does only what was ticked, pauses rather than deletes, keeps chat and memory', async () => {
  const bots = new Bots({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'tc-botclose-')), run: async () => ({ text: 'ok' }), fill: () => null, checks: { home: os.homedir() } });
  const { bot: made } = bots.create({ name: 'Quill', cwd: os.tmpdir() });
  bots.setWatch(made.id, { path: '/repo/x', head: 'abc' });
  const routines = new Routines({ file: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tc-r-')), 'r.json') });
  const r = routines.create({ pane: `bot:${made.id}`, text: 'Morning summary', days: [1], time: '09:00' }).routine;
  const closed = [];
  const plan = botClosePlan({ bot: { ...bot, id: made.id, state: 'idle' }, panes, routines: routines.forPane(`bot:${made.id}`), watches: bots.watches(made.id) });
  const out = await closeBotItems({ botId: made.id, ids: ['terminal:terminal-done', `routine:${r.id}`, 'watch:/repo/x'], plan, bots, routines,
    requestClose: async (id) => { closed.push(id); return { ok: true }; } });
  assert.equal(out.ok, true);
  assert.deepEqual(closed, ['terminal-done'], 'the busy terminal Noam left unticked stays open');
  assert.equal(routines.forPane(`bot:${made.id}`)[0].enabled, false, 'paused, still there');
  assert.deepEqual(bots.watches(made.id), [{ path: '/repo/x', head: 'abc', paused: true }]);
  assert.match(bots.messages(made.id).at(-1).text, /Noam closed: Run the phone tests; Scheduled message.*The chat and memory are kept/);
  assert.ok(bots.read(made.id), 'the bot itself is kept');
});

test('a reply in progress stops cleanly and says so', async () => {
  let release;
  const bots = new Bots({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'tc-botstop-')), fill: () => null, checks: { home: os.homedir() },
    run: (_bot, _text, { onStart }) => new Promise((resolve) => { onStart(() => resolve({ stopped: true, error: 'Stopped by Noam.' })); release = resolve; }) });
  bots.preflight = () => ({ ok: true });
  const { bot: made } = bots.create({ name: 'Quill', cwd: os.tmpdir() });
  bots.send(made.id, 'do a long thing');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(bots.stop(made.id).wasRunning, true);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(bots.messages(made.id).at(-1).text, 'You stopped this reply. Ask again any time.');
  assert.equal(bots.running.has(made.id), false);
  assert.ok(release);
});
