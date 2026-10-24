// Sidebar folders, the Archive and New messages on top (Noam 2026-10-24: R-7369, R-7385, R-7386,
// R-7387, R-7399). The store is the bridge's own; the page is the real app with a faked bridge.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { ListFolders, isArchived } from '../bridge/list-folders.mjs';

const html = fs.readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'list-folders-')), 'list-folders.json');
const DAY = 86400_000;

test('the store keeps folders, categories and bring-back per owner, with plain errors', () => {
  const store = new ListFolders(tmpFile());
  let s = store.apply('noam', { op: 'create', name: 'Studio', pane: 'p1' });
  const studio = s.folders[0].id;
  assert.equal(s.members.p1, studio);
  assert.throws(() => store.apply('noam', { op: 'create', name: ' studio ' }), /already a folder called "studio"/);
  assert.throws(() => store.apply('noam', { op: 'create', name: '   ' }), /Give the folder a name/);
  s = store.apply('noam', { op: 'create', name: 'Later' });
  s = store.apply('noam', { op: 'order', id: s.folders[1].id, direction: 'up' });
  assert.deepEqual(s.folders.map((f) => f.name), ['Later', 'Studio']);
  s = store.apply('noam', { op: 'catCreate', name: 'Clients', pane: 'p2' });
  assert.equal(s.archiveCat.p2, s.archiveCats[0].id);
  s = store.apply('noam', { op: 'catRemove', id: s.archiveCats[0].id });
  assert.deepEqual([s.archiveCats.length, s.archiveCat.p2], [0, undefined], 'its chats go back to Not sorted yet');
  s = store.apply('noam', { op: 'remove', id: studio });
  assert.equal(s.members.p1, undefined, 'a removed folder sends its chats back to their project');
  assert.throws(() => store.apply('noam', { op: 'days', days: 3 }), /Choose 7, 14 or 30 days, or never/);
  assert.equal(store.read('noam').archiveDays, 7, '7 days unless changed');
  assert.deepEqual(store.read('someone-else').folders, [], 'per owner');
  s = store.apply('noam', { op: 'bringBack', pane: 'p9' }, 1234);
  assert.equal(s.keepActive.p9, 1234);
});

test('the Archive rule: quiet 7+ days, never when waiting for Noam, unread, working or unknown', () => {
  const now = Date.now(), s = { archiveDays: 7, keepActive: {} };
  const quiet = { id: 'q', turn: 'idle', lastActiveAt: now - 8 * DAY };
  assert.equal(isArchived(quiet, s, { now }), true);
  assert.equal(isArchived({ ...quiet, turn: 'waiting' }, s, { now }), false, 'waiting for his answer');
  assert.equal(isArchived({ ...quiet, attention: { kind: 'approval' } }, s, { now }), false, 'waiting for his approval');
  assert.equal(isArchived(quiet, s, { now, unread: true }), false, 'unread answer');
  assert.equal(isArchived({ ...quiet, turn: 'working' }, s, { now }), false);
  assert.equal(isArchived({ id: 'k', turn: 'idle' }, s, { now }), false, 'unknown activity');
  assert.equal(isArchived({ ...quiet, lastUsedAt: now - DAY }, s, { now }), false, 'opened yesterday');
  assert.equal(isArchived(quiet, { ...s, keepActive: { q: now - DAY } }, { now }), false, 'brought back');
  assert.equal(isArchived(quiet, { ...s, archiveDays: 0 }, { now }), false, 'turned off');
});

function fixture() {
  const now = Date.now(), ago = (d) => now - d * DAY;
  const base = { project: 'proj', provider: 'claude', alive: true, turn: 'idle', task: 'Synthetic task' };
  const panes = [
    { ...base, id: 'A', title: 'Recent work', lastActiveAt: ago(1), lastUsedAt: ago(1) },
    { ...base, id: 'W', title: 'Waits for you', turn: 'waiting', attention: { kind: 'approval', title: 'Allow it?' }, lastActiveAt: ago(20), lastUsedAt: ago(20) },
    { ...base, id: 'Q', title: 'Quiet twelve days', lastActiveAt: ago(12), lastUsedAt: ago(12) },
    { ...base, id: 'R', title: 'Old reference', lastActiveAt: ago(30), lastUsedAt: ago(30) },
    { ...base, id: 'U', title: 'Unread answer', lastActiveAt: ago(9), lastUsedAt: ago(10) },
    { ...base, id: 'K', title: 'Unknown age' },
  ];
  return panes;
}

async function openApp(browser, { phone = false, store, owner = 'noam' } = {}) {
  const context = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => { localStorage.setItem('termcontrol-fleet-tab', 'terminals'); localStorage.setItem('termcontrol-window', 'all'); });
  const panes = fixture();
  await page.route('http://folders.synthetic/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/') return route.fulfill({ body: html, contentType: 'text/html' });
    let data = {};
    if (url.pathname === '/api/panes') data = { panes, groups: [{ project: 'proj', panes }], daemon: true };
    if (url.pathname === '/api/bots') data = { bots: [] };
    if (url.pathname === '/api/waiting') data = { items: [] };
    if (url.pathname === '/api/list-folders') {
      if (route.request().method() === 'POST') {
        try { data = store.apply(owner, route.request().postDataJSON()); } catch (e) { return route.fulfill({ status: 400, json: { error: e.message } }); }
      } else data = store.read(owner);
    }
    return route.fulfill({ json: data });
  });
  await page.goto('http://folders.synthetic/');
  await page.waitForSelector('.pane');
  return { page, context, errors };
}

const ids = (page, sel) => page.locator(`${sel} .pane`).evaluateAll((els) => els.map((el) => el.dataset.id));

test('desktop: folders, drag onto a folder, the Archive with categories and bring back', async () => {
  const browser = await chromium.launch();
  const store = new ListFolders(tmpFile());
  store.apply('noam', { op: 'catCreate', name: 'References', pane: 'R' });
  try {
    const { page, context, errors } = await openApp(browser, { store });
    // Quiet 7+ days moved to the Archive (not hidden); waiting, unread, recent and unknown stayed.
    assert.equal(await page.locator('details[data-archive] > summary .count').textContent(), '2');
    await page.locator('details[data-archive] > summary').click();
    assert.deepEqual(await ids(page, '[data-archive-cat] '), ['R', 'Q']);
    assert.deepEqual(await ids(page, '[data-archive-cat=""]'), ['Q']);
    for (const id of ['A', 'W', 'U', 'K']) assert.equal(await page.locator(`details[data-archive] .pane[data-id="${id}"]`).count(), 0, `${id} stays out of the Archive`);
    assert.match(await page.locator('.archive-note').textContent(), /Quiet for 7 days or more/);

    // A folder from the bar, then a chat moved into it from its menu.
    await page.locator('.new-folder').click();
    await page.locator('.list-sheet input').fill('Studio');
    await page.locator('.list-sheet .sheet-primary').click();
    await page.waitForSelector('details[data-folder]');
    assert.match(await page.locator('details[data-folder] .folder-empty').textContent(), /Nothing here yet/);
    await page.locator('.pane[data-id="A"]').click({ button: 'right' });
    await page.locator('.pane-menu [data-move-folder]').click();
    await page.locator('.list-sheet [data-to]').first().click();
    await page.waitForSelector('details[data-folder] .pane[data-id="A"]');
    // Drag on a computer does the same.
    await page.locator('.pane[data-id="K"]').dragTo(page.locator('details[data-folder] > summary'));
    await page.waitForSelector('details[data-folder] .pane[data-id="K"]');
    const fid = store.read('noam').folders[0].id;
    assert.deepEqual([store.read('noam').members.A, store.read('noam').members.K], [fid, fid], 'saved on the bridge, so the phone sees it too');

    // Bring a chat back from the Archive.
    await page.locator('details[data-archive] .pane[data-id="Q"]').click({ button: 'right' });
    await page.locator('.pane-menu [data-bring-back]').click();
    await page.waitForFunction(() => !document.querySelector('details[data-archive] .pane[data-id="Q"]') && document.querySelector('.pane[data-id="Q"]'));
    // A waiting chat never gets archive actions.
    await page.locator('.pane[data-id="W"]').first().click({ button: 'right' });
    assert.equal(await page.locator('.pane-menu [data-bring-back]').count(), 0);
    await page.keyboard.press('Escape');
    await page.screenshot({ path: path.join(os.tmpdir(), 'list-folders-desktop.png') });
    assert.deepEqual(errors, []);
    await context.close();
  } finally { await browser.close(); }
});

test('phone: chats with unread agent messages float to the top; folders and the Archive fit', async () => {
  const browser = await chromium.launch();
  const store = new ListFolders(tmpFile());
  const f = store.apply('noam', { op: 'create', name: 'Studio', pane: 'U' }).folders[0].id;
  try {
    const { page, context, errors } = await openApp(browser, { phone: true, store });
    assert.deepEqual(await ids(page, '.floated'), ['U'], 'unread on top, even though it is filed in Studio');
    assert.equal(await page.locator(`details[data-folder="${f}"] .pane[data-id="U"]`).count(), 0, 'shown once');
    const first = await page.locator('.fleet-content .pane').first().getAttribute('data-id');
    assert.ok(['U', 'W'].includes(first), `the unread chat sits above the folders and projects (first row ${first})`);
    assert.equal(await page.locator('.floated .pane[data-id="W"]').count(), 0, 'waiting chats stay in Needs you, not in New messages');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no sideways scroll');
    await page.locator('details[data-archive] > summary').click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(os.tmpdir(), 'list-folders-phone.png'), fullPage: true });
    // Collapse is saved on the bridge.
    await page.locator(`details[data-folder="${f}"] > summary`).click();
    await page.waitForFunction(() => true);
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(store.read('noam').folders[0].collapsed, true);
    assert.deepEqual(errors, []);
    await context.close();
  } finally { await browser.close(); }
});
