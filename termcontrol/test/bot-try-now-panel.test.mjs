import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { captureMessage, record } from '../bridge/requirements.mjs';

const html = fs.readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
function renderer() {
  const source = html.match(/function tryNowHtml\(items\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(source, 'chat needs a Try now renderer');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  return vm.runInNewContext(`(${source})`, { esc, ui: en => en, URL });
}
test('Try now keeps all ready items, their action and direct link together', () => {
  const render = renderer();
  assert.equal(render([]), '');
  const items = Array.from({ length: 83 }, (_, i) => ({ id: `R-${i + 1}`, words: `Owner request ${i + 1}`, tryText: `Choose fighter ${i + 1}`, link: `https://example.test/game?fighter=${i + 1}` }));
  const output = render(items);
  assert.equal((output.match(/class="try-now-item"/g) || []).length, 83);
  assert.match(output, /Try now.*83/);
  assert.match(output, /Choose fighter 83/);
  assert.match(output, /href="https:\/\/example.test\/game\?fighter=83"/);
  assert.match(html, /tryNowHtml\(data\.tryNow\)/, 'polling must render the canonical ready projection');
});
test('Try now escapes owner text and exposes missing legacy metadata without unsafe links', () => {
  const output = renderer()([{ id: 'R-1', words: '<script>bad</script>', tryText: '<img onerror=bad>', link: 'javascript:alert(1)' }, { id: 'R-2', words: 'Legacy ready item' }]);
  assert.doesNotMatch(output, /<script>|<img|href="javascript:/);
  assert.match(output, /&lt;script&gt;/);
  assert.match(output, /Testing link missing/);
  assert.match(output, /Testing instructions missing/);
  assert.match(output, /Legacy ready item/);
});
test('Try now list stays readable and scrollable at desktop and phone widths', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const css = html.split('\n').filter(line => line.startsWith('.try-now')).join('\n');
    const items = Array.from({ length: 83 }, (_, i) => ({ id: `R-${i + 1}`, words: `Ready owner request ${i + 1}`, tryText: 'Choose two fighters and start a match', link: `https://example.test/${'long-path-'.repeat(20)}${i}` }));
    for (const width of [1600, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await page.setContent(`<style>body{margin:16px;font-family:sans-serif}.chat{max-width:760px;margin:auto}${css}</style><div class="chat">${renderer()(items)}</div>`);
      assert.equal(await page.locator('.try-now-item').count(), 83);
      assert.equal(await page.locator('.try-now a').count(), 83);
      assert.ok(await page.locator('.try-now ul').evaluate(el => el.scrollHeight > el.clientHeight), 'all entries must remain accessible by vertical scrolling');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `no overflow at ${width}`);
      assert.ok(await page.locator('.try-now a').first().evaluate(el => el.getBoundingClientRect().height >= 44), 'links need a phone-sized target');
    }
  } finally { await browser.close(); }
});

test('authenticated chat shows every ready ledger item and its testing handoff', { timeout: 60000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-try-now-'));
  const configDir = path.join(tmp, 'cfg'), botsHome = path.join(tmp, 'home');
  fs.mkdirSync(configDir, { recursive: true }); fs.mkdirSync(botsHome);
  const port = 8000 + Math.floor(Math.random() * 1000), base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['termcontrol/bridge/server.mjs'], { env: { ...process.env, TC_PORT: String(port), TC_CONFIG_DIR: configDir, TC_HOST: '127.0.0.1', TC_BOTS_HOME: botsHome, TC_NO_AGENT_HEALTH: '1' }, stdio: 'ignore' });
  let browser;
  try {
    for (let i = 0; i < 80; i++) { try { await fetch(base + '/login'); break; } catch { await new Promise(r => setTimeout(r, 150)); } }
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await page.addInitScript(() => localStorage.setItem('termcontrol-fleet-tab', 'bots'));
    const errors = []; page.on('pageerror', e => errors.push(String(e)));
    await page.goto(base);
    await page.evaluate(() => { document.querySelector('#email').value = 'owner@example.test'; document.querySelector('#password').value = 'a-good-password'; document.querySelector('form').requestSubmit(); });
    await page.waitForSelector('.bots-home');
    const id = await page.evaluate(async () => (await (await fetch('/api/bots', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Ready testing regression' }) })).json()).bot.id);
    const dir = path.join(configDir, 'requirements');
    const items = captureMessage({ text: Array.from({ length: 83 }, (_, i) => `${i + 1}. Keep ready request ${i + 1} testable`).join('\n'), project: 'termfleet', source: `bot:${id}`, msgId: 'try-now-fixture' }, { dir });
    record(items.map((it, i) => ({ e: 'status', id: it.id, status: 'ready', evidence: i === 0 ? '' : `Try: Choose two fighters and start match ${i + 1} ${base}/login` })), { dir });
    await page.goto(base + '/#bot:' + id);
    await page.waitForFunction(() => document.querySelectorAll('.try-now-item').length === 83);
    assert.ok(await page.locator('.try-now').isVisible(), 'testing list must be in the visible chat, outside the hidden header');
    const api = await page.evaluate(async id => (await (await fetch('/api/bot?id=' + id)).json()).tryNow, id);
    assert.equal(api.length, 83, 'ready list must not inherit the 60-item requirements cap');
    assert.equal(await page.locator('.try-now a').count(), 82);
    assert.match(await page.locator('.try-now').innerText(), /Choose two fighters and start match 83/);
    assert.match(await page.locator('.try-now').innerText(), /Testing instructions missing|חסרות הוראות לבדיקה/);
    for (const width of [1600, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.locator('.try-now ul').evaluate(el => { el.scrollTop = 0; });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `authenticated chat must fit ${width}`);
      if (process.env.TC_TRY_SHOT_DIR) {
        fs.mkdirSync(process.env.TC_TRY_SHOT_DIR, { recursive: true });
        await page.screenshot({ path: path.join(process.env.TC_TRY_SHOT_DIR, `try-now-${width}.png`), fullPage: true });
      }
      await page.locator('.try-now ul').evaluate(el => { el.scrollTop = el.scrollHeight; });
      assert.ok(await page.locator('.try-now ul').evaluate(el => el.scrollTop > 0));
    }
    await page.locator('.try-now ul').evaluate(el => { el.scrollTop = 0; });
    const opened = page.waitForEvent('popup');
    await page.locator('.try-now a').first().click();
    const preview = await opened;
    await preview.waitForLoadState('domcontentloaded');
    assert.equal(preview.url(), base + '/login', 'Open must reach the tested preview link');
    await preview.close();
    assert.deepEqual(errors, []);
    console.log('Authenticated Try now: 83 ready ledger items, 82 direct links and actions, one explicit legacy gap; desktop and phone fit without overflow.');
  } finally { await browser?.close(); child.kill('SIGKILL'); fs.rmSync(tmp, { recursive: true, force: true }); }
});
