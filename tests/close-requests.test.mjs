// Noam 2026-10-20: close a terminal from the phone and from a bot, through the card's own close.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { planCloseRequest, CLOSE_REQUEST_MAX_AGE_MS } from '../src/lib/closeRequests.ts';

const tabs = [
  { id: 'tab-a', title: 'Fix the photo upload', terminals: [{ id: 'p1' }] },
  { id: 'tab-b', title: 'Two panes', terminals: [{ id: 'p2' }, { id: 'p3' }] },
];
const req = (over = {}) => JSON.stringify({ version: 1, kind: 'close', requestId: 'req-12345678', paneId: 'terminal-tab-a-p1', by: 'phone', createdAt: 1000, ...over });

test('a close request names exactly one card and is closed through its own close', () => {
  assert.deepEqual(planCloseRequest(req(), tabs, 2000), { ok: true, tabId: 'tab-a', title: 'Fix the photo upload', request: { requestId: 'req-12345678', paneId: 'terminal-tab-a-p1', by: 'phone', createdAt: 1000 } });
});

test('what cannot be closed cleanly is refused, with the reason', () => {
  assert.equal(planCloseRequest(req({ paneId: 'terminal-tab-x-p9' }), tabs, 2000).reason, 'not-found');
  assert.equal(planCloseRequest(req({ paneId: 'terminal-tab-b-p2' }), tabs, 2000).reason, 'several-terminals');
  assert.equal(planCloseRequest(req(), tabs, 1000 + CLOSE_REQUEST_MAX_AGE_MS + 1).reason, 'expired');
  assert.equal(planCloseRequest(req({ kind: 'spawn' }), tabs, 2000).reason, 'invalid');
  assert.equal(planCloseRequest('not json', tabs, 2000).reason, 'invalid');
  assert.equal(planCloseRequest(req({ requestId: '../../x' }), tabs, 2000).requestId, null, 'a request id never becomes a path');
});

test('the app starts the close loop and closes through closeTerminalSession, the card X path', () => {
  const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /startCloseRequestLoop\(\);/);
  const loop = fs.readFileSync(new URL('../src/lib/closeRequestLoop.ts', import.meta.url), 'utf8');
  assert.match(loop, /closeTerminalSession\(plan\.tabId, "operator"\)/);
  assert.match(loop, /fs_delete/, 'a request is taken once');
});
