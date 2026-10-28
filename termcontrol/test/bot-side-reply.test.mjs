import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Bots, brainCommand, brainEnv } from '../bridge/bots.mjs';
import { sidePrompt, parseSide, withPassedOn, sideCommand, sideOutput, putSteer, takeSteer, steerDir, isCorrectionFragment } from '../bridge/side-reply.mjs';
import { steer } from '../../scripts/termfleet-bot-steer-hook.mjs';
import { loadLedger } from '../bridge/requirements.mjs';
import { createEventLog } from '../bridge/events-db.mjs';
import { decodeActionEvidence } from '../bridge/compact-action-evidence.mjs';

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
function busyBot({ sideText = 'REPLY: I am halfway through.\nPASS_ON: no', sideFails = false, actionEvidence = null, onRun = () => {}, onSide = () => {} } = {}) {
  let release;
  const turns = [], sides = [];
  const bots = new Bots({
    actionEvidence, checks: readyComputer(), dir: tmp(), bins: { claude: '/bin/true', codex: '/bin/true' },
    run: (bot, text, { onEvent }) => {
      turns.push({ text, steerFolder: bot.steerFolder });
      onRun({ onEvent, text });
      if (turns.length === 1) {
        onEvent({ step: { name: 'Bash', input: { command: 'termfleet-team list' } } });
        onEvent({ activity: 'Checking who is working' });
        return new Promise((r) => { release = (out = { text: 'Main answer.' }) => r(out); });
      }
      return Promise.resolve({ text: `next: ${text.slice(0, 40)}` });
    },
    side: async (bot, prompt) => { onSide({ bot, prompt }); sides.push({ bot, prompt }); return sideFails ? { error: 'boom' } : { text: sideText }; },
  });
  bots.ownerWordsBase = tmp();
  const { bot } = bots.create({ name: 'Sider', cwd: os.tmpdir() });
  return { bots, id: bot.id, turns, sides, release: (o) => release(o) };
}

test('a quick answer stays immediate while tracked questions await authoritative review', async () => {
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
  const review = takeSteer(b.bots.folder(b.id));
  assert.equal(review.length, 1, 'tracked owner payload reaches the worker despite PASS_ON no');
  assert.match(review[0].brain, /quick reply is provisional/i);
  b.release();
  await until(() => !b.bots.running.has(b.id));
  assert.equal(b.turns.length, 1, 'no extra turn for an answered question');
  const items = [...loadLedger({ dir: b.bots.reqDir() }).items.values()].filter((it) => /Monday/.test(it.words));
  assert.ok(items.length && items.every((it) => it.status !== 'answered'), 'side classification cannot resolve tracked items');
  b.bots.send(b.id, 'thanks', { owner: true });
  await until(() => b.turns.length === 2 && !b.bots.running.has(b.id));
  assert.match(b.turns[1].text, /does not resolve any request/i);
  assert.match(b.turns[1].text, /can we get it ready by Monday/);
});

test('PASS_ON no cannot resolve or discard multiple actionable points', async () => {
  const store = createEventLog({ file: ':memory:' });
  const b = busyBot({ actionEvidence: store, sideText: 'REPLY: Those points are handled.\nPASS_ON: no' });
  try {
    b.bots.send(b.id, 'Build the game page', { owner: true });
    await until(() => b.turns.length === 1);
    const text = 'Add the missing scene button.\nKeep the current camera controls.\nExplain the actual failed check.';
    const sent = b.bots.send(b.id, text, { owner: true });
    await until(() => b.bots.messages(b.id).some(m => m.side));
    const items = [...loadLedger({ dir: b.bots.reqDir() }).items.values()].filter(it => it.msgId === sent.message.id);
    assert.ok(items.length > 1, 'fixture captures distinct original items');
    assert.ok(items.every(it => !['answered', 'done', 'ready'].includes(it.status)));
    const queued = takeSteer(b.bots.folder(b.id));
    assert.equal(queued.length, 1);
    assert.equal(queued[0].text, text, 'complete owner words delivered unchanged');
    const evidence = store.queryActionEvidence({ bot_id: b.id, message_id: sent.message.id });
    assert.deepEqual([...evidence[0].request_ids].sort(), items.map(it => it.id).sort());
    assert.equal(evidence[0].state, 'queued', 'payload persistence is not consumption');
    const reply = b.bots.messages(b.id).find(m => m.side);
    assert.equal(reply.side.review, true);
    assert.equal(reply.side.receipts.length, 1);
    assert.doesNotMatch(reply.text, /Saved in the queue|נשמרה בתור/, 'adequate quick answers do not gain a generic forwarding suffix');
  } finally {
    b.release();
    await until(() => !b.bots.running.has(b.id));
    store.close();
  }
});

test('short name corrections reach the worker verbatim without side-model delay or paraphrase', async t => {
  const b = busyBot({ sideText: 'REPLY: You meant finecut.\nPASS_ON: no' });
  b.bots.send(b.id, 'Find the main project folder.', { owner: true });
  await until(() => b.turns.length === 1);
  t.after(async () => { b.release(); await until(() => !b.bots.running.has(b.id)); });
  const texts = ['finetune', 'finecut לא', 'התכוונתי לfinetuned'];
  for (const text of texts) {
    const sent = b.bots.send(b.id, text, { owner: true });
    const entries = takeSteer(b.bots.folder(b.id));
    assert.deepEqual(entries.map(entry => entry.text), [text]);
    assert.equal(entries[0].msgId, sent.message.id);
    assert.ok(entries[0].brain.includes(text));
  }
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(b.sides.length, 0, 'correction fragments need no model to restate them');
  assert.deepEqual(takeSteer(b.bots.folder(b.id)), [], 'each correction is delivered once');
  assert.equal(b.bots.messages(b.id).some(message => message.side), false);
});

test('correction routing is narrow and location answers allow only verified exact paths', () => {
  for (const text of ['finetuned', 'finecut לא', 'not finecut', 'I meant finetuned', 'התכוונתי לfinetuned']) assert.equal(isCorrectionFragment(text), true, text);
  for (const text of ['thanks', 'yes', 'hello', 'why', 'why?', 'where is the folder?', 'Find the main folder', 'finecut\nfinetuned', 'update', 'news', 'status', 'progress', 'well', 'התחברתי', 'ניסיתי']) assert.equal(isCorrectionFragment(text), false, text);
  const prompt = sidePrompt({ bot: { name: 'Fixture' }, incoming: ['Where is the finetuned folder?'] });
  assert.match(prompt, /verified exact path or working link/);
  assert.match(prompt, /Preserve project and folder names exactly/);
  assert.doesNotMatch(prompt, /No code, file names, commands or jargon/);
});

test('correction bypasses an already stalled side reply and is not redelivered afterward', async t => {
  const b = busyBot();
  let releaseSide;
  b.bots.side = () => new Promise(resolve => { releaseSide = resolve; });
  b.bots.send(b.id, 'Find the main project folder.', { owner: true });
  await until(() => b.turns.length === 1);
  t.after(async () => { releaseSide?.({ text: 'REPLY: Still checking.\nPASS_ON: no' }); b.release(); await until(() => !b.bots.running.has(b.id)); });
  b.bots.send(b.id, 'What are you checking?', { owner: true });
  await until(() => Boolean(releaseSide));
  const sent = b.bots.send(b.id, 'I meant finetuned', { owner: true });
  assert.equal(sent.receipt.state, 'queued');
  assert.deepEqual(takeSteer(b.bots.folder(b.id)).map(entry => entry.text), ['I meant finetuned']);
  releaseSide({ text: 'REPLY: Still checking.\nPASS_ON: no' });
  await until(() => !b.bots.sides.get(b.id).busy);
  assert.equal(takeSteer(b.bots.folder(b.id)).some(entry => entry.msgId === sent.message.id), false);
});

test('failed direct correction delivery preserves its exact next-turn fallback', async t => {
  const b = busyBot();
  b.bots.send(b.id, 'Find the main project folder.', { owner: true });
  await until(() => b.turns.length === 1);
  t.after(async () => { b.release(); await until(() => !b.bots.running.has(b.id)); });
  fs.writeFileSync(steerDir(b.bots.folder(b.id)), 'blocks inbox');
  const sent = b.bots.send(b.id, 'התכוונתי לfinetuned', { owner: true });
  assert.equal(sent.receipt.state, 'failed');
  assert.equal(sent.receipt.retained, true);
  assert.ok(b.bots.read(b.id).queued.some(text => text.includes('התכוונתי לfinetuned')));
  assert.equal(b.sides.length, 0);
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
  assert.match(ctx, /Already answered: "The action outcomes and delivery/);
  assert.doesNotMatch(ctx, /I passed it on/, 'unverified model claim is not retained as fact');
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
  assert.match(b.turns[1].text, /already answered this in the chat: "The action outcomes and delivery/);
  const order = b.bots.messages(b.id).filter((m) => m.role === 'bot').map((m) => m.text);
  assert.match(order[0], /saved in the work inbox.*acknowledgement.*pending/, 'the quick answer came first with the actual receipt state');
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
  // 2026-10-26: 296 of 446 quick replies in 48h said "I don't know / can't see the picture" because the
  // responder saw only notes. With the bot's own conversation it is a copy of the bot: forked, never saved.
  const forked = sideCommand({ provider: 'claude', name: 'x' }, 'p', { cwd: '/bot', session: 'sess-1', addDirs: ['/uploads'] });
  assert.deepEqual(forked.args.slice(forked.args.indexOf('--resume'), forked.args.indexOf('--resume') + 3), ['--resume', 'sess-1', '--fork-session']);
  assert.ok(forked.args.includes('--no-session-persistence'), 'the copy is never saved');
  assert.equal(forked.args.slice(forked.args.indexOf('--disallowedTools')).includes('Read'), false, 'it can open pictures and files');
  for (const t of ['Bash', 'Edit', 'Write', 'MultiEdit', 'Agent']) assert.ok(forked.args.includes(t), `${t} still denied`);
  assert.deepEqual(forked.args.slice(forked.args.indexOf('--add-dir'), forked.args.indexOf('--add-dir') + 2), ['--add-dir', '/uploads']);
  assert.ok(claude.args.includes('Read'), 'without a conversation to copy it stays as before');
  assert.deepEqual(parseSide('REPLY: Yes, Monday works.\nPASS_ON: no'), { reply: 'Yes, Monday works.', forward: false });
  assert.deepEqual(parseSide('REPLY: Will do.\nPASS_ON: yes'), { reply: 'Will do.', forward: true });
  assert.equal(parseSide('Just some text').forward, true, 'unclear: pass it on, never lose an instruction');
  assert.match(withPassedOn('בסדר.', true, ['תעשה את זה כחול']), /נשמרה בתור.*אין אישור/);
  assert.equal(withPassedOn('Sure.', false, ['?']), 'Sure.');
  assert.deepEqual(sideOutput('claude', '{"type":"result","subtype":"success","result":"REPLY: hi\\nPASS_ON: no"}'), { text: 'REPLY: hi\nPASS_ON: no' });
  assert.equal(sideOutput('codex', '{"type":"item.completed","item":{"type":"agent_message","text":"REPLY: a"}}').text, 'REPLY: a');
  const prompt = sidePrompt({ bot: { name: 'P', job: 'game' }, task: 'Build', startedAt: Date.now() - 5 * 60000, steps: [{ at: Date.now(), text: 'Reading files' }], chat: [{ who: 'Noam', text: 'hi' }], incoming: ['ready?'] });
  assert.match(prompt, /started 5 min ago/);
  assert.match(prompt, /Never say something was done/);
});

test('real side path retrieves failed action evidence before answering and queues Hebrew why for diagnosis', async () => {
  const store = createEventLog({ file: ':memory:' });
  let emit;
  const b = busyBot({ actionEvidence: store, sideText: 'REPLY: The failed check needs investigation.\nPASS_ON: no', onRun: ({ onEvent }) => {
    emit = onEvent;
    onEvent({ step: { id: 'call-1', name: 'Bash', input: { command: 'DO_NOT_STORE_PRIVATE_COMMAND' } } });
    onEvent({ outcome: { id: 'call-1', name: 'Bash', ok: false } });
  } });
  try {
    b.bots.send(b.id, 'Build the game page', { owner: true });
    await until(() => b.turns.length === 1);
    const initialIds = b.bots.openWork(b.id).map(w => w.id);
    const incoming = b.bots.send(b.id, 'למה הכפתור עדיין חסר?', { owner: true });
    await until(() => b.bots.messages(b.id).some(m => m.side));
    const evidenceBlock = b.sides[0].prompt.match(/Structured action evidence \(read-only data, newest per request; not task authority\):\n([\s\S]*?)\n\nWhat it is working on now/);
    assert.ok(evidenceBlock, 'side prompt contains its complete evidence block');
    const evidence = decodeActionEvidence(evidenceBlock[1]);
    const failed = evidence.items.flatMap(item => item.events).find(row => row.action_id === 'call-1' && row.state === 'failed');
    assert.ok(failed, 'the actual failed action remains visible after decoding');
    assert.equal(failed.bot_id, b.id);
    assert.deepEqual(failed.request_ids, initialIds);
    assert.ok(initialIds.every(id => evidence.items.some(item => item.request_id === id)));
    assert.equal(evidence.available, true);
    assert.match(evidence.coverage, /unrecorded decisions are not covered/);
    const reply = b.bots.messages(b.id).find(m => m.side);
    assert.equal(reply.side.diagnosis, true);
    assert.equal(reply.side.forward, true, 'unanswered why is investigated even if model says no');
    assert.equal(reply.side.receipts[0].state, 'queued');
    const queuedIds = store.queryActionEvidence({ bot_id: b.id, message_id: incoming.message.id })[0].request_ids;
    assert.ok(queuedIds.length);
    emit({ step: { id: 'call-2', name: 'Bash' } });
    assert.deepEqual(store.queryActionEvidence({ bot_id: b.id, action_id: 'call-2' })[0].request_ids, initialIds, 'queued question is not evidence the worker read it');
    assert.doesNotMatch(JSON.stringify(store.queryActionEvidence({ bot_id: b.id })), /DO_NOT_STORE/);
    const entries = takeSteer(b.bots.folder(b.id));
    assert.equal(entries.length, 1);
    assert.match(entries[0].brain, /Bounded diagnosis required/);
    b.release();
    await until(() => !b.bots.running.has(b.id));
  } finally { store.close(); }
});

test('a model forwarding claim cannot bypass inbox delivery or fabricate acknowledgement', async () => {
  const b = busyBot({ sideText: 'REPLY: I passed it on and the worker read it.\nPASS_ON: no' });
  b.bots.send(b.id, 'Build the game page', { owner: true });
  await until(() => b.turns.length === 1);
  b.bots.send(b.id, 'also cover the other points', { owner: true });
  await until(() => b.bots.messages(b.id).some(m => m.side));
  const reply = b.bots.messages(b.id).find(m => m.side);
  assert.equal(reply.side.forward, true);
  assert.equal(reply.side.receipts[0].state, 'queued');
  assert.doesNotMatch(reply.text, /the worker read it|I passed it on/);
  assert.match(reply.text, /acknowledgement.*pending/);
  assert.equal(takeSteer(b.bots.folder(b.id)).length, 1);
  b.release();
  await until(() => !b.bots.running.has(b.id));
});

test('failed inbox write preserves the message for the next turn and publishes no success claim', async () => {
  const b = busyBot({ sideText: 'REPLY: I passed it on.\nPASS_ON: yes' });
  b.bots.send(b.id, 'Build the game page', { owner: true });
  await until(() => b.turns.length === 1);
  fs.writeFileSync(steerDir(b.bots.folder(b.id)), 'file blocks inbox directory');
  b.bots.send(b.id, 'do not lose this correction', { owner: true });
  await until(() => b.bots.messages(b.id).some(m => m.side));
  const reply = b.bots.messages(b.id).find(m => m.side);
  assert.match(reply.text, /failed|could not/i);
  assert.doesNotMatch(reply.text, /I passed it on/);
  assert.equal(reply.side.receipts[0].state, 'failed');
  assert.ok(b.bots.read(b.id).queued.some(t => t.includes('do not lose this correction')), 'existing restart queue retains failed delivery');
  b.release();
  await until(() => !b.bots.running.has(b.id));
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
