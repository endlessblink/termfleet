// Noam 2026-10-20: wake-ups and restart notices were listed as his requests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isRealRequest, ledgerText } from '../../scripts/termfleet-asks.mjs';

test('wake-ups and restart notices are not requests; real ones (even relayed through a bot) are', () => {
  assert.equal(isRealRequest('[Event, not from Noam] check the build'), false);
  assert.equal(isRealRequest('(You were cut off by a restart while working on this; check first)'), false);
  assert.equal(isRealRequest('[Message from the bot "Agent-Manager"] Noam, his words: "fix it"'), true);
  assert.equal(isRealRequest('make the panel taller'), true);
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
