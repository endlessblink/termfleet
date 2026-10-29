import test from 'node:test';
import assert from 'node:assert/strict';
import { recoverBotHelpers, RECOVERY_AFTER_MS } from '../bridge/helper-recovery.mjs';
import { STALL_AFTER_MS, stalledFor } from '../bridge/session-status.mjs';

const minute = 60_000, now = 100 * minute;
function fixture(overrides = {}) {
  const messages = [], nudges = [], wakes = [], logs = [];
  const pane = { id: 'terminal-test', alive: true, provider: 'codex', sessionId: 'conversation', turn: 'idle', ...overrides };
  const item = { id: 'R-test', status: 'assigned', source: 'bot:owner', assigned: [{ pane: pane.id, at: now - 11 * minute }] };
  const bot = { id: 'owner', name: 'Owner', helpers: [{ paneId: pane.id, at: now - 12 * minute }] };
  const bots = { list: () => [bot], messages: () => messages, append: (id, m) => messages.push(m), wake: (id, text) => wakes.push({ id, text }) };
  const options = { bots, panes: [pane], items: [item], now, lastAt: () => now - 11 * minute,
    readAsk: async () => null, readScreen: async () => 'Agent prompt',
    nudge: async (p, text) => { nudges.push({ pane: p.id, text }); return { ok: true, delivered: true }; }, log: (line) => logs.push(line) };
  return { options, pane, item, bot, messages, nudges, wakes, logs };
}

test('shared stuck detection plus polling intervenes inside ten minutes', () => {
  assert.ok(STALL_AFTER_MS + 30_000 <= 10 * minute);
  assert.ok(RECOVERY_AFTER_MS + 30_000 <= 10 * minute);
  assert.ok(stalledFor({ turn: 'working' }, { producing: false }, 1, 1 + STALL_AFTER_MS, 1) > 0);
});

for (const state of ['idle', 'stuck']) test(`${state} helper: only an idle turn with assigned work receives one recovery nudge`, async () => {
  const f = fixture(state === 'stuck' ? { turn: 'working', stalledForMs: 11 * minute } : {});
  const first = await recoverBotHelpers(f.options);
  await recoverBotHelpers(f.options);
  if(state==='stuck'){
    assert.equal(f.nudges.length,0);assert.equal(f.wakes.length,0);assert.equal(first.length,0);return;
  }
  assert.equal(f.nudges.length, 1);
  assert.equal(f.wakes.length, 1);
  assert.equal(first[0].delivered, true);
  assert.equal(first[0].reason, state);
  assert.match(f.nudges[0].text, /R-test/);
  assert.match(f.wakes[0].text, /nudge delivered/);
  assert.match(f.logs[0], /terminal-test/);
});

test('nudge lets an idle helper resume working without a repeated intervention', async () => {
  const f = fixture();
  f.options.nudge = async () => {
    f.nudges.push({ pane: f.pane.id });
    f.pane.turn = 'working';
    f.options.lastAt = () => now;
    return { delivered: true };
  };
  await recoverBotHelpers(f.options);
  assert.equal(f.pane.turn, 'working');
  await recoverBotHelpers(f.options);
  assert.equal(f.nudges.length, 1);
});

for (const variant of ['waiting', 'attention', 'sleeping', 'dead', 'followed', 'ready', 'reassigned', 'recent', 'unknown', 'screen-approval', 'record-approval', 'screen-error']) {
  test(`recovery protects ${variant}`, async () => {
    const f = fixture();
    if (variant === 'waiting') f.pane.turn = 'waiting';
    if (variant === 'attention') f.pane.attention = { kind: 'permission' };
    if (variant === 'sleeping') f.pane.sleeping = true;
    if (variant === 'dead') f.pane.alive = false;
    if (variant === 'followed') f.bot.helpers[0].followed = true;
    if (variant === 'ready') f.item.status = 'ready';
    if (variant === 'reassigned') f.item.assigned.push({ pane: 'other', at: now });
    if (variant === 'recent') f.options.lastAt = () => now - minute;
    if (variant === 'unknown') f.options.lastAt = () => 0;
    if (variant === 'screen-approval') f.options.readScreen = async () => 'Do you want to proceed?\n❯ 1. Yes\n2. No\nEsc to cancel';
    if (variant === 'record-approval') f.options.readAsk = async () => ({ kind: 'permission' });
    if (variant === 'screen-error') f.options.readScreen = async () => 'API Error: out of quota';
    await recoverBotHelpers(f.options);
    assert.equal(f.nudges.length, 0);
  });
}

test('failed delivery tells the owning bot without claiming recovery and does not flood', async () => {
  const f = fixture();
  f.options.nudge = async () => ({ error: 'process disappeared' });
  const [receipt] = await recoverBotHelpers(f.options);
  await recoverBotHelpers(f.options);
  assert.equal(receipt.delivered, false);
  assert.match(f.wakes[0].text, /process disappeared/);
  assert.equal(f.wakes.length, 1);
});

test('persisted receipt survives monitor recreation and item reassignment gets a fresh episode', async () => {
  const f = fixture();
  await recoverBotHelpers({ ...f.options });
  await recoverBotHelpers({ ...f.options });
  assert.equal(f.nudges.length, 1);
  f.item.assigned.push({ pane: f.pane.id, at: now - 10 * minute });
  await recoverBotHelpers({ ...f.options });
  assert.equal(f.nudges.length, 2);
});

test('shared-stuck bot task is retained without typing into its working turn', async () => {
  const f = fixture({ turn: 'working', stalledForMs: 11 * minute });
  f.options.items = [];
  f.bot.helpers[0].task = 'Finish checking the game';
  await recoverBotHelpers(f.options);
  assert.equal(f.nudges.length, 0);assert.equal(f.messages.length,0);
});

test('a fresh ownership or assignment recheck can veto delivery', async () => {
  const f = fixture();
  f.options.recheck = async () => false;
  await recoverBotHelpers(f.options);
  assert.equal(f.nudges.length, 0);
  assert.equal(f.messages.length, 0);
});
