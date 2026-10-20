// Noam 2026-10-20: wake-ups and restart notices were listed as his requests.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isRealRequest, ledgerText, askTitle, followUp, asksForFile, dismissAsk } from '../../scripts/termfleet-asks.mjs';

// Noam 2026-10-20 ("it shows as open tasks, not clear why"): the Desk bot's list showed pasted
// job posts by their title and counted "Well?" and "התחברתי" as new requests.
test('short follow-ups are not new requests; short real requests and bug reports still are', () => {
  for (const t of ['Well?', 'התחברתי', 'נו?', 'I did it.', '> It\'s not fixed yet. The agent found…']) assert.equal(followUp(t), true, t);
  for (const t of ['Desk appears empty', 'desk נתקע', 'fix it', 'make it blue', '> It\'s not fixed yet.\n\nאז איך פותרים את זה?', 'Here is a picture.\n\n[Noam attached 1 picture. Look at it: /x.jpg]']) assert.equal(followUp(t), false, t);
  assert.equal(isRealRequest('Well?'), false);
  assert.equal(isRealRequest('Desk appears empty'), true);
});

test('the list shows his own words first, not the pasted post above them', () => {
  assert.equal(askTitle('Applied AI Engineer - Agentic Systems\nat\nOn-siteDubai, Dubai, United Arab Emirates\n\nמשרות כאלו לא אמורות לעבור סינון...'), 'משרות כאלו לא אמורות לעבור סינון... — Applied AI Engineer - Agentic Systems');
  assert.equal(askTitle('> It\'s not fixed yet. The agent found…\n\nאז איך פותרים את זה?'), 'אז איך פותרים את זה?');
  assert.equal(askTitle('Desk appears empty\n\n[Noam attached 1 picture. Look at each one: /x.jpg]'), 'Desk appears empty');
  assert.equal(askTitle('make the panel taller'), 'make the panel taller');
  // an English request over several lines is left whole
  assert.equal(askTitle('three things:\n1. taller\n2. blue'), 'three things: 1. taller 2. blue');
});

test('Noam can remove a request from the list; its number stays, so later marks still land right', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-dismiss-'));
  const record = path.join(tmp, 'chat.jsonl');
  const line = (o) => JSON.stringify(o);
  fs.writeFileSync(record, [
    line({ type: 'user', message: { content: 'make the panel taller' } }),
    line({ type: 'user', message: { content: 'Fundable - Senior Data Engineer\nArgentina\nRemote\nזה קיבל ציון גבוה למרות שזה רק מארגנטינה' } }),
    line({ type: 'user', message: { content: 'and paste text' } }),
    line({ type: 'assistant', message: { content: [{ type: 'tool_use', input: { command: 'termfleet-asks done 3 "paste works"' } }] } }),
  ].join('\n') + '\n');
  const env = { ...process.env, TC_CONFIG_DIR: path.join(tmp, 'cfg') };
  const prev = process.env.TC_CONFIG_DIR; process.env.TC_CONFIG_DIR = env.TC_CONFIG_DIR;
  try {
    const cacheDir = path.join(tmp, 'cache');
    dismissAsk(record, 2, env);
    const asks = asksForFile(record, { cacheDir });
    assert.deepEqual(asks.map((a) => [a.n, a.status, Boolean(a.dismissed)]), [[1, 'open', false], [2, 'dropped', true], [3, 'done', false]]);
    assert.match(ledgerText(asks), /1\/3 done, 1 dropped, 1 open/);
  } finally { if (prev === undefined) delete process.env.TC_CONFIG_DIR; else process.env.TC_CONFIG_DIR = prev; }
});

test('wake-ups and restart notices are not requests; real ones (even relayed through a bot) are', () => {
  assert.equal(isRealRequest('[Event, not from Noam] check the build'), false);
  assert.equal(isRealRequest('(You were cut off by a restart while working on this; check first)'), false);
  assert.equal(isRealRequest('[Message from the bot "Agent-Manager"] Noam, his words: "fix it"'), true);
  assert.equal(isRealRequest('make the panel taller'), true);
  // several queued messages arrive numbered: a wake-up among them is still not his
  assert.equal(isRealRequest('(1) [Event, not from Noam] The terminal agent finished'), false);
  assert.equal(isRealRequest('(1) make it bigger (2) and blue'), true);
});

test('the list the agent sees leaves them out, numbers unchanged', () => {
  const asks = [
    { n: 1, text: 'make the panel taller', status: 'open', note: '' },
    { n: 2, text: '[Event, not from Noam] wake-up', status: 'open', note: '' },
    { n: 3, text: '(You were cut off by a restart while working on this)', status: 'open', note: '' },
    { n: 4, text: 'and paste text', status: 'open', note: '' },
  ];
  const text = ledgerText(asks);
  assert.match(text, /#1 \[open\] "make the panel taller"/);
  assert.match(text, /#4 \[open\] "and paste text"/);
  assert.doesNotMatch(text, /wake-up|cut off/);
  assert.match(text, /0\/2 done, 2 open/);
});
