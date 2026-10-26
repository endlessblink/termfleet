import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { splitPictures } from '../bridge/send.mjs';
import { parseArgs } from '../../scripts/termfleet-team.mjs';
import { brainBrief } from '../bridge/bots.mjs';

// 2026-10-26, on throwaway Claude and Codex terminals (nothing submitted): a picture path inside
// the words stays text in both; on its own line inside a longer paste only Claude attaches it;
// pasted alone it attaches in both. So each picture line is pasted on its own first.
const exists = (p) => p.startsWith('/pics/');

test('picture lines are taken out of the message, to be pasted on their own', () => {
  const r = splitPictures('[Message from the bot "X"] Look at this.\n/pics/a.png\n\n(Answer here.)\n/pics/b.jpg', exists);
  assert.deepEqual(r.pictures, ['/pics/a.png', '/pics/b.jpg']);
  assert.equal(r.words, '[Message from the bot "X"] Look at this.\n\n(Answer here.)');
});

test('a path inside a sentence, a missing file or a non-picture is left alone, and the text is unchanged', () => {
  const body = 'See /pics/a.png here.\n/other/missing.png\n/pics/notes.txt';
  assert.deepEqual(splitPictures(body, exists), { pictures: [], words: body });
});

test('--image can be given more than once', () => {
  const { flags, positional } = parseArgs(['send', 'who', 'look', '--image', '/pics/a.png', '--image', '/pics/b.png']);
  assert.deepEqual(flags.image, ['/pics/a.png', '/pics/b.png']);
  assert.deepEqual(positional, ['send', 'who', 'look']);
});

test('bots are told to pass the picture itself with --image', () => {
  const brief = fs.readFileSync(new URL('../bridge/bots.mjs', import.meta.url), 'utf8');
  assert.match(brief, /add `--image <full path>` \(once per picture\) to `termfleet-team send`, `ask` or `start`/);
  assert.equal(typeof brainBrief, 'function');
});
