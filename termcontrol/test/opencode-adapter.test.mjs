import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// OpenCode keeps all conversations in one SQLite database. The adapter reads it
// through node:sqlite, which is experimental and may be absent; when it is, the
// whole file is skipped rather than failing the suite.
let sqlite = null;
try { sqlite = require('node:sqlite'); } catch { sqlite = null; }

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-opencode-'));
const dir = path.join(root, 'opencode');
fs.mkdirSync(dir, { recursive: true });
// Point the adapter at the throwaway database BEFORE it is imported, since
// PATHS is derived from XDG_DATA_HOME at module load.
process.env.XDG_DATA_HOME = root;

const message = (id, session, at, data) => ({
  sql: 'INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)',
  values: [id, session, at, JSON.stringify(data)],
});
const part = (id, messageId, session, at, data) => ({
  sql: 'INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?, ?, ?, ?, ?)',
  values: [id, messageId, session, at, JSON.stringify(data)],
});

function seed() {
  const db = new sqlite.DatabaseSync(path.join(dir, 'opencode.db'));
  db.exec('CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT, title TEXT, time_created INTEGER, time_updated INTEGER)');
  db.exec('CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT)');
  db.exec('CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_created INTEGER, data TEXT)');
  db.prepare('INSERT INTO session (id, directory, title) VALUES (?, ?, ?)')
    .run('ses_read', '/tmp/project', 'Fixing the login redirect');

  const rows = [
    message('msg_1', 'ses_read', 1000, { role: 'user', time: { created: 1000 } }),
    message('msg_2', 'ses_read', 2000, { role: 'assistant', time: { created: 2000 } }),
    message('msg_3', 'ses_read', 3000, { role: 'user', time: { created: 3000 } }),
    part('prt_1', 'msg_1', 'ses_read', 1000, { type: 'text', text: 'hello from me' }),
    part('prt_2', 'msg_2', 'ses_read', 2000, { type: 'reasoning', text: 'internal chain of thought' }),
    part('prt_3', 'msg_2', 'ses_read', 2001, { type: 'text', text: 'hi there' }),
    part('prt_4', 'msg_2', 'ses_read', 2002, { type: 'tool', tool: 'bash', state: { input: { command: 'npm test' } } }),
    part('prt_5', 'msg_3', 'ses_read', 3000, { type: 'text', text: 'and again' }),
  ];
  for (const row of rows) db.prepare(row.sql).run(...row.values);
  db.close();
}

test('the phone reads an OpenCode conversation from its database', { skip: !sqlite }, async () => {
  seed();
  const { readFeed, transcriptPath, provider } = await import('../bridge/adapters/opencode.mjs');

  assert.equal(provider, 'opencode');
  assert.ok(transcriptPath({ sessionId: 'ses_read' }), 'a known session should be readable');
  assert.equal(transcriptPath({ sessionId: 'ses_missing' }), null, 'an unknown session has no transcript');

  const fed = readFeed({ sessionId: 'ses_read', provider: 'opencode' }, { limit: 60 });
  const users = fed.events.filter((e) => e.kind === 'user').map((e) => e.text);
  assert.deepEqual(users, ['hello from me', 'and again'], 'operator messages in order');

  const assistant = fed.events.filter((e) => e.kind === 'assistant');
  assert.equal(assistant.length, 1);
  assert.equal(assistant[0].text, 'hi there');
  assert.ok(!JSON.stringify(fed.events).includes('internal chain of thought'), 'reasoning must not leak to the phone');

  const tools = fed.events.filter((e) => e.kind === 'tool');
  assert.equal(tools[0].name, 'bash');
  assert.ok(/'npm test'|npm test/.test(tools[0].summary), tools[0].summary);
});

test('an OpenCode session with no history reads as empty, never as an error', { skip: !sqlite }, async () => {
  const { readFeed } = await import('../bridge/adapters/opencode.mjs');
  assert.deepEqual(readFeed({ sessionId: 'ses_missing' }, { limit: 60 }), { events: [], pending: [] });
});
