import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// A Claude pane in a folder like `comfyui_07` showed a raw screen scrape on the
// phone: its transcript is filed under `comfyui-07`, and the bridge only
// turned slashes into dashes, so it never found the conversation.
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-claude-path-'));
process.env.HOME = home;
const { claudeSlug, claudeTranscript } = await import('../bridge/paths.mjs');

const projects = path.join(home, '.claude', 'projects');
const write = (dir, id) => {
  fs.mkdirSync(path.join(projects, dir), { recursive: true });
  const file = path.join(projects, dir, `${id}.jsonl`);
  fs.writeFileSync(file, '{}\n');
  return file;
};

test('the slug turns every non-alphanumeric character into a dash, as Claude does', () => {
  assert.equal(claudeSlug('/media/x/scratch/opensource-ai/comfyui_07'), '-media-x-scratch-opensource-ai-comfyui-07');
  assert.equal(claudeSlug('/home/a/my.site'), '-home-a-my-site');
});

test('a folder with an underscore finds its conversation', () => {
  const file = write('-media-x-comfyui-07', 'aaaa');
  assert.equal(claudeTranscript('/media/x/comfyui_07', 'aaaa'), file);
});

test('a session filed under a different folder is still found by its id', () => {
  const file = write('-somewhere-else', 'bbbb');
  assert.equal(claudeTranscript('/media/x/moved', 'bbbb'), file);
  assert.equal(claudeTranscript('/media/x/moved', 'missing'), null);
  assert.equal(claudeTranscript('/media/x/moved', ''), null);
});
