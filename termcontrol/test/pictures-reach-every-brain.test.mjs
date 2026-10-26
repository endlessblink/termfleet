import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sideCommand } from '../bridge/side-reply.mjs';
import { brainCommand, attachedPictures } from '../bridge/bots.mjs';

// 2026-10-26: the quick reply got Noam's words without the picture and said "I don't see any
// picture"; Codex bots got the path as text and never looked (0 views). Attached, Codex sends the
// picture to the model (checked against a local stand-in endpoint).
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-pics-'));
const pic = path.join(dir, 'shot.png');
fs.writeFileSync(pic, 'png');

test('a Codex quick reply gets the picture attached before its prompt', () => {
  const { args } = sideCommand({ provider: 'codex' }, 'what is this?', { cwd: dir, images: [pic] });
  assert.ok(args.includes(`--image=${pic}`));
  assert.equal(args.at(-1), 'what is this?');
  assert.ok(args.indexOf(`--image=${pic}`) < args.length - 1);
});

test('a Claude quick reply with a picture may Read it from its folder, and still cannot change anything', () => {
  const { args } = sideCommand({ provider: 'claude' }, 'what is this?', { cwd: dir, images: [pic] });
  const banned = args.slice(args.indexOf('--disallowedTools') + 1);
  assert.ok(!banned.includes('Read'));
  assert.ok(['Bash', 'Edit', 'Write'].every((t) => banned.includes(t)));
  assert.deepEqual(args.slice(args.indexOf('--add-dir'), args.indexOf('--add-dir') + 2), ['--add-dir', dir]);
  assert.ok(!args.includes('--resume'));
});

test('without pictures the note-only Claude quick reply is unchanged: no Read, no folders', () => {
  const { args } = sideCommand({ provider: 'claude' }, 'hi', { cwd: dir });
  assert.ok(args.slice(args.indexOf('--disallowedTools') + 1).includes('Read'));
  assert.ok(!args.includes('--add-dir'));
});

test('a missing picture file is not attached', () => {
  const { args } = sideCommand({ provider: 'codex' }, 'x', { cwd: dir, images: [path.join(dir, 'gone.png')] });
  assert.ok(!args.some((a) => a.startsWith('--image')));
});

test("a Codex bot turn attaches the pictures named in the bridge's own note", () => {
  const text = `look\n\n[Noam attached 1 picture. Look at each one before answering (open the file to see it): ${pic}]`;
  assert.deepEqual(attachedPictures(text), [pic]);
  const first = brainCommand({ provider: 'codex', cwd: dir, name: 'B', id: 'x' }, text).args;
  assert.ok(first.includes(`--image=${pic}`));
  assert.ok(first.at(-1).endsWith(`${pic}]`));
  const resumed = brainCommand({ provider: 'codex', cwd: dir, name: 'B', id: 'x', sessions: { codex: 's1' } }, text).args;
  assert.ok(resumed.includes(`--image=${pic}`));
});
