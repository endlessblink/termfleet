// Noam 2026-10-23 (R-353, "המסך הזה לא כלכך עוזר לי"): a per-item table in a bot reply does not help.
// The reply stays plain; the per-item list waits under a collapsed Details toggle, on the PC and the phone.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../bridge/server.mjs', import.meta.url), 'utf8');
const bots = fs.readFileSync(new URL('../bridge/bots.mjs', import.meta.url), 'utf8');

test('the bot view carries the per-reply item list', () => {
  assert.match(server, /view\.details = replyDetails\(view\.messages, itemsView\(\{ source: `bot:\$\{view\.bot\.id\}`/);
});

test('a bot reply renders a collapsed Details toggle with his words, what was done and the proof', () => {
  const fn = html.slice(html.indexOf('function replyDetailsHtml('), html.indexOf('// Slim bot header'));
  assert.match(fn, /<details class="reply-details" data-detail-key="reply:/);
  assert.doesNotMatch(fn, /<details[^>]*\sopen/, 'closed until he taps it');
  assert.match(fn, /it\.words/); assert.match(fn, /it\.did/); assert.match(fn, /it\.evidence/);
  assert.doesNotMatch(fn, /it\.id/, 'no item ids on his screen');
  assert.match(html, /messageHtml\('assistant',m\.text,bot\.name,when,'','','',\{mid:m\.id\}\)\+replyDetailsHtml\(m\.id,data\.details\?\.\[m\.id\]\)/);
});

test('an open Details stays open when new messages repaint the chat', () => {
  assert.match(html, /const openReplyDetails=new Set\(\[\.\.\.main\.querySelectorAll\('\.reply-details\[open\]'\)\]/);
});

test('the toggle is a 44px tap target and wraps on a phone', () => {
  assert.match(html, /\.reply-details>summary\{[^}]*min-height:44px/);
  assert.match(html, /\.reply-details li\{[^}]*overflow-wrap:anywhere/);
});

test('bots are told to answer in plain sentences, not with a per-item table', () => {
  assert.doesNotMatch(bots, /per-item table/);
  assert.match(bots, /1-3 plain sentences[^']*No item ids, no quoted words, no table/);
});
