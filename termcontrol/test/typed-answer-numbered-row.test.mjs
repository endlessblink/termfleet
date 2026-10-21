// Claude Code 2.1.288 types a custom answer into the numbered "Type something." row itself,
// with "Chat about this" still shown below (Noam 2026-10-21: "לא יכול לשלוח את זה"). Screens
// below are copied from a live test terminal; the bridge must type into that row and submit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sendCustomAnswer } from '../bridge/send.mjs';

const TITLE = 'Which fruit do you like for the answer test?';
const RULE = '─'.repeat(60);
const form = (focus, rowText = 'Type something.') => [' ☐ Fruit ', '', TITLE, '',
  `${focus === 1 ? '❯' : ' '} 1. Apple`, '     Pick Apple', `${focus === 2 ? '❯' : ' '} 2. Banana`, '     Pick Banana',
  `${focus === 3 ? '❯' : ' '} 3. ${rowText}`, RULE, '  4. Chat about this', '',
  `Enter to select · ↑/↓ to navigate${focus === 3 ? ' · ctrl+g to edit in VS Code' : ''} · Esc to cancel`].join('\n');

function terminal(start) {
  const state = { focus: 1, text: '', ...start }, writes = [];
  const draw = () => form(state.focus, state.focus === 3 && state.text ? state.text : 'Type something.');
  return {
    writes,
    io: {
      screen: async () => draw(),
      pause: async () => {},
      record: () => {},
      write: async (data) => {
        writes.push(data);
        if (/^[1-3]$/.test(data)) state.focus = Number(data);
        else if (data === '\u0015') state.text = '';
        else if (data.startsWith('\u001b[200~')) state.text += data.slice(6, -6);
        else if (data === '\r') state.submitted = state.text;
      },
    },
    state,
  };
}

const pane = { id: 'terminal-test', provider: 'claude', project: 'test' };
const question = { id: 'q1', title: TITLE, kind: 'question', options: [{ key: '1', label: 'Apple' }, { key: '2', label: 'Banana' }] };

test('focuses the numbered Type something row, types the Hebrew answer and submits it', async () => {
  const t = terminal();
  const result = await sendCustomAnswer(pane, question, 'בzen browser מבוסס פיירפוקס', t.io);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(t.writes[0], '3');
  assert.equal(t.state.submitted, 'בzen browser מבוסס פיירפוקס');
});

test('clears words left in the row from an earlier try before typing', async () => {
  const t = terminal({ focus: 3, text: 'old draft' });
  const result = await sendCustomAnswer(pane, question, 'Zen', t.io);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(t.writes[0], '\u0015');
  assert.equal(t.state.submitted, 'Zen');
});

test('never presses Enter when the row cannot be focused', async () => {
  const t = terminal();
  t.io.write = async (data) => { t.writes.push(data); };
  const result = await sendCustomAnswer(pane, question, 'Zen', t.io);
  assert.equal(result.notSent, true);
  assert.ok(!t.writes.includes('\r'));
});
