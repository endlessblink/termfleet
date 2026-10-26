import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium, webkit } from 'playwright';

const source = fs.readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
const start = source.indexOf('function linkToast(');
const end = source.indexOf('// Native disclosures', start);
assert.ok(start > 0 && end > start, 'find the actual link-opening handler');
const handler = source.slice(start, end);
const base = 'http://127.0.0.1:42819';
const destination = `${base}/destination`;

async function fixture(browser, { embedded = false, touch = false, openerStatus = 200 } = {}) {
  const context = await browser.newContext({
    viewport: touch ? { width: 390, height: 844 } : { width: 1280, height: 800 },
    hasTouch: touch, isMobile: touch,
  });
  const opens = [];
  await context.route(`${base}/**`, async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/open-link') {
      opens.push(route.request().postDataJSON());
      return route.fulfill({ status: openerStatus, json: { ok: openerStatus === 200 } });
    }
    if (url.pathname === '/parent') return route.fulfill({
      contentType: 'text/html', body: '<iframe src="/chat" style="width:100%;height:700px"></iframe>',
    });
    return route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><title>Destination reached</title><main>Destination reached</main>' });
  });
  const page = await context.newPage();
  await page.goto(`${base}/${embedded ? 'parent' : 'chat'}`);
  const frame = embedded ? page.frames().find(f => f.parentFrame()) : page.mainFrame();
  await frame.waitForLoadState();
  await frame.evaluate(() => { document.body.innerHTML = '<div id="links"></div>'; });
  await frame.addScriptTag({ content: `
    const ui=(en)=>en;
    const esc=(value)=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    document.querySelector('#links').innerHTML = '<a class="msg-link" target="_blank" rel="noopener noreferrer" href="${destination}">Message link</a>';
    ${handler}
  ` });
  return { context, page, frame, opens };
}

test('embedded PC chat sends message clicks to the desktop opener', async t => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  for (const selector of ['a.msg-link']) {
    await t.test(selector, async () => {
      const { context, frame, opens } = await fixture(browser, { embedded: true });
      try {
        await frame.locator(selector).click();
        for (let i = 0; i < 20 && !opens.length; i++) await new Promise(r => setTimeout(r, 25));
        assert.deepEqual(opens, [{ url: destination }]);
        assert.equal(context.pages().length, 1, 'desktop opener must not also launch an iframe popup');
      } finally { await context.close(); }
    });
  }
});

test('failed desktop opening displays a useful error with copy instructions', async t => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const { context, frame } = await fixture(browser, { embedded: true, openerStatus: 503 });
  try {
    await frame.locator('a.msg-link').click();
    await frame.locator('.link-toast.show').waitFor({ timeout: 3000 });
    assert.match(await frame.locator('.link-toast.show').textContent(), /could not open|couldn't open|unable to open/i);
    assert.match(await frame.locator('.link-toast.show').textContent(), /copy/i);
  } finally { await context.close(); }
});

test('phone taps and desktop browser clicks open real destinations in new tabs', async t => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  for (const touch of [false, true]) {
    for (const selector of ['a.msg-link']) {
      await t.test(`${touch ? 'phone tap' : 'PC click'} ${selector}`, async () => {
        const { context, page, frame, opens } = await fixture(browser, { touch });
        try {
          const [popup] = await Promise.all([
            context.waitForEvent('page', { timeout: 10000 }),
            frame.locator(selector)[touch ? 'tap' : 'click'](),
          ]);
          await popup.waitForLoadState('domcontentloaded');
          assert.equal(popup.url(), destination);
          assert.equal(await popup.locator('main').textContent(), 'Destination reached');
          assert.equal(page.url(), `${base}/chat`, 'chat stays open');
          assert.deepEqual(opens, [], 'phone/browser must not open a link on the server PC');
        } finally { await context.close(); }
      });
    }
  }
});

test('WebKit phone taps open message destinations with the full touch handlers', async t => {
  if (!fs.existsSync(webkit.executablePath())) return t.skip('WebKit browser is not installed');
  const browser = await webkit.launch();
  t.after(() => browser.close());
  for (const selector of ['a.msg-link']) {
    await t.test(selector, async () => {
      const { context, page, frame, opens } = await fixture(browser, { touch: true });
      try {
        const [popup] = await Promise.all([
          context.waitForEvent('page', { timeout: 10000 }),
          frame.locator(selector).tap(),
        ]);
        await popup.waitForLoadState('domcontentloaded');
        assert.equal(popup.url(), destination);
        assert.equal(await popup.locator('main').textContent(), 'Destination reached');
        assert.equal(page.url(), `${base}/chat`);
        assert.deepEqual(opens, []);
      } finally { await context.close(); }
    });
  }
});

test('a phone long press opens the menu once and its Open link action still works', async t => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const { context, page, frame } = await fixture(browser, { touch: true });
  try {
    const box = await frame.locator('a.msg-link').boundingBox();
    const session = await context.newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }],
    });
    await frame.locator('.link-menu a').waitFor();
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    assert.equal(context.pages().length, 1, 'long press must not also navigate');
    const popupPromise = context.waitForEvent('page', { timeout: 3000 });
    await frame.locator('.link-menu a').tap();
    const popup = await popupPromise;
    await popup.waitForLoadState('domcontentloaded');
    assert.equal(popup.url(), destination);
    assert.equal(await popup.locator('main').textContent(), 'Destination reached');
  } finally { await context.close(); }
});
