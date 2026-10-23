// Noam 2026-10-23: "want to drag these here -" / "and cant right now". Files dragged from
// the file manager (Dolphin: several .md and .mjs files) onto a bot chat's message box
// attach like the paperclip: pictures as tiles, other files as name+size chips, and the
// bot is handed every file. The desktop engine gives real files, or only their
// file:// addresses (text/uri-list), which the PC's own server reads.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Bots } from '../bridge/bots.mjs';
import { resolveLocalFile } from '../bridge/local-image.mjs';

const repo = path.resolve('.');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tc-drop-'));

test('a dropped file is kept under its own name; empty and oversized files are refused', async () => {
  const dir = tmp();
  process.env.TC_UPLOAD_DIR = dir;
  const { saveFile, fileName } = await import(`../bridge/uploads.mjs?drop=${Date.now()}`);
  const saved = saveFile({ name: 'rough-cut-mac-full-report.md', body: Buffer.from('# report') });
  assert.equal(saved.ok, true);
  assert.equal(path.basename(saved.path), 'rough-cut-mac-full-report.md');
  assert.ok(saved.path.startsWith(path.join(dir, 'files') + path.sep));
  assert.equal(fs.readFileSync(saved.path, 'utf8'), '# report');
  assert.equal(fileName('../../etc/passwd'), 'passwd');
  assert.equal(fileName('..'), 'file');
  assert.match(saveFile({ name: 'a.md', body: Buffer.alloc(0) }).error, /empty/);
  assert.match(saveFile({ name: 'a.bin', body: Buffer.alloc(25 * 1024 * 1024 + 1) }).error, /25 MB/);
  delete process.env.TC_UPLOAD_DIR;
});

test('the PC reads a dropped address only inside the allowed places, never a folder', () => {
  const home = tmp();
  const file = path.join(home, 'notes.mjs');
  fs.writeFileSync(file, 'export {}');
  assert.equal(resolveLocalFile(file, { home, roots: [home] }).file, fs.realpathSync(file));
  assert.equal(resolveLocalFile(file, { home, roots: [home] }).type, 'application/octet-stream');
  assert.equal(resolveLocalFile(home, { home, roots: [home] }), null, 'a folder is not a file');
  assert.equal(resolveLocalFile('/etc/hostname', { home, roots: [home] }), null);
  assert.equal(resolveLocalFile('relative.md', { home, roots: [home] }), null);
});

test('the bot is handed every attached file and the chat names them', async () => {
  const up = tmp(), seen = [];
  const home = tmp();
  for (const d of ['.claude', '.codex']) fs.mkdirSync(path.join(home, d), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', '.credentials.json'), '{}');
  fs.writeFileSync(path.join(home, '.codex', 'auth.json'), '{}');
  fs.writeFileSync(path.join(home, 'daemon.sock'), '');
  const bots = new Bots({ checks: { home, socket: path.join(home, 'daemon.sock') }, dir: tmp(), run: async (bot, text) => { seen.push(text); return { text: 'ok' }; } });
  bots.picturesDir = up;
  const { bot } = bots.create({ name: 'Dropper', cwd: os.tmpdir() });
  fs.mkdirSync(path.join(up, 'files', 'x'), { recursive: true });
  const md = path.join(up, 'files', 'x', 'report.md'); fs.writeFileSync(md, '# hi');
  assert.match(bots.send(bot.id, '', { files: ['/etc/hostname'] }).error, /file could not be found/);
  assert.equal(bots.send(bot.id, '', { files: [md] }).ok, true);
  for (let i = 0; i < 200 && bots.running.has(bot.id); i++) await wait(5);
  assert.ok(seen.some((t) => t.includes(`Noam attached 1 file`) && t.includes(md)), 'the bot was not handed the file');
  const mine = bots.view(bot.id).messages.find((m) => m.role === 'operator');
  assert.deepEqual(mine.files, ['report.md']);
  assert.equal(mine.text, 'Here is a file.');
});

function startBridge() {
  const root = tmp();
  const configDir = path.join(root, 'cfg'), botsHome = path.join(root, 'home'), uploads = path.join(root, 'up');
  for (const d of [configDir, botsHome, uploads]) fs.mkdirSync(d, { recursive: true });
  const port = 7900 + Math.floor(Math.random() * 300);
  // The brain is /bin/false: no model is ever called.
  const child = spawn(process.execPath, [path.join(repo, 'termcontrol/bridge/server.mjs')], { env: { ...process.env, TC_PORT: String(port), TC_CONFIG_DIR: configDir, TC_HOST: '127.0.0.1', TC_BOTS_HOME: botsHome, TC_UPLOAD_DIR: uploads, TC_CLAUDE_BIN: '/bin/false', TC_CODEX_BIN: '/bin/false', TC_NO_AGENT_HEALTH: '1' }, stdio: 'ignore' });
  return { configDir, uploads, port, stop: () => { child.kill('SIGKILL'); fs.rmSync(root, { recursive: true, force: true }); } };
}
async function ready(port) { for (let i = 0; i < 80; i++) { try { await fetch(`http://127.0.0.1:${port}/login`); return; } catch { await wait(150); } } }

async function openBotChat(browser, base) {
  const p = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await p.addInitScript(() => localStorage.setItem('termcontrol-fleet-tab', 'bots'));
  const errors = []; p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(base + '/');
  await p.evaluate(() => { const e = document.querySelector('#email'); if (e) e.value = 'owner@example.test'; document.querySelector('#password').value = 'a-good-password'; document.querySelector('form').requestSubmit(); });
  await p.waitForFunction(() => document.querySelector('.bots-home'), null, { timeout: 20000, polling: 250 });
  const id = await p.evaluate(async () => { const r = await fetch('/api/bots', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Drop test' }) }); return (await r.json()).bot.id; });
  await p.evaluate((bid) => { location.hash = 'bot:' + bid; }, id);
  await p.waitForSelector('.bot-composer textarea', { timeout: 15000 });
  return { p, id, errors };
}

// A drag from the file manager, as the page sees it: enter, hover, then drop.
const dragFiles = (p, spec) => p.evaluate(async ({ files = [], uris = '' }) => {
  const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6lLQAAAAASUVORK5CYII='), (c) => c.charCodeAt(0));
  const dt = new DataTransfer();
  for (const f of files) dt.items.add(f.png ? new File([png], f.name, { type: 'image/png' }) : new File([f.text], f.name, { type: f.type || '' }));
  if (uris) dt.setData('text/uri-list', uris);
  const target = document.querySelector('.bot-composer textarea'), bar = document.querySelector('.bot-composer');
  target.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }));
  target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
  const lit = bar.classList.contains('dropping'), hint = getComputedStyle(bar, '::after').content;
  const drop = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt });
  target.dispatchEvent(drop);
  return { lit, hint, prevented: drop.defaultPrevented, litAfter: bar.classList.contains('dropping') };
}, spec);

test('files dropped on the bot message box attach as chips and tiles, and all reach the bot', { timeout: 90000 }, async () => {
  const b = startBridge(), base = `http://localhost:${b.port}`;
  await ready(b.port);
  const browser = await chromium.launch();
  try {
    const { p, id, errors } = await openBotChat(browser, base);
    const drag = await dragFiles(p, { files: [{ name: 'rough-cut-mac-full-report.md', text: '# full report\n'.repeat(700) }, { name: 'rough-cut-index.mjs.patched', text: 'export const x = 1;\n' }, { name: 'shot.png', png: true }] });
    assert.equal(drag.lit, true, 'the box did not light up while dragging');
    assert.match(drag.hint, /Drop files to attach/);
    assert.equal(drag.prevented, true, 'the drop was left to the browser (it would open the file)');
    assert.equal(drag.litAfter, false);
    await p.waitForFunction(() => document.querySelectorAll('.bot-pic').length === 3, null, { timeout: 5000 });
    const chips = await p.$$eval('.bot-file', (els) => els.map((e) => e.textContent));
    assert.equal(chips.length, 2);
    assert.match(chips[0], /rough-cut-mac-full-report\.md/);
    assert.match(chips[0], /9\.6 KB/);
    assert.equal(await p.locator('.bot-pic img').count(), 1, 'the picture gets a preview');
    await p.screenshot({ path: path.join(os.tmpdir(), 'tc-drop-chips.png') });

    // Remove the .mjs chip, then send.
    await p.locator('.bot-file').nth(1).locator('button').click();
    assert.equal(await p.locator('.bot-pic').count(), 2);
    assert.equal(await p.locator('.bot-composer .send').isDisabled(), false);
    await p.locator('.bot-composer .send').click();
    await p.waitForFunction(() => !document.querySelector('.bot-pic'), null, { timeout: 20000, polling: 200 });
    await wait(600);
    const kept = fs.readdirSync(path.join(b.uploads, 'files')).flatMap((d) => fs.readdirSync(path.join(b.uploads, 'files', d)));
    assert.deepEqual(kept, ['rough-cut-mac-full-report.md']);
    const chat = fs.readFileSync(path.join(b.configDir, 'bots', id, 'chat.jsonl'), 'utf8');
    assert.match(chat, /"role":"operator"[^\n]*"images":1[^\n]*"files":\["rough-cut-mac-full-report.md"\]/);
    await p.waitForFunction(() => document.body.textContent.includes('📎 rough-cut-mac-full-report.md'), null, { timeout: 8000 });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); b.stop(); }
});

test('a drop that carries only file addresses is read on the PC; too-big files are refused plainly', { timeout: 90000 }, async () => {
  const b = startBridge(), base = `http://localhost:${b.port}`;
  await ready(b.port);
  const browser = await chromium.launch();
  try {
    const { p, errors } = await openBotChat(browser, base);
    // The bridge runs as this user, so a file under the system temp folder is in reach.
    const src = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-drop-src-'));
    const a = path.join(src, 'cinema teaching journal (1).md'), big = path.join(src, 'huge.mkv');
    fs.writeFileSync(a, '# journal');
    fs.writeFileSync(big, Buffer.alloc(26 * 1024 * 1024));
    const uris = [a, big].map((f) => 'file://' + encodeURI(f)).join('\r\n');
    await dragFiles(p, { uris });
    await p.waitForFunction(() => document.querySelectorAll('.bot-file').length === 1, null, { timeout: 8000 });
    assert.match(await p.locator('.bot-file').textContent(), /cinema teaching journal \(1\)\.md/);
    await p.locator('.sendstate').filter({ hasText: /huge\.mkv.*25 MB/ }).waitFor({ timeout: 5000 });
    // A file dropped outside the box never replaces the page.
    const outside = await p.evaluate(() => { const dt = new DataTransfer(); dt.items.add(new File(['x'], 'x.md')); const e = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }); document.querySelector('main').dispatchEvent(e); return e.defaultPrevented; });
    assert.equal(outside, true);
    assert.deepEqual(errors, []);
    fs.rmSync(src, { recursive: true, force: true });
  } finally { await browser.close(); b.stop(); }
});

// Inside the PC app the engine hides dropped files from the page (WebKitGTK gives a blank
// address list and only the first address as text), so the app catches the drop and posts
// {termfleetDrop, x, y, paths} to the chat frame. Several files must all arrive.
test('in the PC app frame: the app passes the drop on and every file attaches; only its own frame parent counts', { timeout: 90000 }, async () => {
  const b = startBridge(), base = `http://localhost:${b.port}`;
  await ready(b.port);
  const browser = await chromium.launch();
  try {
    const { p, id, errors } = await openBotChat(browser, base);
    const src = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-drop-app-'));
    const files = ['rough-cut-mac-full-report.md', 'rough-cut-index.mjs.patched', 'rough-caut-mac-full-report.md'].map((n) => path.join(src, n));
    files.forEach((f, i) => fs.writeFileSync(f, `# file ${i}\n`));
    // The app around the chat: same page, in a frame, as the PC app shows it.
    await p.evaluate((url) => { document.open(); document.write(`<iframe src="${url}" style="position:fixed;left:40px;top:30px;width:1200px;height:740px;border:0"></iframe>`); document.close(); }, `${base}/#bot:${id}`);
    const frame = await (await p.waitForSelector('iframe')).contentFrame();
    await frame.waitForSelector('.bot-composer textarea', { timeout: 15000 });
    const box = await frame.$eval('.bot-composer textarea', (t) => { const r = t.getBoundingClientRect(); return { x: r.left + 20, y: r.top + 10 }; });
    // A page that is not the frame's parent is ignored.
    await frame.evaluate((at) => window.postMessage({ termfleetDrop: 'drop', ...at, paths: ['/etc/hostname'] }, '*'), box);
    const post = (msg) => p.evaluate((m) => document.querySelector('iframe').contentWindow.postMessage(m, '*'), msg);
    await post({ termfleetDrop: 'enter', ...box, paths: files });
    assert.equal(await frame.$eval('.bot-composer', (el) => el.classList.contains('dropping')), true, 'the box did not light up');
    await post({ termfleetDrop: 'leave', x: -1, y: -1, paths: [] });
    assert.equal(await frame.$eval('.bot-composer', (el) => el.classList.contains('dropping')), false);
    await post({ termfleetDrop: 'drop', ...box, paths: files });
    await frame.waitForFunction(() => document.querySelectorAll('.bot-file').length === 3, null, { timeout: 8000 });
    assert.deepEqual(await frame.$$eval('.bot-file .bot-file-name', (els) => els.map((e) => e.textContent)), files.map((f) => path.basename(f)));
    await frame.locator('.bot-composer .send').click();
    await frame.waitForFunction(() => !document.querySelector('.bot-pic'), null, { timeout: 20000, polling: 200 });
    await wait(600);
    const chat = fs.readFileSync(path.join(b.configDir, 'bots', id, 'chat.jsonl'), 'utf8');
    assert.match(chat, /"files":\["rough-cut-mac-full-report.md","rough-cut-index.mjs.patched","rough-caut-mac-full-report.md"\]/);
    assert.deepEqual(errors, []);
    fs.rmSync(src, { recursive: true, force: true });
  } finally { await browser.close(); b.stop(); }
});
