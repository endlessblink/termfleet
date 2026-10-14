import test from 'node:test';
import assert from 'node:assert/strict';
import { inputBoxText, heldInInput, confirmSubmitted } from '../bridge/send.mjs';

// Owner evidence 2026-10-10 (sent.log + transcript): a phone photo + "Here" was typed
// into Claude at 21:23 but its Enter was swallowed; it sat in the box until the next
// message at 21:53 pushed both out as "HereMy phone is not connecting".
const RULE = '─'.repeat(60);
const claude = (box) => ['✻ Baked for 14s · done 10:15', '❯ /done', RULE, `❯ ${box}`, RULE, '[OMC] | ctx:11% | Sonnet 5.5', '⏵⏵ auto mode on'].join('\n');
const codex = (box) => ['• Done.', 'Worked for 10s • 3:06 PM', '› go', `› ${box}`, 'weekly 73% left · Context 23% used', '← for agents · ? for shortcuts'].join('\n');

test('finds the input box of Claude and Codex, not the echoed history above it', () => {
  assert.equal(inputBoxText(claude(''), 'claude'), '');
  assert.equal(inputBoxText(claude('[Image #1]Here'), 'claude'), '[Image #1]Here');
  assert.equal(inputBoxText(codex('Ask Codex to do anything'), 'codex'), 'Ask Codex to do anything');
  assert.equal(inputBoxText('no box at all', 'claude'), null);
  assert.equal(inputBoxText(claude('x'), 'opencode'), null);
});

test('only positive evidence counts as "still unsent"', () => {
  const photo = '/home/me/Pictures/termcontrol/2026-10-10T21-23-02.jpg Here';
  assert.equal(heldInInput(claude('[Image #1]Here'), photo, 'claude'), true);
  assert.equal(heldInInput(claude(''), photo, 'claude'), false, 'empty box: it went');
  assert.equal(heldInInput(claude('something I am typing myself'), 'deploy the fix now', 'claude'), false);
  assert.equal(heldInInput(claude('please deploy the fix now'), 'please deploy the fix now', 'claude'), true);
  assert.equal(heldInInput(claude('[Pasted text #1 +12 lines]'), 'line one\nline two', 'claude'), true);
  assert.equal(heldInInput(codex('Ask Codex to do anything'), 'check the build', 'codex'), false);
  assert.equal(heldInInput(codex('check the build'), 'check the build', 'codex'), true);
  assert.equal(heldInInput('garbled', 'check the build', 'claude'), null);
});

function fakePane(boxes) {
  const writes = [];
  let screenIndex = 0;
  return {
    writes,
    deps: {
      screen: () => claude(boxes[Math.min(screenIndex++, boxes.length - 1)]),
      write: async (data) => { writes.push(data); },
      pause: async () => {},
      record: () => {},
      deadlineMs: 50,
    },
  };
}

test('a swallowed submit is pressed again, and stops as soon as the box is clear', async () => {
  const f = fakePane(['please deploy the fix now', '']);
  const result = await confirmSubmitted({ id: 'p', provider: 'claude' }, 'please deploy the fix now', Date.now(), f.deps);
  assert.deepEqual(f.writes, ['\r']);
  assert.equal(result.held, false);
});

test('never presses submit when the box is clear or unreadable', async () => {
  for (const boxes of [[''], ['my own unrelated draft']]) {
    const f = fakePane(boxes);
    await confirmSubmitted({ id: 'p', provider: 'claude' }, 'please deploy the fix now', Date.now(), f.deps);
    assert.deepEqual(f.writes, []);
  }
  const unread = { ...fakePane(['x']).deps, screen: () => null };
  const writes = [];
  await confirmSubmitted({ id: 'p', provider: 'claude' }, 'please deploy', Date.now(), { ...unread, write: async (d) => writes.push(d) });
  assert.deepEqual(writes, []);
});

test('gives up after two extra presses and says the message is still held', async () => {
  let clock = 0;
  const f = fakePane(['please deploy the fix now']);
  const result = await confirmSubmitted({ id: 'p', provider: 'claude' }, 'please deploy the fix now', 0, { ...f.deps, deadlineMs: 1e9, pause: async () => { clock++; } });
  assert.equal(f.writes.length, 2);
  assert.equal(result.held, true);
  assert.ok(clock >= 3);
});
