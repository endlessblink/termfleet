import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Bots, brainCommand, brainEnv } from '../bridge/bots.mjs';
import { sidePrompt, parseSide, withPassedOn, sideCommand, sideOutput, putSteer, takeSteer, steerDir } from '../bridge/side-reply.mjs';
import { steer } from '../../scripts/termfleet-bot-steer-hook.mjs';
import { loadLedger } from '../bridge/requirements.mjs';

// R-7173 (Noam 2026-10-24: "when I ask questions - the answers need to be instant while the
// bot is working"). A message that arrives while the bot works gets a quick side answer at
// once; an instruction also reaches the running turn. Never calls Claude or Codex.
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tf-side-'));
function readyComputer() {
  const home = tmp();
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', '.credentials.json'), '{}');
  fs.writeFileSync(path.join(home, '.codex', 'auth.json'), '{}');
  const socket = path.join(home, 'daemon.sock');
  fs.writeFileSync(socket, '');
  return { home, socket };
}
const until = async (fn, ms = 2000) => { const end = Date.now() + ms; while (!fn()) { if (Date.now() > end) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 5)); } };

/** A bot whose first turn runs until released, with a stand-in side responder. */
function busyBot({ sideText = 'REPLY: I am halfway through.\nPASS_ON: no', sideFails = false } = {}) {
  let release;
  const turns = [], sides = [];
  const bots = new Bots({
    checks: readyComputer(), dir: tmp(), bins: { claude: '/bin/true', codex: '/bin/true' },
    run: (bot, text, { onEvent }) => {
      turns.push({ text, steerFolder: bot.steerFolder });
      if (turns.length === 1) {
        onEvent({ step: { name: 'Bash', input: { command: 'termfleet-team list' } } });
        onEvent({ activity: 'Checking who is working' });
        return new Promise((r) => { release = (out = { text: 'Main answer.' }) => r(out); });
      }
      return Promise.resolve({ text: `next: ${text.slice(0, 40)}` });
    },
    side: async (bot, prompt) => { sides.push({ bot, prompt }); return sideFails ? { error: 'boom' } : { text: sideText }; },
  });
  bots.ownerWordsBase = tmp();
  const { bot } = bots.create({ name: 'Sider', cwd: os.tmpdir() });
  return { bots, id: bot.id, turns, sides, release: (o) => release(o) };
}

test('a question sent while the bot works is answered at once, without stopping or repeating the turn', async () => {
  const b = busyBot();
  b.bots.send(b.id, 'Build the game page', { owner: true });
  await until(() => b.turns.length === 1);
  const t0 = Date.now();
  const sent = b.bots.send(b.id, 'can we get it ready by Monday?', { owner: true });
  assert.equal(sent.side, true);
  await until(() => b.bots.messages(b.id).some((m) => m.side));
  assert.ok(Date.now() - t0 < 1000, 'answered right away');
  const side = b.bots.messages(b.id).find((m) => m.side);
  assert.equal(side.role, 'bot');
  assert.equal(side.text, 'I am halfway through.');
  assert.equal(side.side.forward, false);
  assert.equal(b.bots.summary(b.id).state, 'working', 'the main turn keeps running');
  // What the side responder saw: the task, the live steps, and his question.
  assert.match(b.sides[0].prompt, /Build the game page/);
  assert.match(b.sides[0].prompt, /termfleet-team list/);
  assert.match(b.sides[0].prompt, /can we get it ready by Monday\?/);
  // A plain question is not queued as another turn; the next turn just knows it was answered.
  assert.equal((b.bots.queues.get(b.id) || []).length, 0);
  assert.deepEqual(takeSteer(b.bots.folder(b.id)), []);
  b.release();
  await until(() => !b.bots.running.has(b.id));
  assert.equal(b.turns.length, 1, 'no extra turn for an answered question');
  const items = [...loadLedger({ dir: b.bots.reqDir() }).items.values()].filter((it) => /Monday/.test(it.words));
  assert.ok(items.length && items.every((it) => it.status === 'answered'), 'his question is marked answered');
  b.bots.send(b.id, 'thanks', { owner: true });
  await until(() => b.turns.length === 2 && !b.bots.running.has(b.id));
  assert.match(b.turns[1].text, /Already answered: do not repeat/);
  assert.match(b.turns[1].text, /can we get it ready by Monday/);
});

test('an instruction sent mid-turn is handed to the running turn after its next step, with the side answer so it is not repeated', async () => {
  const b = busyBot({ sideText: 'REPLY: Got it, I passed it on to the work in progress.\nPASS_ON: yes' });
  b.bots.send(b.id, 'Build the game page', { owner: true });
  await until(() => b.turns.length === 1);
  assert.equal(b.turns[0].steerFolder, b.bots.folder(b.id), 'the running turn listens for mid-turn messages');
  b.bots.send(b.id, 'make it playable on mobile too', { owner: true });
  await until(() => fs.existsSync(steerDir(b.bots.folder(b.id))) && fs.readdirSync(steerDir(b.bots.folder(b.id))).some((n) => n.endsWith('.json')));
  // The hook the brain runs after a tool step picks it up.
  const out = steer({ hook_event_name: 'PostToolUse' }, { TERMFLEET_BOT_ID: b.id, TERMFLEET_BOT_STEER: b.bots.folder(b.id) });
  const ctx = out.hookSpecificOutput.additionalContext;
  assert.equal(out.hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.match(ctx, /make it playable on mobile too/);
  assert.match(ctx, /Already answered: "Got it, I passed it on/);
  assert.match(ctx, /do not repeat that answer/);
  assert.equal(steer({ hook_event_name: 'PostToolUse' }, { TERMFLEET_BOT_ID: b.id, TERMFLEET_BOT_STEER: b.bots.folder(b.id) }), null, 'handed over once');
  b.release();
  await until(() => !b.bots.running.has(b.id));
  assert.equal(b.turns.length, 1, 'taken mid-turn, so no second turn');
});

test('an instruction the turn never got to starts the next turn, marked as already answered', async () => {
  const b = busyBot({ sideText: 'REPLY: Passed it on.\nPASS_ON: yes' });
  b.bots.send(b.id, 'Build the game page', { owner: true });
  await until(() => b.turns.length === 1);
  b.bots.send(b.id, 'use the blue theme', { owner: true });
  await until(() => b.bots.messages(b.id).some((m) => m.side));
  b.release();
  await until(() => b.turns.length === 2 && !b.bots.running.has(b.id));
  assert.match(b.turns[1].text, /use the blue theme/);
  assert.match(b.turns[1].text, /already answered this in the chat: "Passed it on\."/);
  const order = b.bots.messages(b.id).filter((m) => m.role === 'bot').map((m) => m.text);
  assert.equal(order[0], 'Passed it on.', 'the quick answer came before the main answer');
});

test('if the side answer fails, the message still reaches the bot as before', async () => {
  const b = busyBot({ sideFails: true });
  b.bots.send(b.id, 'Build the game page', { owner: true });
  await until(() => b.turns.length === 1);
  b.bots.send(b.id, 'how is it going?', { owner: true });
  await until(() => fs.existsSync(steerDir(b.bots.folder(b.id))) && fs.readdirSync(steerDir(b.bots.folder(b.id))).some((n) => n.endsWith('.json')));
  assert.equal(b.bots.messages(b.id).some((m) => m.side), false);
  b.release();
  await until(() => b.turns.length === 2 && !b.bots.running.has(b.id));
  assert.match(b.turns[1].text, /how is it going\?/);
});

test('several messages during one side answer are answered together next; events and idle bots never use it', async () => {
  const b = busyBot();
  b.bots.send(b.id, 'Build the game page', { owner: true });
  await until(() => b.turns.length === 1);
  b.bots.send(b.id, 'one?', { owner: true });
  b.bots.send(b.id, 'two?', { owner: true });
  b.bots.send(b.id, 'three?', { owner: true });
  await until(() => b.sides.length === 2);
  assert.match(b.sides[1].prompt, /two\?[\s\S]*three\?/);
  b.bots.wake(b.id, 'a terminal finished');   // an event, not Noam: the old queue
  assert.equal(b.sides.length, 2);
  b.release();
  await until(() => !b.bots.running.has(b.id) && b.turns.length === 2);
  const before = b.sides.length;
  b.bots.send(b.id, 'idle question', { owner: true });
  await until(() => !b.bots.running.has(b.id) && b.turns.length === 3);
  assert.equal(b.sides.length, before, 'an idle bot answers normally');
});

test('the side responder is read-only on the bot\'s own plan, and its answer is parsed safely', () => {
  const claude = sideCommand({ provider: 'claude', name: 'x' }, 'p', { cwd: '/tmp' });
  assert.ok(claude.args.includes('--no-session-persistence'));
  assert.ok(claude.args.includes('--restricted'));
  for (const t of ['Bash', 'Edit', 'Write']) assert.ok(claude.args.includes(t), `${t} denied`);
  assert.equal(claude.args.includes('--allowedTools'), false);
  const codex = sideCommand({ provider: 'codex', name: 'x', model: 'gpt-5.5' }, 'p', { cwd: '/tmp' });
  assert.deepEqual(codex.args.slice(codex.args.indexOf('-s'), codex.args.indexOf('-s') + 2), ['-s', 'read-only']);
  assert.ok(codex.args.includes('--ephemeral'));
  assert.ok(codex.args.includes('gpt-5.5'), 'the bot\'s own model');
  assert.deepEqual(parseSide('REPLY: Yes, Monday works.\nPASS_ON: no'), { reply: 'Yes, Monday works.', forward: false });
  assert.deepEqual(parseSide('REPLY: Will do.\nPASS_ON: yes'), { reply: 'Will do.', forward: true });
  assert.equal(parseSide('Just some text').forward, true, 'unclear: pass it on, never lose an instruction');
  assert.match(withPassedOn('בסדר.', true, ['תעשה את זה כחול']), /העברתי/);
  assert.equal(withPassedOn('Sure.', false, ['?']), 'Sure.');
  assert.deepEqual(sideOutput('claude', '{"type":"result","subtype":"success","result":"REPLY: hi\\nPASS_ON: no"}'), { text: 'REPLY: hi\nPASS_ON: no' });
  assert.equal(sideOutput('codex', '{"type":"item.completed","item":{"type":"agent_message","text":"REPLY: a"}}').text, 'REPLY: a');
  const prompt = sidePrompt({ bot: { name: 'P', job: 'game' }, task: 'Build', startedAt: Date.now() - 5 * 60000, steps: [{ at: Date.now(), text: 'Reading files' }], chat: [{ who: 'Noam', text: 'hi' }], incoming: ['ready?'] });
  assert.match(prompt, /started 5 min ago/);
  assert.match(prompt, /Never say something was done/);
});

test('only a bot\'s running turn gets the steer hook and folder', () => {
  const bot = { id: 'abcabcabcabc', name: 'S', provider: 'claude', cwd: '/tmp', sessions: { claude: { id: 'u', started: false } } };
  assert.equal(brainCommand(bot, 'x').args.includes('--settings'), false);
  const withSteer = brainCommand({ ...bot, steerFolder: '/tmp/b' }, 'x').args;
  const settings = JSON.parse(withSteer[withSteer.indexOf('--settings') + 1]);
  assert.match(settings.hooks.PostToolUse[0].hooks[0].command, /termfleet-bot-steer-hook\.mjs/);
  assert.equal(brainEnv({ ...bot, steerFolder: '/tmp/b' }, {}).TERMFLEET_BOT_STEER, '/tmp/b');
  assert.equal(brainEnv(bot, {}).TERMFLEET_BOT_STEER, undefined);
  assert.equal(steer({ hook_event_name: 'PostToolUse' }, {}), null, 'outside a bot brain the hook does nothing');
  const folder = tmp();
  putSteer(folder, { at: 1, msgId: 'a', text: 'x' });
  assert.equal(takeSteer(folder).length, 1);
  assert.equal(takeSteer(folder).length, 0);
});
