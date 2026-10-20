// Noam 2026-10-20: close a terminal from the phone. The request reaches the TermFleet app,
// which closes the card like its X; an unanswered request is taken back, never left to fire later.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { requestClose } from '../../scripts/lib/close-request.mjs';

const fastPause = () => new Promise((r) => setTimeout(r, 5));

test('the app answers: closed, or refused with a plain reason', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-close-'));
  const app = setInterval(() => {
    for (const name of fs.readdirSync(dir).filter((n) => n.endsWith('.request.json'))) {
      const req = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
      fs.rmSync(path.join(dir, name));
      const result = req.paneId === 'terminal-tab-a-p1' ? { ok: true, title: 'Fix the photo upload' } : { ok: false, reason: 'several-terminals' };
      fs.writeFileSync(path.join(dir, `${req.requestId}.result.json`), JSON.stringify({ requestId: req.requestId, ...result }));
      assert.equal(req.kind, 'close');
      assert.equal(req.by, 'phone:owner');
    }
  }, 5);
  try {
    assert.deepEqual(await requestClose('terminal-tab-a-p1', { by: 'phone:owner', dir, pause: fastPause }), { ok: true, title: 'Fix the photo upload' });
    const refused = await requestClose('terminal-tab-b-p2', { by: 'phone:owner', dir, pause: fastPause });
    assert.equal(refused.ok, false);
    assert.match(refused.error, /several terminals/);
    assert.deepEqual(fs.readdirSync(dir), [], 'nothing left behind');
  } finally { clearInterval(app); }
});

test('an app from before the close fix says "not found" for a running terminal: the error says it needs one relaunch', async () => {
  // Noam 2026-10-21 'לא יכול לסגור את זה': the running app answered every close "not found".
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-close-'));
  const app = setInterval(() => {
    for (const name of fs.readdirSync(dir).filter((n) => n.endsWith('.request.json'))) {
      const req = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
      fs.rmSync(path.join(dir, name));
      fs.writeFileSync(path.join(dir, `${req.requestId}.result.json`), JSON.stringify({ requestId: req.requestId, ok: false, reason: 'not-found' }));
    }
  }, 5);
  try {
    // Still running: the daemon stops it (works on what runs today); its card goes with the next relaunch.
    const stopped = [];
    const today = await requestClose('terminal-tab-a-p1', { dir, pause: fastPause, running: async () => true, stop: async (id) => { stopped.push(id); return true; } });
    assert.equal(today.ok, true);
    assert.equal(today.stoppedInDaemon, true);
    assert.deepEqual(stopped, ['terminal-tab-a-p1']);
    // The daemon could not stop it either: plain error, nothing claimed.
    const outdated = await requestClose('terminal-tab-a-p1', { dir, pause: fastPause, running: async () => true, stop: async () => false });
    assert.equal(outdated.reason, 'app-outdated');
    assert.match(outdated.error, /needs one relaunch/);
    // Already ended: that is closed, so removing its bot is not blocked.
    const gone = await requestClose('terminal-tab-a-p1', { dir, pause: fastPause, running: async () => false, stop: async () => { throw new Error('nothing to stop'); } });
    assert.deepEqual(gone, { ok: true, alreadyClosed: true, title: null });
  } finally { clearInterval(app); }
});

test('a bot\'s close sheet closes its terminals at the same time, not one after another', async () => {
  const { closeBotItems } = await import('../bridge/bot-close.mjs');
  let open = 0, most = 0;
  const requestClose = async () => { open++; most = Math.max(most, open); await new Promise((r) => setTimeout(r, 30)); open--; return { ok: true }; };
  const plan = { items: ['a', 'b', 'c'].map((x) => ({ id: `terminal:terminal-${x}`, kind: 'terminal', label: x })) };
  const r = await closeBotItems({ botId: 'b1', ids: plan.items.map((i) => i.id), plan, bots: { append() {} }, routines: {}, requestClose });
  assert.equal(r.ok, true);
  assert.equal(most, 3);
  assert.deepEqual(r.results.map((x) => x.label), ['a', 'b', 'c'], 'results keep the sheet order');
});

test('no answer (TermFleet not updated or closed): the request is taken back and nothing closes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-close-'));
  const r = await requestClose('terminal-tab-a-p1', { dir, timeoutMs: 60, pause: fastPause });
  assert.equal(r.reason, 'no-answer');
  assert.match(r.error, /Nothing was closed/);
  assert.deepEqual(fs.readdirSync(dir), []);
  assert.equal((await requestClose('not-a-terminal', { dir })).ok, false);
});
