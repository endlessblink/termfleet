import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Bots, runBrain } from '../bridge/bots.mjs';

const until = async fn => {
  const deadline = Date.now() + 3000;
  while (!fn()) {
    if (Date.now() > deadline) throw new Error('Synthetic bot did not reach the expected event');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
};

async function fixture(t, events, finalEvents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-progress-'));
  const home = path.join(dir, 'home');
  fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
  fs.writeFileSync(path.join(home, '.codex', 'auth.json'), '{}');
  const socket = path.join(dir, 'fake.sock');
  fs.writeFileSync(socket, '');
  const marker = path.join(dir, 'waiting'), release = path.join(dir, 'release');
  const bin = path.join(dir, 'fake-codex.mjs');
  fs.writeFileSync(bin, `#!/usr/bin/env node
import fs from 'node:fs';
const out = event => process.stdout.write(JSON.stringify(event) + '\\n');
out({type:'thread.started', thread_id:'synthetic-progress'});
for (const event of ${JSON.stringify(events)}) out(event);
fs.writeFileSync(${JSON.stringify(marker)}, 'waiting');
const timer = setInterval(() => {
  if (!fs.existsSync(${JSON.stringify(release)})) return;
  clearInterval(timer);
  for (const event of ${JSON.stringify(finalEvents)}) out(event);
}, 5);
`, { mode: 0o755 });
  let observed = 0;
  const bots = new Bots({ dir: path.join(dir, 'bots'), checks: { home, socket },
    bins: { codex: bin }, fill: () => null,
    run: (bot, text, options) => runBrain(bot, text, { ...options,
      env: { ...process.env, TERMFLEET_GENTLE_BRAINS: '0' },
      onEvent: event => {
        if (event.text || event.activity) observed++;
        options.onEvent(event);
      } }) });
  const { bot } = bots.create({ name: 'Progress fixture', provider: 'codex', cwd: dir });
  t.after(async () => {
    fs.writeFileSync(release, 'release');
    await until(() => !bots.running.has(bot.id));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  assert.equal(bots.send(bot.id, 'Inspect the synthetic task.').ok, true);
  await until(() => fs.existsSync(marker));
  // The marker is written after stdout, whose pipe may be consumed on the next tick.
  await until(() => observed >= events.length);
  return { bots, id: bot.id, release: async () => {
    fs.writeFileSync(release, 'release');
    await until(() => !bots.running.has(bot.id));
  } };
}

const message = text => ({ type: 'item.completed', item: { id: text, type: 'agent_message', text } });
const working = { type: 'item.started', item: { id: 'check', type: 'command_execution', command: 'node check.mjs' } };
const completed = { type: 'turn.completed' };

test('Codex progress reaches chat and side context before its next tool finishes, with one final reply', async t => {
  const f = await fixture(t, [message('Checking the delayed task.'), working], [message('The check returned two findings.'), completed]);
  const progress = f.bots.view(f.id).messages.filter(m => m.progress);
  assert.deepEqual(progress.map(m => m.text), ['Checking the delayed task.']);
  assert.deepEqual(f.bots.running.get(f.id).said, ['Checking the delayed task.']);
  assert.equal(f.bots.summary(f.id).state, 'working');
  assert.equal(f.bots.view(f.id).messages.some(m => m.role === 'bot'), false);
  await f.release();
  const chat = f.bots.view(f.id).messages;
  assert.deepEqual(chat.filter(m => m.role === 'bot').map(m => m.text), ['The check returned two findings.']);
  assert.equal(chat.some(m => m.progress && m.text === 'The check returned two findings.'), false);
});

test('a final-only Codex message is not published as progress before turn completion', async t => {
  const f = await fixture(t, [message('The final result.')], [completed]);
  assert.equal(f.bots.view(f.id).messages.some(m => m.progress || m.role === 'bot'), false);
  await f.release();
  assert.deepEqual(f.bots.view(f.id).messages.filter(m => m.role === 'bot').map(m => m.text), ['The final result.']);
});

test('replayed progress is not repeated and side context stays bounded', async t => {
  const events = [];
  for (let i = 0; i < 9; i++) events.push(message(`Checking step ${i}.`), working, working);
  const f = await fixture(t, events, [message('The check is finished.'), completed]);
  assert.deepEqual(f.bots.view(f.id).messages.filter(m => m.progress).map(m => m.text), Array.from({ length: 9 }, (_, i) => `Checking step ${i}.`));
  assert.deepEqual(f.bots.running.get(f.id).said, Array.from({ length: 6 }, (_, i) => `Checking step ${i + 3}.`));
  await f.release();
});

test('completion claims stay on the checked final publication path', async t => {
  const f = await fixture(t, [message('Keyboard selection is fixed.'), working], [message('The change still needs verification.'), completed]);
  assert.equal(f.bots.view(f.id).messages.some(m => m.progress), false);
  await f.release();
});

test('a final message followed by bookkeeping appears once after completion', async t => {
  const text = 'The audit returned two findings.';
  const f = await fixture(t, [message(text), working], [completed]);
  assert.equal(f.bots.view(f.id).messages.filter(m => m.text === text).length, 1);
  await f.release();
  assert.equal(f.bots.view(f.id).messages.filter(m => m.text === text).length, 1);
  assert.equal(f.bots.view(f.id).messages.filter(m => m.role === 'bot' && m.text === text).length, 1);
});
