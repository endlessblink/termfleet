import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveLocalImage } from '../bridge/local-image.mjs';

// Noam: "שהלינקים שהסוכנים נותנים יהיו לחיצים" + "ושיהיה קל להעתיק אותם אם צריך".
const html = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../app/index.html'), 'utf8');
const start = html.indexOf('const esc = ');
const end = html.indexOf("return `<div class=\"rich\">${out.join('')}</div>`;\n}", start);
const richText = new Function(`${html.slice(start, end)}return \`<div class="rich">\${out.join('')}</div>\`;\n}\nreturn richText;`)();
const links = (out) => [...out.matchAll(/<a class="msg-link[^"]*" href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));

test('plain, bare and localhost addresses become links', () => {
  const out = richText('See https://github.com/endlessblink/termfleet?tab=readme&x=1 and github.com/x/y, www.example.org and localhost:5177/app.');
  assert.deepEqual(links(out), ['https://github.com/endlessblink/termfleet?tab=readme&x=1', 'https://github.com/x/y', 'https://www.example.org', 'http://localhost:5177/app']);
  assert.match(out, /target="_blank" rel="noopener noreferrer"/);
});

test('links inside Hebrew text drop Hebrew punctuation and stay left-to-right', () => {
  const out = richText('הנה הקישור: https://example.com/path. ובסוגריים (github.com/a/b), וגם ״https://x.dev/q״ — ראו ב-https://he.wikipedia.org/wiki/תל_אביב!');
  assert.deepEqual(links(out), ['https://example.com/path', 'https://github.com/a/b', 'https://x.dev/q', 'https://he.wikipedia.org/wiki/תל_אביב']);
  assert.match(out, /dir="ltr"/);
  assert.match(out, /\/path<\/a><button[^>]*class="link-copy"[\s\S]*?<\/button>\. ובסוגריים/);
});

test('a link that opened a bracket keeps it', () => {
  assert.deepEqual(links(richText('https://en.wikipedia.org/wiki/Tauri_(software)')), ['https://en.wikipedia.org/wiki/Tauri_(software)']);
});

test('Markdown links work and unsafe ones stay plain text', () => {
  const out = richText('[המדריך](https://docs.example.com/a) [bare](github.com/q) [bad](javascript:alert(1)) [data](data:text/html,x)');
  assert.deepEqual(links(out), ['https://docs.example.com/a', 'https://github.com/q']);
  assert.doesNotMatch(out, /href="javascript|href="data/);
  assert.match(out, /\[bad\]\(javascript:alert\(1\)\)/);
});

test('an address in backticks is a link; code is not', () => {
  const out = richText('Open `http://127.0.0.1:5177` then run `npm test`');
  assert.deepEqual(links(out), ['http://127.0.0.1:5177']);
  assert.match(out, /<code>npm test<\/code>/);
});

test('file names, versions, e-mail and capitalised words are not links', () => {
  assert.deepEqual(links(richText('Edited index.html, package.json, server.mjs, v0.1.0 in 0.07s; mail me@example.com; ASP.NET and Node.js')), []);
});

test('every link has a copy button carrying the address', () => {
  const out = richText('a https://a.io b');
  assert.match(out, /<button type="button" class="link-copy" data-link="https:\/\/a\.io" aria-label="Copy link"/);
});

test('a screenshot path opens through the picture preview', () => {
  const out = richText('Saved /home/me/shots/after.png and ~/Pictures/x.jpg; not /etc/passwd');
  assert.deepEqual(links(out), ['/api/local-image?path=%2Fhome%2Fme%2Fshots%2Fafter.png', '/api/local-image?path=~%2FPictures%2Fx.jpg']);
  assert.match(out, /data-link="\/home\/me\/shots\/after\.png"/);
});

test('message text is still escaped', () => {
  const out = richText('<img src=x onerror=alert(1)> https://ok.com/"onmouseover=x');
  assert.doesNotMatch(out, /<img/);
  assert.doesNotMatch(out, /href="[^"]*"onmouseover/);
});

test('the picture preview only serves pictures under home or temp', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-img-home-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-img-out-'));
  fs.writeFileSync(path.join(home, 'shot.png'), 'png');
  fs.writeFileSync(path.join(home, 'secret.txt'), 'no');
  fs.writeFileSync(path.join(outside, 'other.png'), 'png');
  fs.symlinkSync(path.join(home, 'secret.txt'), path.join(home, 'sneaky.png'));
  const opts = { home, roots: [home] };
  assert.equal(resolveLocalImage(path.join(home, 'shot.png'), opts).type, 'image/png');
  assert.equal(resolveLocalImage('~/shot.png', opts).type, 'image/png');
  assert.equal(resolveLocalImage(path.join(home, 'secret.txt'), opts), null);
  assert.equal(resolveLocalImage(path.join(home, 'sneaky.png'), opts), null);
  assert.equal(resolveLocalImage(path.join(outside, 'other.png'), opts), null);
  assert.equal(resolveLocalImage(path.join(home, '../', path.basename(outside), 'other.png'), opts), null);
  assert.equal(resolveLocalImage('shot.png', opts), null);
});

// Noam: "לחיצה על לינק עדיין לא עושה כלום" — the PC app's link handler was pasted inside the
// read-aloud click handler, so it only switched on after "read aloud" was pressed.
test('the PC-app link handler is registered on load, not inside another handler', () => {
  const speak = html.indexOf("closest('.speak-message')");
  const linkCode = html.indexOf('const insidePcApp=');
  const speakEnd = html.indexOf('speechSynthesis.speak(utterance);\n});', speak);
  assert.ok(speak > 0 && linkCode > 0 && speakEnd > 0);
  assert.ok(speakEnd < linkCode || speak > linkCode, 'read-aloud handler must close before the link code starts');
});
