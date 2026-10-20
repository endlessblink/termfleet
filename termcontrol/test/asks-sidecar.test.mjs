// Noam 2026-10-20: "I want updates on the sidebar of those terminals" - the desktop reads each terminal's requests from a file the bridge keeps current.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAsksSidecarWriter, asksSidecarName, fnv } from '../bridge/asks-sidecar.mjs';

test('the hash matches the desktop app\'s (known value)', () => {
  assert.equal(fnv('abc'), '1a47e90b');
  assert.equal(asksSidecarName('abc'), 'asks-1a47e90b.json');
});

test('requests are written per live terminal, rewritten only when they change, and the list follows status changes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asks-sidecar-'));
  try {
    let asks = [{ n: 1, text: 'Fix the login', status: 'open', note: '' }];
    const write = createAsksSidecarWriter({ dir, asksOf: (pane) => (pane.id === 'p1' ? asks : null), now: () => 42 });
    const panes = [{ id: 'p1', live: true, producing: true }, { id: 'p2', live: true }, { id: 'p3', live: false }];
    assert.equal(write(panes), 1);
    const file = path.join(dir, asksSidecarName('p1'));
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { paneId: 'p1', working: true, asks, updatedAt: 42 });
    assert.equal(write(panes), 0, 'unchanged: no rewrite');
    asks = [{ n: 1, text: 'Fix the login', status: 'done', note: 'checked' }];
    assert.equal(write(panes), 1);
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).asks[0].status, 'done');
    assert.equal(fs.readdirSync(dir).length, 1, 'terminals without requests or not live get no file, no temp files left');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
