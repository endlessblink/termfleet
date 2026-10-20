// Noam 2026-10-20: "I need to see numbers on the dock too... one colour for agents and another
// for terminals, both shown". The dock icon carries an orange bots badge and a blue terminals badge.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDockIcon, dockIconSvg, withIcon, BOT_COLOUR, TERMINAL_COLOUR } from '../bridge/dock-icon.mjs';

const base = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#17313f"/></svg>\n';
const desktop = '[Desktop Entry]\nType=Application\nName=TermFleet\nIcon=termfleet\nStartupWMClass=Termfleet\n';
function setup() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-dock-'));
  const desktopFile = path.join(home, 'termfleet.desktop'), baseIcon = path.join(home, 'termfleet.svg'), dir = path.join(home, 'dock');
  fs.writeFileSync(desktopFile, desktop); fs.writeFileSync(baseIcon, base);
  const refreshes = [];
  const update = createDockIcon({ desktopFile, baseIcon, dir, refresh: async () => { refreshes.push(fs.readFileSync(desktopFile, 'utf8').match(/^Icon=(.*)$/m)[1]); } });
  return { desktopFile, dir, update, refreshes };
}

test('both counts are drawn, each in its own colour, and zero draws nothing', () => {
  const both = dockIconSvg(base, 3, 1);
  assert.ok(both.includes(`fill="${BOT_COLOUR}"`) && both.includes(`fill="${TERMINAL_COLOUR}"`));
  assert.match(both, />3<\/text>.*>1<\/text>/);
  assert.ok(!dockIconSvg(base, 0, 2).includes(BOT_COLOUR));
  assert.ok(!dockIconSvg(base, 4, 0).includes(TERMINAL_COLOUR));
  assert.equal(dockIconSvg(base, 0, 0), base);
  assert.match(dockIconSvg(base, 140, 0), />99\+<\/text>/);
  assert.equal(withIcon(desktop, '/x/y.svg').match(/^Icon=(.*)$/m)[1], '/x/y.svg');
});

test('the launcher follows the counts, refreshes only on change, and returns to the plain icon', async () => {
  const { desktopFile, dir, update, refreshes } = setup();
  assert.equal(await update(2, 1), true);
  const icon = path.join(dir, 'termfleet-b2-t1.svg');
  assert.ok(fs.existsSync(icon));
  assert.match(fs.readFileSync(desktopFile, 'utf8'), new RegExp(`^Icon=${icon}$`, 'm'));
  assert.match(fs.readFileSync(desktopFile, 'utf8'), /^StartupWMClass=Termfleet$/m, 'the rest of the launcher is kept');
  assert.equal(await update(2, 1), false, 'same counts: no rewrite, no refresh');
  await update(5, 1);
  assert.deepEqual(fs.readdirSync(dir), ['termfleet-b5-t1.svg'], 'old icons are cleaned up');
  await update(0, 0);
  assert.match(fs.readFileSync(desktopFile, 'utf8'), /^Icon=termfleet$/m);
  assert.deepEqual(fs.readdirSync(dir), []);
  assert.equal(refreshes.length, 3);
});

test('a reinstall that resets the launcher is corrected on the next check', async () => {
  const { desktopFile, update } = setup();
  await update(1, 0);
  fs.writeFileSync(desktopFile, desktop);
  assert.equal(await update(1, 0), true);
  assert.match(fs.readFileSync(desktopFile, 'utf8'), /termfleet-b1-t0\.svg/);
});

test('tests and copies of the service never touch the real launcher', () => {
  const src = fs.readFileSync(new URL('../bridge/server.mjs', import.meta.url), 'utf8');
  assert.match(src, /if \(!process\.env\.TC_CONFIG_DIR && process\.env\.TC_NO_DOCK_ICON !== '1'\)/);
});

// Noam: "also here I need to see the notifications per platform" (the Bots and Terminals tabs).
test('the tabs carry the dock counts: unread bot messages in orange, waiting terminals in blue', async () => {
  const { readFileSync } = await import('node:fs');
  const page = readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
  assert.match(page, /botsNeed=botList\.filter\(b=>!b\.hidden\)\.reduce\(\(n,b\)=>n\+\(Number\(b\.unread\)\|\|0\),0\)/);
  assert.match(page, /termsNeed=panes\.filter\(p=>p\.attention\)\.length/, 'a real question or approval, not a finished turn');
  assert.match(page, /\.tab-need-term\{background:var\(--terminals\)/);
  assert.match(page, /--terminals:#5aa9e6/);
});

// Noam: "the notifications don't update even though I already read those agents".
test('opening a bot chat clears its count on the dock within one check', async () => {
  const { Bots } = await import('../bridge/bots.mjs');
  const s = setup();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-dock-bots-'));
  for (const d of ['.claude', '.codex']) fs.mkdirSync(path.join(home, d));
  fs.writeFileSync(path.join(home, '.claude', '.credentials.json'), '{}');
  fs.writeFileSync(path.join(home, '.codex', 'auth.json'), '{}');
  fs.writeFileSync(path.join(home, 'daemon.sock'), '');
  let clock = 1000;
  const bots = new Bots({ checks: { home, socket: path.join(home, 'daemon.sock') }, dir: fs.mkdtempSync(path.join(os.tmpdir(), 'tf-dock-b-')), now: () => (clock += 10), notify: () => {}, run: async () => ({ text: 'Done.' }) });
  const { bot } = bots.create({ name: 'Reader', cwd: os.tmpdir() });
  bots.readAt(bot.id);
  bots.send(bot.id, 'hi');
  for (let i = 0; i < 200 && bots.running.has(bot.id); i++) await new Promise((r) => setTimeout(r, 5));
  const unread = () => bots.list().filter((b) => !b.hidden).reduce((n, b) => n + (Number(b.unread) || 0), 0);   // what the service's dock check adds up
  assert.equal(unread(), 1);
  await s.update(unread(), 0);
  assert.match(s.refreshes.at(-1), /termfleet-b1-t0\.svg$/);
  bots.markRead(bot.id);   // the chat was opened (on any device: the read mark is on the server)
  assert.equal(unread(), 0);
  await s.update(unread(), 0);
  assert.equal(s.refreshes.at(-1), 'termfleet', 'back to the plain icon, no badge left behind');
});

// Noam picked "Two small dots": small, on the right edge, the blue one moves up when alone.
test('the dots are small and sit on the right edge', () => {
  const both = dockIconSvg(base, 3, 2);
  assert.equal((both.match(/<circle cx="86" cy="\d+" r="15"/g) || []).length, 2);
  assert.match(both, /cy="17" r="15" fill="#d97757"/);
  assert.match(both, /cy="50" r="15" fill="#5aa9e6"/);
  assert.match(dockIconSvg(base, 0, 2), /cy="17" r="15" fill="#5aa9e6"/);
});
