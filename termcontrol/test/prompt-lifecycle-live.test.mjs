// Opt-in read-back of the actual served HTML. Every browser API is intercepted
// before navigation; synthetic cards never enter owner history or a real pane.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

const origin = process.env.TC_LIVE_PROMPT_UI_ORIGIN;
const hash = value => createHash('sha256').update(value).digest('hex');
for (const width of [390, 1600]) test(`served prompt lifecycle at ${width}px with all APIs isolated`, { skip: !origin, timeout: 45000 }, async () => {
  const base = new URL(origin);
  assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname), 'read-back is loopback only');
  const signIn = await fetch(new URL('/embed', base), { redirect: 'manual', headers: { 'sec-fetch-dest': 'iframe' } });
  assert.equal(signIn.status, 302);
  const cookie = signIn.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie, 'local owner embed authorizes the read-only page fetch');
  const served = await fetch(new URL('/', base), { headers: { cookie } });
  assert.equal(served.status, 200);
  const appHash = hash(Buffer.from(await served.arrayBuffer()));
  assert.equal(appHash, hash(fs.readFileSync(new URL('../app/index.html', import.meta.url))), 'served HTML matches the tested disk bytes');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width, height: 860 }, serviceWorkers: 'block' });
  const equals = cookie.indexOf('=');
  await context.addCookies([{ name: cookie.slice(0, equals), value: cookie.slice(equals + 1), url: base.origin }]);
  await context.addInitScript(() => sessionStorage.setItem('termcontrol-pin-open', 'open'));
  const bot = { id: 'synthetic-prompt-readback', name: 'Synthetic prompt read-back', provider: 'codex', state: 'idle', helpers: [], job: '', pinned: false };
  let card = { id: 'synthetic-card', role: 'terminal-ask', pane: 'synthetic-not-a-real-pane', askId: 'synthetic-ask-1', kind: 'permission', label: 'Synthetic approval', text: 'What do you want to do?', detail: 'Isolated read-back fixture; no provider or terminal receives input.', options: [{ key: '1', label: 'Stop and wait' }, { key: '2', label: 'Switch to usage credits' }], promptState: 'active', at: Date.now() };
  const reminder = { id: 'synthetic-history', role: 'reminder', card: card.id, text: 'Historical synthetic prompt reminder', at: card.at };
  const sent = [], apiPaths = [], errors = [];
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== base.origin) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    apiPaths.push(url.pathname);
    let body = { ok: true, bots: [], panes: [], routines: [], groups: [], folders: [], terminals: [], skills: [], asks: [], items: [], messages: [], v: 'isolated-prompt-fixture' };
    if (url.pathname === '/api/bot') body = { bot, messages: [card, reminder], asks: [], requirements: [], tryNow: [], details: {} };
    if (url.pathname === '/api/bots') body = { bots: [bot], models: {} };
    if (url.pathname === '/api/send') { sent.push(JSON.parse(route.request().postData())); body = { stale: true, error: 'Synthetic prompt closed' }; }
    return route.fulfill({ status: url.pathname === '/api/send' ? 409 : 200, json: body });
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(String(error)));
  try {
    const loaded = await page.goto(new URL('/#bot:synthetic-prompt-readback', base).href);
    assert.equal(loaded.status(), 200);
    assert.equal(hash(await loaded.body()), appHash, 'headless browser loaded the exact live authenticated HTML');
    await page.waitForSelector('.term-ask-pinned [data-term-choice="1"]');
    card = { ...card, settled: true, promptState: 'resolved' };
    await page.waitForFunction(() => !document.querySelector('.term-ask-pinned') && document.querySelector('[data-term-ask="synthetic-card"]')?.classList.contains('ended'));
    assert.equal(await page.locator('.reminder-jump').count(), 0);
    assert.match(await page.locator('.bot-reminder').innerText(), /Historical synthetic prompt reminder/);
    card = { ...card, settled: false, askId: 'synthetic-ask-2', promptState: 'unknown' };
    await page.waitForFunction(() => /Checking whether/.test(document.querySelector('[data-term-ask="synthetic-card"]')?.textContent || ''));
    assert.equal(await page.locator('.term-ask-pinned').count(), 0);
    assert.equal(await page.locator('[data-term-ask="synthetic-card"] button').count(), 0);
    card = { ...card, promptState: 'active', detail: 'Fresh complete replacement context' };
    await page.waitForSelector('.term-ask-pinned [data-ask="synthetic-ask-2"] [data-term-choice="1"]:not([disabled])');
    assert.match(await page.locator('.term-ask-pinned').innerText(), /Fresh complete replacement context/);
    await page.locator('.term-ask-pinned [data-term-choice="1"]').click();
    await page.waitForFunction(() => !document.querySelector('.term-ask-pinned'));
    assert.deepEqual(sent, [{ pane: card.pane, askId: 'synthetic-ask-2', choice: '1' }], 'input exists only in the intercepted synthetic transport');
    assert.deepEqual(errors, []);
    assert.ok(apiPaths.includes('/api/bot') && apiPaths.includes('/api/send'));
    console.log(JSON.stringify({ result: 'PASS', width, appHash, syntheticApiRequests: apiPaths.length, realApiRequests: 0, proofScope: 'actual served authenticated HTML; all browser APIs synthetic; no real bot or terminal interaction' }));
  } finally { await browser.close(); }
});
