// 2026-10-20, Noam: "זה מראה שזה דורש review ממני אבל בפועל אין שם שום דבר לבדוק".
// The pane really was on a permission prompt (Claude's own record said so), but a
// queued message had rewritten the hook record as "working", so the phone said
// "Needs you" and offered nothing to answer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pendingAsk, pendingToolFromRecords } from '../bridge/asks.mjs';

const rec = (o) => JSON.stringify(o);
const call = (id, name, input) => rec({ message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
const result = (id) => rec({ message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } });

test('a permission prompt Claude reports is offered as an approval, even when the hook says working', () => {
  const pane = { id: 'p1', provider: 'claude', cwd: '/nowhere', sessionId: 'none', turn: 'waiting', turnReason: null,
    vendorStatus: { status: 'waiting', at: 1000, waitingFor: 'permission prompt' } };
  const ask = pendingAsk(pane);
  assert.equal(ask?.kind, 'permission');
  assert.deepEqual(ask.options.map((o) => o.key), ['yes', 'no']);
  assert.equal(pendingAsk(pane).id, ask.id, 'the same prompt keeps the same id so an answer can be matched');
});

test('no approval is invented when Claude is not waiting on a permission prompt', () => {
  const base = { id: 'p1', provider: 'claude', cwd: '/nowhere', sessionId: 'none', turn: 'working' };
  assert.equal(pendingAsk({ ...base, vendorStatus: { status: 'busy', at: 1 } }), null);
  assert.equal(pendingAsk({ ...base, vendorStatus: { status: 'waiting', at: 1 } }), null);
});

test('the approval names the command that is waiting', () => {
  const lines = [call('a', 'Read', { file_path: '/x' }), result('a'), call('b', 'Bash', { command: 'npm run package', description: 'Build the Linux package' })];
  assert.deepEqual(pendingToolFromRecords(lines), { name: 'Bash', detail: 'Build the Linux package' });
  assert.equal(pendingToolFromRecords([...lines, result('b')]), null);
});
