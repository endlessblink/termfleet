// 2026-10-20, Noam: "זה מראה שזה דורש review ממני אבל בפועל אין שם שום דבר לבדוק".
// The pane really was on a permission prompt (Claude's own record said so), but a
// queued message had rewritten the hook record as "working", so the phone said
// "Needs you" and offered nothing to answer.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pendingAsk, pendingToolFromRecords, screenTail } from '../bridge/asks.mjs';
import { PATHS } from '../bridge/paths.mjs';

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
  assert.deepEqual(pendingToolFromRecords(lines), { id: 'b', name: 'Bash', detail: 'Build the Linux package' });
  assert.equal(pendingToolFromRecords([...lines, result('b')]), null);
});

// Noam 2026-10-24: a helper's card said only "This agent is asking permission to continue",
// with dead buttons ("if it asks something it needs to be visible and not a message about that").
test('a permission the hook reports shows what the terminal shows, and keeps one id across status updates', () => {
  const pane = { id: 'p2', provider: 'codex', cwd: '/nowhere', sessionId: 's', turn: 'waiting', turnReason: 'permission_request', updatedAt: 1 };
  const screen = 'some output\n╭────╮\n│ Run git push origin main? │\n│ Pushes the steps update │\n╰────╯\n';
  const ask = pendingAsk(pane, { screen, codexApproval: () => null, codexQuestion: () => null, codexTranscript: () => null });
  assert.equal(ask.kind, 'permission');
  assert.match(ask.detail, /Run git push origin main\?\nPushes the steps update/);
  assert.equal(screenTail(''), '');
});

test("Claude's permission event for its own question tool is not shown as an empty permission card", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-perm-'));
  const before = PATHS.claudeProjects;
  PATHS.claudeProjects = dir;
  const pane = { id: 'p3', provider: 'claude', cwd: '/nowhere', sessionId: '22222222-2222-4222-8222-222222222222', turn: 'waiting', turnReason: 'permission_request', updatedAt: 5 };
  const folder = path.join(dir, 'x');
  fs.mkdirSync(folder);
  const file = path.join(folder, `${pane.sessionId}.jsonl`);
  try {
    fs.writeFileSync(file, call('q1', 'AskUserQuestion', { questions: [] }) + '\n');
    assert.equal(pendingAsk(pane), null, 'the question card comes from the record instead');
    // A real tool waiting for approval: named, with a stable id however often the status updates.
    const other = { ...pane, sessionId: '33333333-3333-4333-8333-333333333333' };
    fs.writeFileSync(path.join(folder, `${other.sessionId}.jsonl`), call('t1', 'Bash', { command: 'git push', description: 'Push the steps update' }) + '\n');
    const ask = pendingAsk(other);
    assert.equal(ask.title, 'Allow this command?');
    assert.equal(ask.detail, 'Push the steps update');
    assert.equal(pendingAsk({ ...other, updatedAt: 99 }).id, ask.id);
  } finally { PATHS.claudeProjects = before; fs.rmSync(dir, { recursive: true, force: true }); }
});
