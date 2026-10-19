// Noam 2026-10-19: "still cant ctrl+v" after a fix. A page held open in the desktop app or on
// a phone never reloaded by itself, so fixes never reached it. It now asks the bridge which
// version is current and reloads when idle (or offers a Reload button when he is typing).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';

const html = fs.readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
const pane = { id: 'a', sessionId: 'a', title: 'Chat a', project: 'Project a', provider: 'codex', turn: 'idle', alive: true, updatedAt: Date.now() };

async function page(browser, versions) {
  const p = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const state = { loads: 0, checks: 0 };
  await p.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/') { state.loads++; return route.fulfill({ contentType: 'text/html', body: html }); }
    if (url.pathname === '/api/app-version') return route.fulfill({ json: { v: versions[Math.min(state.checks++, versions.length - 1)] } });
    if (url.pathname === '/api/panes') return route.fulfill({ json: { daemon: true, panes: [pane], view: 'manual' } });
    if (url.pathname === '/api/feed') return route.fulfill({ json: { pane, events: [], reachedStart: true, producing: false } });
    return route.fulfill({ json: {} });
  });
  await p.goto('https://termcontrol.test/');
  await p.locator('.pane[data-id="a"]').waitFor();
  await p.waitForFunction(() => true);
  return { p, state };
}
const wake = (p) => p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });

test('the bridge says which page version is current', async () => {
  const src = fs.readFileSync(new URL('../bridge/server.mjs', import.meta.url), 'utf8');
  assert.match(src, /\/api\/app-version/);
});

test('an idle page reloads itself when a new version is out', async () => {
  const browser = await chromium.launch();
  try {
    const { p, state } = await page(browser, ['v1', 'v2']);
    await p.waitForFunction(() => document.querySelector('.pane'), null, { polling: 100 });
    await wake(p);   // second check -> v2
    await p.waitForFunction(() => performance.getEntriesByType('navigation').length >= 1, null, { polling: 100 });
    for (let i = 0; i < 50 && state.loads < 2; i++) await new Promise((r) => setTimeout(r, 100));
    assert.equal(state.loads, 2, 'the page reloaded once');
    await p.close();
  } finally { await browser.close(); }
});

test('a page with a message being typed is NOT reloaded; it offers a Reload button instead', async () => {
  const browser = await chromium.launch();
  try {
    const { p, state } = await page(browser, ['v1', 'v2']);
    await p.locator('.pane[data-id="a"]').click();
    await p.locator('.composer textarea').fill('half-written message');
    await wake(p);
    await p.locator('.update-ready .sendstate-action').waitFor({ timeout: 5000 });
    assert.equal(state.loads, 1, 'no reload while typing');
    assert.equal(await p.inputValue('.composer textarea'), 'half-written message');
    await p.close();
  } finally { await browser.close(); }
});
