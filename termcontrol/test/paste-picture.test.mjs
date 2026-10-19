// Noam 2026-10-19: "Cant paste an image on mobile in agent conversation".
// Phone keyboards often never send a paste event for a picture, so the menu has a
// "Paste picture" button that reads the picture from the clipboard when tapped.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';

const html = fs.readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
const pane = (id) => ({ id, sessionId: id, title: `Chat ${id}`, project: `Project ${id}`, provider: 'codex', turn: 'idle', alive: true, updatedAt: Date.now() });

async function fixture(browser, clipboard) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  await page.addInitScript((mode) => {
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6lLQAAAAASUVORK5CYII='), (c) => c.charCodeAt(0));
    const read = mode === 'picture' ? async () => [{ types: ['text/plain', 'image/png'], getType: async (t) => new Blob([t === 'image/png' ? png : 'words'], { type: t }) }]
      : mode === 'text' ? async () => [{ types: ['text/plain'], getType: async () => new Blob(['just words'], { type: 'text/plain' }) }]
        : async () => { throw Object.assign(new Error('denied'), { name: 'NotAllowedError' }); };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { read, writeText: async () => {} } });
  }, clipboard);
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html });
    if (url.pathname === '/api/panes') return route.fulfill({ json: { daemon: true, panes: [pane('a')], view: 'manual' } });
    if (url.pathname === '/api/feed') return route.fulfill({ json: { pane: pane('a'), events: [], reachedStart: true, producing: false } });
    return route.fulfill({ json: {} });
  });
  await page.goto('https://termcontrol.test/');
  await page.locator('.pane[data-id="a"]').click();
  await page.locator('.composer textarea').waitFor();
  return page;
}
const openMenu = async (page) => { await page.locator('.composer-menu > summary').click(); };

test('Paste picture brings the copied picture into the message, exactly like Attach', async () => {
  const browser = await chromium.launch();
  try {
    const page = await fixture(browser, 'picture');
    await openMenu(page);
    await page.locator('.paste-image').click();
    await page.locator('.attached .name').filter({ hasText: 'pasted image' }).waitFor({ timeout: 8000 });
    assert.equal(await page.locator('.attached').isHidden(), false);
    assert.equal(await page.locator('.composer-menu').evaluate((d) => d.open), false, 'the menu closes');
    await page.close();
  } finally { await browser.close(); }
});

test('Paste picture says plainly when there is no picture or the phone refuses', async () => {
  const browser = await chromium.launch();
  try {
    let page = await fixture(browser, 'text');
    await openMenu(page); await page.locator('.paste-image').click();
    await page.locator('.sendstate').filter({ hasText: /No picture/ }).waitFor({ timeout: 5000 });
    await page.close();
    page = await fixture(browser, 'denied');
    await openMenu(page); await page.locator('.paste-image').click();
    await page.locator('.sendstate').filter({ hasText: /Allow paste|Attach an image/ }).waitFor({ timeout: 5000 });
    assert.equal(await page.locator('.attached').isHidden(), true);
    await page.close();
  } finally { await browser.close(); }
});
