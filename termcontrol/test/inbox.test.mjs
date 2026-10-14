import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Goal 2026-10-12 (from gawkbot's inbox): every agent's open question in one list,
// answered in place with one tap or one key, the recommended answer on Enter.
const html = fs.readFileSync(path.join(import.meta.dirname, '../app/index.html'), 'utf8');
const server = fs.readFileSync(path.join(import.meta.dirname, '../bridge/server.mjs'), 'utf8');

test('the bridge lists every open question with its choices, longest wait first', () => {
  assert.match(server, /url\.pathname === '\/api\/inbox'/);
  assert.match(server, /pendingAsk\(pane, \{ screen \}\) \|\| screenPermissionAsk\(pane, screen\)/);
  assert.match(server, /items\.sort\(\(a, b\) => \(a\.pane\.lastActiveAt \|\| 0\) - \(b\.pane\.lastActiveAt \|\| 0\)\)/);
});

test('the phone answers through the same checked path as a chat, and never guesses multi-pick', () => {
  assert.match(html, /async function openInbox\(\)/);
  assert.match(html, /body:JSON\.stringify\(\{pane:card\.dataset\.pane,askId:card\.dataset\.ask,choice\}\)/);
  assert.match(html, /const answerable=ask && !ask\.multiSelect && ask\.stage!=='review'/);
  assert.match(html, /\/recommended\|מומלץ\/i/);
  assert.match(html, /location\.hash==='#inbox'/);
});
