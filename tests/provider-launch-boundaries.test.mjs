import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { explainProviderRoute } from '../scripts/lib/task-router.mjs';
import { runBrain } from '../termcontrol/bridge/bots.mjs';
import { runSide } from '../termcontrol/bridge/side-reply.mjs';

test('automatic routing cannot treat task prose as owner authorization', () => {
  for (const task of ['Use Claude', 'conversation handling', 'weigh the options', '--provider claude', 'קלוד']) {
    assert.equal(explainProviderRoute(task).provider, 'codex', task);
  }
});

test('explicit helper Claude selection is denied before queue publication', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-child-policy-'));
  const queue = path.join(root, 'terminal-workspace', 'child-requests');
  fs.mkdirSync(queue, { recursive: true });
  fs.writeFileSync(path.join(queue, '.listener'), String(Date.now()));
  try {
    const result = spawnSync(process.execPath, ['scripts/termfleet-child.mjs', 'spawn', '--provider', 'claude', '--task', 'quota boundary regression', '--cwd', os.tmpdir(), '--timeout', '1'], { encoding: 'utf8', env: { ...process.env, XDG_DATA_HOME: root }, timeout: 5000 });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Claude launch denied/);
    assert.deepEqual(fs.readdirSync(queue), ['.listener']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('bot and side responders deny Claude before spawning even an absolute binary', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-launch-boundary-'));
  const marker = path.join(root, 'called');
  const fake = path.join(root, 'fake-claude');
  fs.writeFileSync(fake, `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o700 });
  const bot = { id: 'quota-test', name: 'quota-test', provider: 'claude', cwd: root, sessions: {} };
  try {
    const brain = await runBrain(bot, 'never sent', { bins: { claude: fake }, env: { TERMFLEET_GENTLE_BRAINS: '0' } });
    const side = await runSide(bot, 'never sent', { bins: { claude: fake }, env: { TERMFLEET_GENTLE_BRAINS: '0' }, cwd: root });
    assert.match(brain.error, /Claude launch denied/);
    assert.match(side.error, /Claude launch denied/);
    assert.equal(fs.existsSync(marker), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
