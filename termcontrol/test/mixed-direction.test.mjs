import { serveAppModule } from './helpers/app-module-route.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';

// Noam 2026-10-20: "וגם במצב שבו יש קודם אנגלית ואז עברית כתיבת עברית מימין לשמאל לא עובדת טוב".
// A line that starts in English but is mostly Hebrew must read right-to-left everywhere:
// the message box while typing, the chat bubbles, the title, the requests list, the list
// rows and the Needs you strip, on a phone and on a desktop.
const html = fs.readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
const ONE = 'TermFleet צריך לעבוד טוב';
const TWO = 'Please check the export\nTermFleet צריך לבדוק את הייצוא';

const scan = () => {
  const found = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    const i = n.data.indexOf('צריך'), j = n.data.indexOf('TermFleet');
    if (i < 0 || j < 0 || n.parentElement.closest('.message-details')) continue;
    const a = document.createRange(); a.setStart(n, i); a.setEnd(n, i + 4);
    const b = document.createRange(); b.setStart(n, j); b.setEnd(n, j + 9);
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    if (!ra.width || !rb.width) continue;
    // Right-to-left: the Hebrew word that follows "TermFleet" sits to its left.
    found.push({ where: n.parentElement.className || n.parentElement.tagName, rtl: ra.left < rb.left });
  }
  return found;
};

for (const [name, viewport] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1366, height: 860 }]]) {
  test(`English first, then Hebrew, reads right-to-left on a ${name}`, async () => {
    const now = Date.now();
    const pane = { id: 'fixture', project: 'demo', provider: 'claude', task: ONE, turn: 'waiting', updatedAt: now, attention: { kind: 'question', title: ONE } };
    const events = [
      { kind: 'user', at: new Date(now - 60000).toISOString(), text: ONE },
      { kind: 'assistant', at: new Date(now - 50000).toISOString(), text: ONE },
      { kind: 'user', at: new Date(now - 40000).toISOString(), text: TWO },
    ];
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport });
      await page.addInitScript(() => { try { sessionStorage.setItem('termcontrol-asks-open', 'open'); } catch {} });
      await page.route('**/*', async (route) => {
  if(await serveAppModule(route))return;
        const u = new URL(route.request().url());
        if (u.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html });
        if (u.pathname === '/api/panes') return route.fulfill({ json: { panes: [pane], groups: [{ id: 'demo', project: 'demo', panes: [pane] }], daemon: true } });
        if (u.pathname === '/api/feed') return route.fulfill({ json: { pane, events, reachedStart: true, asks: [{ n: 1, text: ONE, status: 'open' }] } });
        return route.fulfill({ json: {} });
      });
      await page.goto('https://termcontrol.test/');
      await page.waitForSelector('.pane');
      const list = await page.evaluate(scan);
      await page.locator('.pane').first().click();
      await page.waitForSelector('.composer textarea');
      await page.waitForTimeout(600);
      const chat = await page.evaluate(scan);
      const all = [...list, ...chat];
      assert.ok(all.length >= 6, `found the mixed line in ${all.length} places`);
      assert.deepEqual(all.filter((x) => !x.rtl), [], 'every mixed English→Hebrew line reads right-to-left');

      const box = page.locator('.composer textarea').first();
      await box.click();
      await page.keyboard.type(ONE);
      assert.equal(await box.evaluate((el) => getComputedStyle(el).direction), 'rtl', 'the message box turns right-to-left while typing');
      await box.fill('');
      await page.keyboard.type('Please check the export');
      assert.equal(await box.evaluate((el) => getComputedStyle(el).direction), 'ltr', 'plain English stays left-to-right');
      await page.keyboard.press('Shift+Enter');
      await page.keyboard.type('צריך לבדוק את הייצוא עכשיו');
      assert.equal(await box.evaluate((el) => getComputedStyle(el).direction), 'rtl', 'a Hebrew second line turns the box right-to-left');
    } finally {
      await browser.close();
    }
  });
}
