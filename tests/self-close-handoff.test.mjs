// 2026-10-24: Codex terminals that ran `termfleet-team close self` never closed. Codex's box
// kills the detached waiter when the command ends, so the note left in /tmp lets the Stop hook
// (outside the box) start it again.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { markSelfClose, takeSelfClose, startSelfCloseWaiter } from '../scripts/lib/self-close-handoff.mjs';

const pane = 'terminal-638fef4e-899c-476c-aed3-ba19b888fe5d-9d0afbc2-8a78-4bbc-8add-bb3c497b60a2';
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'self-close-'));

test('close self leaves a note that the end of the turn takes once', () => {
  const dir = tmp();
  assert.equal(markSelfClose(pane, { dir, now: () => 1000 }), true);
  assert.equal(takeSelfClose(pane, { dir, now: () => 2000 }), true);
  assert.equal(takeSelfClose(pane, { dir, now: () => 2000 }), false, 'a second turn end does not close again');
});

test('no note, an old note, or another terminal\'s note never closes this one', () => {
  const dir = tmp();
  assert.equal(takeSelfClose(pane, { dir }), false);
  markSelfClose(pane, { dir, now: () => 0 + 1 });
  assert.equal(takeSelfClose(pane, { dir, now: () => 16 * 60_000 }), false, 'older than 15 minutes');
  assert.equal(fs.existsSync(path.join(dir, `${pane}.json`)), false, 'the old note is removed');
  markSelfClose('terminal-other', { dir, now: () => 1000 });
  assert.equal(takeSelfClose(pane, { dir, now: () => 2000 }), false);
});

test('a terminal id never becomes a path outside the folder', () => {
  const dir = tmp();
  assert.equal(markSelfClose('../../etc/x', { dir }), false);
  assert.equal(markSelfClose('terminal-../../x', { dir }), false);
  assert.equal(startSelfCloseWaiter('rm -rf', { run: () => { throw new Error('must not run'); } }), false);
});

test('the waiter starts in its own session, so the hook ending does not end it', () => {
  let seen;
  const ok = startSelfCloseWaiter(pane, { run: (cmd, args, opts) => { seen = { args, opts }; return { pid: 42, unref() {} }; } });
  assert.equal(ok, true);
  assert.equal(seen.opts.detached, true);
  assert.match(seen.args[0], /termfleet-close-self\.mjs$/);
  assert.equal(seen.args[1], pane);
});

test('the Codex Stop hook and close self both use the note', () => {
  const hook = fs.readFileSync(new URL('../scripts/termfleet-codex-status-hook.mjs', import.meta.url), 'utf8');
  assert.match(hook, /=== "Stop"\) \{\s*try \{\s*if \(takeSelfClose\(paneId\)\) startSelfCloseWaiter\(paneId\);/);
  const team = fs.readFileSync(new URL('../scripts/termfleet-team.mjs', import.meta.url), 'utf8');
  assert.match(team, /markSelfClose\(paneId\)/);
});
