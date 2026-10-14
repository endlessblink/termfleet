import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Rooms, handleFor, mentionedMembers, messageForAgent, MAX_HOPS } from '../bridge/rooms.mjs';

// Owner request 2026-10-12: agents share one room; @-mention picks who answers,
// agents can ask each other, and a hop limit stops them looping.
function harness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-rooms-'));
  let clock = 1_000_000;
  const sent = [];
  const feeds = new Map();
  const rooms = new Rooms({
    file: path.join(dir, 'rooms.json'),
    now: () => clock,
    send: async (pane, text) => { sent.push({ pane: pane.id, text }); return { ok: true }; },
    readFeed: (pane) => ({ events: feeds.get(pane.id) || [] }),
  });
  const panes = [
    { id: 'p1', project: 'termfleet', provider: 'claude' },
    { id: 'p2', project: 'bina-ve-ze', provider: 'codex' },
    { id: 'p3', project: 'termfleet', provider: 'codex' },
  ];
  const answer = (id, text) => feeds.set(id, [...(feeds.get(id) || []), { kind: 'assistant', at: clock, text }]);
  const tick = async (ms) => { clock += ms; await rooms.poll(panes); };
  return { rooms, panes, sent, answer, tick, dir, advance: (ms) => { clock += ms; } };
}

async function settle(h) {
  await h.tick(1000);   // sees the answer
  await h.tick(7000);   // still unchanged after the settle time
}

test('members get distinct, typeable handles', () => {
  const taken = new Set();
  const a = handleFor({ project: 'TermFleet', provider: 'claude' }, taken); taken.add(a);
  const b = handleFor({ project: 'TermFleet', provider: 'codex' }, taken); taken.add(b);
  const c = handleFor({ project: 'בינה ועוד', provider: 'codex' }, taken);
  assert.equal(a, 'termfleet');
  assert.equal(b, 'termfleet-codex');
  assert.equal(c, 'בינה-ועוד');
});

test('a message naming nobody goes to every member; a mention goes only to that member', async () => {
  const h = harness();
  const { room } = h.rooms.create('Release', h.panes.slice(0, 2));
  await h.rooms.post(room.id, 'Status, everyone?', h.panes);
  assert.deepEqual(h.sent.map((s) => s.pane), ['p1', 'p2']);
  h.sent.length = 0;
  await h.rooms.post(room.id, '@bina-ve-ze can you check the tests?', h.panes);
  assert.deepEqual(h.sent.map((s) => s.pane), ['p2']);
  assert.match(h.sent[0].text, /You are @bina-ve-ze/);
  assert.match(h.sent[0].text, /You: Status, everyone\?/, 'recent room talk travels with the message');
});

test('an agent answer is posted once it has settled, not while it is still working', async () => {
  const h = harness();
  const { room } = h.rooms.create('Release', [h.panes[0]]);
  await h.rooms.post(room.id, 'Ship it?', h.panes);
  h.advance(2000);
  h.answer('p1', 'Checking…');
  h.panes[0].turn = 'working';
  await h.tick(10000);
  assert.equal(h.rooms.get(room.id).messages.length, 1, 'nothing posted while working');
  h.panes[0].turn = 'completed';
  h.answer('p1', 'Yes, all green.');
  await settle(h);
  const last = h.rooms.get(room.id).messages.at(-1);
  assert.equal(last.author, '@termfleet');
  assert.equal(last.text, 'Yes, all green.');
  assert.equal(h.rooms.get(room.id).pending.length, 0);
});

test('an answer that mentions another member is passed on, up to the hop limit', async () => {
  const h = harness();
  const { room } = h.rooms.create('Pair', h.panes.slice(0, 2));
  await h.rooms.post(room.id, '@termfleet start', h.panes);
  let speaker = 'p1';
  for (let hop = 0; hop < MAX_HOPS + 1; hop++) {
    h.advance(2000);
    h.answer(speaker, speaker === 'p1' ? '@bina-ve-ze your turn' : '@termfleet your turn');
    await settle(h);
    speaker = speaker === 'p1' ? 'p2' : 'p1';
  }
  const texts = h.rooms.get(room.id).messages.map((m) => m.text);
  assert.ok(texts.some((t) => /back and forth enough/.test(t)), 'the loop is stopped');
  assert.equal(h.sent.length, MAX_HOPS, 'one operator delivery plus the allowed hand-offs');
});

test('a closed member is reported in the room instead of silently skipped', async () => {
  const h = harness();
  const { room } = h.rooms.create('Pair', h.panes.slice(0, 2));
  await h.rooms.post(room.id, 'hello', [h.panes[0]]);
  assert.match(h.rooms.get(room.id).messages.at(-1).text, /@bina-ve-ze is closed/);
});

test('rooms survive a restart of the bridge', async () => {
  const h = harness();
  const { room } = h.rooms.create('Keep', [h.panes[0]]);
  await h.rooms.post(room.id, 'remember me', h.panes);
  const again = new Rooms({ file: path.join(h.dir, 'rooms.json') });
  assert.equal(again.get(room.id).messages[0].text, 'remember me');
  assert.equal(again.get(room.id).pending.length, 1);
});

test('mentions resolve only to members and the agent prompt names everyone', () => {
  const room = { name: 'R', members: [{ pane: 'a', handle: 'one' }, { pane: 'b', handle: 'two' }], messages: [] };
  assert.deepEqual(mentionedMembers(room, 'hey @two and @nobody, email me@x.com'), ['b']);
  const text = messageForAgent(room, room.members[0], { seq: 1, author: 'You', text: 'hi' });
  assert.match(text, /You are @one\. Others: @two\./);
});
