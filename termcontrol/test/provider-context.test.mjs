import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { captureContext, receiptPrompt, verifyReceipt } from '../bridge/provider-context.mjs';
import crypto from 'node:crypto';
import { Bots, brainCommand } from '../bridge/bots.mjs';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-context-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'source.jsonl');
  const image = path.join(dir, 'photo.png'); fs.writeFileSync(image, 'picture');
  const bot = { id: '0123456789ab', cwd: dir, provider: 'claude', sessions: { claude: { id: 'source', started: true } }, rules: 'Never publish.', inflight: { text: 'Check the last result before retrying.' } };
  const chat = Array.from({ length: 30 }, (_, i) => ({ id: `m${i}`, at: i, role: i % 2 ? 'bot' : 'operator', text: `שלום ${i} ` + 'x'.repeat(i === 0 ? 2000 : 0) }));
  chat[2].attachments = [{ path: image, kind: 'image' }];
  fs.writeFileSync(file, [
    { type: 'user', uuid: 'u1', message: { content: 'Old decision: keep the logo.' } },
    { type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'PRIVATE REASONING' }, { type: 'text', text: 'Last unfinished action: inspect the output.' }, { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/tmp/output.txt' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'Artifact is present.' }] } },
  ].map(JSON.stringify).join('\n') + '\n');
  return { dir, file, bot, chat, image, options: { resolveTranscript: () => file, memory: 'Approved design: blue.', openItems: [{ id: 'R-1', status: 'open', words: 'Finish the picture.' }] } };
}

test('portable capture keeps every ordered turn, Hebrew, decisions, tools and image hashes, excluding hidden reasoning', t => {
  const f = fixture(t), context = captureContext(f.bot, f.chat, f.options);
  assert.equal(context.payload.chat.length, 30);
  assert.equal(context.payload.chat[0].text, f.chat[0].text);
  assert.match(context.json, /Old decision/); assert.match(context.json, /Artifact is present/);
  assert.doesNotMatch(context.json, /PRIVATE REASONING/);
  assert.equal(context.payload.attachments[0].path, f.image);
  assert.equal(context.payload.attachments[0].sha256.length, 64);
  assert.equal(context.payload.ownerRecords[0].authorization, 'none');
  assert.match(receiptPrompt(context), /No tools/);
  assert.equal(verifyReceipt(context, JSON.stringify(context.receipt)), true);
  assert.equal(verifyReceipt(context, JSON.stringify({ ...context.receipt, openItems: [] })), false);
  assert.equal(verifyReceipt(context, JSON.stringify({ ...context.receipt, sha256: 'wrong' })), false);
});

test('missing, damaged, oversized or credential-bearing context stops without silently truncating', t => {
  const f = fixture(t);
  assert.throws(() => captureContext(f.bot, f.chat, { ...f.options, maxBytes: 100 }), /limit/i);
  assert.throws(() => captureContext(f.bot, f.chat, { ...f.options, resolveTranscript: () => null }), /unavailable/i);
  fs.appendFileSync(f.file, '{partial');
  assert.throws(() => captureContext(f.bot, f.chat, f.options), /record/i);
  fs.writeFileSync(f.file, '');
  assert.throws(() => captureContext(f.bot, f.chat, f.options), /empty/i);
  fs.writeFileSync(f.file, JSON.stringify({ type: 'user', message: { content: 'Authorization: Bearer sensitive-secret-value' } }));
  assert.throws(() => captureContext(f.bot, f.chat, f.options), /credential/i);
});

test('Codex public records survive compaction; reasoning and encrypted content stay private', t => {
  const f = fixture(t);
  f.bot.provider = 'codex'; f.bot.sessions.codex = 'codex-source';
  fs.writeFileSync(f.file, [
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'First decision' }] } },
    { type: 'compacted', payload: { message: 'Accessible summary' } },
    { type: 'response_item', payload: { type: 'reasoning', encrypted_content: 'PRIVATE' } },
    { type: 'response_item', payload: { type: 'function_call', call_id: 'one', name: 'exec_command', arguments: '{"cmd":"pwd"}' } },
    { type: 'response_item', payload: { type: 'function_call_output', call_id: 'one', output: '/work' } },
  ].map(JSON.stringify).join('\n'));
  const c = captureContext(f.bot, f.chat, f.options);
  assert.match(c.json, /First decision/); assert.match(c.json, /Accessible summary/);
  assert.match(c.json, /\/work/); assert.doesNotMatch(c.json, /PRIVATE/);
});

function machine(t, { gate = () => {}, receipt = 'good', runWork } = {}) {
  const f = fixture(t), calls = [];
  const controls = { receipt, pause: null };
  const run = async (bot, text, options) => {
    calls.push({ provider: bot.provider, text, validation: Boolean(options.extras?.validateHandoff), sessions: structuredClone(bot.sessions) });
    if (options.extras?.validateHandoff) {
      options.onStart?.(() => {});
      if (controls.pause) await controls.pause;
      const json = text.split(/<portable-context[^>]*>\n/)[1].split('\n</portable-context>')[0];
      const payload = JSON.parse(json);
      const hash = value => crypto.createHash('sha256').update(value).digest('hex');
      const answer = { sha256: hash(json), turns: payload.chat.length, records: payload.records.length, openItems: payload.openItems.map(i => i.id), lastAction: { inflight: payload.unfinished.inflight?.text || null, retry: payload.unfinished.retry?.text || null, lastRecordLine: payload.records.at(-1)?.line ?? null }, unavailable: [] };
      options.onEvent?.({ session: `${bot.provider}-received` });
      if (controls.receipt === 'tool') options.onEvent?.({ step: { name: 'exec_command' } });
      return controls.receipt === 'error' ? { error: 'partial transfer' } : { text: JSON.stringify(controls.receipt === 'wrong' ? { ...answer, turns: -1 } : answer), code: controls.receipt === 'partial' ? 1 : 0 };
    }
    return runWork ? runWork(bot, text, options) : { text: 'Acknowledged and continued.' };
  };
  const options = { dir: path.join(f.dir, 'bots'), run, providerGate: gate, contextOptions: f.options, bins: { claude: '/bin/false', codex: '/bin/false' } };
  const bots = new Bots(options);
  // Keep all test authorities inside the disposable fixture.
  bots.reqDir = () => path.join(f.dir, 'requirements');
  const created = bots.create({ name: 'Portable context', cwd: f.dir });
  assert.equal(created.ok, true);
  const bot = bots.read(created.bot.id);
  bot.sessions.claude.started = true;
  bot.sessions.claude.id = 'original-claude';
  bot.sessions.codex = 'original-codex';
  bots.write(bot);
  for (const message of f.chat) bots.append(bot.id, message);
  return { ...f, bots, bot, options, calls, controls };
}

for (const from of ['claude', 'codex']) test(`${from} switches to the other provider only after its actual payload receipt, preserving source sessions`, async t => {
  const f = machine(t), target = from === 'claude' ? 'codex' : 'claude';
  f.bot.provider = from; f.bot.active = from; f.bots.write(f.bot);
  if (from === 'codex') fs.writeFileSync(f.file, JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Old decision: keep the logo.' }] } }) + '\n');
  const before = structuredClone(f.bot.sessions);
  const changed = f.bots.changeProvider(f.bot.id, target);
  assert.equal(changed.ok, true, changed.error);
  assert.equal(changed.pending, true);
  assert.equal(f.calls.length, 0, 'staging does not run a provider');
  const result = await f.bots.turn(f.bot.id, 'Continue the unfinished action.');
  assert.equal(result.error, undefined);
  assert.deepEqual(f.calls.map(c => c.validation), [true, false]);
  assert.equal(f.calls[1].provider, target);
  assert.equal(target === 'codex' ? f.calls[1].sessions.codex : f.calls[1].sessions.claude.id, `${target}-received`);
  const saved = f.bots.read(f.bot.id);
  assert.equal(saved.providerSwitch, undefined);
  assert.deepEqual(saved.lastProviderSwitch.previous.sessions, before);
  assert.match(f.calls[0].text, /שלום 0/);
  assert.match(f.calls[0].text, /Old decision/);
});

for (const failure of ['wrong', 'error', 'tool']) test(`invalid receipt (${failure}) restores original state and sends no task`, async t => {
  const f = machine(t, { receipt: failure });
  const before = f.bots.read(f.bot.id);
  assert.equal(f.bots.changeProvider(f.bot.id, 'codex').ok, true);
  const result = await f.bots.turn(f.bot.id, 'Never deliver before receipt.');
  assert.equal(result.providerSwitchFailed, true);
  const saved = f.bots.read(f.bot.id);
  assert.equal(saved.provider, before.provider);
  assert.equal(saved.active, before.active);
  assert.deepEqual(saved.sessions, before.sessions);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].validation, true);
  assert.ok(saved.failedProviderSwitch.file);
});

test('policy rejection leaves original state and running turn intact', t => {
  const f = machine(t, { gate: () => { throw new Error('Target blocked by owner policy.'); } });
  let stopped = false;
  f.bots.running.set(f.bot.id, { stop: () => { stopped = true; } });
  const before = f.bots.read(f.bot.id);
  const result = f.bots.changeProvider(f.bot.id, 'codex');
  assert.equal(result.ok, false);
  assert.match(result.error, /policy/);
  assert.equal(stopped, false);
  assert.deepEqual(f.bots.read(f.bot.id), before);
  assert.equal(f.calls.length, 0);
});

test('pending transaction survives restart, rejects conflicting switches and verifies once before continuing', async t => {
  const f = machine(t);
  assert.equal(f.bots.changeProvider(f.bot.id, 'codex').ok, true);
  const pending = f.bots.read(f.bot.id).providerSwitch;
  assert.equal(f.bots.changeProvider(f.bot.id, 'codex').ok, true);
  assert.equal(f.bots.changeProvider(f.bot.id, 'claude').ok, false);
  assert.deepEqual(f.bots.read(f.bot.id).providerSwitch, pending);
  const restarted = new Bots(f.options);
  restarted.reqDir = f.bots.reqDir;
  await restarted.turn(f.bot.id, 'Resume after restart.');
  await restarted.turn(f.bot.id, 'Next turn.');
  assert.equal(f.calls.filter(c => c.validation).length, 1);
  assert.equal(f.calls.filter(c => !c.validation).length, 2);
});

test('changed image or original source stops receipt and restores source conversation', async t => {
  for (const changed of ['image', 'source']) {
    const f = machine(t);
    assert.equal(f.bots.changeProvider(f.bot.id, 'codex').ok, true);
    fs.appendFileSync(changed === 'image' ? f.image : f.file, 'changed');
    const result = await f.bots.turn(f.bot.id, 'Do not act.');
    assert.equal(result.providerSwitchFailed, true);
    assert.equal(f.calls.length, 0);
    assert.equal(f.bots.read(f.bot.id).provider, 'claude');
  }
});

test('receipt command uses separate restricted configuration and stdin, without inherited bot instructions', () => {
  const command = brainCommand({ provider: 'codex', cwd: '/tmp', sessions: {} }, 'portable receipt', { extras: { validateHandoff: true } });
  assert.ok(command.args.includes('--ignore-user-config'));
  assert.ok(command.args.includes('read-only'));
  assert.ok(command.args.includes('shell_tool'));
  assert.equal(command.stdin, 'portable receipt');
  assert.equal(command.args.at(-1), '-');
  assert.ok(!command.args.includes('workspace-write'));
});

test('failed transfer holds every queued message across restart and Retry, without an automatic retry loop', async t => {
  const f = machine(t, { receipt: 'wrong' });
  f.bots.preflight = () => ({ ok: true });
  assert.equal(f.bots.changeProvider(f.bot.id, 'codex').ok, true);
  const messages = Array.from({ length: 35 }, (_, i) => `Unfinished task ${i}`);
  f.bots.queues.set(f.bot.id, messages.slice());
  await f.bots.drain(f.bot.id);
  assert.equal(f.calls.filter(c => !c.validation).length, 0);
  const held = f.bots.read(f.bot.id);
  for (const message of messages) assert.ok(held.blocked.text.includes(message));
  assert.equal(held.inflight, undefined);
  const restarted = new Bots(f.options);
  restarted.reqDir = f.bots.reqDir;
  restarted.preflight = () => ({ ok: true });
  assert.equal(restarted.resumeInterrupted(), 0, 'a rejected transfer needs explicit Retry');
  f.controls.receipt = 'good';
  assert.equal(restarted.retry(f.bot.id).ok, true);
  // Wait only for this bounded local fake turn to settle.
  for (let i = 0; i < 100 && restarted.running.has(f.bot.id); i++) await new Promise(resolve => setTimeout(resolve, 2));
  assert.equal(restarted.running.has(f.bot.id), false);
  assert.equal(restarted.read(f.bot.id).blocked, undefined);
  assert.equal(f.calls.filter(c => !c.validation).length, 1);
  for (const message of messages) assert.ok(f.calls.at(-1).text.includes(message));
});

test('one receipt runs at a time and incoming text reaches the verified provider before old work', async t => {
  const f = machine(t);
  let release;
  f.controls.pause = new Promise(resolve => { release = resolve; });
  assert.equal(f.bots.changeProvider(f.bot.id, 'codex').ok, true);
  f.bots.running.set(f.bot.id, { task: 'original', steps: [] });
  const first = f.bots.turn(f.bot.id, 'Original task.');
  const second = await f.bots.turn(f.bot.id, 'Concurrent task.');
  assert.equal(second.providerSwitchFailed, true);
  f.bots.queues.set(f.bot.id, ['New instruction: do not publish.']);
  release();
  assert.equal((await first).error, undefined);
  assert.equal(f.calls.filter(c => c.validation).length, 1);
  assert.equal(f.calls.filter(c => !c.validation).length, 1);
  assert.match(f.calls.at(-1).text, /New instruction: do not publish/);
  assert.equal(f.bots.queues.get(f.bot.id).length, 0);
});

test('legacy attachments cannot disappear silently and receipt field order is irrelevant', t => {
  const f = fixture(t);
  f.chat[4].images = 2;
  assert.throws(() => captureContext(f.bot, f.chat, f.options), /attachment.*unavailable/i);
  delete f.chat[4].images;
  const c = captureContext(f.bot, f.chat, f.options);
  assert.equal(verifyReceipt(c, JSON.stringify(Object.fromEntries(Object.entries(c.receipt).reverse()))), true);
});

test('missing compaction prefix, forked lineage and unsupported public tools stop explicitly', t => {
  const f = fixture(t);
  f.bot.provider = 'codex'; f.bot.sessions.codex = 'codex-source';
  for (const record of [
    { type: 'compacted', payload: { message: 'Only a summary remains.' } },
    { type: 'session_meta', payload: { forked_from_id: 'missing-parent' } },
    { type: 'response_item', payload: { type: 'web_search_call' } },
  ]) {
    fs.writeFileSync(f.file, JSON.stringify(record));
    assert.throws(() => captureContext(f.bot, f.chat, f.options), /unavailable|Unsupported/);
  }
});

test('partial subprocess completion cannot commit even with a correct payload receipt', async t => {
  const f = machine(t, { receipt: 'partial' });
  assert.equal(f.bots.changeProvider(f.bot.id, 'codex').ok, true);
  const result = await f.bots.turn(f.bot.id, 'Do not repeat completed work.');
  assert.equal(result.providerSwitchFailed, true);
  assert.equal(f.bots.read(f.bot.id).provider, 'claude');
  assert.equal(f.calls.filter(c => !c.validation).length, 0);
});

test('corrupt retained chat is not silently omitted during capture', t => {
  const f = machine(t);
  fs.appendFileSync(path.join(f.bots.folder(f.bot.id), 'chat.jsonl'), '{partial');
  const before = f.bots.read(f.bot.id);
  assert.equal(f.bots.changeProvider(f.bot.id, 'codex').ok, false);
  assert.deepEqual(f.bots.read(f.bot.id), before);
  assert.equal(f.calls.length, 0);
});

test('Retry receipt includes held unfinished work and queued owner instructions', t => {
  const f = machine(t);
  const bot = f.bots.read(f.bot.id);
  bot.blocked = { code: 'provider-context', text: 'Inspect the previous result before retrying.', queued: ['Do not publish.'], at: 1 };
  f.bots.write(bot);
  assert.equal(f.bots.changeProvider(bot.id, 'codex').ok, true);
  const pending = f.bots.read(bot.id).providerSwitch;
  const snapshot = JSON.parse(fs.readFileSync(path.join(f.bots.folder(bot.id), pending.file), 'utf8'));
  assert.equal(snapshot.receipt.lastAction.inflight, bot.blocked.text);
  assert.deepEqual(snapshot.payload.queue, bot.blocked.queued);
});

test('damaged ledger blocks capture without exposing its raw contents', t => {
  const f = machine(t);
  fs.mkdirSync(f.bots.reqDir(), { recursive: true });
  fs.writeFileSync(path.join(f.bots.reqDir(), 'ledger.jsonl'), '{private malformed text');
  const result = f.bots.changeProvider(f.bot.id, 'codex');
  assert.equal(result.ok, false);
  assert.match(result.error, /stored context/);
  assert.doesNotMatch(result.error, /private malformed/);
});

async function waitForLocal(predicate) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  assert.fail('The local fake turn did not settle.');
}

test('failed idle receipt clears quota retry and timer cannot restart held work', async t => {
  const f = machine(t, { receipt: 'wrong' });
  const bot = f.bots.read(f.bot.id);
  bot.retry = { at: 0, text: 'Finish the quota-delayed task.' };
  f.bots.write(bot);
  assert.equal(f.bots.changeProvider(bot.id, 'codex').ok, true);
  await waitForLocal(() => Boolean(f.bots.read(bot.id).blocked));
  const held = f.bots.read(bot.id);
  assert.equal(held.retry, undefined);
  assert.equal(held.blocked.text, bot.retry.text);
  f.bots.retryDue();
  assert.equal(f.calls.filter(call => !call.validation).length, 0);
  held.retry = bot.retry; // A stale disk retry must also respect the hold.
  f.bots.write(held);
  f.bots.retryDue();
  assert.equal(f.calls.length, 1);
  assert.equal(f.bots.running.has(bot.id), false);
  assert.equal(f.bots.read(bot.id).blocked.code, 'provider-context');
});

test('35 arrivals during stalled validation survive shutdown in order, including duplicates', async t => {
  const f = machine(t);
  f.bots.preflight = () => ({ ok: true });
  f.controls.pause = new Promise(() => {}); // Model a process lost before receipt completes.
  f.bots.switchTo(f.bot.id, 'codex', 'Preparing transfer.', { preferred: true });
  f.bots.queues.set(f.bot.id, ['Original unfinished work.']);
  void f.bots.drain(f.bot.id);
  await waitForLocal(() => f.calls.some(call => call.validation));
  const arrivals = Array.from({ length: 35 }, (_, i) => i === 34 ? 'arrival-0' : `arrival-${i}`);
  f.bots.queues.set(f.bot.id, arrivals.slice());
  await f.bots.closeDown({ maxMs: 0 });
  assert.deepEqual(f.bots.read(f.bot.id).queued, arrivals);
  f.controls.pause = null;
  const restarted = new Bots(f.options);
  restarted.reqDir = f.bots.reqDir;
  restarted.preflight = () => ({ ok: true });
  assert.equal(restarted.resumeInterrupted(), 1);
  await waitForLocal(() => !restarted.running.has(f.bot.id));
  const work = f.calls.filter(call => !call.validation);
  assert.equal(work.length, 1);
  assert.match(work[0].text, /Original unfinished work/);
  let position = -1;
  for (const message of arrivals) {
    position = work[0].text.indexOf(message, position + 1);
    assert.notEqual(position, -1, `Missing or reordered ${message}`);
  }
});

test('idle quota switch validates and resumes task without another owner message', async t => {
  const f = machine(t);
  f.bots.preflight = () => ({ ok: true });
  const bot = f.bots.read(f.bot.id);
  bot.retry = { at: Date.now() + 86400000, text: 'Resume the exact pending quota task.' };
  f.bots.write(bot);
  assert.equal(f.bots.changeProvider(bot.id, 'codex').ok, true);
  await waitForLocal(() => f.calls.some(call => !call.validation) && !f.bots.running.has(bot.id));
  assert.deepEqual(f.calls.map(call => call.validation), [true, false]);
  assert.match(f.calls[1].text, /Resume the exact pending quota task/);
  assert.equal(f.calls[1].sessions.codex, 'codex-received');
  assert.equal(f.bots.read(bot.id).providerSwitch, undefined);
  assert.equal(f.bots.read(bot.id).retry, undefined);
});

test('restart finishes pending idle receipt without inventing work', async t => {
  const f = machine(t);
  f.bots.switchTo(f.bot.id, 'codex', 'Preparing transfer.', { preferred: true });
  const restarted = new Bots(f.options);
  restarted.reqDir = f.bots.reqDir;
  assert.equal(restarted.resumeInterrupted(), 1);
  await waitForLocal(() => !restarted.read(f.bot.id).providerSwitch && !restarted.running.has(f.bot.id));
  assert.deepEqual(f.calls.map(call => call.validation), [true]);
  assert.equal(restarted.read(f.bot.id).sessions.codex, 'codex-received');
});

test('receipt completing during graceful shutdown keeps every waiting instruction', async t => {
  const f = machine(t);
  let release;
  f.controls.pause = new Promise(resolve => { release = resolve; });
  assert.equal(f.bots.changeProvider(f.bot.id, 'codex').ok, true);
  await waitForLocal(() => f.calls.some(call => call.validation));
  const arrivals = Array.from({ length: 35 }, (_, i) => `shutdown-arrival-${i}`);
  f.bots.queues.set(f.bot.id, arrivals.slice());
  await f.bots.closeDown({ maxMs: 1000, pause: async () => {
    release();
    await new Promise(resolve => setImmediate(resolve));
  } });
  assert.deepEqual(f.bots.read(f.bot.id).queued, arrivals);
  assert.equal(f.calls.filter(call => !call.validation).length, 0);
});
