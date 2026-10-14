import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { multiSelectState, toggleMultiChoice, typeMultiCustomAnswer, submitMultiChoice, sendCustomAnswer } from '../bridge/send.mjs';

// Owner report 2026-10-11: "Can't type custom answers" on a pick-several question. The
// phone could not answer those at all. This fake follows the installed Claude form's key
// handling: a digit ticks without moving focus (typed as text on the typing row), the
// typing row ticks itself when it has text, Enter there would untick it, Down from the
// last option focuses Submit, Enter on Submit submits.
const TITLE = 'Where do the tasks it never mentioned live, so the window reads all of them?';
const LABELS = ['FlowState', 'Obsidian notes', 'Things I told agents', 'Google Calendar'];

function fakeForm({ focus = 1 } = {}) {
  const form = { focus, checked: new Set(), text: '', submitted: null, keys: [] };
  const inputRow = LABELS.length + 1;
  form.render = () => [
    '← ☒ Hardcoded ☐ Missing tasks ✔ Submit →',
    TITLE,
    ...LABELS.map((label, i) => `${form.focus === i + 1 ? '❯ ' : '  '}${i + 1}. [${form.checked.has(i + 1) ? '✓' : ' '}] ${label}`),
    `${form.focus === inputRow ? '❯ ' : '  '}${inputRow}. [${form.text ? '✓' : ' '}] ${form.text || 'Type something'}`,
    `${form.focus === 'submit' ? '❯' : ' '}   Submit`,
    'Enter to select · Tab/Arrow keys to navigate · Esc to cancel',
  ].join('\n');
  form.write = async (data) => {
    form.keys.push(data);
    if (data.startsWith('\u001b[200~')) { if (form.focus === inputRow) form.text += data.slice(6, -6); return; }
    for (const key of data.match(/\u001b\[[AB]|./gs)) {
      if (key === '\u001b[B') form.focus = form.focus === inputRow ? 'submit' : form.focus === 'submit' ? 'submit' : form.focus + 1;
      else if (key === '\u001b[A') form.focus = form.focus === 'submit' ? inputRow : Math.max(1, form.focus - 1);
      else if (key === '\r') {
        if (form.focus === 'submit') form.submitted = { checked: [...form.checked], text: form.text };
        else if (form.focus === inputRow) form.text = form.text ? '' : form.text; // Enter unticks the typed answer
        else form.checked.has(form.focus) ? form.checked.delete(form.focus) : form.checked.add(form.focus);
      } else if (/^[1-9]$/.test(key)) {
        if (form.focus === inputRow) form.text += key;
        else if (Number(key) <= LABELS.length) form.checked.has(Number(key)) ? form.checked.delete(Number(key)) : form.checked.add(Number(key));
      }
    }
  };
  form.deps = { screen: async () => form.render(), write: form.write, pause: async () => {}, record: () => {} };
  return form;
}
const pane = { id: 'terminal-x', project: 'demo', provider: 'claude' };
const question = { id: 'q1', title: TITLE, multiSelect: true, options: LABELS.map((label, i) => ({ key: String(i + 1), label })) };

test('reads ticks, focus and typed text from the form', () => {
  const form = fakeForm({ focus: 3 });
  form.checked.add(2);
  form.text = 'my own place';
  const state = multiSelectState(form.render(), 4);
  assert.deepEqual(state.checked, ['2']);
  assert.equal(state.focus, 3);
  assert.equal(state.customText, 'my own place');
  assert.equal(multiSelectState('no form here', 4), null);
});

test('ticks and unticks an option, confirmed on screen', async () => {
  const form = fakeForm();
  assert.deepEqual((await toggleMultiChoice(pane, question, '3', form.deps)).checked, ['3']);
  assert.deepEqual((await toggleMultiChoice(pane, question, '1', form.deps)).checked, ['1', '3']);
  assert.deepEqual((await toggleMultiChoice(pane, question, '3', form.deps)).checked, ['1']);
  assert.equal(form.submitted, null, 'a tick never submits');
});

test('types an own answer into the typing row and never presses Enter there', async () => {
  const form = fakeForm({ focus: 2 });
  const result = await sendCustomAnswer(pane, question, 'tasks in my email', form.deps);
  assert.equal(result.ok, true, result.error);
  assert.equal(form.text, 'tasks in my email');
  assert.equal(form.focus, 5);
  assert.ok(!form.keys.includes('\r'), 'no Enter: it would untick the typed answer');
  assert.equal((await typeMultiCustomAnswer(pane, question, 'again', form.deps)).notSent, true, 'never appends to existing text');
});

test('a tick after typing leaves the typing row first, so the digit is not typed as text', async () => {
  const form = fakeForm({ focus: 5 });
  form.text = 'own';
  const result = await toggleMultiChoice(pane, question, '2', form.deps);
  assert.deepEqual(result.checked, ['2']);
  assert.equal(form.text, 'own');
});

test('Submit sends exactly what was ticked and typed', async () => {
  const form = fakeForm();
  await toggleMultiChoice(pane, question, '1', form.deps);
  await typeMultiCustomAnswer(pane, question, 'my notes app', form.deps);
  await toggleMultiChoice(pane, question, '4', form.deps);
  const result = await submitMultiChoice(pane, question, form.deps);
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(form.submitted, { checked: [1, 4], text: 'my notes app' });
});

test('Submit refuses an empty answer and a question that is gone', async () => {
  assert.equal((await submitMultiChoice(pane, question, fakeForm().deps)).notSent, true);
  const gone = { ...fakeForm().deps, screen: async () => 'something else' };
  assert.equal((await toggleMultiChoice(pane, question, '1', gone)).notSent, true);
});

test('the phone offers ticks, an own answer and Submit on pick-several questions', () => {
  const html = fs.readFileSync(path.join(import.meta.dirname, '../app/index.html'), 'utf8');
  const server = fs.readFileSync(path.join(import.meta.dirname, '../bridge/server.mjs'), 'utf8');
  assert.match(html, /aria-pressed="\$\{\(ask\.checked\|\|\[\]\)\.includes\(option\.key\)\}"/);
  assert.match(html, /data-submit-multi/);
  assert.doesNotMatch(html, /customAnswerSupported!==false && !ask\.multiSelect/);
  assert.doesNotMatch(server, /pane\.provider==='claude' && !ask\.multiSelect/);
});
