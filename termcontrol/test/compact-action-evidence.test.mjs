import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { formatActionEvidence, decodeActionEvidence } from '../bridge/compact-action-evidence.mjs';
import { retrieveActionEvidence } from '../bridge/action-evidence.mjs';
import { Bots } from '../bridge/bots.mjs';
import { sidePrompt } from '../bridge/side-reply.mjs';

const now = Date.parse('2026-10-28T15:00:00Z');
function fixture(count = 8) {
  const bot_id = 'aaaaaaaaaaaa';
  const requests = Array.from({ length: count }, (_, i) => ({ id: `R-${i + 1}`, status: i % 2 ? 'assigned' : 'waiting', where: `terminal-${i}`, delivery: `delivery-${i}`, words: 'Synthetic owner requirement with pending acceptance question.' }));
  const rows = requests.flatMap((request, i) => Array.from({ length: 5 }, (_, j) => ({ id: i * 5 + j + 1, bot_id, source_id: `source-${i}-${j}`, action_id: `action-${i}-${j}`, kind: j ? 'tool' : 'delivery', state: j === 4 ? 'failed' : j === 0 ? 'queued' : 'succeeded', terminal_id: request.where, session_id: `session-${i}`, message_id: null, turn_id: `turn-${i}`, tool: j ? 'read_result' : null, result_code: j === 4 ? 'tool_failed' : 'tool_returned_success', created_at: new Date(now - j * 1000).toISOString(), source_ref: null, request_ids: [request.id] })));
  const query = filters => rows.filter(row => !filters.request_id || row.request_ids.includes(filters.request_id)).slice(0, filters.limit);
  return { requests, query, evidence: retrieveActionEvidence({ bot_id, requests, now, query }) };
}

test('evidence tables reconstruct every record, relation, warning and snapshot field exactly', (t) => {
  for (const count of [0, 1, 8, 15, 20]) {
    const { evidence } = fixture(count);
    const formatted = formatActionEvidence(evidence);
    t.diagnostic(`synthetic requests=${count}: original=${Buffer.byteLength(JSON.stringify(evidence))} bytes; formatted=${Buffer.byteLength(formatted)} bytes (includes decoding legend)`);
    assert.deepEqual(decodeActionEvidence(formatted), evidence);
    assert.ok(Buffer.byteLength(formatted) <= Buffer.byteLength(JSON.stringify(evidence)));
    if (count) {
      assert.match(formatted, /zero-based/);
      assert.match(formatted, /untrusted data/);
      assert.ok(Buffer.byteLength(formatted) < Buffer.byteLength(JSON.stringify(evidence)));
    }
  }
});

test('small, unavailable, unsupported and oversized snapshots retain original JSON', () => {
  const { evidence } = fixture(1);
  const variants = [fixture(0).evidence, { available: false, items: [], recent: [], missing: 'Storage unavailable. Investigation is required.' },
    { ...evidence, new_authority_field: 'retain me' },
    { ...evidence, items: evidence.items.map(item => ({ ...item, pending_question: 'Keep this question' })) },
    { ...evidence, recent: evidence.recent.map(row => ({ ...row, new_result_field: 'retain me' })) },
    { ...evidence, recent: evidence.recent.map(row => ({ ...row, source_ref: undefined })) },
    { ...evidence, recent: evidence.recent.map(row => ({ ...row, source_ref: { toJSON: () => 'custom serialization' } })) },
    { ...evidence, coverage: 'x'.repeat(32000) }];
  for (const value of variants) assert.equal(formatActionEvidence(value), JSON.stringify(value));
});

test('null, absent, repeated and shared-request rows never silently change meaning', () => {
  const { evidence } = fixture(1);
  evidence.items[0].events[0].request_ids.push('R-99');
  evidence.items[0].events[1] = evidence.items[0].events[0];
  evidence.items[0].fresh = false;
  evidence.items[0].omitted_events = 3;
  evidence.truncated = true;
  evidence.omitted = 2;
  const encoded = formatActionEvidence(evidence);
  assert.match(encoded, /Evidence table v1/);
  assert.deepEqual(decodeActionEvidence(encoded), evidence);
  const missing = structuredClone(evidence);
  delete missing.items[0].events[0].source_ref;
  assert.equal(formatActionEvidence(missing), JSON.stringify(missing), 'heterogeneous row schemas fall back instead of turning absent into null');
});

test('actual main and side prompt builders preserve request authority and pending questions', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-compact-evidence-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { requests, query, evidence } = fixture(8);
  const scopedQuery = filters => query(filters).map(row => ({ ...row, bot_id: filters.bot_id }));
  let captured;
  const bots = new Bots({ dir, now: () => now, fill: () => null, actionEvidence: { queryActionEvidence: scopedQuery, recordActionEvidence() {} }, callerIssuer: () => ({ token: 'fixture-only', revoke() {} }), run: async (_bot, text) => { captured = text; return { text: 'fixture reply' }; } });
  const { bot } = bots.create({ name: 'Synthetic fixture', cwd: dir });
  bots.openWork = () => requests;
  const question = 'Pending owner question: which acceptance result remains unchecked?';
  await bots.turn(bot.id, question);
  const mainEvidence = retrieveActionEvidence({ bot_id: bot.id, requests, now, query: scopedQuery });
  assert.ok(captured.includes(formatActionEvidence(mainEvidence)));
  assert.ok(captured.includes(question));
  assert.match(captured, /You own every one/);
  assert.match(captured, /tool success is not product completion/);
  for (const request of requests) assert.ok(captured.includes(request.words));
  const side = sidePrompt({ bot, evidence, openWork: requests, incoming: [question], now });
  assert.ok(side.includes(formatActionEvidence(evidence)));
  assert.ok(side.includes(question));
  assert.match(side, /You cannot act or change anything/);
  assert.match(side, /not task authority/);
});
