// Noam 2026-10-20: "how will I know what is ready and waiting for me?" and "I need this from
// every agent: a short summary that keeps itself up to date, with exactly what to do".
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectWaiting, createWaitingNotifier } from '../bridge/waiting.mjs';
import { cli, parseMark, ledgerText } from '../../scripts/termfleet-asks.mjs';

const asks = {
  'bot:b1': [{ n: 5, text: 'Show unread messages on the bots', status: 'ready', note: 'open the bots list and look for the orange numbers' }, { n: 6, text: 'Old thing', status: 'done', note: 'x' }],
  'bot:b2': [{ n: 2, text: 'Slim header', status: 'ready', note: 'open a bot chat and tap 25/30' }],
  'terminal:p1': [{ n: 9, text: 'Fix the photo send', status: 'ready', note: 'attach a photo in a bot chat and send it' }, { n: 10, text: 'Still building', status: 'partial', note: 'half' }],
};
const input = {
  bots: [{ id: 'b1', name: 'Agent-Manager' }, { id: 'b2', name: 'paper-bot' }, { id: 'b3', name: 'Quiet', hidden: true, blocked: { ask: 'hidden bots stay out' } }, { id: 'b4', name: 'pc-helper', blocked: { ask: 'Which drive should I clean?' } }],
  panes: [{ id: 'p1', title: 'rough-cut fixes', turn: 'idle' }, { id: 'p2', title: 'Desk deploy', turn: 'waiting', attention: { title: 'Permission request: run npm install' } }, { id: 'p3', title: 'closed one', alive: false, turn: 'waiting' }],
  asksOf: ({ kind, id }) => asks[`${kind}:${id}`] || null,
};

// Noam 2026-10-20: "I'm drowning in notifications I don't need" / "this shouldn't be in the list
// at all" (the Try rows). Only what blocks work until he acts: an approval or a question.
// 2026-10-24: a terminal's own permission prompt was a false "Waiting for you" alarm; only
// real questions (a bot that stopped to ask, a terminal asking a question) are listed.
test('only real questions are listed: no permission prompts, no ready-to-try items, no idle terminals', () => {
  const items = collectWaiting(input);
  assert.deepEqual(items.map((i) => [i.kind, i.who]), [['answer', 'pc-helper']]);
  const asked = collectWaiting({ panes: [{ id: 'p6', project: 'desk', attention: { kind: 'question', title: 'Which port?' } }], bots: [] });
  assert.deepEqual(asked.map((i) => [i.kind, i.go, i.todo]), [['answer', '#p6', 'Answer it']]);
  const perms = collectWaiting({ panes: [{ id: 'p7', project: 'x', attention: { kind: 'permission', title: 'Run npm install?' } }, { id: 'p8', project: 'y', attention: { title: 'Allow Edit?' } }], bots: [] });
  assert.deepEqual(perms, [], 'a terminal permission prompt is not listed');
  const allowWord = collectWaiting({ panes: [{ id: 'p9', project: 'z', attention: { kind: 'question', title: 'Should I allow guests to edit?' } }], bots: [] });
  assert.equal(allowWord.length, 1, 'a real question that says "allow" is still listed');
  const idle = collectWaiting({ panes: [{ id: 'p5', project: 'rough-cut-mvp', turn: 'waiting' }], bots: [] });
  assert.deepEqual(idle, [], 'a terminal that just finished its turn is not waiting for him');
});

test('a terminal a bot started is listed once, under the bot, opening the terminal with the prompt', () => {
  const attention = { kind: 'question', title: 'Which branch should I use?' };
  const items = collectWaiting({
    bots: [{ id: 'b1', name: 'paper-bot_dev', helpers: [{ paneId: 'p1' }, { paneId: 'p2' }] }],
    panes: [{ id: 'p1', project: 'paper-bot', attention }, { id: 'p2', project: 'paper-bot', attention }],
  });
  assert.deepEqual(items.map((i) => [i.who, i.go]), [['paper-bot_dev', '#p1']]);
});

test('only blocking items notify, several at once become one notification, never twice', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tf-waiting-')), 'seen.json');
  const pushes = [], desktops = [];
  const notify = createWaitingNotifier({ file, push: async (n) => pushes.push(n), desktop: async (n) => desktops.push(n) });
  assert.deepEqual(await notify([]), [], 'the first look only learns');
  const ask = (id, title) => ({ id, project: id, attention: { kind: 'question', title } });
  const one = collectWaiting({ panes: [ask('p1', 'Which file?')] });
  assert.equal((await notify(one)).length, 1);
  assert.equal(pushes.length, 1); assert.equal(desktops.length, 1);
  assert.match(pushes[0].title, /p1 is waiting for you/);
  assert.equal(pushes[0].url, '/#p1');
  assert.deepEqual(await notify(one), [], 'never twice for the same item');
  const three = collectWaiting({ panes: [ask('p1', 'Which file?'), ask('p2', 'Which port?'), ask('p3', 'Which branch?')] });
  assert.equal((await notify(three)).length, 2);
  assert.equal(pushes.length, 2, 'two new items, one notification');
  assert.match(pushes[1].title, /2 agents are waiting for you/);
  // A ready-to-try item never notifies, even if one is handed in.
  assert.deepEqual(await notify([...three, { key: 'ready:x', kind: 'try', who: 'x', what: 'y', todo: 'z', go: '#x' }]), []);
  assert.equal(pushes.length, 2);
  const again = createWaitingNotifier({ file, push: async (n) => pushes.push(n), desktop: async () => {} });
  assert.deepEqual(await again(three), [], 'survives a restart');
});

test('agents mark a request ready with what to try, and are told to', () => {
  assert.equal(cli(['ready', '5', 'open', 'the', 'bots', 'list']).ok, true);
  assert.equal(cli(['ready', '5']).ok, false);
  assert.deepEqual(parseMark('termfleet-asks ready 5,6 "tap 25/30 in a bot chat"'), { status: 'ready', nums: [5, 6], note: 'tap 25/30 in a bot chat' });
  const text = ledgerText([{ n: 1, text: 'Make it smaller', status: 'ready', note: 'open a chat' }, { n: 2, text: 'Another', status: 'open', note: '' }]);
  assert.match(text, /#1 \[ready: open a chat\]/);
  assert.match(text, /Use ready \(not partial\) when it is built and live/);
});

test('a relayed request shows his own words, and a terminal is named by its project', async () => {
  const { plainAsk } = await import('../bridge/waiting.mjs');
  assert.equal(plainAsk('<pasted_content id="x">\n[Message from the bot "Agent-Manager" (bot:1), sent through TermFleet.] New task. Noam, his words: "אז אני צריך לקבל עדכונים". More.\n</pasted_content>'), 'אז אני צריך לקבל עדכונים');
  assert.equal(plainAsk('Make the header smaller'), 'Make the header smaller');
  const items = collectWaiting({ panes: [{ id: 'p9', project: 'termfleet', title: '[Message from the bot "A"] long brief', turn: 'waiting', attention: { kind: 'question', title: 'Which file?' } }], bots: [] });
  assert.equal(items[0].who, 'termfleet');
});

// Agent-Manager 2026-10-20, from Noam's screenshot: a Try line showed "| tail -..." and only the
// first of several chained marks counted. Each mark takes only its own quoted note.
test('a mark takes only its own note, and every chained mark counts', async () => {
  const { parseMarks } = await import('../../scripts/termfleet-asks.mjs');
  assert.deepEqual(parseMarks('termfleet-asks ready 52 "click between board pages and tabs; each should open at once" | tail -3'),
    [{ status: 'ready', nums: [52], note: 'click between board pages and tabs; each should open at once' }]);
  const chained = parseMarks('cd /x && termfleet-asks done 5 "tests pass, 12/12" 2>&1 | tail -2; ~/.local/bin/termfleet-asks ready 55 \'open the board\' >/dev/null && echo ok\nnode scripts/termfleet-asks.mjs ready 66,67 "tap Requests" || true');
  assert.deepEqual(chained.map((m) => [m.status, m.nums, m.note]), [['done', [5], 'tests pass, 12/12'], ['ready', [55], 'open the board'], ['ready', [66, 67], 'tap Requests']]);
  assert.deepEqual(parseMarks('termfleet-asks ready 5 open the bots list; echo x'), [{ status: 'ready', nums: [5], note: 'open the bots list' }]);
  assert.deepEqual(parseMarks('grep -n "termfleet-asks ready 5" file; termfleet-asks --help'), []);
});

// TF-099, Noam 2026-10-22: "every so often I see a Waiting for you list at the top, then it resets
// and disappears". Recorded live: the terminal service was out of reach for ~3 s, the bridge then
// read every old status record (1351 terminals, closed ones too), the list jumped from 1 real item
// to 9 ghosts, notified, and reset 8 s later. While the terminals cannot be seen, what they were
// waiting for stays exactly as last seen; bot items are still read fresh.
test('the list stays as it was while the terminals cannot be seen, then follows them again', () => {
  const real = { id: 'p1', project: 'termfleet', attention: { kind: 'question', title: 'Test question' } };
  const ghosts = Array.from({ length: 8 }, (_, i) => ({ id: `old${i}`, project: `old${i}`, attention: { kind: 'permission', title: 'This agent is asking permission to continue.' } }));
  const seen = collectWaiting({ panes: [real], bots: [], daemon: true });
  assert.equal(seen.length, 1);
  const blind = collectWaiting({ panes: [real, ...ghosts], bots: [{ id: 'b4', name: 'pc-helper', blocked: { ask: 'Which drive?' } }], daemon: false, previous: seen });
  assert.deepEqual(blind.map((i) => i.key).sort(), [seen[0].key, blind.find((i) => i.source === 'bot').key].sort(), 'no ghosts, the real item kept, bots still fresh');
  const back = collectWaiting({ panes: [], bots: [], daemon: true, previous: blind });
  assert.deepEqual(back, [], 'once the terminals are seen again an answered item drops');
});

test('the phone keeps the list last seen when one read of it fails', () => {
  const page = fs.readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
  assert.match(page, /const waitingData=\(await waitingRequest\) \|\| lastFleetData\?\.waiting \|\| null/);
  const server = fs.readFileSync(new URL('../bridge/server.mjs', import.meta.url), 'utf8');
  assert.match(server, /collectWaiting\(\{ panes, bots: bots\.list\(\), asksOf, daemon, previous: waitingNow \}\)/);
  assert.match(server, /!waitingLooked \? await refreshWaiting\(\)/, 'a fresh bridge looks before saying nothing waits');
});
