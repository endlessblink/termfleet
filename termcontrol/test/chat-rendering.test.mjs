import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { agentsByPane, reconcileLivePanes } from '../bridge/inventory.mjs';

// TF-046: a hand-started agent with no status record was listed as a plain
// shell, so the phone showed its raw terminal screen instead of the chat.

function fakeProc() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-proc-'));
  const claudeSessions = path.join(root, 'claude-sessions');
  fs.mkdirSync(claudeSessions);
  const proc = (pid, cmd, pane, fds = []) => {
    const dir = path.join(root, String(pid));
    fs.mkdirSync(path.join(dir, 'fd'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'cmdline'), cmd.split(' ').join('\0') + '\0');
    fs.writeFileSync(path.join(dir, 'environ'), `HOME=/home/x\0${pane ? `TERMFLEET_PANE_ID=${pane}\0` : ''}`);
    fds.forEach((target, i) => fs.symlinkSync(target, path.join(dir, 'fd', String(i + 3))));
  };
  proc(100, '/usr/bin/node /home/x/.npm-global/bin/codex', 'terminal-a-1');
  proc(101, '/opt/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex', 'terminal-a-1', [
    '/home/x/.codex/sessions/2026/09/23/rollout-2026-09-23T09-37-26-01a0ccfb-c27d-7e13-a2a8-14db5dd7b529.jsonl',
  ]);
  // A review helper's conversation, started later, is also held open.
  proc(102, '/opt/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex exec review', 'terminal-a-1', [
    '/home/x/.codex/sessions/2026/09/23/rollout-2026-09-23T11-43-51-01a0cd6f-7f77-77a2-9097-5c2d6c09b294.jsonl',
  ]);
  // Resumed conversation: the id on the command line wins even over an older helper file.
  proc(500, '/usr/bin/node /x/bin/codex resume 01a0c831-4975-7bc3-b28a-793d0cf09e42', 'terminal-d-4');
  proc(501, '/opt/codex/bin/codex', 'terminal-d-4', [
    '/h/.codex/sessions/2026/09/20/rollout-2026-09-20T08-00-00-01a0aaaa-0000-7000-8000-000000000000.jsonl',
    '/h/.codex/sessions/2026/09/22/rollout-2026-09-22T11-17-48-01a0c831-4975-7bc3-b28a-793d0cf09e42.jsonl',
  ]);
  proc(200, 'claude --resume', 'terminal-b-2');
  fs.writeFileSync(path.join(claudeSessions, '200.json'), JSON.stringify({ sessionId: 'claude-conv-1' }));
  proc(300, '/bin/bash', 'terminal-c-3');
  proc(400, '/usr/bin/codex', null);
  return { root, claudeSessions };
}

test('agents are found from the process table with the conversation they hold open', () => {
  const { root, claudeSessions } = fakeProc();
  const agents = agentsByPane({ procRoot: root, claudeSessions });
  assert.deepEqual(agents.get('terminal-a-1'), { provider: 'codex', sessionId: '01a0ccfb-c27d-7e13-a2a8-14db5dd7b529' });
  assert.deepEqual(agents.get('terminal-b-2'), { provider: 'claude', sessionId: 'claude-conv-1' });
  assert.equal(agents.has('terminal-c-3'), false, 'a plain shell is not an agent');
  assert.deepEqual(agents.get('terminal-d-4'), { provider: 'codex', sessionId: '01a0c831-4975-7bc3-b28a-793d0cf09e42' });
  assert.equal(agents.size, 3, 'a process without a terminal id is ignored');
});

test('a live agent without a status record is a chat, not a shell', () => {
  const live = new Map([['terminal-a-1', { initialCwd: '/w/freelance-desk' }], ['terminal-c-3', { initialCwd: '/w/x' }]]);
  const agents = new Map([['terminal-a-1', { provider: 'codex', sessionId: 'conv-a' }]]);
  const panes = reconcileLivePanes([], live, { tabs: [], groups: [] }, agents);
  const agent = panes.find((p) => p.id === 'terminal-a-1');
  const shell = panes.find((p) => p.id === 'terminal-c-3');
  assert.equal(agent.provider, 'codex');
  assert.equal(agent.sessionId, 'conv-a');
  assert.equal(shell.provider, 'shell');
});

test('the conversation a running agent holds open beats a stale status record', () => {
  const live = new Map([['terminal-a-1', {}]]);
  const agents = new Map([['terminal-a-1', { provider: 'codex', sessionId: 'current' }]]);
  const record = { id: 'terminal-a-1', provider: 'codex', sessionId: 'old', updatedAt: 1 };
  const [pane] = reconcileLivePanes([record], live, { tabs: [], groups: [] }, agents);
  assert.equal(pane.sessionId, 'current');
});

// The chat renderer lives in the single-page app; load exactly that source.
const html = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../app/index.html'), 'utf8');
const start = html.indexOf('const esc = ');
const end = html.indexOf("return `<div class=\"rich\">${out.join('')}</div>`;\n}", start);
assert.ok(start > 0 && end > start, 'chat renderer source found');
const richText = new Function(`${html.slice(start, end)}return \`<div class="rich">\${out.join('')}</div>\`;\n}\nreturn richText;`)();

test('a Markdown table in an agent reply becomes a real table', () => {
  const out = richText('Plan:\n\n| When | What |\n|---|---|\n| Today | 📣 Mixboard live promotion |\n| Today | 💬 מעצבים עם AI WhatsApp group |\n\nDone.');
  assert.match(out, /<table>/);
  assert.match(out, /<th dir="ltr">When<\/th><th dir="ltr">What<\/th>/);
  assert.match(out, /<td dir="ltr">Today<\/td><td dir="ltr">📣 Mixboard live promotion<\/td>/);
  assert.match(out, /<td dir="ltr">💬 מעצבים עם AI WhatsApp group<\/td>/);
  assert.doesNotMatch(out, /\|---/);
  assert.match(out, /<p dir="ltr">Done\.<\/p>/);
});

test('a box-drawn terminal table becomes a real table', () => {
  const out = richText('┌───────┬──────────┐\n│ When  │ What     │\n├───────┼──────────┤\n│ Today │ TikTok   │\n│ Today │ LinkedIn │\n└───────┴──────────┘');
  assert.match(out, /<th dir="ltr">When<\/th><th dir="ltr">What<\/th>/);
  assert.match(out, /<td dir="ltr">Today<\/td><td dir="ltr">LinkedIn<\/td>/);
  assert.doesNotMatch(out, /[│┌─]/);
});

test('lists, code and emphasis render, and markup in the text stays inert', () => {
  const out = richText('Next steps:\n- Check the **event URL**\n- Run `npm test`\n\n```\n<script>x</script>\n```\n<img src=x onerror=alert(1)>');
  assert.match(out, /<ul><li dir="ltr">Check the <strong>event URL<\/strong><\/li><li dir="ltr">Run <code>npm test<\/code><\/li><\/ul>/);
  assert.match(out, /<pre><code>&lt;script&gt;x&lt;\/script&gt;<\/code><\/pre>/);
  assert.doesNotMatch(out, /<img|<script/);
});

test('a three-column table becomes one labelled card per row on a phone', () => {
  const out = richText('| Time | Plan | Status |\n|---|---|---|\n| Today | 🎵 TikTok | Share the live as a Story |');
  assert.match(out, /class="tablewrap stacked"/);
  assert.match(out, /<td data-label="Time"><div dir="ltr">Today<\/div><\/td>/);
  assert.match(out, /<td data-label="Status"><div dir="ltr">Share the live as a Story<\/div><\/td>/);
});

test('direction follows the language a line is mostly written in', () => {
  assert.match(richText('💬 `מעצבים עם AI` WhatsApp group'), /<p dir="ltr">/);
  assert.match(richText('שלחתי את ההודעה לקבוצת WhatsApp'), /<p dir="rtl">/);
});
