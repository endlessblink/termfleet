import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { captureMessage, record, loadLedger } from '../bridge/requirements.mjs';
import { recordOwnerWords } from '../bridge/owner-words.mjs';
import { cli } from '../../scripts/termfleet-asks.mjs';

// All signing material and ledger events are disposable fixtures, never owner records.
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'confirmation-guard-'));
  const config = path.join(root, 'config'), dir = path.join(root, 'ledger');
  const previous = process.env.TC_CONFIG_DIR;
  process.env.TC_CONFIG_DIR = config;
  t.after(() => {
    if (previous === undefined) delete process.env.TC_CONFIG_DIR;
    else process.env.TC_CONFIG_DIR = previous;
    fs.rmSync(root, { recursive: true, force: true });
  });
  captureMessage({ text: '(1) repair the title (2) repair the footer', project: 'fixture', source: 'bot:fixture-chat', msgId: 'request', at: 500 }, { dir });
  record(['R-1', 'R-2'].map(id => ({ e: 'status', id, status: 'ready', at: 1000, evidence: 'isolated fixture result' })), { dir });
  return {
    dir, config, item: id => loadLedger({ dir }).items.get(id),
    sign: (text, { at = Date.now() + 1, botId = 'fixture-chat', id = 'receipt' } = {}) => recordOwnerWords({ id, at, botId, bot: 'Fixture', text }, { base: config }),
    lock: (...args) => cli(['lock', ...args], { TERMFLEET_REQ_DIR: dir }),
  };
}

test('agent-authored approval cannot lock a nonvisual delivered request', t => {
  const f = fixture(t);
  assert.equal(f.lock('R-1', '--noam-said', 'works').ok, false);
  assert.equal(f.item('R-1').locked, false);
  assert.equal(f.item('R-1').confirmedBy, null);
});

for (const [name, text, options] of [
  ['older receipt', 'R-1 works', { at: 900 }],
  ['same-time receipt', 'R-1 works', { at: 1000 }],
  ['unrelated request', 'R-2 works', {}],
  ['wrong chat', 'R-1 works', { botId: 'other-chat' }],
  ['generic approval without a target', 'works, thanks', {}],
  ['mixed positive and negative verdicts', 'R-1 still broken; R-2 works', {}],
  ['quoted claim', 'You said R-1 works', {}],
  ['question', 'R-1 works?', {}],
  ['negative verdict', 'R-1 does not work', {}],
  ['negative app verdict', '[Noam tapped "Still not fixed" on R-1]', { botId: 'app' }],
  ['wrong app target', '[Noam tapped "Works for me" on R-2]', { botId: 'app' }],
]) test(`refuses ${name} without mutating the request`, t => {
  const f = fixture(t); f.sign(text, options);
  const before = fs.readFileSync(path.join(f.dir, 'ledger.jsonl'), 'utf8');
  assert.equal(f.lock('R-1', '--owner-words', 'receipt').ok, false);
  assert.equal(fs.readFileSync(path.join(f.dir, 'ledger.jsonl'), 'utf8'), before);
});

test('raw writers cannot forge locks or owner-confirmed completion', t => {
  const f = fixture(t); f.sign('R-2 works');
  assert.throws(() => record([{ e: 'lock', id: 'R-1', by: 'Noam: works' }], f));
  assert.throws(() => record([{ e: 'status', status: 'done', id: 'R-1', ownerMsg: 'receipt' }], f));
  assert.equal(f.item('R-1').status, 'ready');
});

for (const [text, botId] of [['R-1 works, thanks', 'fixture-chat'], ['R-1 עובד, תודה', 'fixture-chat'], ['[Noam tapped "Works for me" on R-1]', 'app']]) {
  test(`preserves targeted genuine confirmation: ${text}`, t => {
    const f = fixture(t); f.sign(text, { botId });
    assert.equal(f.lock('R-1', '--owner-words', 'receipt').ok, true);
    assert.equal(f.item('R-1').confirmedBy, 'receipt');
    assert.equal(f.item('R-1').locked, true);
    const before = fs.readFileSync(path.join(f.dir, 'ledger.jsonl'), 'utf8');
    assert.equal(f.lock('R-1', '--owner-words', 'receipt').ok, true);
    assert.equal(fs.readFileSync(path.join(f.dir, 'ledger.jsonl'), 'utf8'), before, 'retry preserves the existing lock and its original timestamp');
  });
}

test('multi-item lock validates the whole batch before recording anything', t => {
  const f = fixture(t); f.sign('R-1 works');
  assert.equal(f.lock('R-1,R-2', '--owner-words', 'receipt').ok, false);
  assert.equal(f.item('R-1').locked, false);
  assert.equal(f.item('R-2').locked, false);
});

test('a batch cannot apply an old confirmation to a newer delivery revision', t => {
  const f = fixture(t); f.sign('R-1 works');
  const before = fs.readFileSync(path.join(f.dir, 'ledger.jsonl'), 'utf8');
  assert.throws(() => record([
    { e: 'status', id: 'R-1', status: 'ready', at: 3000, evidence: 'new revision' },
    { e: 'lock', id: 'R-1', ownerMsg: 'receipt' },
    { e: 'status', id: 'R-1', status: 'done', ownerMsg: 'receipt' },
  ], f));
  assert.equal(fs.readFileSync(path.join(f.dir, 'ledger.jsonl'), 'utf8'), before);
});

test('backdating a new delivery event cannot revive an older signed receipt', t => {
  const f = fixture(t); f.sign('R-1 works', { at: Date.now() - 1 });
  record([{ e: 'status', id: 'R-1', status: 'ready', at: 1000, recordedAt: 1000 }], f);
  assert.equal(f.lock('R-1', '--owner-words', 'receipt').ok, false);
  assert.equal(f.item('R-1').locked, false);
});

test('nonvisual agent completion remains distinct from owner confirmation', t => {
  const f = fixture(t);
  record([{ e: 'status', status: 'done', id: 'R-1', evidence: 'isolated result' }], f);
  assert.equal(f.item('R-1').status, 'done');
  assert.equal(f.item('R-1').confirmedBy, null);
});

test('a repeated targeted app verdict keeps the original confirmation unchanged', t => {
  const f = fixture(t);
  f.sign('[Noam tapped "Works for me" on R-1]', { botId: 'app' });
  assert.equal(f.lock('R-1', '--owner-words', 'receipt').ok, true);
  f.sign('[Noam tapped "Works for me" on R-1]', { botId: 'app', id: 'second-tap', at: Date.now() + 10 });
  const before = fs.readFileSync(path.join(f.dir, 'ledger.jsonl'), 'utf8');
  record([{ e: 'status', id: 'R-1', status: 'done', ownerMsg: 'second-tap' }, { e: 'lock', id: 'R-1', ownerMsg: 'second-tap' }], f);
  assert.equal(fs.readFileSync(path.join(f.dir, 'ledger.jsonl'), 'utf8'), before);
  assert.equal(f.item('R-1').confirmedBy, 'receipt');
});
