import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { Bots } from '../bridge/bots.mjs';
import { beginPromptObservation, isCurrentPromptObservation, checkBotEvents, helperState, retireTerminalPrompt, screenStillAsks, REMIND_AFTER_MS } from '../bridge/bot-events.mjs';
import { promptObservation } from '../bridge/prompt-lifecycle.mjs';
import { matchesAsk } from '../bridge/asks.mjs';

const ask = { id: 'quota-1', kind: 'permission', title: 'What do you want to do?', options: [{ key: '1', label: 'Stop and wait' }, { key: '2', label: 'Switch to usage credits' }] };
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-prompt-life-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let now = 1800000000000;
  const bots = new Bots({ dir, run: async () => ({ text: 'unused' }), fill: () => null, checks: { home: os.homedir() }, now: () => now });
  const { bot } = bots.create({ name: 'Isolated prompt fixture', cwd: os.tmpdir() });
  fs.writeFileSync(path.join(bots.folder(bot.id), 'helpers.json'), JSON.stringify([{ paneId: 'terminal-fixture', task: 'Synthetic approval', at: now }]));
  bots.wake = () => ({ ok: true });
  const pane = { id: 'terminal-fixture', provider: 'claude', sessionId: 's1', turn: 'waiting' };
  const look = ({ current = ask, screen = 'Synthetic live permission', panes = [pane], available = true, seen = new Map() } = {}) => checkBotEvents({ bots, panes, available, seen, now: now += REMIND_AFTER_MS, readAsk: async () => current, readScreen: async () => screen, closeCheck: () => [], prompted: () => false, notify: () => {} });
  const cards = () => bots.messages(bot.id).filter(m => m.role === 'terminal-ask');
  const reminders = () => bots.messages(bot.id).filter(m => m.role === 'reminder');
  return { bots, bot, pane, look, cards, reminders, time: () => now };
}

for (const reason of ['closed while visible', 'cancelled', 'restart with stale waiting status']) test(reason, async t => {
  const f = fixture(t); await f.look();
  const seen = new Map();
  await f.look({ current: null, screen: 'Cancelled. Back at the command prompt.', seen });
  await f.look({ current: null, screen: 'Cancelled. Back at the command prompt.', seen });
  assert.equal(f.cards()[0].settled, true);
  assert.equal(f.reminders().length, 0, 'no reminder without a currently verified prompt');
  assert.equal(helperState(f.bots.list().find(b => b.id === f.bot.id), [f.pane], f.time(), { bots: f.bots }).helpersAsking, 0);
});

test('disconnect and unknown screen preserve approval history but cannot remind; reconnect restores exact active prompt', async t => {
  const f = fixture(t); await f.look();
  await f.look({ panes: [], available: false });
  assert.equal(f.cards()[0].settled, undefined);
  assert.equal(f.cards()[0].promptState, 'unknown');
  await f.look({ current: null, screen: '' });
  assert.equal(f.cards()[0].settled, undefined);
  assert.equal(f.reminders().length, 0);
  await f.look();
  assert.equal(f.cards().length, 1);
  assert.equal(f.cards()[0].promptState, 'active');
  assert.equal(f.reminders().length, 1, 'a genuinely active unanswered approval may remind after reconnect');
});

test('confirmed terminal exit immediately retires approval', async t => {
  const f = fixture(t); await f.look(); await f.look({ panes: [] });
  assert.equal(f.cards()[0].settled, true);
  assert.equal(f.cards()[0].terminalClosed, true);
  assert.equal(f.reminders().length, 0);
});

test('a daemon-owned session whose process exited is closed even if its old screen remains', async t => {
  const f = fixture(t); await f.look();
  await f.look({ panes: [{ ...f.pane, exited: true }] });
  assert.equal(f.cards()[0].settled, true);
  assert.equal(f.reminders().length, 0);
});

for (const change of [{ provider: 'codex' }, { sessionId: 's2' }]) test('provider or conversation replacement retires old approval', async t => {
  const f = fixture(t); await f.look();
  await f.look({ panes: [{ ...f.pane, ...change }], current: null, screen: '' });
  assert.equal(f.cards()[0].settled, true);
  assert.equal(f.reminders().length, 0);
});

test('a provider switch keeps the replacement provider approval answerable', async t => {
  const f = fixture(t); await f.look();
  await f.look({ panes: [{ ...f.pane, provider: 'codex', sessionId: 's2' }], current: { ...ask, id: 'codex-approval' } });
  assert.equal(f.cards()[0].settled, true);
  assert.equal(f.cards()[1].askId, 'codex-approval');
  assert.equal(f.cards()[1].settled, undefined);
});

test('a different prompt supersedes the old card without reminding about it', async t => {
  const f = fixture(t); await f.look();
  await f.look({ current: { ...ask, id: 'different', title: 'Allow a different command?' } });
  assert.equal(f.cards()[0].settled, true);
  assert.equal(f.cards()[1].askId, 'different');
  assert.equal(f.reminders().length, 0);
});

test('late observation cannot resurrect an approval after a newer confirmed terminal exit', async t => {
  const f = fixture(t); await f.look();
  let release, started;
  const pending = new Promise(resolve => { release = resolve; });
  const reading = new Promise(resolve => { started = resolve; });
  const late = checkBotEvents({ bots: f.bots, panes: [f.pane], seen: new Map(), now: f.time(), readAsk: async () => { started(); return pending; }, readScreen: async () => 'Old prompt screen', notify: () => {} });
  await reading;
  await f.look({ panes: [] });
  release(ask); await late;
  assert.equal(f.cards().length, 1);
  assert.equal(f.cards()[0].settled, true);
  assert.equal(f.reminders().length, 0);
});

test('a stale answer retires its exact ID durably and cannot retire a replacement', async t => {
  const f = fixture(t); await f.look();
  retireTerminalPrompt(f.bots, f.pane.id, ask.id);
  assert.equal(f.cards()[0].settled, true);
  await f.look({ current: { ...ask, id: 'new-prompt', title: 'A new approval' } });
  retireTerminalPrompt(f.bots, f.pane.id, ask.id);
  assert.equal(f.cards()[1].settled, undefined);
  const reloaded = new Bots({ dir: path.dirname(f.bots.folder(f.bot.id)), run: async () => ({ text: 'unused' }), fill: () => null });
  assert.equal(reloaded.messages(f.bot.id).find(m => m.askId === ask.id).settled, true);
});

// Exercise the actual route's authority checks with isolated sources and no
// daemon/provider transport. These guards must precede any key injection.
const server = fs.readFileSync(new URL('../bridge/server.mjs', import.meta.url), 'utf8');
const start = server.indexOf('const current = await currentPanes({ fresh: true });', server.indexOf('const existing = choiceReceipts.get(pane.id, payload.askId)'));
const end = server.indexOf('const adapter = adapterFor(fresh);', start);
assert.ok(start >= 0 && end > start, 'the send route has a fresh authority check');
async function routeAuthority({ bots, pane, daemon = true, currentAsk = ask, screen = 'Live synthetic menu', screenAsk = null, cachedScreen = null, choice = '1' }) {
  return vm.runInNewContext(`(async () => { ${server.slice(start, end)} return {verified:true}; })()`, {
    bots, payload: { pane: pane.id, askId: ask.id, choice },
    currentPanes: async () => ({ daemon, panes: [pane] }),
    visibleScreenOf: () => cachedScreen, liveScreenOf: async () => screen,
    pendingAsk: () => currentAsk,
    screenPermissionAsk: (_pane, observed) => observed === screen && String(observed || '').trim() ? screenAsk : null,
    matchesAsk, retireTerminalPrompt, res: {}, json: (_res, status, body) => ({ status, ...body }),
  });
}

test('send route unavailable service and unreadable screen refuse without retiring history', async t => {
  const f = fixture(t); await f.look();
  for (const observation of [{ daemon: false }, { currentAsk: null, screen: '' }]) {
    const result = await routeAuthority({ bots: f.bots, pane: f.pane, ...observation });
    assert.equal(result.status, 503); assert.equal(result.notSent, true);
    assert.equal(f.cards()[0].settled, undefined);
  }
});

test('matching cached old prompt cannot authorize input when the live screen is unavailable', async t => {
  const f = fixture(t); await f.look();
  for (const screen of [null, '']) {
    const result = await routeAuthority({ bots: f.bots, pane: f.pane, currentAsk: ask, screen, cachedScreen: 'Cached old quota menu' });
    assert.equal(result.status, 503);
    assert.equal(result.notSent, true);
    assert.equal(result.verified, undefined, 'transport cannot proceed using cached prompt identity');
    assert.equal(f.cards()[0].settled, undefined, 'unknown observation preserves approval history');
  }
});

test('send route changed prompt retires exactly the old ID while invalid choice on same ID preserves it', async t => {
  const f = fixture(t); await f.look();
  const screen = 'What do you want to do?\n1. Stop and wait\n2. Switch to usage credits\nEsc to cancel';
  const invalidChoice = await routeAuthority({ bots: f.bots, pane: f.pane, screen, screenAsk: ask, choice: 'not-an-option' });
  assert.equal(invalidChoice.status, 409);
  assert.equal(invalidChoice.stale, true);
  assert.equal(invalidChoice.current.id, ask.id);
  assert.equal(invalidChoice.verified, undefined, 'an invalid choice cannot reach key injection');
  assert.equal(f.cards()[0].settled, undefined, 'invalid choice is not proof that a live prompt ended');
  const replacement = { ...ask, id: 'replacement', title: 'Allow a different command?' };
  const replacementScreen = 'Allow a different command?\n1. Stop and wait\n2. Switch to usage credits\nEsc to cancel';
  const changedPrompt = await routeAuthority({ bots: f.bots, pane: f.pane, currentAsk: replacement, screen: replacementScreen, screenAsk: replacement });
  assert.equal(changedPrompt.status, 409);
  assert.equal(changedPrompt.stale, true);
  assert.equal(changedPrompt.current.id, replacement.id);
  assert.equal(changedPrompt.verified, undefined, 'an old question cannot reach key injection');
  assert.equal(f.cards()[0].settled, true);
});

test('send route refuses permission absent from or different on the live screen without retiring history', async t => {
  const f = fixture(t); await f.look();
  for (const observation of [
    { screen: 'Finished checking. Ready for the next message.' },
    { screen: 'A different permission is open.', screenAsk: { ...ask, id: 'different-screen-permission' } },
  ]) {
    const result = await routeAuthority({ bots: f.bots, pane: f.pane, ...observation });
    assert.equal(result.status, 409);
    assert.equal(result.notSent, true);
    assert.equal(result.verified, undefined, 'an unverified permission cannot pass the authority gate');
    assert.equal(f.cards()[0].settled, undefined, 'a screen mismatch does not authorize retiring retained history');
  }
});

const refreshStart = server.indexOf('view.messages = await Promise.all(view.messages.map(async (card) => {', server.indexOf('// A chat refresh checks its open cards'));
const refreshEnd = server.indexOf('view.bot.helpers ||= [];', refreshStart);
assert.ok(refreshStart >= 0 && refreshEnd > refreshStart, 'chat refresh reconciles its visible cards');
async function refreshCards(f, { daemon = true, currentAsk = ask, screen = 'Synthetic live menu' } = {}) {
  const view = { bot: f.bot, messages: f.bots.messages(f.bot.id) };
  const promptRound = beginPromptObservation(f.bots);
  return vm.runInNewContext(`(async () => { ${server.slice(refreshStart, refreshEnd)} return view; })()`, {
    view, bots: f.bots, panes: [f.pane], daemon, promptRound,
    beginPromptObservation, isCurrentPromptObservation,
    liveScreenOf: async () => typeof screen === 'function' ? screen() : screen, pendingAsk: () => currentAsk,
    screenPermissionAsk: () => null, promptObservation, screenStillAsks, retireTerminalPrompt,
  });
}

test('chat refresh immediately retires a positively absent prompt without new reminders', async t => {
  const f = fixture(t); await f.look();
  const view = await refreshCards(f, { currentAsk: null, screen: 'Cancelled. Agent ready for a message.' });
  assert.equal(view.messages.find(m => m.role === 'terminal-ask').settled, true);
  assert.equal(f.cards()[0].settled, true, 'retirement survives refresh and service restart');
  assert.equal(f.reminders().length, 0);
});

test('delayed chat refresh cannot settle a same-ID approval revalidated by a newer poll', async t => {
  const f = fixture(t); await f.look();
  let release, started;
  const pending = new Promise(resolve => { release = resolve; });
  const reading = new Promise(resolve => { started = resolve; });
  const delayed = refreshCards(f, { currentAsk: null, screen: () => { started(); return pending; } });
  await reading;
  await f.look();
  release('Old cancelled screen snapshot');
  const view = await delayed;
  assert.equal(f.cards()[0].settled, undefined, 'late GET cannot retire newer persisted approval');
  const card = view.messages.find(m => m.role === 'terminal-ask');
  assert.equal(card.askId, ask.id);
  assert.equal(card.promptState, 'active', 'late response reads back current persisted state');
  assert.equal(card.settled, undefined);
});

test('delayed chat refresh returns the latest settled terminal-exit record', async t => {
  const f = fixture(t); await f.look();
  let release, started;
  const pending = new Promise(resolve => { release = resolve; });
  const reading = new Promise(resolve => { started = resolve; });
  const delayed = refreshCards(f, { currentAsk: ask, screen: () => { started(); return pending; } });
  await reading;
  await f.look({ panes: [] });
  release('Old menu still visible in the delayed read');
  const view = await delayed;
  const card = view.messages.find(m => m.role === 'terminal-ask');
  assert.equal(card.settled, true);
  assert.equal(card.terminalClosed, true, 'response preserves the newer authoritative closure details');
  assert.equal(card.promptState, 'resolved');
  assert.equal(f.cards()[0].terminalClosed, true);
});

test('chat refresh preserves exact active approval and retains unknown approvals without claiming they are answerable', async t => {
  const f = fixture(t); await f.look();
  for (const observation of [{ daemon: false }, { currentAsk: null, screen: null }]) {
    const view = await refreshCards(f, observation);
    const card = view.messages.find(m => m.role === 'terminal-ask');
    assert.equal(card.promptState, 'unknown'); assert.equal(card.settled, undefined);
    assert.equal(f.cards()[0].settled, undefined, 'unknown must not overwrite approval history');
  }
  const view = await refreshCards(f);
  assert.equal(view.messages.find(m => m.role === 'terminal-ask').promptState, 'active');
  assert.equal(f.cards()[0].settled, undefined);
});
