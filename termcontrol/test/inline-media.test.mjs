import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findMedia, mediaKind, MEDIA_RULE, parseQuestion } from '../bridge/bot-questions.mjs';
import { resolveView } from '../bridge/question-view.mjs';
import { Bots, brainBrief } from '../bridge/bots.mjs';

// Noam 2026-10-24: "יש אפשרות להוסיף בצ'אט כאן inline עבור הסוכנים תמונות / סרטונים / גיפים?",
// "כדי שיוכל לשאול אותי על דברים ישירות בצ'אט?", "כדי שאראה דברים שהוא מג'נרט והוא לא יצטרך
// לשלוח אותי החוצה כדי לראות דברים וכו".
function files() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-media-'));
  for (const f of ['cover.png', 'loop.gif', 'demo.mp4', 'clip.mov', 'notes.txt']) fs.writeFileSync(path.join(dir, f), 'x');
  return dir;
}

test('pictures, GIFs and videos in a reply become inline media; their own lines leave the text', () => {
  const dir = files();
  const r = findMedia(`Here is the new cover:\n${path.join(dir, 'cover.png')}\nAnd the loop ${path.join(dir, 'loop.gif')} plus a clip:\nhttps://example.com/v/demo.webm?x=1\n${path.join(dir, 'demo.mp4')}\n${path.join(dir, 'notes.txt')}`);
  assert.deepEqual(r.media.map((m) => [m.kind, m.name]), [['image', 'cover.png'], ['image', 'loop.gif'], ['video', 'demo.webm'], ['video', 'demo.mp4']]);
  assert.match(r.media[0].href, /^\/view\/[A-Za-z0-9_-]{22}\/[A-Za-z0-9_-]+\/cover\.png$/);
  assert.equal(r.media[2].href, 'https://example.com/v/demo.webm?x=1');
  // a path on its own line is shown as the picture, not as text; one inside a sentence stays
  assert.doesNotMatch(r.text, /cover\.png/);
  assert.match(r.text, /And the loop .*loop\.gif plus a clip:/);
  assert.match(r.text, /notes\.txt/, 'other files stay plain text');
  // the server serves them, the .mov too
  assert.equal(resolveView(r.media[0].href).type, 'image/png');
  assert.equal(resolveView(findMedia(path.join(dir, 'clip.mov')).media[0].href).type, 'video/quicktime');
});

test('no media, a missing file, or a hidden folder: nothing is added', () => {
  assert.deepEqual(findMedia('Just words.').media, []);
  assert.deepEqual(findMedia('/home/nobody/none.png').media, []);
  assert.equal(mediaKind('/view/k/d/a.webp'), 'image');
  assert.equal(mediaKind('https://x.y/a.MP4'), 'video');
  assert.equal(mediaKind('https://x.y/page'), null);
});

test('at most six media per message, each named once', () => {
  const dir = files();
  const many = Array.from({ length: 9 }, (_, i) => `https://example.com/${i}.png`).join('\n');
  assert.equal(findMedia(many).media.length, 6);
  assert.equal(findMedia(`${path.join(dir, 'cover.png')}\n${path.join(dir, 'cover.png')}`).media.length, 1);
});

test('a question answer can carry its own picture or video', () => {
  const dir = files();
  const r = parseQuestion(`[question]\nWhich cover?\n- Cover A | ${path.join(dir, 'cover.png')} (recommended)\n- Cover B | https://example.com/b.gif\n- Moving | ${path.join(dir, 'demo.mp4')}\n[/question]`);
  assert.deepEqual(r.question.options, ['Cover A', 'Cover B', 'Moving']);
  assert.equal(mediaKind(r.question.optionLinks[0]), 'image');
  assert.equal(mediaKind(r.question.optionLinks[2]), 'video');
});

test('every bot is told how to show him things right in the chat', () => {
  assert.match(MEDIA_RULE, /own line/);
  assert.match(MEDIA_RULE, /picture|GIF|video/);
  assert.ok(brainBrief({ name: 'M', job: 'x' }).includes(MEDIA_RULE));
});

test('a bot reply with a picture is stored with its media', async () => {
  const dir = files();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-media-h-'));
  for (const d of ['.claude', '.codex']) fs.mkdirSync(path.join(home, d));
  fs.writeFileSync(path.join(home, '.claude', '.credentials.json'), '{}');
  fs.writeFileSync(path.join(home, '.codex', 'auth.json'), '{}');
  fs.writeFileSync(path.join(home, 'daemon.sock'), '');
  const bots = new Bots({ checks: { home, socket: path.join(home, 'daemon.sock') }, dir: fs.mkdtempSync(path.join(os.tmpdir(), 'tc-media-b-')), notify: () => {}, run: async () => ({ text: `Made it:\n${path.join(dir, 'cover.png')}` }) });
  const { bot } = bots.create({ name: 'Painter', cwd: os.tmpdir() });
  bots.send(bot.id, 'make a cover');
  for (let i = 0; i < 4000 && bots.running.has(bot.id); i++) await new Promise((r) => setTimeout(r, 5));
  const reply = bots.messages(bot.id).find((m) => m.role === 'bot');
  assert.equal(reply.text, 'Made it:');
  assert.equal(reply.media.length, 1);
  assert.equal(reply.media[0].kind, 'image');
});

test('the page shows media inline in reserved boxes, opens pictures inside the chat, plays videos in place', () => {
  const page = fs.readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
  assert.match(page, /function botMediaHtml/);
  assert.match(page, /loading="lazy"/);
  assert.match(page, /preload="metadata"/);
  assert.match(page, /playsinline/);
  assert.match(page, /\.bot-media-item\{[^}]*aspect-ratio/);
  assert.match(page, /box\.id='media-full'/);
  assert.match(page, /bot-q-thumb/);
});
