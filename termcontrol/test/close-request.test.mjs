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

test('no answer (TermFleet not updated or closed): the request is taken back and nothing closes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-close-'));
  const r = await requestClose('terminal-tab-a-p1', { dir, timeoutMs: 60, pause: fastPause });
  assert.equal(r.reason, 'no-answer');
  assert.match(r.error, /Nothing was closed/);
  assert.deepEqual(fs.readdirSync(dir), []);
  assert.equal((await requestClose('not-a-terminal', { dir })).ok, false);
});
