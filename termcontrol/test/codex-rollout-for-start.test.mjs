// R-7214: Codex terminals a bot starts often never get their conversation id recorded, so the
// cleanup could not see when they last worked or which files they changed. Their conversation
// record is found from how they were started: same folder, started within minutes, and its
// first request is the one the terminal was started with.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rolloutForStart, promptToken } from '../bridge/adapters/codex.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-rollouts-'));
const day = path.join(root, '2026', '10', '23');
fs.mkdirSync(day, { recursive: true });
const startedAt = Date.parse('2026-10-23T20:16:40Z');
const stamp = (ms) => { const d = new Date(ms); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`; };
const write = (id, { at, cwd, forked = false, prompt }) => {
  const meta = { type: 'session_meta', payload: { id, cwd, timestamp: new Date(at).toISOString(), ...(forked ? { forked_from_id: 'x' } : {}) } };
  const user = { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: prompt }] } };
  const file = path.join(day, `rollout-${stamp(at)}-${id}.jsonl`);
  fs.writeFileSync(file, `${JSON.stringify(meta)}\n${JSON.stringify({ type: 'response_item', payload: { pad: 'x'.repeat(5000) } })}\n${JSON.stringify(user)}\n`);
  return file;
};
const cwd = '/w/politic-fighter';
const task = 'Goal: Let Noam copy any move\nFull instructions: Read /home/n/.local/share/terminal-workspace/child-tasks/9add0aaf-805c-46b3-b004-95c9300cb330.md and carry out';
const mine = write('01a16a68-9fff-7553-950d-c0896444209c', { at: startedAt + 4000, cwd, prompt: task });
write('01a16a6e-15e3-7ab3-afe5-9bdf416759d0', { at: startedAt + 6000, cwd, forked: true, prompt: task });
write('01a16a70-0000-7000-8000-000000000001', { at: startedAt + 5000, cwd, prompt: 'Goal: something else\nFull instructions: Read /home/n/.local/share/terminal-workspace/child-tasks/other.md' });
write('01a16a71-0000-7000-8000-000000000002', { at: startedAt + 3000, cwd: '/w/other', prompt: task });

test('the token is the child-task file when there is one, else the start of the first request', () => {
  assert.equal(promptToken(`codex '${task}'; exec "\${SHELL:-bash}" -l`), 'child-tasks/9add0aaf-805c-46b3-b004-95c9300cb330.md');
  assert.equal(promptToken("codex 'The PC rebooted at about 22:39 and killed the previous agents. FIRST: check'"), 'The PC rebooted at about 22:39 and killed the previous agent');
  assert.equal(promptToken('codex'), null);
  assert.equal(promptToken('claude --resume abc'), null);
});

test('the main conversation in the same folder, started then, with that first request', () => {
  const found = rolloutForStart({ cwd, startedAt, token: 'child-tasks/9add0aaf-805c-46b3-b004-95c9300cb330.md', root });
  assert.deepEqual(found, { sessionId: '01a16a68-9fff-7553-950d-c0896444209c', file: mine });
  assert.equal(rolloutForStart({ cwd, startedAt: startedAt + 3 * 3600_000, token: 'child-tasks/9add0aaf-805c-46b3-b004-95c9300cb330.md', root }), null, 'not one started hours later');
  assert.equal(rolloutForStart({ cwd, startedAt, token: 'child-tasks/nope.md', root }), null);
  assert.equal(rolloutForStart({ cwd, startedAt, token: null, root }), null);
});
