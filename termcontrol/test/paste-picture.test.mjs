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

test('Paste picture opens the gallery chooser when there is no picture or the phone refuses', async () => {
  const browser = await chromium.launch();
  try {
    // A screenshot lives in the gallery, not on the clipboard: the picture chooser opens.
    for (const [mode, words] of [['text', /No picture/], ['denied', /would not let the app read the clipboard/]]) {
      const page = await fixture(browser, mode);
      await openMenu(page);
      const chooser = page.waitForEvent('filechooser', { timeout: 5000 });
      await page.locator('.paste-image').click();
      await chooser;
      await page.locator('.sendstate').filter({ hasText: words }).waitFor({ timeout: 5000 });
      assert.equal(await page.locator('.attached').isHidden(), true);
      await page.close();
    }
  } finally { await browser.close(); }
});

test('bot chats: the Paste picture button adds the copied picture as a tile, and explains a refusal', async () => {
  const browser = await chromium.launch();
  try {
    for (const [mode, expectTile] of [['picture', true], ['text', false], ['denied', false]]) {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
      await page.addInitScript((m) => {
        const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6lLQAAAAASUVORK5CYII='), (c) => c.charCodeAt(0));
        const read = m === 'picture' ? async () => [{ types: ['image/png'], getType: async () => new Blob([png], { type: 'image/png' }) }]
          : m === 'text' ? async () => [{ types: ['text/plain'], getType: async () => new Blob(['words'], { type: 'text/plain' }) }]
            : async () => { throw Object.assign(new Error('denied'), { name: 'NotAllowedError' }); };
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { read, writeText: async () => {} } });
      }, mode);
      const bot = { id: 'abcdef012345', name: 'Quill', job: '', provider: 'claude', fallback: 'codex', active: 'claude', state: 'idle', health: { level: 'ok', text: 'Ready' }, messages: [], helpers: [], memoryPending: 0, notify: true, pinned: false, hidden: false };
      await page.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html });
        if (url.pathname === '/api/panes') return route.fulfill({ json: { daemon: true, panes: [], view: 'manual' } });
        if (url.pathname === '/api/bots') return route.fulfill({ json: { bots: [bot], providers: ['claude', 'codex'], models: {} } });
        if (url.pathname === '/api/bot') return route.fulfill({ json: { bot, messages: [], asks: null } });
        return route.fulfill({ json: {} });
      });
      await page.goto('https://termcontrol.test/#bot:abcdef012345');
      await page.locator('.bot-composer .bot-paste').waitFor({ timeout: 10000 });
      if (expectTile) await page.locator('.bot-composer .bot-paste').click();
      if (expectTile) await page.locator('.bot-pics .bot-pic').waitFor({ timeout: 6000 });
      else {
        const chooser = page.waitForEvent('filechooser', { timeout: 5000 });
        await page.locator('.bot-composer .bot-paste').click();
        await chooser;
        await page.locator('.sendstate').filter({ hasText: mode === 'text' ? /No picture/ : /would not let the app read the clipboard/ }).waitFor({ timeout: 5000 });
        assert.equal(await page.locator('.bot-pics .bot-pic').count(), 0);
      }
      await page.close();
    }
  } finally { await browser.close(); }
});

// Noam 2026-10-19: "cant paste text here". Copying from a web page or a chat app puts
// text AND a small picture on the clipboard; the picture handler used to swallow the text.
const MIXED = 'שורה ראשונה בעברית with English words\nשורה שנייה: https://example.com/path?x=1\n\n- נקודה אחת\n- point two\nסוף.';
const pasteEvent = (page, selector, { withText, withPicture }) => page.evaluate(({ selector, withText, withPicture, text }) => {
  const dt = new DataTransfer();
  if (withText) dt.setData('text/plain', text);
  if (withPicture) dt.items.add(new File([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))], 'shot.png', { type: 'image/png' }));
  const event = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
  document.querySelector(selector).dispatchEvent(event);
  return event.defaultPrevented;
}, { selector, withText, withPicture, text: MIXED });

async function botFixture(browser) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const bot = { id: 'abcdef012345', name: 'Quill', job: '', provider: 'claude', fallback: 'codex', active: 'claude', state: 'idle', health: { level: 'ok', text: 'Ready' }, messages: [], helpers: [], memoryPending: 0, notify: true, pinned: false, hidden: false };
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html });
    if (url.pathname === '/api/panes') return route.fulfill({ json: { daemon: true, panes: [], view: 'manual' } });
    if (url.pathname === '/api/bots') return route.fulfill({ json: { bots: [bot], providers: ['claude', 'codex'], models: {} } });
    if (url.pathname === '/api/bot') return route.fulfill({ json: { bot, messages: [], asks: null } });
    return route.fulfill({ json: {} });
  });
  await page.goto('https://termcontrol.test/#bot:abcdef012345');
  await page.locator('.bot-composer textarea').waitFor({ timeout: 10000 });
  return page;
}

test('bot chat: text on the clipboard is always pasted (even with a picture); a picture-only clipboard still becomes a picture', async () => {
  const browser = await chromium.launch();
  try {
    const page = await botFixture(browser);
    assert.equal(await pasteEvent(page, '.bot-composer textarea', { withText: true, withPicture: true }), false, 'the browser is left to paste the text');
    assert.equal(await page.locator('.bot-pic').count(), 0);
    assert.equal(await pasteEvent(page, '.bot-composer textarea', { withText: true, withPicture: false }), false);
    assert.equal(await pasteEvent(page, '.bot-composer textarea', { withText: false, withPicture: true }), true, 'picture only: taken as a picture');
    await page.locator('.bot-pic').waitFor({ timeout: 5000 });
    await page.close();
  } finally { await browser.close(); }
});

test('bot chat: a long multi-line Hebrew + English text really lands in the box (real clipboard, real Ctrl+V)', async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['clipboard-read', 'clipboard-write'] });
    await context.close();
    const page = await botFixture(browser);
    const big = Array.from({ length: 40 }, (_, i) => `${i}. ${MIXED}`).join('\n\n');
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://termcontrol.test' }).catch(() => {});
    await page.evaluate(async (text) => {
      const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([text], { type: 'text/plain' }), 'image/png': new Blob([png], { type: 'image/png' }) })]);
    }, big);
    await page.locator('.bot-composer textarea').click();
    await page.keyboard.press('Control+V');
    await page.waitForFunction((n) => document.querySelector('.bot-composer textarea').value.length === n, big.length, { timeout: 5000 });
    assert.equal(await page.inputValue('.bot-composer textarea'), big);
    assert.equal(await page.locator('.bot-pic').count(), 0);
    await page.close();
  } finally { await browser.close(); }
});

test('terminal chat: text on the clipboard is pasted even with a picture; a picture-only clipboard still attaches', async () => {
  const browser = await chromium.launch();
  try {
    const page = await fixture(browser, 'text');
    assert.equal(await pasteEvent(page, '.composer textarea', { withText: true, withPicture: true }), false);
    assert.equal(await page.locator('.attached').isHidden(), true);
    assert.equal(await pasteEvent(page, '.composer textarea', { withText: false, withPicture: true }), true);
    await page.locator('.attached .name').filter({ hasText: 'pasted image' }).waitFor({ timeout: 8000 });
    await page.close();
  } finally { await browser.close(); }
});

// The TermFleet desktop app's engine (WebKitGTK) fires the paste event for a copied picture
// with NO data in it; the clipboard API, asked from inside that event, still has the picture.
async function engineFixture(browser, { chat, clipboardTypes }) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  await page.addInitScript((types) => {
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
    const read = async () => [{ types, getType: async (t) => new Blob([t === 'image/png' ? png : 'words'], { type: t }) }];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { read, writeText: async () => {} } });
  }, clipboardTypes);
  const bot = { id: 'abcdef012345', name: 'Quill', job: '', provider: 'claude', fallback: 'codex', active: 'claude', state: 'idle', health: { level: 'ok', text: 'Ready' }, messages: [], helpers: [], memoryPending: 0, notify: true, pinned: false, hidden: false };
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html });
    if (url.pathname === '/api/panes') return route.fulfill({ json: { daemon: true, panes: [pane('a')], view: 'manual' } });
    if (url.pathname === '/api/feed') return route.fulfill({ json: { pane: pane('a'), events: [], reachedStart: true, producing: false } });
    if (url.pathname === '/api/bots') return route.fulfill({ json: { bots: chat === 'bot' ? [bot] : [], providers: ['claude', 'codex'], models: {} } });
    if (url.pathname === '/api/bot') return route.fulfill({ json: { bot, messages: [], asks: null } });
    return route.fulfill({ json: {} });
  });
  if (chat === 'bot') { await page.goto('https://termcontrol.test/#bot:abcdef012345'); await page.locator('.bot-composer textarea').waitFor({ timeout: 10000 }); }
  else { await page.goto('https://termcontrol.test/'); await page.locator('.pane[data-id="a"]').click(); await page.locator('.composer textarea').waitFor(); }
  return page;
}
const emptyPaste = (page, selector) => page.evaluate((selector) => {
  document.querySelector(selector).dispatchEvent(new ClipboardEvent('paste', { clipboardData: new DataTransfer(), bubbles: true, cancelable: true }));
}, selector);

test('desktop engine: an EMPTY paste event still brings a copied picture in (bot chat and terminal chat), but never when the clipboard also has text', async () => {
  const browser = await chromium.launch();
  try {
    let page = await engineFixture(browser, { chat: 'bot', clipboardTypes: ['image/png'] });
    await emptyPaste(page, '.bot-composer textarea');
    await page.locator('.bot-pic').waitFor({ timeout: 5000 });
    await page.close();
    page = await engineFixture(browser, { chat: 'bot', clipboardTypes: ['text/plain', 'image/png'] });
    await emptyPaste(page, '.bot-composer textarea');
    await page.waitForTimeout(500);
    assert.equal(await page.locator('.bot-pic').count(), 0, 'text on the clipboard wins');
    await page.close();
    page = await engineFixture(browser, { chat: 'terminal', clipboardTypes: ['image/png'] });
    await emptyPaste(page, '.composer textarea');
    await page.locator('.attached .name').filter({ hasText: 'pasted image' }).waitFor({ timeout: 8000 });
    await page.close();
  } finally { await browser.close(); }
});

// Noam 2026-10-23: "לא יכול להדביק תמונות בctrl+v". A picture FILE copied in the file
// manager reaches the page only as its address (text/uri-list, often repeated as
// text/plain); the desktop engine never hands over the file. The page loads each copied
// picture through the PC's own server, so it attaches exactly like the paperclip.
const uriPaste = (page, selector, uris, { plain = true } = {}) => page.evaluate(({ selector, uris, plain }) => {
  const dt = new DataTransfer();
  dt.setData('text/uri-list', uris.join('\r\n'));
  if (plain) dt.setData('text/plain', uris.join('\n'));
  const event = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
  document.querySelector(selector).dispatchEvent(event);
  return event.defaultPrevented;
}, { selector, uris, plain });
async function servePictures(page, asked) {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  await page.route('**/api/local-image*', (route) => {
    const url = new URL(route.request().url());
    asked.push({ path: url.searchParams.get('path'), paste: url.searchParams.get('paste') });
    return route.fulfill({ status: 200, contentType: 'image/png', body: png });
  });
}

test('bot chat: Ctrl+V of copied picture files attaches every one as a tile, and text paste is unchanged', async () => {
  const browser = await chromium.launch();
  try {
    const page = await botFixture(browser);
    const asked = [];
    await servePictures(page, asked);
    const prevented = await uriPaste(page, '.bot-composer textarea', ['file:///home/noam/Pictures/Screenshot%20one.png', 'file:///media/data/shot-2.JPG']);
    assert.equal(prevented, true, 'the address is not pasted as text');
    await page.waitForFunction(() => document.querySelectorAll('.bot-pic').length === 2, null, { timeout: 5000 });
    assert.deepEqual(asked.map((a) => a.path), ['/home/noam/Pictures/Screenshot one.png', '/media/data/shot-2.JPG']);
    assert.ok(asked.every((a) => a.paste === '1'));
    assert.equal(await page.inputValue('.bot-composer textarea'), '');
    // Each tile can be removed, like the paperclip's.
    await page.locator('.bot-pic button').first().click();
    assert.equal(await page.locator('.bot-pic').count(), 1);
    // A copied file that is not a picture, or ordinary words, stays a normal text paste.
    assert.equal(await uriPaste(page, '.bot-composer textarea', ['file:///home/noam/notes.txt']), false);
    assert.equal(await pasteEvent(page, '.bot-composer textarea', { withText: true, withPicture: false }), false);
    assert.equal(await page.locator('.bot-pic').count(), 1);
    await page.close();
  } finally { await browser.close(); }
});

test('terminal chat: Ctrl+V of a copied picture file attaches it', async () => {
  const browser = await chromium.launch();
  try {
    const page = await fixture(browser, 'text');
    await servePictures(page, []);
    assert.equal(await uriPaste(page, '.composer textarea', ['file:///home/noam/Pictures/shot.png'], { plain: false }), true);
    await page.locator('.attached .name').filter({ hasText: 'shot.png' }).waitFor({ timeout: 8000 });
    await page.close();
  } finally { await browser.close(); }
});

test('desktop engine: an EMPTY paste event brings in copied picture files and several pictures at once', async () => {
  const browser = await chromium.launch();
  try {
    // The clipboard holds copied files (addresses only).
    let page = await engineFixture(browser, { chat: 'bot', clipboardTypes: ['text/uri-list'] });
    await page.evaluate(() => {
      const read = async () => [{ types: ['text/uri-list', 'text/plain'], getType: async () => new Blob(['file:///home/noam/a.png\r\nfile:///home/noam/b.webp'], { type: 'text/plain' }) }];
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { read, writeText: async () => {} } });
    });
    await servePictures(page, []);
    await emptyPaste(page, '.bot-composer textarea');
    await page.waitForFunction(() => document.querySelectorAll('.bot-pic').length === 2, null, { timeout: 5000 });
    await page.close();
    // Two pictures on the clipboard: both arrive.
    page = await engineFixture(browser, { chat: 'bot', clipboardTypes: ['image/png'] });
    await page.evaluate(() => {
      const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
      const item = { types: ['image/png'], getType: async () => new Blob([png], { type: 'image/png' }) };
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { read: async () => [item, item], writeText: async () => {} } });
    });
    await emptyPaste(page, '.bot-composer textarea');
    await page.waitForFunction(() => document.querySelectorAll('.bot-pic').length === 2, null, { timeout: 5000 });
    await page.close();
  } finally { await browser.close(); }
});

// The desktop engine says "a file address is on the clipboard" but blanks the address
// itself (file links are hidden from web pages). The PC's own server then reads the
// copied files from the system clipboard.
const hiddenAddressPaste = (page, selector) => page.evaluate((selector) => {
  const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { types: ['text/uri-list'], items: [], files: [], getData: () => '' } });
  document.querySelector(selector).dispatchEvent(event);
}, selector);

test('desktop engine: copied picture files whose addresses the engine hides still attach, through the PC server', async () => {
  const browser = await chromium.launch();
  try {
    let page = await botFixture(browser);
    const asked = [];
    await servePictures(page, asked);
    await page.route('**/api/clipboard-files', (route) => route.fulfill({ json: { paths: ['/home/noam/Pictures/a.png', '/media/data/b.png'] } }));
    await hiddenAddressPaste(page, '.bot-composer textarea');
    await page.waitForFunction(() => document.querySelectorAll('.bot-pic').length === 2, null, { timeout: 5000 });
    assert.deepEqual(asked.map((a) => a.path), ['/home/noam/Pictures/a.png', '/media/data/b.png']);
    await page.close();
    page = await fixture(browser, 'text');
    await servePictures(page, []);
    await page.route('**/api/clipboard-files', (route) => route.fulfill({ json: { paths: ['/home/noam/Pictures/shot.png'] } }));
    await hiddenAddressPaste(page, '.composer textarea');
    await page.locator('.attached .name').filter({ hasText: 'shot.png' }).waitFor({ timeout: 8000 });
    await page.close();
  } finally { await browser.close(); }
});

// Noam 2026-10-23: "גם הדבקת צילום מסך עוד פעם לא עובדת". KDE's screenshot tool, with
// auto-save on, puts the picture AND the saved file's address on the clipboard. The PC
// engine then fires a paste with a blank address and refuses to hand over the picture
// itself (NotAllowedError) but does give the address; the picture must still attach.
test('bot and terminal chats: a saved screenshot (picture + its address, picture refused) still attaches', async () => {
  const browser = await chromium.launch();
  try {
    for (const where of ['bot', 'terminal']) {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
      await page.addInitScript(() => {
        const address = 'file:///home/noam/Pictures/Screenshots/Screenshot_20261023_164500.png';
        const item = { types: ['text/plain', 'text/uri-list', 'image/png'], getType: async (t) => { if (t === 'image/png') throw Object.assign(new Error('not allowed'), { name: 'NotAllowedError' }); return new Blob([address], { type: t }); } };
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { read: async () => [item], writeText: async () => {} } });
      });
      const asked = [];
      const bot = { id: 'abcdef012345', name: 'Quill', job: '', provider: 'claude', fallback: 'codex', active: 'claude', state: 'idle', health: { level: 'ok', text: 'Ready' }, messages: [], helpers: [], memoryPending: 0, notify: true, pinned: false, hidden: false };
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6lLQAAAAASUVORK5CYII=', 'base64');
      await page.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html });
        if (url.pathname === '/api/local-image') { asked.push(url.searchParams.get('path')); return route.fulfill({ contentType: 'image/png', body: png }); }
        if (url.pathname === '/api/clipboard-files') return route.fulfill({ json: { paths: [] } });   // the PC reads nothing
        if (url.pathname === '/api/panes') return route.fulfill({ json: { daemon: true, panes: [pane('a')], view: 'manual' } });
        if (url.pathname === '/api/feed') return route.fulfill({ json: { pane: pane('a'), events: [], reachedStart: true, producing: false } });
        if (url.pathname === '/api/bots') return route.fulfill({ json: { bots: where === 'bot' ? [bot] : [], providers: ['claude', 'codex'], models: {} } });
        if (url.pathname === '/api/bot') return route.fulfill({ json: { bot, messages: [], asks: null } });
        return route.fulfill({ json: {} });
      });
      if (where === 'bot') await page.goto('https://termcontrol.test/#bot:abcdef012345');
      else { await page.goto('https://termcontrol.test/'); await page.locator('.pane[data-id="a"]').click(); }
      const box = where === 'bot' ? '.bot-composer textarea' : '.composer textarea';
      await page.locator(box).waitFor({ timeout: 10000 });
      // What the engine fires: the address type is listed, its value blank, no files.
      const prevented = await page.evaluate((sel) => {
        const cd = { types: ['text/uri-list'], files: [], items: [], getData: () => '' };
        const e = new Event('paste', { bubbles: true, cancelable: true }); Object.defineProperty(e, 'clipboardData', { value: cd });
        document.querySelector(sel).dispatchEvent(e); return e.defaultPrevented;
      }, box);
      assert.equal(prevented, true);
      if (where === 'bot') await page.locator('.bot-pics .bot-pic img').waitFor({ timeout: 6000 });
      else await page.locator('.attached:not([hidden])').waitFor({ timeout: 6000 });
      assert.deepEqual(asked, ['/home/noam/Pictures/Screenshots/Screenshot_20261023_164500.png']);
      await page.close();
    }
  } finally { await browser.close(); }
});
