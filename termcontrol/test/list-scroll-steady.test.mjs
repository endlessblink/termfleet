// Noam 2026-10-24: "התצוגה קופצת למעלה, אפילו שהתצוגה היא על חלק תחתון יותר". On the phone's Bots
// list, a refresh whose bots request failed (a slow bridge) drew the list empty for a moment, the
// scroll snapped to the top and stayed there (reproduced: 900 -> 0, 30 rows -> 0). The list now
// keeps its last bots and its place.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';

const html = fs.readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
const bots = Array.from({ length: 30 }, (_, i) => ({ id: `b${String(i).padStart(10, '0')}x`, name: `Bot ${i + 1}`, job: 'Synthetic job', provider: 'claude', state: 'idle', unread: 0, lastAt: Date.now() - i * 60000 }));

test('the Bots list on a phone stays where it was scrolled when a refresh cannot read the bots', async () => {
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    let botsCalls = 0, failBots = false;
    await page.route('http://scroll.synthetic/**', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/') return route.fulfill({ body: html, contentType: 'text/html' });
      if (url.pathname === '/api/bots') { botsCalls++; return failBots ? route.fulfill({ status: 503, json: { error: 'busy' } }) : route.fulfill({ json: { bots } }); }
      if (url.pathname === '/api/panes') return route.fulfill({ json: { panes: [], groups: [], daemon: true } });
      if (url.pathname === '/api/waiting') return route.fulfill({ json: { items: [] } });
      return route.fulfill({ json: {} });
    });
    await page.addInitScript(() => localStorage.setItem('termcontrol-fleet-tab', 'bots'));
    await page.goto('http://scroll.synthetic/');
    await page.waitForSelector('.bot-row');
    const look = () => page.evaluate(() => ({ top: Math.round(document.querySelector('main').scrollTop), rows: document.querySelectorAll('.bot-row').length }));
    await page.evaluate(() => { document.querySelector('main').scrollTop = 900; });
    const before = await look();
    assert.ok(before.top > 500, `scrolled down (${before.top})`);
    const asked = botsCalls;
    failBots = true;
    await page.evaluate(() => window.dispatchEvent(new Event('online')));   // a refresh whose bots read fails
    await page.waitForTimeout(1500);
    assert.ok(botsCalls > asked, 'the refresh asked for the bots again');
    const after = await look();
    assert.equal(after.rows, before.rows, 'the bots stay listed');
    assert.ok(Math.abs(after.top - before.top) < 4, `stayed in place: ${before.top} -> ${after.top}`);
    // A refresh that works keeps the place too.
    failBots = false;
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForTimeout(1500);
    assert.ok(Math.abs((await look()).top - before.top) < 4);
    await ctx.close();
  } finally { await browser.close(); }
});
