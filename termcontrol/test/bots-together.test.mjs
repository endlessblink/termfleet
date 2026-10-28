import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Bots, brainBrief } from '../bridge/bots.mjs';
import { pickResponder, PASS, messageForAgent } from '../bridge/rooms.mjs';
import { handoffLine, visibleFeed } from '../bridge/feed.mjs';
import { run as memoryCommand } from '../../scripts/termfleet-memory.mjs';
import { recordInBot, recordHelper } from '../../scripts/termfleet-team.mjs';
import { issueBotCaller, BOT_CALLER_TOKEN_ENV } from '../../scripts/lib/bot-caller.mjs';

// TF-096 part 6 + Noam 16.10 17:53: "Job and rules should be created when starting and
// based on the chat … Location should be the same one with each agent next to the other".
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tf-together-'));

test('a new bot needs only a name; its folder sits next to the other bots', () => {
  const home = tmp();
  process.env.TC_BOTS_HOME = path.join(home, 'TermFleet', 'bots');
  try {
    const bots = new Bots({ dir: tmp(), run: async () => ({ text: '' }) });
    const a = bots.create({ name: 'Paperbot dev' }).bot;
    const b = bots.create({ name: 'Quill' }).bot;
    assert.equal(a.cwd, path.join(home, 'TermFleet', 'bots', 'Paperbot-dev'));
    assert.equal(path.dirname(a.cwd), path.dirname(b.cwd), 'side by side');
    assert.ok(fs.statSync(a.cwd).isDirectory());
  } finally { delete process.env.TC_BOTS_HOME; }
});

test('a bot without a job is told to draft its job and rules from the chat', () => {
  assert.match(brainBrief({ name: 'Q', job: '', rules: '' }), /draft them and offer them to him with: `termfleet-memory profile --job/);
  assert.doesNotMatch(brainBrief({ name: 'Q', job: 'Runs paper-bot', rules: '' }), /draft them/);
});

test('the bot offers its job and rules; Noam accepts (or edits) them; nothing changes before', () => {
  const root = tmp();
  const bots = new Bots({ dir: path.join(root, 'bots'), run: async () => ({ text: '' }) });
  const { bot } = bots.create({ name: 'Paperbot', cwd: os.tmpdir() });
  const env = { TERMFLEET_BOT_ID: bot.id, TC_CONFIG_DIR: root };
  assert.match(memoryCommand(['profile', '--job', 'Develops paper-bot', '--rules', 'Ask before deploying'], env).message, /once he accepts/);
  assert.deepEqual(bots.summary(bot.id).proposedProfile.job, 'Develops paper-bot');
  assert.equal(bots.read(bot.id).job, '', 'not used until accepted');
  assert.equal(bots.acceptProfile(bot.id, { rules: 'Ask before deploying.\nKeep tests green.' }).ok, true);
  const saved = bots.read(bot.id);
  assert.equal(saved.job, 'Develops paper-bot');
  assert.equal(saved.rules, 'Ask before deploying.\nKeep tests green.');
  assert.equal(saved.proposedProfile, undefined);
  assert.match(memoryCommand(['profile', '--rules', 'x'], env).message, /Give your job/);
});

test('in a group chat, the member whose job fits answers; unclear messages ask all with a PASS rule', () => {
  const room = { name: 'Release', members: [
    { pane: 'bot:a', handle: 'quill', label: 'Quill', job: 'phone app and its tests' },
    { pane: 'bot:b', handle: 'hogan', label: 'Hogan', job: 'servers and deploys' },
  ], messages: [] };
  assert.deepEqual(pickResponder(room, 'The phone tests are failing again'), ['bot:a']);
  assert.deepEqual(pickResponder(room, 'deploys are slow on the servers'), ['bot:b']);
  assert.equal(pickResponder(room, 'how is everyone?'), null);
  const msg = messageForAgent(room, room.members[0], { seq: 1, author: 'You', text: 'how is everyone?', everyone: true });
  assert.match(msg, /reply with exactly: PASS/);
  assert.equal(PASS.test('PASS'), true);
  assert.equal(PASS.test('Passing the tests now'), false);
});

test('handoffs show in the sender\'s chat too: a terminal agent\'s and a bot\'s', () => {
  const ev = { kind: 'tool', at: '2026-10-16T10:00:00Z', name: 'Bash', summary: 'termfleet-team send botson "Run the morning checks"' };
  assert.deepEqual(handoffLine(ev), { kind: 'notice', at: ev.at, text: '↪ Handed to botson: Run the morning checks' });
  assert.equal(visibleFeed({ events: [ev, { kind: 'tool', summary: 'ls -la' }] }).events.length, 1, 'other tool calls stay hidden');
  const root = tmp();
  const id = 'abcdefabcdef';
  fs.mkdirSync(path.join(root, 'bots', id), { recursive: true });
  const callerOptions = { base: path.join(root, 'callers') };
  const issued = issueBotCaller({ id, name: 'Test bot', provider: 'codex', botFolder: path.join(root, 'bots', id) }, callerOptions);
  const env = { TERMFLEET_BOT_ID: id, TC_CONFIG_DIR: '/wrong', [BOT_CALLER_TOKEN_ENV]: issued.token };
  assert.equal(recordInBot({ role: 'handoff', pane: 'terminal-x', to: 'botson', text: 'Run the checks' }, env, callerOptions), true);
  assert.equal(recordHelper({ paneId: 'terminal-y', task: 'phone tests' }, env, callerOptions), true);
  const chat = fs.readFileSync(path.join(root, 'bots', id, 'chat.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(chat[0].role, 'handoff');
  const bots = new Bots({ dir: path.join(root, 'bots'), run: async () => ({ text: '' }) });
  assert.equal(recordInBot({ role: 'handoff' }, {}), false, 'outside a bot nothing is written');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'bots', id, 'helpers.json'), 'utf8'))[0].paneId, 'terminal-y');
  assert.ok(bots);
  issued.revoke();
});

test('pinned bots come first; hidden ones are kept, just out of the way; search finds words in any bot chat', () => {
  const bots = new Bots({ dir: tmp(), run: async () => ({ text: '' }) });
  const a = bots.create({ name: 'Alpha', cwd: os.tmpdir() }).bot;
  const b = bots.create({ name: 'Beta', cwd: os.tmpdir() }).bot;
  bots.update(a.id, { pinned: true });
  bots.update(b.id, { hidden: true });
  const list = bots.list();
  assert.equal(list[0].name, 'Alpha');
  assert.equal(list.find((x) => x.name === 'Beta').hidden, true);
  bots.append(b.id, { role: 'operator', text: 'The invoice for Matan is due Sunday' });
  const hits = bots.search('invoice Matan');
  assert.equal(hits[0].bot.name, 'Beta');
  assert.match(hits[0].snippet, /invoice for Matan/);
});
