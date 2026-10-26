import test from 'node:test';
import assert from 'node:assert/strict';
import { botAsksFromItems } from '../bridge/bot-request-panel.mjs';
import { asksFrom, askTitle, hook } from '../../scripts/termfleet-asks.mjs';
import { ownerTextOf } from '../bridge/requirements.mjs';

const reminder = '[Your open requests from Noam: 1. You own every one.\n- R-17817 [partial] Find actual bugs]';
test('bot panel includes every active ledger item once, including ready, independent of transcript/provider', () => {
  const items = Array.from({ length: 80 }, (_, n) => ({ id: `R-${n + 1}`, n: n + 1, words: `Owner request ${n + 1}`, status: ['new', 'assigned', 'partial', 'ready'][n % 4] }));
  const rows = botAsksFromItems([...items, items[0], { id: 'R-90', status: 'done' }, { id: 'R-91', status: 'new', locked: true }]);
  assert.equal(rows.length, 80);
  assert.equal(new Set(rows.map(x => x.id)).size, 80);
  assert.equal(rows.filter(x => x.status === 'ready').length, 20);
  assert.equal(rows[0].text, 'Owner request 1');
  assert.match(rows[0].title, /^R-1 /);
});
test('open-request harness reminders cannot become numbered requests or ledger owner words', () => {
  const user = text => JSON.stringify({ type: 'user', message: { content: text } });
  assert.deepEqual(asksFrom([user(reminder)]), []);
  const asks = asksFrom([user(`Fix the panel\n\n${reminder}`)]);
  assert.equal(asks.length, 1);
  assert.equal(asks[0].text, 'Fix the panel');
  assert.equal(askTitle(`Fix the panel\n\n${reminder}`), 'Fix the panel');
  assert.equal(ownerTextOf(reminder), null);
  assert.equal(ownerTextOf(`Fix the panel\n\n${reminder}`).text, 'Fix the panel');
  for (const line of [
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: reminder }] } },
    { type: 'attachment', attachment: { type: 'queued_command', humanTurn: true, prompt: reminder } },
  ]) assert.deepEqual(asksFrom([JSON.stringify(line)]), []);
  const env = { TERMFLEET_REQ_LEDGER: 'off' };
  assert.equal(hook({ hook_event_name: 'UserPromptSubmit', prompt: reminder }, { env }), null);
});
