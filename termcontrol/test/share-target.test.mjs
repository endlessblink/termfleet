// Noam 2026-10-19: "maybe add TermFleet as a Share option?" The phone's Share sheet posts
// a picture to /share; the app's worker keeps it locally, the app asks which chat gets it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function withApp(run) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-share-'));
  const configDir = path.join(tmp, 'cfg'), botsHome = path.join(tmp, 'home');
  for (const d of [configDir, botsHome]) fs.mkdirSync(d, { recursive: true });
  const port = 7400 + Math.floor(Math.random() * 90);
  const child = spawn(process.execPath, [path.join(path.resolve('.'), 'termcontrol/bridge/server.mjs')], { env: { ...process.env, TC_PORT: String(port), TC_CONFIG_DIR: configDir, TC_HOST: '127.0.0.1', TC_BOTS_HOME: botsHome, TC_NO_AGENT_HEALTH: '1', TC_DESK_STT: '0' }, stdio: 'ignore' });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 80; i++) { try { await fetch(`http://127.0.0.1:${port}/login`); break; } catch { await wait(150); } }
  const browser = await chromium.launch();
  try { await run({ browser, port, base: `http://localhost:${port}` }); }
  finally { await browser.close(); child.kill('SIGKILL'); fs.rmSync(tmp, { recursive: true, force: true }); }
}

async function signedIn(browser, base) {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true })).newPage();
  await page.goto(base + '/');
  await page.evaluate(() => { const e = document.querySelector('#email'); if (e) e.value = 'owner@example.test'; document.querySelector('#password').value = 'a-good-password'; document.querySelector('form').requestSubmit(); });
  await page.waitForFunction(() => document.querySelector('.fleet-tabs'), null, { timeout: 20000, polling: 250 });
  return page;
}

// What Android's Share sheet does: a multipart POST of the picture to /share.
const shareFromPhone = (page) => page.evaluate(() => {
  const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6lLQAAAAASUVORK5CYII='), (c) => c.charCodeAt(0));
  const form = document.createElement('form'); form.method = 'POST'; form.action = '/share'; form.enctype = 'multipart/form-data';
  const input = document.createElement('input'); input.type = 'file'; input.name = 'image';
  const data = new DataTransfer(); data.items.add(new File([png], 'Screenshot_1.png', { type: 'image/png' })); input.files = data.files;
  form.append(input); document.body.append(form); form.submit();
});

test('the manifest offers TermControl in the Share sheet for pictures', async () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../app/manifest.webmanifest', import.meta.url), 'utf8'));
  assert.equal(manifest.share_target.action, '/share');
  assert.equal(manifest.share_target.method, 'POST');
  assert.equal(manifest.share_target.enctype, 'multipart/form-data');
  assert.deepEqual(manifest.share_target.params.files, [{ name: 'image', accept: ['image/*'] }]);
});

test('without an active worker a share POST never ends on an error page', async () => {
  await withApp(async ({ port }) => {
    const res = await fetch(`http://127.0.0.1:${port}/share`, { method: 'POST', redirect: 'manual', body: 'x' });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), '/?share=0');
  });
});

test('a shared picture asks which chat gets it, then lands in that bot chat ready to send; cancel throws it away', { timeout: 120000 }, async () => {
  await withApp(async ({ browser, base }) => {
    const page = await signedIn(browser, base);
    const botId = await page.evaluate(async () => (await (await fetch('/api/bots', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Share test' }) })).json()).bot.id);
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 15000, polling: 250 });

    await shareFromPhone(page);
    await page.waitForSelector('.share-dialog .share-thumbs img', { timeout: 15000 });
    assert.equal(await page.locator('.share-dialog .share-thumbs img').count(), 1);
    assert.equal(new URL(page.url()).search, '', 'the share marker is removed from the address');
    // Cancel: nothing is kept.
    await page.locator('.share-dialog .room-cancel').click();
    await page.waitForFunction(async () => (await (await caches.open('share-inbox')).keys()).length === 0, null, { timeout: 5000, polling: 100 });

    // Share again and pick the bot.
    await shareFromPhone(page);
    await page.waitForSelector('.share-dialog .share-row[data-kind=bot]', { timeout: 15000 });
    await page.locator(`.share-dialog .share-row[data-id="${botId}"]`).click();
    await page.waitForSelector('.bot-composer .bot-pics .bot-pic', { timeout: 10000 });
    assert.equal(await page.locator('.bot-composer .bot-pics .bot-pic').count(), 1);
    assert.equal(new URL(page.url()).hash, `#bot:${botId}`);
    await page.waitForFunction(async () => (await (await caches.open('share-inbox')).keys()).length === 0, null, { timeout: 5000, polling: 100 });   // the local copy is cleared once handed over
    await page.context().close();
  });
});

test('a shared picture can also go to a terminal agent chat (when one is open)', { timeout: 120000 }, async (ctx) => {
  await withApp(async ({ browser, base }) => {
    const page = await signedIn(browser, base);
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 15000, polling: 250 });
    await shareFromPhone(page);
    await page.waitForSelector('.share-dialog', { timeout: 15000 });
    const rows = page.locator('.share-dialog .share-row[data-kind=pane]');
    if (!(await rows.count())) { await page.locator('.share-dialog .room-cancel').click(); return ctx.skip('no terminal agent chat is open on this machine'); }
    await rows.first().click();
    await page.locator('.composer .attached .name').filter({ hasText: 'Screenshot_1.png' }).waitFor({ timeout: 15000 });
    await page.context().close();
  });
});

// Noam 2026-10-20: "see it as a share option, then ask which agent to send to". A shared
// link or text goes into the chosen bot's message box, ready to edit and send.
test('the manifest names the app TermFleet and accepts shared links and text', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../app/manifest.webmanifest', import.meta.url), 'utf8'));
  assert.equal(manifest.name, 'TermFleet');
  assert.equal(manifest.share_target.params.text, 'text');
  assert.equal(manifest.share_target.params.url, 'url');
  assert.equal(manifest.share_target.params.title, 'title');
});

test('a shared link asks which bot gets it, then waits in that bot\'s message box', { timeout: 120000 }, async () => {
  await withApp(async ({ browser, base }) => {
    const page = await signedIn(browser, base);
    const botId = await page.evaluate(async () => (await (await fetch('/api/bots', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Link test' }) })).json()).bot.id);
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 15000, polling: 250 });
    await page.evaluate(() => {
      const form = document.createElement('form'); form.method = 'POST'; form.action = '/share'; form.enctype = 'multipart/form-data';
      for (const [k, v] of [['title', 'Senior Motion Designer'], ['text', 'Senior Motion Designer'], ['url', 'https://example.test/jobs/42']]) { const i = document.createElement('input'); i.name = k; i.value = v; form.append(i); }
      document.body.append(form); form.submit();
    });
    await page.waitForSelector('.share-dialog .share-words', { timeout: 15000 });
    assert.equal(await page.locator('.share-dialog .share-words').innerText(), 'Senior Motion Designer\nhttps://example.test/jobs/42');
    await page.locator(`.share-dialog .share-row[data-id="${botId}"]`).click();
    await page.waitForFunction(() => document.querySelector('.bot-composer textarea')?.value.includes('https://example.test/jobs/42'), null, { timeout: 10000, polling: 200 });
    assert.equal(await page.locator('.bot-composer textarea').inputValue(), 'Senior Motion Designer\nhttps://example.test/jobs/42');
    assert.equal(await page.locator('.bot-composer button.send').isDisabled(), false);
    await page.waitForFunction(async () => (await (await caches.open('share-inbox')).keys()).length === 0, null, { timeout: 5000, polling: 100 });
    await page.context().close();
  });
});
