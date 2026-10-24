// Pictures, GIFs and videos inside terminal-agent chats too, and a markdown image line becomes
// the picture (Noam 2026-10-24: "show the animation directly in termcontrol / termfleet chat";
// the politic bot's "![Pillow](https://…/anim-sleep-2x.gif)" showed as raw text above the GIF).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
import { findMedia } from '../bridge/bot-questions.mjs';

const html = fs.readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');

test('a markdown image or link to a picture or video becomes the picture, not leftover text', () => {
  const text = 'Here they are:\n\nPillow:\n![Pillow - they did not wake me](https://endlessblink.tail07658e.ts.net:8443/review/anim-sleep-2x.gif)\n\n[Golden pager](https://endlessblink.tail07658e.ts.net:8443/review/anim-pager-2x.mp4)\nTell me which one.';
  const shown = findMedia(text);
  assert.deepEqual(shown.media.map((m) => [m.kind, m.name]), [['image', 'anim-sleep-2x.gif'], ['video', 'anim-pager-2x.mp4']]);
  assert.doesNotMatch(shown.text, /!\[|\]\(|https:/, 'no raw markdown or address left');
  assert.match(shown.text, /Here they are:[\s\S]*Pillow:[\s\S]*Tell me which one\./);
  // A link inside a sentence stays readable text; the picture still shows.
  const inline = findMedia('See https://x.example/a.png for the new logo.');
  assert.equal(inline.media.length, 1);
  assert.match(inline.text, /See https:\/\/x\.example\/a\.png for the new logo\./);
});

test('a terminal agent chat shows its pictures, GIFs and videos inside the message, on phone and PC', async () => {
  const browser = await chromium.launch();
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  try {
    for (const phone of [true, false]) {
      const ctx = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 900 } });
      const page = await ctx.newPage();
      const errors = []; page.on('pageerror', (e) => errors.push(e.message));
      const pane = { id: 'T1', project: 'politic-fighter', provider: 'codex', alive: true, turn: 'idle', lastActiveAt: Date.now() };
      await page.route('http://media.synthetic/**', async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname === '/') return route.fulfill({ body: html, contentType: 'text/html' });
        if (url.pathname.startsWith('/media/')) return route.fulfill({ body: png, contentType: 'image/png' });
        let data = null;
        if (url.pathname === '/api/panes') data = { panes: [pane], groups: [{ project: 'politic-fighter', panes: [pane] }], daemon: true };
        if (url.pathname === '/api/feed') data = { pane, events: [{ kind: 'user', text: 'Show me the animation' }, { kind: 'assistant', text: 'Here is the pager animation.', media: [{ kind: 'image', href: 'http://media.synthetic/media/pager.gif', name: 'pager.gif' }, { kind: 'video', href: 'http://media.synthetic/media/pager.mp4', name: 'pager.mp4' }] }] };
        if (url.pathname === '/api/visit') data = { ok: true, lastUsedAt: Date.now() };
        if (url.pathname === '/api/bots') data = { bots: [] };
        if (url.pathname === '/api/waiting') data = { items: [] };
        // Like the real bridge: a terminal that is not in a bot group is "not found".
        if (url.pathname === '/api/bot-group') return route.fulfill({ status: 404, json: { error: 'Not found' } });
        return route.fulfill({ json: data || {} });
      });
      await page.addInitScript(() => localStorage.setItem('termcontrol-fleet-tab', 'terminals'));
      await page.goto('http://media.synthetic/');
      await page.locator('.pane[data-id="T1"]').click();
      await page.waitForSelector('.bot-media img');
      assert.equal(await page.locator('.bot-media img').getAttribute('src'), 'http://media.synthetic/media/pager.gif');
      assert.equal(await page.locator('.bot-media video[controls]').count(), 1, 'a video plays in place with its own controls');
      await page.locator('[data-media-full]').click();
      assert.equal(await page.locator('#media-full[open]').count(), 1, 'tapping a picture opens it full size inside the chat');
      // Noam 2026-10-24: Back after opening a picture left a black screen. Back closes it, the chat stays.
      await page.goBack();
      await page.waitForFunction(() => !document.querySelector('#media-full[open]'));
      assert.equal(await page.evaluate(() => location.hash), '#T1');
      assert.equal(await page.locator('.bot-media img').isVisible(), true, 'still in the same chat');
      // Closing it by tapping undoes its history step, so one more Back leaves the chat as usual.
      await page.locator('[data-media-full]').click();
      await page.locator('#media-full').click();
      await page.waitForFunction(() => !document.querySelector('#media-full[open]') && !history.state?.mediaFull);
      assert.equal(await page.evaluate(() => location.hash), '#T1');
      assert.equal(await page.locator('.bot-media img').isVisible(), true);
      await page.locator('[data-media-full]').click();
      await page.screenshot({ path: `${process.env.TMPDIR || '/tmp'}/inline-media-terminal-${phone ? 'phone' : 'pc'}.png` });
      assert.deepEqual(errors, []);
      await ctx.close();
    }
  } finally { await browser.close(); }
});
