import { serveAppModule } from './helpers/app-module-route.mjs';
// Noam 2026-10-24: "הכיתוב termcontrol למעלה קופץ". Every list refresh (every 15 s, and on live
// events) emptied the count line under "TermControl" until the bridge answered, so the title
// moved 9 px up and down while agents worked. The line now keeps its text and one fixed height.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';

const html = fs.readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');

test('the TermControl title does not move while the list refreshes', async () => {
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    let calls = 0;
    const panes = [{ id: 'A', project: 'p', provider: 'claude', alive: true, turn: 'working', producing: true, lastActiveAt: Date.now() }];
    await page.route('http://header.synthetic/**', async (route) => {
  if(await serveAppModule(route))return;
      const url = new URL(route.request().url());
      if (url.pathname === '/') return route.fulfill({ body: html, contentType: 'text/html' });
      if (url.pathname === '/api/panes') { if (calls++) await new Promise((r) => setTimeout(r, 1500)); return route.fulfill({ json: { panes, groups: [{ project: 'p', panes }], daemon: true } }); }
      if (url.pathname === '/api/bots') return route.fulfill({ json: { bots: [] } });
      if (url.pathname === '/api/waiting') return route.fulfill({ json: { items: [] } });
      return route.fulfill({ json: {} });
    });
    await page.addInitScript(() => localStorage.setItem('termcontrol-fleet-tab', 'terminals'));
    await page.goto('http://header.synthetic/');
    await page.waitForSelector('.pane');
    const look = () => page.evaluate(() => { const t = document.querySelector('body>header h1'), s = document.querySelector('body>header .sub'); return { top: Math.round(t.getBoundingClientRect().top), sub: s.textContent }; });
    const before = await look();
    assert.equal(before.sub, '1 terminal');
    const asked = calls;
    await page.evaluate(() => window.dispatchEvent(new Event('online')));   // a refresh, as when the phone reconnects
    const seen = [];
    for (let i = 0; i < 18; i++) { seen.push(await look()); await page.waitForTimeout(100); }
    assert.ok(calls > asked, 'the list did refresh');
    assert.ok(seen.every((s) => s.top === before.top), `title moved: ${JSON.stringify(seen.map((s) => s.top))}`);
    assert.ok(seen.every((s) => s.sub === '1 terminal'), `count line emptied: ${JSON.stringify(seen.map((s) => s.sub))}`);
    await ctx.close();
  } finally { await browser.close(); }
});
