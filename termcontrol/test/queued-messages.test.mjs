import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Owner report 2026-10-11: "Old messages I sent on mobile get removed when I send a new one".
// A message sent while Claude is busy is recorded as a queued command, not a user message,
// and the chat held only one "sending" bubble, so each new message hid the previous one.
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-queued-'));
process.env.HOME = home;
const cwd = '/work/demo';
const sessionId = '11111111-2222-3333-4444-555555555555';
const dir = path.join(home, '.claude', 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'));
fs.mkdirSync(dir, { recursive: true });
const lines = [
  { type: 'user', timestamp: '2026-10-11T08:00:00Z', message: { role: 'user', content: 'first request' } },
  { type: 'assistant', timestamp: '2026-10-11T08:00:05Z', message: { role: 'assistant', content: [{ type: 'text', text: 'Working on it.' }] } },
  { type: 'queue-operation', operation: 'enqueue', timestamp: '2026-10-11T08:00:10Z', content: 'second message while busy' },
  { type: 'attachment', timestamp: '2026-10-11T08:00:20Z', attachment: { type: 'queued_command', prompt: 'second message while busy', origin: { kind: 'human' }, humanTurn: true, timestamp: '2026-10-11T08:00:10Z' } },
  { type: 'attachment', timestamp: '2026-10-11T08:00:21Z', attachment: { type: 'queued_command', prompt: '<task-notification>background job done</task-notification>', origin: { kind: 'task' } } },
  { type: 'attachment', timestamp: '2026-10-11T08:00:30Z', attachment: { type: 'queued_command', prompt: 'third message while busy', origin: { kind: 'human' }, humanTurn: true } },
];
fs.writeFileSync(path.join(dir, `${sessionId}.jsonl`), lines.map(line => JSON.stringify(line)).join('\n') + '\n');
const { readFeed } = await import('../bridge/adapters/claude.mjs');

test('messages typed while Claude is busy appear in the chat, in order', () => {
  const users = readFeed({ cwd, sessionId }).events.filter(e => e.kind === 'user').map(e => e.text);
  assert.deepEqual(users, ['first request', 'second message while busy', 'third message while busy']);
});

test('the chat keeps every unconfirmed message, not only the newest', () => {
  const html = fs.readFileSync(path.join(import.meta.dirname, '../app/index.html'), 'utf8');
  assert.match(html, /sentQueue = \[\.\.\.sentQueue, entry\]/);
  assert.match(html, /unconfirmedSent\(sentQueue,visibleEvents\)\.map\(/);
  assert.doesNotMatch(html, /justSent = entry/);
});

test.after(() => fs.rmSync(home, { recursive: true, force: true }));
