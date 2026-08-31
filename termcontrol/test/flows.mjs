#!/usr/bin/env node
/**
 * Whole journeys, the way the owner actually uses TermControl — first run,
 * the glance, the reply, coming back later, and the awkward moments in
 * between. Where run.mjs checks parts, this checks paths through them.
 *
 *   node termcontrol/test/flows.mjs
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const bridge = path.join(here, '..', 'bridge', 'server.mjs');

let pass = 0, fail = 0; const failures = [];
async function check(name, fn) {
  try { const r = await fn(); pass++; console.log(`  ok   ${name}${typeof r === 'string' ? ' — ' + r : ''}`); }
  catch (e) { fail++; failures.push([name, e.message]); console.log(`  FAIL ${name} — ${e.message}`); }
}
const ok = (c, m) => { if (!c) throw new Error(m); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const group = (t) => console.log(`\n${t}`);

const PHONE = { width: 390, height: 844 };

async function main() {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-flow-'));
  const port = 7990 + Math.floor(Math.random() * 9);
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [bridge], {
    env: { ...process.env, TC_PORT: String(port), TC_CONFIG_DIR: configDir, TC_HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const log = [];
  child.stdout.on('data', (d) => log.push(String(d)));
  child.stderr.on('data', (d) => log.push(String(d)));
  for (let i = 0; i < 40; i++) { try { await fetch(base + '/login'); break; } catch { await wait(150); } }

  const browser = await chromium.launch();
  const phone = () => browser.newContext({ viewport: PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

  // ------------------------------------------------------------- first run --
  group('The very first time');
  const ctx = await phone();
  const p = await ctx.newPage();

  await check('landing on the app leads straight to creating an account', async () => {
    await p.goto(base + '/');
    await p.waitForSelector('form', { timeout: 8000 });
    const words = (await p.textContent('body')).toLowerCase();
    ok(/create/.test(words), 'the first screen should offer to create a sign-in');
  });

  await check('the email field is set up for a phone keyboard', async () => {
    const f = await p.$eval('#email', (e) => ({ type: e.type, mode: e.inputMode, cap: e.getAttribute('autocapitalize'), auto: e.autocomplete }));
    ok(f.type === 'email', 'should be an email field');
    ok(f.cap === 'none' || f.cap === 'off', 'must not capitalise the address');
    return `${f.type}/${f.mode || 'default'}`;
  });

  await check('a mistyped password is explained, not just rejected', async () => {
    await p.fill('#email', 'owner@example.com');
    await p.fill('#password', 'short');
    await p.click('button[type=submit]');
    await p.waitForSelector('form', { timeout: 8000 });
    const words = (await p.textContent('body'));
    ok(/8 characters|at least/i.test(words), `no guidance shown: ${words.slice(0, 120)}`);
  });

  await check('what you typed is not thrown away after an error', async () => {
    const kept = await p.inputValue('#email');
    ok(kept === 'owner@example.com', `email was cleared (${kept})`);
  });

  await check('creating the account lands you straight in the fleet', async () => {
    await p.fill('#password', 'a-good-password');
    await p.click('button[type=submit]');
    await p.waitForSelector('.pane', { timeout: 15000 });
    ok(!(await p.$('#password')), 'still on the form');
  });

  // ---------------------------------------------------------------- glance --
  group('The ten-second glance');

  await check('the header answers "does anything need me?" without scrolling', async () => {
    const sub = await p.textContent('#sub');
    ok(/waiting|terminal/.test(sub), `unhelpful summary: ${sub}`);
    return sub.trim();
  });

  await check('each card says which project and what is happening', async () => {
    const card = await p.$eval('.pane', (e) => e.textContent.replace(/\s+/g, ' ').trim());
    ok(card.length > 10, 'card is nearly empty');
    return card.slice(0, 60);
  });

  await check('a terminal with nothing to say still reads honestly', async () => {
    const none = await p.$$eval('.task.none', (els) => els.map((e) => e.textContent.trim()));
    for (const t of none) ok(!/undefined|null|\[object/.test(t), `placeholder leaked: ${t}`);
    return none.length ? `${none.length} shown as "${none[0]}"` : 'none needed';
  });

  await check('the list is readable without pinching', async () => {
    const sizes = await p.$$eval('.project, .task', (els) => els.map((e) => parseFloat(getComputedStyle(e).fontSize)));
    const min = Math.min(...sizes);
    ok(min >= 13, `smallest text is ${min}px`);
    return `${min}px smallest`;
  });

  group('Arranging the fleet');

  await check('terminals are grouped by project out of the box', async () => {
    const state = await p.$$eval('.switch button', (els) => els.map((e) => `${e.textContent.trim()}=${e.getAttribute('aria-pressed')}`));
    ok(state.includes('Projects=true'), `wrong default: ${state.join(' ')}`);
    const groups = await p.$$('.projgroup');
    ok(groups.length > 0, 'no project groups rendered');
    return `${groups.length} projects`;
  });

  await check('each project shows its own emoji and name', async () => {
    const heads = await p.$$eval('.projhead', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
    ok(heads.length > 0 && heads.every((h) => h.length > 1), 'project headings are empty');
    return heads.slice(0, 3).join(' | ');
  });

  await check('a project that needs you is called out', async () => {
    const marked = await p.$$eval('.projhead.needs .count', (els) => els.map((e) => e.textContent.trim()));
    for (const m of marked) ok(/needs you/i.test(m), `unclear marker: ${m}`);
    return marked.length ? `${marked.length} flagged` : 'nothing waiting right now';
  });

  await check('switching to your own order shows move controls', async () => {
    await p.click('.switch button[data-view="manual"]');
    await p.waitForSelector('.moves', { timeout: 8000 });
    const state = await p.$$eval('.switch button', (els) => els.map((e) => `${e.textContent.trim()}=${e.getAttribute('aria-pressed')}`));
    ok(state.includes('My order=true'), `switch did not take: ${state.join(' ')}`);
    ok((await p.$$('.projgroup')).length === 0, 'project groups should be gone in your own order');
  });

  await check('moving a terminal down actually moves it', async () => {
    // Compare terminals, not project names: several terminals can belong to
    // the same project, so names alone cannot tell you what moved.
    const before = await p.$$eval('.pane', (els) => els.map((e) => e.dataset.id));
    await p.click('[data-move="down"][data-at="0"]');
    await wait(1300);
    const after = await p.$$eval('.pane', (els) => els.map((e) => e.dataset.id));
    ok(after.indexOf(before[0]) === 1, `the moved terminal should be second, it is at ${after.indexOf(before[0])}`);
    ok(after[0] === before[1], 'the terminal below should have taken first place');
    return 'swapped with the one below';
  });

  await check('moving it back up restores the order', async () => {
    const before = await p.$$eval('.pane', (els) => els.map((e) => e.dataset.id));
    await p.click(`[data-move="up"][data-at="1"]`);
    await wait(1300);
    const after = await p.$$eval('.pane', (els) => els.map((e) => e.dataset.id));
    ok(after[0] === before[1], 'moving up did not restore it');
    return 'restored';
  });

  await check('the top item cannot be moved further up', async () => {
    const disabled = await p.$eval('[data-move="up"][data-at="0"]', (e) => e.disabled);
    ok(disabled, 'the first row offers an up arrow that does nothing');
  });

  await check('your arrangement survives a reload', async () => {
    const before = await p.$$eval('.pane', (els) => els.map((e) => e.dataset.id));
    await p.reload();
    await p.waitForSelector('.pane', { timeout: 12000 });
    await wait(700);
    const pressed = await p.$$eval('.switch button', (els) => els.filter((e) => e.getAttribute('aria-pressed') === 'true').map((e) => e.textContent.trim()));
    const after = await p.$$eval('.pane', (els) => els.map((e) => e.dataset.id));
    ok(pressed.join() === 'My order', `view was not remembered: ${pressed.join()}`);
    ok(before.join() === after.join(), 'the order was not remembered');
    return 'view and order both kept';
  });

  await check('switching back to projects restores the grouping', async () => {
    await p.click('.switch button[data-view="projects"]');
    await p.waitForSelector('.projgroup', { timeout: 8000 });
    ok((await p.$$('.moves')).length === 0, 'move controls should be gone');
  });

  // ------------------------------------------------------------------ read --
  group('Opening one and reading it');

  await check('a chat opens within a couple of seconds', async () => {
    const t0 = Date.now();
    await p.click('.pane');
    await p.waitForSelector('.composer', { timeout: 10000 });
    await p.waitForFunction(() => document.querySelectorAll('#main > *').length > 0, { timeout: 10000 });
    const ms = Date.now() - t0;
    ok(ms < 4000, `took ${ms}ms`);
    return `${ms}ms`;
  });

  await check('the header still tells you which terminal you are in', async () => {
    const t = (await p.textContent('#title')).trim();
    ok(t && t !== 'TermControl', `header did not change: ${t}`);
    return t;
  });

  await check('you can tell who said what', async () => {
    // The view is remembered between terminals; make sure we are on the
    // conversation before judging it.
    await p.evaluate(() => sessionStorage.setItem('tc-mode', 'chat'));
    const chat = await p.$('.composer [data-mode="chat"]');
    if (chat) { await chat.click(); await wait(1200); }
    const roles = await p.$$eval('.who', (els) => [...new Set(els.map((e) => e.textContent.trim()))]);
    ok(roles.length >= 1, 'no speaker labels at all');
    return roles.join(', ');
  });

  await check('long command lines scroll instead of breaking the layout', async () => {
    const over = await p.evaluate(() => Math.max(document.documentElement.scrollWidth - window.innerWidth, document.querySelector('main') ? document.querySelector('main').scrollWidth - document.querySelector('main').clientWidth : 0));
    ok(over <= 1, `page overflows by ${over}px`);
  });

  await check('the newest message is what you see first', async () => {
    const atBottom = await p.evaluate(() => window.innerHeight + window.scrollY >= document.body.scrollHeight - 30);
    ok(atBottom, 'opened somewhere other than the latest message');
  });

  // ----------------------------------------------------------------- reply --
  group('Slash commands');

  await check('typing a slash offers the agent\'s commands', async () => {
    await p.fill('.composer textarea', '/');
    await p.dispatchEvent('.composer textarea', 'input');
    await p.waitForSelector('.cmdlist button', { timeout: 10000 });
    const shown = await p.$$eval('.cmdlist .cmd', (els) => els.slice(0, 4).map((e) => e.textContent));
    ok(shown.length >= 2 && shown.every((s) => s.startsWith('/')), `unexpected list: ${shown.join(' ')}`);
    return shown.slice(0, 3).join(' ');
  });

  await check('the list narrows as you type', async () => {
    const before = await p.$$eval('.cmdlist button', (els) => els.length);
    await p.fill('.composer textarea', '/anal');
    await p.dispatchEvent('.composer textarea', 'input');
    await wait(500);
    const after = await p.$$eval('.cmdlist .cmd', (els) => els.map((e) => e.textContent));
    ok(after.length > 0 && after.length < before, `${before} then ${after.length}`);
    ok(after.every((c) => c.toLowerCase().includes('anal')), `unrelated matches: ${after.join(' ')}`);
    return after.join(' ');
  });

  await check('picking one fills it in and closes the list', async () => {
    await p.click('.cmdlist button');
    await wait(400);
    const value = await p.inputValue('.composer textarea');
    ok(value.startsWith('/') && value.endsWith(' '), `filled in as ${JSON.stringify(value)}`);
    ok(await p.$eval('.cmdlist', (e) => e.hidden), 'the list stayed open');
    return JSON.stringify(value);
  });

  await check('a command that does not exist says so plainly', async () => {
    await p.fill('.composer textarea', '/zzzznotacommand');
    await p.dispatchEvent('.composer textarea', 'input');
    await wait(500);
    const text = (await p.textContent('.cmdlist')).trim();
    ok(/no command matches/i.test(text), `unclear: ${text}`);
    await p.fill('.composer textarea', '');
    await p.dispatchEvent('.composer textarea', 'input');
  });

  await check('ordinary typing does not open the list', async () => {
    await p.fill('.composer textarea', 'just a normal message');
    await p.dispatchEvent('.composer textarea', 'input');
    await wait(400);
    ok(await p.$eval('.cmdlist', (e) => e.hidden), 'the command list opened for ordinary text');
    await p.fill('.composer textarea', '');
    await p.dispatchEvent('.composer textarea', 'input');
  });

  group('Files and shell commands');

  await check('typing @ offers files from that terminal\'s project', async () => {
    await p.fill('.composer textarea', 'look at @');
    await p.dispatchEvent('.composer textarea', 'input');
    await p.waitForSelector('.cmdlist button', { timeout: 10000 });
    const shown = await p.$$eval('.cmdlist .path', (els) => els.length);
    ok(shown > 0, 'no files were offered');
    return `${shown} shown`;
  });

  await check('the file list narrows as you type', async () => {
    await p.fill('.composer textarea', 'look at @server');
    await p.dispatchEvent('.composer textarea', 'input');
    await wait(700);
    const files = await p.$$eval('.cmdlist .path', (els) => els.map((e) => e.textContent));
    ok(files.length > 0, 'nothing matched "server"');
    ok(files.every((f) => f.toLowerCase().includes('server')), `unrelated: ${files.slice(0, 3).join(' ')}`);
    return files[0];
  });

  await check('picking a file inserts its path, keeping what you wrote', async () => {
    await p.click('.cmdlist button');
    await wait(400);
    const value = await p.inputValue('.composer textarea');
    ok(value.startsWith('look at @'), `lost the message: ${JSON.stringify(value)}`);
    ok(value.includes('/') || value.length > 'look at @'.length + 3, `no path inserted: ${value}`);
    ok(await p.$eval('.cmdlist', (e) => e.hidden), 'the list stayed open');
    return JSON.stringify(value.slice(0, 40));
  });

  await check('a message starting with ! explains that it runs a command', async () => {
    await p.fill('.composer textarea', '!ls -la');
    await p.dispatchEvent('.composer textarea', 'input');
    await wait(400);
    const text = (await p.textContent('.cmdlist')).trim();
    ok(/shell command/i.test(text), `unclear: ${text}`);
    await p.fill('.composer textarea', '');
    await p.dispatchEvent('.composer textarea', 'input');
  });

  group('Reading back through a conversation');

  await check('a conversation opens with a page of messages, not a handful', async () => {
    const rows = await p.$$eval('#main > *', (els) => els.length);
    ok(rows >= 20, `only ${rows} things to read — history is being cut short`);
    return `${rows} shown`;
  });

  await check('there is a way back to older messages', async () => {
    const canGoBack = !!(await p.$('.earlier'));
    const atStart = !!(await p.$('.start'));
    ok(canGoBack || atStart, 'no way back and no note that this is the start');
    return canGoBack ? 'offers earlier messages' : 'already at the start';
  });

  await check('loading earlier messages actually adds them', async () => {
    const btn = await p.$('.earlier');
    if (!btn) return 'already at the start of this conversation';
    const before = await p.$$eval('#main > *', (els) => els.length);
    await btn.click();
    await wait(2500);
    const after = await p.$$eval('#main > *', (els) => els.length);
    ok(after > before, `${before} then ${after}`);
    return `${before} to ${after}`;
  });

  await check('the conversation can be scrolled', async () => {
    const scrollable = await p.$eval('main', (e) => e.scrollHeight > e.clientHeight + 20);
    ok(scrollable, 'there is nothing to scroll through');
  });

  await check('a terminal with no conversation shows its screen instead', async () => {
    // Side sessions and plain shells keep no conversation of their own. A dead
    // end is worse than showing what is actually on the terminal.
    await p.click('.back');
    await p.waitForSelector('.pane', { timeout: 10000 });
    const cards = await p.$$('.pane');

    let found = null;
    for (const card of cards.slice(0, 12)) {
      await card.click();
      await p.waitForSelector('.composer', { timeout: 8000 });
      await wait(1800);
      if (await p.$('.screen')) { found = await p.textContent('.note').catch(() => ''); break; }
      if (await p.$('.empty')) { found = 'DEAD END'; break; }
      await p.click('.back');
      await p.waitForSelector('.pane', { timeout: 8000 });
    }

    if (found === null) return 'every terminal had a conversation to show';
    ok(found !== 'DEAD END', 'a terminal offered nothing at all');
    return 'falls back to the screen';
  });

  group('Replying');

  await check('the reply box is visible without hunting for it', async () => {
    const seen = await p.evaluate(() => {
      const b = document.querySelector('.composer')?.getBoundingClientRect();
      return !!b && b.top < window.innerHeight && b.bottom <= window.innerHeight + 1;
    });
    ok(seen, 'composer is off screen');
  });

  await check('sending gives immediate feedback', async () => {
    await p.route('**/api/send', async (r) => { await wait(400); await r.fulfill({ status: 200, body: '{"ok":true,"delivered":true}' }); });
    await p.fill('.composer textarea', 'thanks, carry on');
    await p.click('.composer button.send');
    await p.waitForSelector('.sendstate', { timeout: 4000 });
    const first = await p.textContent('.sendstate');
    ok(/sending/i.test(first), `no immediate acknowledgement: ${first}`);
  });

  await check('a sent message clears the box and confirms', async () => {
    await p.waitForFunction(() => /delivered/i.test(document.querySelector('.sendstate')?.textContent || ''), { timeout: 8000 });
    const left = await p.inputValue('.composer textarea');
    ok(left === '', `text stayed behind: "${left}"`);
    await p.unroute('**/api/send');
  });

  await check('the confirmation does not linger forever', async () => {
    await wait(2200);
    ok(!(await p.$('.sendstate')), 'the "Sent" note never went away');
  });

  await check('your message appears in the chat straight away', async () => {
    await p.route('**/api/send', async (r) => r.fulfill({ status: 200, body: '{"ok":true,"delivered":true}' }));
    const mine = 'please summarise the last change ' + Date.now();
    await p.fill('.composer textarea', mine);
    await p.click('.composer button.send');
    // An earlier step may already have left one of these on screen, so wait
    // for this exact message rather than the first that appears.
    await p.waitForFunction(
      (needle) => [...document.querySelectorAll('.msg.mine .bubble')].some((e) => (e.textContent || '').includes(needle)),
      mine,
      { timeout: 10000 },
    );
    await p.unroute('**/api/send');
    return 'shown as yours';
  });

  await check('it is marked as waiting for the agent, not as read', async () => {
    const label = await p.textContent('.msg.mine .when');
    ok(/waiting for the agent/i.test(label), `unclear state: ${label}`);
    return label.trim();
  });

  await check('a message that never reached the terminal says so', async () => {
    await p.route('**/api/send', async (r) => r.fulfill({ status: 200, body: '{"ok":true,"delivered":false}' }));
    await p.fill('.composer textarea', 'did this actually arrive');
    await p.click('.composer button.send');
    await p.waitForFunction(
      () => /did not appear/i.test(document.querySelector('.sendstate')?.textContent || ''),
      { timeout: 8000 },
    );
    const msg = await p.textContent('.sendstate');
    ok(/computer/i.test(msg), `unclear warning: ${msg}`);
    await p.unroute('**/api/send');
    return 'warned clearly';
  });

  await check('interrupting a busy agent needs a deliberate second tap', async () => {
    await p.route('**/api/send', async (r) => r.fulfill({ status: 200, body: JSON.stringify({ error: 'busy', busy: true, message: 'The agent is still working. Send anyway?' }) }));
    await p.fill('.composer textarea', 'stop what you are doing');
    await p.click('.composer button.send');
    await p.waitForSelector('.sendstate .acts', { timeout: 6000 });
    const buttons = await p.$$eval('.sendstate .acts button', (els) => els.map((e) => e.textContent.trim()));
    ok(buttons.length === 2, `expected two choices, got ${buttons.join('/')}`);
    ok(/wait/i.test(buttons[0]), 'the safe choice should come first');
    return buttons.join(' / ');
  });

  await check('choosing to wait keeps your message', async () => {
    await p.click('.sendstate [data-no]');
    await wait(300);
    const kept = await p.inputValue('.composer textarea');
    ok(kept.length > 0, 'the message was discarded when you chose to wait');
    await p.unroute('**/api/send');
  });

  // ------------------------------------------------------------- returning --
  group('Coming back later');

  await check('closing and reopening keeps you signed in', async () => {
    await p.close();
    const p2 = await ctx.newPage();
    await p2.goto(base + '/');
    await p2.waitForSelector('.pane', { timeout: 12000 });
    ok(!(await p2.$('#password')), 'was asked to sign in again');
    await p2.close();
  });

  await check('a different phone must sign in for itself', async () => {
    const other = await phone();
    const op = await other.newPage();
    await op.goto(base + '/');
    await op.waitForSelector('form', { timeout: 8000 });
    const words = (await op.textContent('body')).toLowerCase();
    ok(/sign in/.test(words), 'a new device should be asked to sign in');
    ok(!/create/.test(words), 'a new device must not be offered account creation');
    await other.close();
  });

  await check('signing in from a new phone works and shows the fleet', async () => {
    const other = await phone();
    const op = await other.newPage();
    await op.goto(base + '/login');
    await op.fill('#email', 'owner@example.com');
    await op.fill('#password', 'a-good-password');
    await op.click('button[type=submit]');
    await op.waitForSelector('.pane', { timeout: 12000 });
    await other.close();
  });

  // --------------------------------------------------------------- stress ---
  group('Awkward moments');

  await check('tapping through several terminals quickly does not tangle', async () => {
    const c = await phone(); const q = await c.newPage();
    await q.goto(base + '/login');
    await q.fill('#email', 'owner@example.com'); await q.fill('#password', 'a-good-password');
    await q.click('button[type=submit]');
    await q.waitForSelector('.pane');
    // In and out of four terminals, the way a thumb does it: some with the
    // on-screen back button, some with the phone's own back gesture.
    for (let i = 0; i < 4; i++) {
      const cards = await q.$$('.pane');          // re-query: the list re-renders
      if (!cards.length) throw new Error('the fleet list vanished');
      await cards[Math.min(i, cards.length - 1)].click();
      await q.waitForSelector('.composer', { timeout: 6000 });
      await wait(200);
      if (i % 2 === 0) await q.click('.back');
      else await q.goBack();
      await q.waitForSelector('.pane', { timeout: 6000 });
      await wait(150);
    }
    const composers = await q.$$('.composer');
    ok(composers.length === 0, `${composers.length} reply boxes left on the fleet list`);
    const titles = (await q.textContent('#title')).trim();
    ok(titles === 'TermControl', `header still shows a chat: ${titles}`);
    await c.close();
    return 'no leftovers';
  });

  await check('the app survives its own refresh cycle for a minute', async () => {
    const c = await phone(); const q = await c.newPage();
    const errors = [];
    q.on('pageerror', (e) => errors.push(e.message));
    await q.goto(base + '/login');
    await q.fill('#email', 'owner@example.com'); await q.fill('#password', 'a-good-password');
    await q.click('button[type=submit]');
    await q.waitForSelector('.pane');
    await q.click('.pane');
    await q.waitForSelector('.composer');
    await wait(35000);
    ok(errors.length === 0, `page errors: ${errors.slice(0, 2).join('; ')}`);
    await c.close();
    return 'no errors in 35s';
  });

  await check('the bridge logged nothing alarming through all of it', () => {
    const text = log.join('');
    ok(!/Error|ERR_|throw/.test(text), text.slice(0, 200));
  });

  await ctx.close();
  await browser.close();
  child.kill('SIGKILL');
  for (const f of fs.readdirSync(configDir)) fs.unlinkSync(path.join(configDir, f));
  fs.rmdirSync(configDir);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log('\nFailures:'); for (const [n, e] of failures) console.log(`  - ${n}: ${e}`); process.exit(1); }
}
main().catch((e) => { console.error('test run itself failed:', e); process.exit(2); });
