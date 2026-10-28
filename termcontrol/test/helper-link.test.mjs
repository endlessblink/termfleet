import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { linkObservedHelper } from '../bridge/helper-link.mjs';

function fixture(t, initial) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helper-link-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const botId = 'aaaaaaaaaaaa', requestId = 'R-12', paneId = 'terminal-exact';
  const file = path.join(root, 'helpers.json');
  if (initial !== undefined) fs.writeFileSync(file, JSON.stringify(initial));
  const item = { id: requestId, source: `bot:${botId}`, words: 'Original request', status: 'assigned', assigned: [{ pane: 'older', delivery: 'D-old' }, { pane: paneId, delivery: 'D-exact' }] };
  const pane = { id: paneId, alive: true, provider: 'codex', sessionId: 'actual-session', cwd: '/project', turn: 'working', producing: true };
  const bots = { read: (id) => id === botId ? { id, sessions: { codex: 'bot-session' } } : null, folder: (id) => { assert.equal(id, botId); return root; } };
  const args = { botId, requestId, paneId }, deps = { items: new Map([[requestId, item]]), panes: [pane], bots, now: 1234 };
  return { args, deps, item, pane, file, call: (argsPatch = {}, depsPatch = {}) => linkObservedHelper({ ...args, ...argsPatch }, { ...deps, ...depsPatch }) };
}

test('exact request assignment and live session create only an observer without touching source authority', (t) => {
  const f = fixture(t), before = structuredClone({ item: f.item, pane: f.pane, bot: f.deps.bots.read(f.args.botId) });
  const result = f.call();
  assert.equal(result.ok, true); assert.equal(result.created, true);
  assert.deepEqual(result.helper, { paneId: 'terminal-exact', provider: 'codex', cwd: '/project', followed: true, requestId: 'R-12', delivery: 'D-exact', sessionId: 'actual-session', linkedBy: 'owner-correction', at: 1234 });
  assert.deepEqual(JSON.parse(fs.readFileSync(f.file, 'utf8')), [result.helper]);
  assert.deepEqual({ item: f.item, pane: f.pane, bot: f.deps.bots.read(f.args.botId) }, before);
  assert.deepEqual(f.call(), { ok: true, helper: result.helper, created: false });
});

test('unknown bot, wrong request source, old assignment and absent delivery refuse without writes', (t) => {
  const f = fixture(t);
  assert.equal(f.call({ botId: '../invalid' }).ok, false);
  assert.equal(f.call({ botId: 'bbbbbbbbbbbb' }).ok, false);
  assert.equal(f.call({ requestId: 'R-other' }).ok, false);
  assert.equal(f.call({ paneId: 'older' }).ok, false);
  f.item.source = 'bot:bbbbbbbbbbbb'; assert.equal(f.call().ok, false);
  f.item.source = `bot:${f.args.botId}`;
  f.item.assigned.at(-1).delivery = ' '; assert.equal(f.call().ok, false);
  assert.equal(fs.existsSync(f.file), false);
});

test('dead, absent or sessionless terminals refuse without contacting worker', (t) => {
  const f = fixture(t);
  assert.equal(f.call({}, { panes: [] }).ok, false);
  f.pane.alive = false; assert.equal(f.call().ok, false);
  f.pane.alive = true; f.pane.sessionId = ''; assert.equal(f.call().ok, false);
  assert.equal(fs.existsSync(f.file), false);
});

test('complete helper history and owned or ended links are preserved byte for byte', (t) => {
  const owned = { paneId: 'terminal-exact', followed: false, task: 'Original task', at: 1 };
  const history = [owned, ...Array.from({ length: 25 }, (_, i) => ({ paneId: `other-${i}`, task: `older ${i}`, at: i }))];
  const f = fixture(t, history), before = fs.readFileSync(f.file, 'utf8');
  assert.deepEqual(f.call(), { ok: true, helper: owned, created: false });
  assert.equal(fs.readFileSync(f.file, 'utf8'), before);
  const ended = { paneId: 'terminal-exact', followed: true, ended: 12, task: 'Observed earlier', at: 1 };
  fs.writeFileSync(f.file, JSON.stringify([ended]));
  assert.deepEqual(f.call(), { ok: true, helper: ended, created: false });
  assert.deepEqual(JSON.parse(fs.readFileSync(f.file, 'utf8')), [ended]);
});

test('adding observation retains older entries and invalid history fails closed', (t) => {
  const history = [{ paneId: 'older-owned', task: 'keep', at: 1 }], f = fixture(t, history);
  assert.equal(f.call().created, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.file, 'utf8'))[0], history[0]);
  fs.writeFileSync(f.file, '{broken'); assert.equal(f.call().ok, false);
  assert.equal(fs.readFileSync(f.file, 'utf8'), '{broken');
  fs.writeFileSync(f.file, '{}'); assert.equal(f.call().ok, false);
});
