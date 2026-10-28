import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanDeliveryReceipt, reconcileQueuedDeliveries, createDeliveryReconciler } from '../bridge/delivery-reconciliation.mjs';
import { createEventLog } from '../bridge/events-db.mjs';
import { confirmReceipt } from '../bridge/delivery.mjs';

const stamp = n => new Date(n).toISOString();

test('periodic reconciliation survives database reopen and retrieves acknowledgement for every item', t => {
  const f = fixture(t), dbFile = path.join(path.dirname(f.file), 'events.db');
  let store = createEventLog({ file: dbFile, now: () => 1000 });
  store.recordActionEvidence({ ...f.queued[0], source_id: 'D-aabbccdd:queued', kind: 'delivery', request_ids: ['R-1', 'R-2'] });
  store.close();
  store = createEventLog({ file: dbFile, now: () => 3000 }); t.after(() => store.close());
  const run = createDeliveryReconciler({ pending: f => store.pendingActionDeliveries(f), record: e => store.recordActionEvidence(e), recordForPane: () => ({ file: f.file, provider: 'codex', sessionId: f.sessionId }) });
  f.write([codex('old input', 1500)]);
  assert.equal(run([f.pane], 3000).recorded, 0);
  fs.appendFileSync(f.file, JSON.stringify(codex('PRIVATE [delivery D-aabbccdd]')) + '\n');
  run([f.pane], 3000); // finish the cursor pass before wrapping
  assert.equal(run([f.pane], 3000).recorded, 1);
  assert.equal(run([f.pane], 3000).recorded, 0);
  for (const request_id of ['R-1', 'R-2']) {
    const rows = store.queryActionEvidence({ bot_id: 'aaaaaaaaaaaa', request_id });
    assert.deepEqual(rows.map(e => e.state), ['received', 'queued']);
    assert.match(rows[0].source_ref, /^session:exact-session\/byte:\d+$/);
    assert.equal(rows[0].result_code, 'delivery_input_recorded');
    assert.doesNotMatch(JSON.stringify(rows), /PRIVATE|session.jsonl/);
  }
  assert.equal(store.pendingActionDeliveries().length, 0);
});
const codex = (text, at = 2000) => ({ timestamp: stamp(at), type: 'event_msg', payload: { type: 'user_message', message: text } });
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'delivery-reconcile-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'session.jsonl'), sessionId = 'exact-session';
  const write = rows => fs.writeFileSync(file, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
  const pane = { id: 'terminal-exact', alive: true, provider: 'codex', sessionId };
  const queued = [{ bot_id: 'aaaaaaaaaaaa', terminal_id: pane.id, session_id: sessionId, action_id: 'D-aabbccdd', request_ids: ['R-1'], state: 'queued', at: 1000 }];
  const records = new Map(), recordForPane = () => ({ file, provider: pane.provider, sessionId });
  const recordReceived = event => { const key = `${event.bot_id}:${event.source_id}`; if (records.has(key)) return false; records.set(key, event); return true; };
  const run = patch => reconcileQueuedDeliveries({ queued, panes: [pane], recordForPane, recordReceived, now: 3000, ...patch });
  const scan = patch => scanDeliveryReceipt({ file, provider: pane.provider, sessionId, delivery: 'D-aabbccdd', since: 1000, now: 3000, ...patch });
  return { file, sessionId, pane, queued, records, write, run, scan };
}

test('late exact user mark after initial queued timeout records once without changing task authority or leaking text', async t => {
  const f = fixture(t), before = structuredClone(f.queued);
  f.write([codex('Earlier input', 1500)]); assert.equal(f.run().recorded, 0);
  const initial = await confirmReceipt(f.pane, { token: '[delivery D-aabbccdd]', wasBusy: true, timeoutMs: 1, pollMs: 1,
    deps: { panes: async () => [f.pane], transcript: () => f.file, fresh: () => false, screen: async () => '', write: () => assert.fail('No terminal input is allowed') } });
  assert.equal(initial.queued, true); assert.equal(initial.received, false);
  fs.appendFileSync(f.file, JSON.stringify(codex('private request words [delivery D-aabbccdd]')) + '\n');
  assert.equal(f.run().recorded, 1); assert.equal(f.run().recorded, 0);
  assert.equal(f.records.size, 1); assert.deepEqual(f.queued, before);
  const event = [...f.records.values()][0];
  assert.equal(event.source_id, 'D-aabbccdd:received'); assert.equal(event.state, 'received');
  assert.deepEqual(Object.keys(event.proof).sort(), ['session_id', 'file', 'offset', 'observed_at'].sort());
  assert.equal(JSON.stringify(event).includes('private request words'), false);
  assert.equal('status' in event, false);
});

test('Codex response user and Claude structured user formats are accepted', t => {
  const f = fixture(t);
  f.write([{ timestamp: stamp(2000), type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '[delivery D-aabbccdd]' }] } }]);
  assert.ok(f.scan());
  f.write([{ timestamp: stamp(2000), sessionId: f.sessionId, type: 'user', message: { role: 'user', content: [{ type: 'text', text: '[delivery D-aabbccdd]' }] } }]);
  assert.ok(f.scan({ provider: 'claude' }));
});

test('wrong session, missing or dead pane, old and future marks never promote', t => {
  const f = fixture(t); f.write([codex('[delivery D-aabbccdd]')]);
  assert.equal(f.run({ panes: [{ ...f.pane, sessionId: 'other' }] }).recorded, 0);
  assert.equal(f.run({ panes: [] }).recorded, 0);
  assert.equal(f.run({ panes: [{ ...f.pane, alive: false }] }).recorded, 0);
  assert.equal(f.run({ recordForPane: () => ({ file: f.file, provider: 'codex', sessionId: 'other' }) }).recorded, 0);
  f.write([{ type: 'session_meta', payload: { id: 'other' } }, codex('[delivery D-aabbccdd]')]); assert.equal(f.scan(), null);
  f.write([{ timestamp: stamp(2000), sessionId: 'other', type: 'user', message: { role: 'user', content: '[delivery D-aabbccdd]' } }]);
  assert.equal(f.scan({ provider: 'claude' }), null);
  f.write([codex('[delivery D-aabbccdd]', 999), codex('[delivery D-aabbccdd]', 3001)]); assert.equal(f.scan(), null);
});

test('assistant and tool quotes, unknown shapes and partial token strings are not user consumption', t => {
  const f = fixture(t);
  for (const row of [
    { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '[delivery D-aabbccdd]' }] } },
    { type: 'response_item', payload: { type: 'function_call_output', output: '[delivery D-aabbccdd]' } },
    { type: 'unknown', message: '[delivery D-aabbccdd]' },
    codex('[delivery D-aabbccdd-more]'), codex('[delivery D-11223344]'),
  ]) { f.write([{ timestamp: stamp(2000), ...row }]); assert.equal(f.scan(), null); }
});

test('bounded tail handles long rotated records, malformed and partial rows and missing files', t => {
  const f = fixture(t);
  f.write([codex('[delivery D-aabbccdd]'), codex('x'.repeat(300000))]); assert.equal(f.scan(), null);
  f.write([{ type: 'session_meta', payload: { id: f.sessionId } }, codex('x'.repeat(300000)), codex('[delivery D-aabbccdd]')]);
  assert.ok(f.scan()); assert.ok(f.scan().offset > 300000);
  fs.writeFileSync(f.file, '{malformed\n' + JSON.stringify(codex('[delivery D-aabbccdd]'))); assert.equal(f.scan(), null);
  fs.appendFileSync(f.file, '\n'); assert.ok(f.scan());
  fs.unlinkSync(f.file); assert.equal(f.scan(), null);
});

test('bot scope and delivery identities stay separate and processing is capped at twenty', t => {
  const f = fixture(t); f.write([codex('[delivery D-aabbccdd]')]);
  const other = { ...f.queued[0], bot_id: 'bbbbbbbbbbbb', action_id: 'D-11223344' };
  assert.equal(f.run({ queued: [f.queued[0], other] }).recorded, 1);
  assert.deepEqual([...f.records.values()].map(event => event.bot_id), ['aaaaaaaaaaaa']);
  const many = Array.from({ length: 30 }, () => ({ ...f.queued[0] }));
  assert.equal(f.run({ queued: many, maxBatch: 100 }).checked, 20);
});
