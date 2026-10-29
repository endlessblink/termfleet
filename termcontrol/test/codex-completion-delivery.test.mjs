import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Bots } from '../bridge/bots.mjs';
import { checkBotEvents } from '../bridge/bot-events.mjs';
import { completionLifecycle } from '../bridge/adapters/codex.mjs';
import { helperEventIds } from '../bridge/helper-completions.mjs';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-codex-completion-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bots = new Bots({ dir, fill: () => null });
  const { bot } = bots.create({ name: 'Completion fixture', cwd: dir });
  bots.drain = () => {};
  fs.writeFileSync(path.join(bots.folder(bot.id), 'helpers.json'), JSON.stringify([{ paneId: 'helper', at: 1, task: 'fixture work' }]));
  const pane = { id: 'helper', provider: 'codex', sessionId: 'session-fixture', turn: 'working' };
  const lifecycle = { source: 'fixture-source', cursor: 0, activeTurn: null, completions: [] };
  const files = [];
  const tick = (seen = new Map()) => checkBotEvents({ bots, seen, panes: [pane], readAsk: async () => null, readScreen: async () => '', closeCheck: () => files, readCompletion: () => structuredClone(lifecycle) });
  return { bots, bot, pane, lifecycle, tick, dir, files };
}

const event = (type, turn_id, last_agent_message, timestamp = '2026-10-28T12:00:00Z') => JSON.stringify({ type: 'event_msg', timestamp, payload: { type, turn_id, last_agent_message } }) + '\n';
const identityFor = (bot, kind = 'completion') => ({ botId: bot.id, paneId: 'helper', incarnation: '1', provider: 'codex', sessionId: 'session-fixture', turnId: 'turn-1', kind });
const admit = (f, text = 'exact result') => f.bots.acceptHelperEvent(f.bot.id, { identity: identityFor(f.bot), text, enrollmentKey: 'helper', enrollment: { cursor: 2 } });
function fakeBrain(f, run = async () => ({ text: 'I have read the result.' })) {
  f.bots.preflight = () => ({ ok: true });
  f.bots.terminalDigest = () => '';
  f.bots.withSideNotes = (_id, text) => text;
  f.bots.returnIfReset = () => {};
  f.bots.freshStartIfFull = () => {};
  f.bots.turn = run;
}

test('actual lifecycle parser enrolls at a byte cursor and preserves exact completed result', (t) => {
  const f = fixture(t), file = path.join(f.dir, 'lifecycle.jsonl');
  fs.writeFileSync(file, event('task_started', 'old') + event('task_complete', 'old', 'prior result') + event('task_started', 'current'));
  const baseline = completionLifecycle(f.pane, null, file);
  assert.equal(baseline.activeTurn, 'current');
  fs.appendFileSync(file, event('task_complete', 'current', 'same output') + event('task_started', 'newer'));
  const observed = completionLifecycle(f.pane, baseline, file);
  assert.equal(observed.completions.length, 1);
  assert.equal(observed.completions[0].turnId, 'current');
  assert.equal(observed.completions[0].result, 'same output');
  assert.equal(observed.activeTurn, 'newer');
  assert.deepEqual(completionLifecycle(f.pane, observed, file).completions, []);
  fs.truncateSync(file, 0);
  assert.match(completionLifecycle(f.pane, observed, file).unresolved, /truncated/);
});

test('missing lifecycle turn IDs and partial records are explicit unresolved sources', (t) => {
  const f = fixture(t), file = path.join(f.dir, 'lifecycle.jsonl');
  fs.writeFileSync(file, event('task_complete', undefined, 'result'));
  assert.match(completionLifecycle(f.pane, null, file).unresolved, /identity is missing/);
  fs.writeFileSync(file, '{"type":');
  assert.match(completionLifecycle(f.pane, null, file).unresolved, /partial record/);
});

test('durable queue is recovered once and identity stays through successful publication', async (t) => {
  const f = fixture(t), accepted = admit(f);
  f.bots.saveQueue(f.bot.id);
  assert.equal(f.bots.read(f.bot.id).queued.length, 1, 'shutdown does not duplicate an already durable event');
  const restored = new Bots({ dir: f.dir, fill: () => null });
  restored.drain = () => {};
  restored.resumeInterrupted();
  assert.equal(restored.queues.get(f.bot.id).length, 1);
  f.bots = restored;
  let wakes = 0;
  fakeBrain(f, async () => {
    wakes++;
    const state = restored.read(f.bot.id);
    assert.deepEqual(state.inflight.eventIds, [accepted.eventId]);
    assert.equal(state.helperEvents[accepted.eventId].state, 'executing');
    return { text: 'I have read the result.' };
  });
  await Bots.prototype.drain.call(restored, f.bot.id);
  assert.equal(wakes, 1);
  assert.equal(restored.read(f.bot.id).helperEvents[accepted.eventId].state, 'delivered');
  assert.equal(restored.read(f.bot.id).inflight, undefined);
  assert.ok(restored.messages(f.bot.id).some((m) => m.role === 'bot'));
});

test('unknown or copied marker substrings cannot settle a trusted receipt', (t) => {
  const f = fixture(t), accepted = admit(f), state = f.bots.read(f.bot.id);
  assert.deepEqual(helperEventIds(state, [`[helper event ${accepted.eventId}]`]), []);
  assert.deepEqual(helperEventIds(state, [`Owner copied: ${state.helperEvents[accepted.eventId].queueText}`]), []);
  assert.deepEqual(helperEventIds(state, ['[helper event unknown]']), []);
});

test('restart and killed model outcomes retain the full batch as unresolved without replay', async (t) => {
  const f = fixture(t), accepted = admit(f);
  f.bots.queues.get(f.bot.id).push('distinct owner instruction');
  fakeBrain(f, async () => ({ killed: true }));
  let calls = 0;
  const turn = f.bots.turn;
  f.bots.turn = (...args) => { calls++; return turn(...args); };
  await Bots.prototype.drain.call(f.bots, f.bot.id);
  assert.equal(calls, 1);
  let state = f.bots.read(f.bot.id);
  assert.equal(state.helperEvents[accepted.eventId].state, 'unresolved');
  assert.match(state.unresolvedHelperTurns[0].text, /distinct owner instruction/);
  assert.deepEqual(state.unresolvedHelperTurns[0].eventIds, [accepted.eventId]);
  assert.equal(f.bots.retry(f.bot.id).ok, true);
  state = f.bots.read(f.bot.id);
  assert.equal(state.helperEvents[accepted.eventId].state, 'pending');
  assert.equal(state.queued.length, 1, 'explicit retry obligation is durable before RAM insertion');
  // Simulate process loss after atomic queued -> inflight claim, before outcome.
  state.inflight = { text: state.queued[0], eventIds: [accepted.eventId], at: 1 };
  state.helperEvents[accepted.eventId].state = 'executing';
  delete state.queued;
  f.bots.write(state);
  const restored = new Bots({ dir: f.dir, fill: () => null });
  restored.drain = () => { throw new Error('must not automatically replay ambiguous work'); };
  restored.resumeInterrupted();
  assert.equal(restored.read(f.bot.id).helperEvents[accepted.eventId].state, 'unresolved');
  assert.match(restored.read(f.bot.id).unresolvedHelperTurns[0].text, /distinct owner instruction/);
});

test('unchanged Codex result is one durable obligation across working flickers and restart', async (t) => {
  const f = fixture(t);
  await f.tick(); // explicit enrollment cursor
  Object.assign(f.lifecycle, { cursor: 2, completions: [{ turnId: 'turn-1', cursor: 2, result: 'same output', source: 'fixture-source:2' }] });
  f.pane.turn = 'idle';
  await Promise.all([f.tick(), f.tick()]);
  f.pane.turn = 'working'; await f.tick(); await f.tick();
  f.pane.turn = 'idle'; await f.tick();
  const reopened = new Bots({ dir: f.dir, fill: () => null });
  assert.equal(Object.keys(reopened.read(f.bot.id).helperEvents || {}).length, 1);
  assert.equal(reopened.read(f.bot.id).queued.length, 1);
  f.lifecycle.cursor = 4;
  f.lifecycle.completions.push({ turnId: 'turn-2', cursor: 4, result: 'same output', source: 'fixture-source:4' });
  await f.tick();
  assert.equal(Object.keys(f.bots.read(f.bot.id).helperEvents).length, 2, 'identical text in a distinct turn is distinct work');
});

test('admission is atomic, idempotent, and a failed persistence stays retryable', (t) => {
  const { bots, bot } = fixture(t);
  const identity = { botId: bot.id, paneId: 'helper', incarnation: '1', provider: 'codex', sessionId: 'session-fixture', turnId: 'turn-1', kind: 'completion' };
  const original = bots.write.bind(bots);
  bots.write = () => { throw new Error('fault before atomic rename'); };
  assert.throws(() => bots.acceptHelperEvent(bot.id, { identity, text: 'result', enrollmentKey: 'helper', enrollment: { cursor: 2 } }), /fault/);
  assert.equal(bots.read(bot.id).helperEvents, undefined);
  bots.write = original;
  const first = bots.acceptHelperEvent(bot.id, { identity, text: 'result', enrollmentKey: 'helper', enrollment: { cursor: 2 } });
  const second = bots.acceptHelperEvent(bot.id, { identity, text: 'result', enrollmentKey: 'helper', enrollment: { cursor: 2 } });
  assert.equal(first.eventId, second.eventId);
  assert.equal(bots.read(bot.id).queued.length, 1);
});

test('registration ignores prior completed history and newer active work prevents close advice', async (t) => {
  const f = fixture(t);
  Object.assign(f.lifecycle, { cursor: 2, completions: [{ turnId: 'old', cursor: 2, result: 'old', source: 'fixture-source:2' }] });
  await f.tick();
  assert.equal(Object.keys(f.bots.read(f.bot.id).helperEvents || {}).length, 0);
  Object.assign(f.lifecycle, { cursor: 5, activeTurn: 'newer', completions: [{ turnId: 'current', cursor: 4, result: 'exact result', source: 'fixture-source:4' }] });
  await f.tick();
  const [receipt] = Object.values(f.bots.read(f.bot.id).helperEvents);
  assert.doesNotMatch(receipt.text, /termfleet-team close/);
  assert.match(receipt.text, /exact result/);
});

test('a new helper that finishes before the first poll is not mistaken for historical registration', async (t) => {
  const f = fixture(t), file = path.join(f.dir, 'fast.jsonl');
  fs.writeFileSync(file, event('task_started', 'fast') + event('task_complete', 'fast', 'fast result'));
  fs.writeFileSync(path.join(f.bots.folder(f.bot.id), 'helpers.json'), JSON.stringify([{ paneId: 'helper', at: 1, completionEnrollment: { kind: 'new-session', registeredAt: Date.parse('2026-10-28T11:59:59Z') } }]));
  f.pane.turn = 'idle';
  await checkBotEvents({ bots: f.bots, seen: new Map(), panes: [f.pane], readAsk: async () => null, readCompletion: (pane, enrolled) => completionLifecycle(pane, enrolled, file), closeCheck: () => [] });
  assert.equal(Object.keys(f.bots.read(f.bot.id).helperEvents).length, 1);
});

test('unsaved then closeable is one independent event after restarts; approval prevents close advice', async (t) => {
  const f = fixture(t);
  await f.tick();
  f.pane.turn = 'idle';
  f.files.push('unsaved.txt');
  Object.assign(f.lifecycle, { cursor: 2, completions: [{ turnId: 'turn-1', cursor: 2, result: 'same', source: 'fixture:2' }] });
  await f.tick();
  assert.equal(Object.keys(f.bots.read(f.bot.id).helperEvents).length, 1);
  f.files.pop();
  f.pane.attention = { kind: 'permission' };
  await f.tick();
  assert.equal(Object.keys(f.bots.read(f.bot.id).helperEvents).length, 1, 'pending approval cannot authorize closure');
  delete f.pane.attention;
  await f.tick(); await f.tick();
  const restored = new Bots({ dir: f.dir, fill: () => null });
  restored.drain = () => {};
  await checkBotEvents({ bots: restored, seen: new Map(), panes: [f.pane], readAsk: async () => null, readCompletion: () => f.lifecycle, closeCheck: () => [] });
  assert.deepEqual(Object.values(restored.read(f.bot.id).helperEvents).map((e) => e.identity.kind).sort(), ['closeability', 'completion']);
});

test('fault after durable acceptance and before follow retirement retries retirement without a second event', async (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.bots.folder(f.bot.id), 'helpers.json'), JSON.stringify([{ paneId: 'helper', at: 1, followed: true }]));
  await f.tick();
  Object.assign(f.lifecycle, { cursor: 2, completions: [{ turnId: 'turn-1', cursor: 2, result: 'follow result', source: 'fixture:2' }] });
  const end = f.bots.endFollow.bind(f.bots);
  f.bots.endFollow = () => { throw new Error('retirement fault'); };
  await assert.rejects(f.tick(), /retirement fault/);
  assert.equal(Object.keys(f.bots.read(f.bot.id).helperEvents).length, 1);
  f.bots.endFollow = end;
  await f.tick();
  assert.equal(Object.keys(f.bots.read(f.bot.id).helperEvents).length, 1);
  assert.ok(f.bots.helpers(f.bot.id)[0].ended);
});

test('publication failure never settles the event and explicit Retry remains visible', async (t) => {
  const f = fixture(t), accepted = admit(f);
  fakeBrain(f);
  const append = f.bots.append.bind(f.bots);
  f.bots.append = (id, msg) => { if (msg.role === 'bot') throw new Error('publication fault'); return append(id, msg); };
  await Bots.prototype.drain.call(f.bots, f.bot.id);
  const state = f.bots.read(f.bot.id);
  assert.equal(state.helperEvents[accepted.eventId].state, 'unresolved');
  assert.ok(state.unresolvedHelperTurns[0].text.includes('exact result'));
  assert.ok(f.bots.summary(f.bot.id).blocked, 'existing UI exposes the explicit Retry button');
});

test('large lifecycle payloads are bounded before JSON parsing and previews stay small', (t) => {
  const f = fixture(t), file = path.join(f.dir, 'large.jsonl');
  fs.writeFileSync(file, event('task_started', 'current') + event('task_complete', 'current', 'x'.repeat(900_000)));
  const observed = completionLifecycle(f.pane, null, file);
  assert.equal(observed.completions[0].result.length, 2048);
  fs.writeFileSync(file, event('task_started', 'current') + event('task_complete', 'current', 'x'.repeat(1024 * 1024)));
  assert.match(completionLifecycle(f.pane, null, file).unresolved, /safe read bound/);
});

test('post-rename acceptance fault is reconciled on the next poll without restart', async (t) => {
  const f = fixture(t);
  await f.tick();
  Object.assign(f.lifecycle, { cursor: 2, completions: [{ turnId: 'turn-1', cursor: 2, result: 'result', source: 'fixture:2' }] });
  const write = f.bots.writeHelperState.bind(f.bots);
  let fail = true;
  f.bots.writeHelperState = (bot) => {
    write(bot);
    if (fail && Object.keys(bot.helperEvents || {}).length) { fail = false; throw new Error('fsync outcome fault after rename'); }
  };
  await assert.rejects(f.tick(), /fsync outcome fault/);
  assert.equal(f.bots.queues.get(f.bot.id), undefined);
  await f.tick();
  assert.equal(f.bots.queues.get(f.bot.id).length, 1);
  assert.equal(Object.keys(f.bots.read(f.bot.id).helperEvents).length, 1);
});

test('preprocessing fault retains event identity and full mixed batch for usable explicit retry', async (t) => {
  const f = fixture(t), accepted = admit(f);
  fakeBrain(f);
  f.bots.queues.get(f.bot.id).push('owner words retained');
  f.bots.terminalDigest = () => { throw new Error('preprocessing fault'); };
  await Bots.prototype.drain.call(f.bots, f.bot.id);
  const state = f.bots.read(f.bot.id);
  assert.equal(state.helperEvents[accepted.eventId].state, 'unresolved');
  assert.match(state.unresolvedHelperTurns[0].text, /owner words retained/);
  const restored = new Bots({ dir: f.dir, fill: () => null });
  restored.drain = () => { throw new Error('must not replay unresolved preprocessing batch'); };
  restored.resumeInterrupted();
  assert.equal(restored.queues.get(f.bot.id)?.length || 0, 0);
  assert.equal(f.bots.retry(f.bot.id).ok, true);
});

test('provider snapshot cannot automatically replay an unresolved helper batch', async (t) => {
  const f = fixture(t), accepted = admit(f), state = f.bots.read(f.bot.id);
  const text = state.queued[0] + '\nowner payload';
  state.providerSwitch = { previous: { inflight: { text, eventIds: [accepted.eventId] } } };
  delete state.queued;
  state.helperEvents[accepted.eventId].state = 'executing';
  f.bots.write(state);
  f.bots.queues.set(f.bot.id, []);
  f.bots.verifyProviderChange = async () => null;
  await f.bots.finishIdleProviderChange(f.bot.id);
  const held = f.bots.read(f.bot.id);
  assert.equal(held.providerSwitch.previous.inflight, undefined);
  assert.match(held.unresolvedHelperTurns[0].text, /owner payload/);
  assert.equal(f.bots.queues.get(f.bot.id).length, 0);
});

test('queue claim and publication acknowledgment faults never lose a durable obligation', async (t) => {
  for (const phase of ['claim', 'publishing', 'acknowledgment']) {
    const f = fixture(t), accepted = admit(f);
    fakeBrain(f);
    const write = f.bots.write.bind(f.bots);
    let failed = false;
    f.bots.write = (state) => {
      const e = state.helperEvents?.[accepted.eventId];
      const target = phase === 'claim' ? state.inflight && !state.inflight.phase
        : phase === 'publishing' ? state.inflight?.phase === 'publishing' : e?.state === 'delivered';
      if (!failed && target) { failed = true; throw new Error(`fault ${phase}`); }
      return write(state);
    };
    await Bots.prototype.drain.call(f.bots, f.bot.id);
    assert.equal(failed, true, phase);
    const state = f.bots.read(f.bot.id);
    assert.equal(state.helperEvents[accepted.eventId].state, 'unresolved', phase);
    assert.equal(state.unresolvedHelperTurns.length, 1, phase);
  }
});

test('messages merged during actual provider verification retain identities and full retry payload', async (t) => {
  const f = fixture(t), first = admit(f);
  fakeBrain(f);
  const state = f.bots.read(f.bot.id);
  state.providerSwitch = { previous: {} };
  f.bots.write(state);
  let second;
  f.bots.verifyProviderChange = async () => {
    second = f.bots.acceptHelperEvent(f.bot.id, { identity: { ...identityFor(f.bot), turnId: 'turn-2' }, text: 'new exact payload during transfer', enrollmentKey: 'helper', enrollment: { cursor: 4 } });
    f.bots.queues.get(f.bot.id).push('owner message during transfer');
    const verified = f.bots.read(f.bot.id);
    delete verified.providerSwitch;
    f.bots.write(verified);
    return null;
  };
  f.bots.callerIssuer = () => ({ token: 'fixture', revoke() {} });
  f.bots.run = async () => ({ error: 'simulated uncertain provider result' });
  f.bots.turn = (id, text) => Bots.prototype.turn.call(f.bots, id, text);
  await Bots.prototype.drain.call(f.bots, f.bot.id);
  const held = f.bots.read(f.bot.id).unresolvedHelperTurns[0];
  assert.deepEqual(held.eventIds.sort(), [first.eventId, second.eventId].sort());
  assert.match(held.text, /new exact payload during transfer/);
  assert.match(held.text, /owner message during transfer/);
});

test('large initial enrollment checkpoints bounded scans without replaying remaining history', async (t) => {
  const f = fixture(t), file = path.join(f.dir, 'history.jsonl');
  const noise = JSON.stringify({ type: 'response_item', payload: { text: 'x'.repeat(64 * 1024) } }) + '\n';
  fs.writeFileSync(file, noise.repeat(145) + event('task_started', 'historical') + event('task_complete', 'historical', 'old result'));
  const tick = () => checkBotEvents({ bots: f.bots, seen: new Map(), panes: [f.pane], readAsk: async () => null, closeCheck: () => [], readCompletion: (pane, enrolled) => completionLifecycle(pane, enrolled, file) });
  await tick();
  const enrollment = Object.values(f.bots.read(f.bot.id).helperEnrollments)[0];
  assert.equal(enrollment.initializing, true);
  assert.ok(enrollment.cursor < fs.statSync(file).size);
  fs.appendFileSync(file, event('task_started', 'new') + event('task_complete', 'new', 'new result'));
  await tick();
  assert.equal(Object.keys(f.bots.read(f.bot.id).helperEvents || {}).length, 0);
  await tick();
  assert.deepEqual(Object.values(f.bots.read(f.bot.id).helperEvents).map((e) => e.identity.turnId), ['new']);
});

test('completion backlog is delivered in bounded batches without advancing past undelivered turns', (t) => {
  const f = fixture(t), file = path.join(f.dir, 'backlog.jsonl');
  fs.writeFileSync(file, Array.from({ length: 11 }, (_, n) => event('task_started', `turn-${n}`) + event('task_complete', `turn-${n}`, 'same')).join(''));
  let cursor = null;
  const turns = [];
  do {
    const observed = completionLifecycle(f.pane, cursor, file);
    assert.ok(observed.completions.length <= 4);
    turns.push(...observed.completions.map((e) => e.turnId));
    cursor = observed;
  } while (cursor.more);
  assert.equal(turns.length, 11);
  assert.equal(new Set(turns).size, 11);
});

test('an initially absent source retries successfully when the lifecycle record becomes available', async (t) => {
  const f = fixture(t), file = path.join(f.dir, 'eventually-visible.jsonl');
  fs.writeFileSync(path.join(f.bots.folder(f.bot.id), 'helpers.json'), JSON.stringify([{ paneId: 'helper', at: 1, completionEnrollment: { kind: 'new-session', registeredAt: Date.parse('2026-10-28T11:59:59Z') } }]));
  const tick = () => checkBotEvents({ bots: f.bots, seen: new Map(), panes: [f.pane], readAsk: async () => null, closeCheck: () => [], readCompletion: (pane, enrolled) => completionLifecycle(pane, enrolled, file) });
  await tick();
  assert.equal(f.bots.summary(f.bot.id).helperDelivery.sources.length, 1);
  fs.writeFileSync(file, event('task_started', 'visible') + event('task_complete', 'visible', 'eventually visible result'));
  await tick();
  assert.equal(Object.keys(f.bots.read(f.bot.id).helperEvents).length, 1);
  assert.equal(f.bots.summary(f.bot.id).helperDelivery.sources.length, 0);
});
