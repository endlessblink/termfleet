import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stateOf, stuckNote, waitForReply } from '../bridge/orchestrate.mjs';
import { Bots } from '../bridge/bots.mjs';
import { fnv } from '../../scripts/lib/agent-status-paths.mjs';

// 2026-10-26: a Codex helper lost its server at 12:45 and its status kept saying "working". Its bot
// was told "working" for two hours, kept messaging it, and `termfleet-team close` refused it.

test('a working terminal whose record stopped long ago is stuck, not working', () => {
  assert.equal(stateOf({ alive: true, turn: 'working', stalledForMs: 30 * 60_000 }), 'stuck');
  assert.equal(stateOf({ alive: true, turn: 'working', stalledForMs: 0 }), 'working');
});

test('a stalled terminal with a question open is waiting on Noam, never stuck', () => {
  assert.equal(stateOf({ alive: true, turn: 'working', stalledForMs: 30 * 60_000, attention: { kind: 'permission' } }), 'waiting');
});

test('a closed terminal stays closed whatever its last word was', () => {
  assert.equal(stateOf({ alive: false, turn: 'working', stalledForMs: 99 * 60_000 }), 'closed');
});

test('waiting for a reply from a stuck terminal ends at once and says to replace it', async () => {
  const pane = { id: 'terminal-x', alive: true, turn: 'working', stalledForMs: 40 * 60_000 };
  const r = await waitForReply('terminal-x', { pollMs: 1, timeoutMs: 1000, panesFn: async () => [pane] });
  assert.equal(r.state, 'stuck');
  assert.match(r.note, /no progress for 40 minutes/i);
  assert.match(r.note, /termfleet-team close terminal-x/);
  assert.equal(stuckNote(pane), r.note);
});

test("a bot is told its dead helper is STUCK, and a closed one is left out", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-stuck-'));
  const status = path.join(home, 'terminal-workspace', 'agent-status');
  fs.mkdirSync(status, { recursive: true });
  const prev = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = home;
  try {
    const now = 10 * 3600_000;
    const bots = new Bots({ dir: path.join(home, 'bots'), now: () => now, bins: {} });
    const id = 'aaaaaaaaaaaa';
    fs.mkdirSync(bots.folder(id), { recursive: true });
    const dead = 'terminal-dead0000-0000-0000-0000-000000000000-p', closed = 'terminal-gone0000-0000-0000-0000-000000000000-p', ok = 'terminal-good0000-0000-0000-0000-000000000000-p';
    fs.writeFileSync(path.join(bots.folder(id), 'helpers.json'), JSON.stringify([dead, closed, ok].map((paneId) => ({ paneId, provider: 'codex', task: 'Fix the title menu', at: 1 }))));
    for (const paneId of [dead, closed, ok]) fs.writeFileSync(path.join(status, `pane-${fnv(paneId)}.json`), JSON.stringify({ paneId, turn: 'working', sessionId: paneId, updatedAt: now - 3 * 3600_000 }));
    bots.recordAt = (p) => (p.sessionId === ok ? now - 60_000 : now - 150 * 60_000);
    const digest = bots.terminalDigest(id, new Set([dead, ok]));
    assert.match(digest, /STUCK: no progress for 150 minutes/);
    assert.match(digest, new RegExp(`termfleet-team close ${dead}`));
    assert.doesNotMatch(digest, /gone0000/);
    assert.match(digest, /good0000.*codex, working/);
  } finally {
    if (prev === undefined) delete process.env.XDG_DATA_HOME; else process.env.XDG_DATA_HOME = prev;
  }
});
