// Noam 2026-10-23: "לא יכול להדביק תמונות בctrl+v". The PC's server reads which picture
// files were copied, because the desktop engine hides file addresses from the page.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { copiedPicturePaths, readCopiedPictureFiles } from '../bridge/clipboard-files.mjs';

test('only a list made entirely of copied picture files counts', () => {
  assert.deepEqual(copiedPicturePaths('file:///home/n/a%20b.png\r\nfile:///media/x/c.JPG\r\n'), ['/home/n/a b.png', '/media/x/c.JPG']);
  assert.deepEqual(copiedPicturePaths('file:///home/n/a.png\nfile:///home/n/notes.txt'), []);
  assert.deepEqual(copiedPicturePaths('just some words'), []);
  assert.deepEqual(copiedPicturePaths('/home/n/a.png'), [], 'a typed path stays text');
  assert.deepEqual(copiedPicturePaths(''), []);
});

test('reads the copied files from the system clipboard and keeps only real pictures it may show', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-clip-'));
  const pic = path.join(dir, 'shot.png'); fs.writeFileSync(pic, 'png');
  const calls = [];
  const run = async (cmd, args) => { calls.push([cmd, ...args]); return `file://${pic}\r\nfile://${dir}/missing.png\r\n`; };
  assert.deepEqual(await readCopiedPictureFiles({ run, env: { DISPLAY: ':0' } }), [fs.realpathSync(pic)]);
  assert.equal(calls[0][0], 'xclip');
  calls.length = 0;
  await readCopiedPictureFiles({ run, env: { WAYLAND_DISPLAY: 'wayland-0' } });
  assert.equal(calls[0][0], 'wl-paste');
  assert.deepEqual(await readCopiedPictureFiles({ run: async () => { throw new Error('no clipboard'); }, env: { DISPLAY: ':0' } }), []);
  assert.deepEqual(await readCopiedPictureFiles({ run: async () => 'words', env: { DISPLAY: ':0' } }), []);
  fs.rmSync(dir, { recursive: true, force: true });
});
