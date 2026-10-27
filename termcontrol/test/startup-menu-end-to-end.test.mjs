// Noam 2026-10-27 (Image 19): a helper froze on Codex's "Hooks need review" menu. The detector was
// fixed; this replays the whole path: frozen terminal -> card in the bot's chat + phone push ->
// his tap "2" typed into that terminal.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkBotEvents } from '../bridge/bot-events.mjs';
import { answerScreenChoice } from '../bridge/send.mjs';
import { screenPromptAsk } from '../bridge/asks.mjs';
import { Bots } from '../bridge/bots.mjs';

const T0 = 1_792_941_414_879;
const menu = (cursor) => [
  '  Hooks need review', '  4 hooks are new or changed.', '',
  ...['Review hooks', 'Trust all and continue', "Continue without trusting (hooks won't run)"].map((l, i) => `${cursor === i + 1 ? '›' : ' '} ${i + 1}. ${l}`),
  '', '  enter confirm · esc skip',
].join('\n');

test('a helper frozen on a startup menu gets a card with its real options, a push, and the tap types the digit', async () => {
  const bots = new Bots({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'tf-menu-')), run: async () => ({ text: 'ok' }), fill: () => null, checks: { home: os.homedir() }, now: () => T0 });
  const { bot } = bots.create({ name: 'freelance-desk', cwd: os.tmpdir() });
  fs.writeFileSync(path.join(bots.folder(bot.id), 'helpers.json'), JSON.stringify([{ paneId: 'terminal-h', task: 'desk helper', at: T0 }]));
  const woke = [], pushed = [];
  bots.wake = (id, text) => { woke.push(text); return { ok: true }; };
  const pane = { id: 'terminal-h', provider: 'codex', turn: 'idle' };   // no status: Codex never started
  const look = () => checkBotEvents({ bots, seen: new Map(), now: T0, notify: (n) => pushed.push(n), panes: [pane], readAsk: async () => null, readScreen: async () => menu(1) });
  await look();
  const cards = bots.messages(bot.id).filter((m) => m.role === 'terminal-ask');
  assert.equal(cards.length, 1, 'one card');
  assert.equal(cards[0].text, 'Hooks need review');
  assert.deepEqual(cards[0].options.map((o) => o.label), ['Review hooks', 'Trust all and continue', "Continue without trusting (hooks won't run)"]);
  assert.equal(pushed.length, 1, 'his phone is told');
  assert.equal(woke.length, 1, 'the bot is told');
  // His tap on "2": digit, then Enter once the cursor sits on it.
  const prompt = screenPromptAsk(pane, menu(1));
  const sent = []; const screens = [menu(2), menu(2), menu(2), 'Codex is starting']; let i = 0;
  const r = await answerScreenChoice(pane, prompt, '2', { write: async (d) => sent.push(d), screen: async () => screens[Math.min(i++, 3)], pause: async () => {}, live: async () => new Set(['terminal-h']), record: () => {} });
  assert.equal(r.ok, true);
  assert.deepEqual(sent, ['2', '\r']);
});
