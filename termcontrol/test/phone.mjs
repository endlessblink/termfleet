#!/usr/bin/env node
/**
 * How TermControl behaves on a phone: layout at real sizes, scrolling while it
 * refreshes, the keyboard, navigation, and what happens when the machine goes
 * away mid-use.
 *
 *   node termcontrol/test/phone.mjs
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const bridge = path.join(here, '..', 'bridge', 'server.mjs');

let pass = 0, fail = 0; const failures = [];
async function check(name, fn) {
  try {
    const r = await fn();
    pass++; console.log(`  ok   ${name}${typeof r === 'string' ? ' — ' + r : ''}`);
  } catch (e) { fail++; failures.push([name, e.message]); console.log(`  FAIL ${name} — ${e.message}`); }
}
const ok = (c, m) => { if (!c) throw new Error(m); };
const eqText = (a, b) => { if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const group = (t) => console.log(`\n${t}`);

async function freePort() {
  const socket = net.createServer();
  await new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', resolve);
  });
  const { port } = socket.address();
  await new Promise((resolve) => socket.close(resolve));
  return port;
}

const PHONES = [
  { name: 'small phone', width: 360, height: 640 },
  { name: 'iPhone', width: 390, height: 844 },
  { name: 'large Android', width: 412, height: 915 },
];

async function main() {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-phone-'));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [bridge], {
    env: { ...process.env, TC_PORT: String(port), TC_CONFIG_DIR: configDir, TC_HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const cleanup = () => {
    if (!child.killed) child.kill('SIGKILL');
    fs.rmSync(configDir, { recursive: true, force: true });
  };
  process.once('exit', cleanup);
  for (let i = 0; i < 40; i++) { try { await fetch(base + '/login'); break; } catch { await wait(150); } }

  const browser = await chromium.launch();

  const signedIn = async (viewport) => {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    const p = await ctx.newPage();
    await p.goto(base + '/');
    if (await p.$('#password')) {
      if (await p.$('#email')) await p.fill('#email', 'owner@example.test');
      await p.fill('#password', 'a-good-password');
      await p.click('button[type=submit]');
    }
    await p.waitForSelector('.pane', { timeout: 15000 });
    return { ctx, p };
  };

  const openReplyChat = async (p) => {
    const pane = await p.$('.pane:not(.waiting)') || await p.$('.pane');
    await pane.click();
    await p.waitForSelector('.composer', { timeout: 10000 });
  };

  group('Layout on real phone sizes');
  for (const vp of PHONES) {
    const { ctx, p } = await signedIn(vp);

    await check(`${vp.name}: nothing spills off the side`, async () => {
      const over = await p.evaluate(() => Math.max(document.documentElement.scrollWidth - window.innerWidth, document.querySelector('main') ? document.querySelector('main').scrollWidth - document.querySelector('main').clientWidth : 0));
      ok(over <= 1, `page is ${over}px wider than the screen`);
    });

    await check(`${vp.name}: cards are comfortable to tap`, async () => {
      const h = await p.$$eval('.pane', (els) => Math.min(...els.map((e) => e.getBoundingClientRect().height)));
      ok(h >= 44, `smallest card is ${Math.round(h)}px tall`);
      return `${Math.round(h)}px`;
    });

    await check(`${vp.name}: terminal identities and order exactly match the authoritative list`, async () => {
      const expected = await p.evaluate(async () => {
        const response = await fetch('/api/panes');
        const payload = await response.json();
        return payload.panes.map((pane) => pane.id);
      });
      const visible = await p.$$eval('.pane', (panes) => panes.map((pane) => pane.dataset.id));
      ok(visible.length === new Set(visible).size, 'duplicate terminal cards are visible');
      eqText(JSON.stringify(visible), JSON.stringify(expected));
      return `${visible.length} terminals in exact order`;
    });

    await openReplyChat(p);
    await wait(1200);

    await check(`${vp.name}: last message clears the reply box`, async () => {
      await p.evaluate(() => document.querySelector('main').scrollTop = document.querySelector('main').scrollHeight);
      await wait(300);
      const gap = await p.evaluate(() => {
        const items = [...document.querySelectorAll('#main > *')];
        const last = items[items.length - 1].getBoundingClientRect();
        const bar = document.querySelector('.composer').getBoundingClientRect();
        return Math.round(bar.top - last.bottom);
      });
      ok(gap >= 0, `overlaps by ${-gap}px`);
      return `${gap}px clear`;
    });

    await check(`${vp.name}: long unbroken text does not stretch the page`, async () => {
      const over = await p.evaluate(() => {
        const el = document.querySelector('.bubble') || document.querySelector('.tool');
        if (!el) return 0;
        return Math.round(el.getBoundingClientRect().width - window.innerWidth);
      });
      ok(over <= 1, `content is ${over}px too wide`);
    });

    await ctx.close();
  }

  group('Reading while it updates');
  {
    const { ctx, p } = await signedIn(PHONES[1]);
    await openReplyChat(p);
    await wait(1200);

    await check('scrolling up is not undone by a refresh', async () => {
      await p.evaluate(() => document.querySelector('main').scrollTop = 200);
      const before = await p.evaluate(() => Math.round(document.querySelector('main').scrollTop));
      await wait(9500);
      const after = await p.evaluate(() => Math.round(document.querySelector('main').scrollTop));
      ok(Math.abs(before - after) <= 2, `moved from ${before} to ${after}`);
      return 'held position';
    });

    await check('at the bottom, it follows new messages', async () => {
      await p.evaluate(() => document.querySelector('main').scrollTop = document.querySelector('main').scrollHeight);
      await wait(9000);
      const atBottom = await p.evaluate(() => (() => { const m = document.querySelector('main'); return m.scrollHeight - m.scrollTop - m.clientHeight <= 20; })());
      ok(atBottom, 'lost the bottom');
    });
    await ctx.close();
  }

  group('Getting around');
  {
    const { ctx, p } = await signedIn(PHONES[1]);
    const selected = await p.evaluate(() => {
      const panes = [...document.querySelectorAll('.pane')];
      const pane = panes[Math.floor(panes.length / 2)];
      pane.scrollIntoView({ block: 'center' });
      const main = document.querySelector('main');
      const offset = Math.round(pane.getBoundingClientRect().top - main.getBoundingClientRect().top);
      const id = pane.dataset.id;
      pane.click();
      return { id, offset };
    });
    await p.waitForSelector('.composer', { timeout: 10000 });

    await check('the phone back button returns to the selected terminal area', async () => {
      await p.goBack();
      await wait(700);
      ok(await p.$('.pane'), 'did not return to the list');
      ok(!(await p.$('.composer')), 'reply box left behind');
      const returned = await p.evaluate((id) => {
        const main = document.querySelector('main');
        const pane = [...document.querySelectorAll('.pane')].find((candidate) => candidate.dataset.id === id);
        return pane ? {
          offset: Math.round(pane.getBoundingClientRect().top - main.getBoundingClientRect().top),
          visible: pane.getBoundingClientRect().bottom > main.getBoundingClientRect().top
            && pane.getBoundingClientRect().top < main.getBoundingClientRect().bottom,
        } : null;
      }, selected.id);
      ok(returned, 'selected terminal disappeared from the fleet');
      ok(returned.visible, 'selected terminal is outside the returned viewport');
      ok(Math.abs(returned.offset - selected.offset) <= 3,
        `selected terminal moved from ${selected.offset}px to ${returned.offset}px`);
      return `restored within ${Math.abs(returned.offset - selected.offset)}px`;
    });

    await check('going back again leaves the app rather than looping', async () => {
      const entries = await p.evaluate(() => history.length);
      ok(entries >= 2, 'history should hold the fleet and the chat');
      return `${entries} entries`;
    });

    await check('reopening a chat by link works', async () => {
      const candidate = await p.$('.pane:not(.waiting)') || await p.$('.pane');
      const id = await candidate.getAttribute('data-id');
      await p.goto(base + '/#' + id);
      await p.waitForSelector('.composer', { timeout: 10000 });
      ok(await p.$('.composer'), 'link did not open the chat');
    });
    await ctx.close();
  }

  group('When things go wrong');
  {
    const { ctx, p } = await signedIn(PHONES[1]);
    await openReplyChat(p);
    await wait(1000);

    await check('losing the connection does not blank what you are reading', async () => {
      const before = await p.$$eval('#main > *', (e) => e.length);
      await ctx.setOffline(true);
      await wait(9000);
      const after = await p.$$eval('#main > *', (e) => e.length);
      await ctx.setOffline(false);
      ok(after >= before, `messages dropped from ${before} to ${after}`);
      return 'kept on screen';
    });

    await check('a failed send tells you, and keeps your text', async () => {
      await ctx.setOffline(true);
      await p.fill('.composer textarea', 'a message that cannot be delivered');
      await p.click('.composer button.send');
      await p.waitForSelector('.sendstate', { timeout: 8000 });
      // the first frame says "Sending…"; wait for the outcome
      await p.waitForFunction(
        () => !/^Sending|^Still trying/.test(document.querySelector('.sendstate')?.textContent || ''),
        { timeout: 14000 },
      );
      const msg = await p.textContent('.sendstate');
      const kept = await p.inputValue('.composer textarea');
      await ctx.setOffline(false);
      ok(/could not reach|did not answer/i.test(msg), `unclear message: ${msg}`);
      ok(kept.length > 0, 'your text was thrown away');
      return 'text preserved';
    });

    await check('a signed-out session is handled, not left spinning', async () => {
      await ctx.clearCookies();
      await p.reload();
      await wait(1500);
      const url = p.url();
      ok(/login|setup/.test(url), `expected the sign-in screen, got ${url}`);
    });
    await ctx.close();
  }

  group('The bottom of the screen');
  {
    const { ctx, p } = await signedIn(PHONES[1]);
    await openReplyChat(p);
    await wait(1000);

    await check('the bottom stays compact: the view switch and the reply box', async () => {
      // Two purposeful rows. The switch has to be down here because a sticky
      // header is unreachable once a phone keyboard is open.
      const h = await p.$eval('.composer', (e) => Math.round(e.getBoundingClientRect().height));
      ok(h <= 130, `the reply area is ${h}px tall with nothing attached`);
      const rows = await p.$$eval('.composer > *, .composer .toolrow, .composer .attached:not([hidden])',
        (els) => els.filter((e) => getComputedStyle(e).display !== 'none').length);
      ok(rows <= 6, `${rows} things stacked at the bottom`);
      return `${h}px`;
    });

    await check('nothing empty is left sitting above the reply box', async () => {
      const visible = await p.$eval('.attached', (e) => getComputedStyle(e).display !== 'none');
      ok(!visible, 'an empty attachment row is taking up space');
    });

    await check('the extra keys appear only while you are typing', async () => {
      const before = await p.$eval('.keys', (e) => getComputedStyle(e).display !== 'none');
      await p.click('.composer textarea');
      await wait(300);
      const during = await p.$eval('.keys', (e) => getComputedStyle(e).display !== 'none');
      ok(!before && during, `keys visible at rest: ${before}, while typing: ${during}`);
      return 'hidden until needed';
    });

    await check('the keys include the ones a phone keyboard hides', async () => {
      const labels = await p.$$eval('.keys button', (els) => els.map((e) => e.textContent.trim()));
      for (const need of ['/', '$', '|', '~']) ok(labels.includes(need), `missing ${need}`);
      ok(labels.includes('Stop'), 'no way to interrupt a runaway agent');
      return labels.join(' ');
    });

    await check('tapping a key types it into your message', async () => {
      await p.fill('.composer textarea', '');
      await p.click('[data-ins="/"]');
      await p.click('[data-ins="$"]');
      const value = await p.inputValue('.composer textarea');
      eqText(value, '/$');
      return JSON.stringify(value);
    });

    await ctx.close();
  }

  group('Typing');
  {
    const { ctx, p } = await signedIn(PHONES[1]);
    await openReplyChat(p);

    await check('the box grows with a long message but stays bounded', async () => {
      const start = await p.$eval('.composer textarea', (e) => e.offsetHeight);
      await p.fill('.composer textarea', Array(30).fill('a long line of text').join('\n'));
      await wait(300);
      const grown = await p.$eval('.composer textarea', (e) => e.offsetHeight);
      ok(grown > start, 'did not grow');
      ok(grown <= 140, `grew too far: ${grown}px`);
      return `${start} to ${grown}px`;
    });

    await check('the reply box stays reachable with a full message', async () => {
      const visible = await p.evaluate(() => {
        const b = document.querySelector('.composer button.send').getBoundingClientRect();
        return b.bottom <= window.innerHeight + 1 && b.top >= 0;
      });
      ok(visible, 'the send button is off screen');
    });

    await check('double tapping send does not send twice', async () => {
      await p.fill('.composer textarea', 'hello there');
      const calls = [];
      await p.route('**/api/send', async (route) => { calls.push(1); await route.fulfill({ status: 200, body: '{"ok":true}' }); });
      await p.click('.composer button.send');
      await p.click('.composer button.send').catch(() => {});
      await wait(900);
      ok(calls.length <= 1, `sent ${calls.length} times`);
      return `${calls.length} request`;
    });
    await ctx.close();
  }

  group('Permission and live status');
  {
    const { ctx, p } = await signedIn(PHONES[1]);
    const paneId = await p.$eval('.pane', (element) => element.dataset.id);
    let feedCall = 0;
    let permissionAvailable = false;
    const feedPayload = (ask = null) => ({
      pane: {
        id: paneId,
        project: 'flow-state',
        provider: 'codex',
        emoji: '📡',
        task: 'Waiting for a permission answer',
      },
      version: 'test',
      live: 'waiting',
      producing: false,
      reachedStart: true,
      pending: [],
      events: [{ kind: 'assistant', text: 'The release is ready to publish.' }],
      ask,
    });
    const permission = {
      id: 'codex:late-arrival:permission:test',
      kind: 'permission',
      title: 'Publish the verified release',
      detail: 'Allow the release upload and public verification.',
      screen: 'Would you like to run the following command?',
      options: [
        { key: 'yes', label: 'Yes' },
        { key: 'yesAlways', label: "Yes, don't ask again" },
        { key: 'no', label: 'No' },
      ],
    };
    await p.route('**/api/feed**', async (route) => {
      const call = ++feedCall;
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(feedPayload(permissionAvailable ? permission : null)),
      });
    });
    await p.click('.pane');
    await p.waitForSelector('.composer');

    await check('returning to an open phone chat immediately reveals a late permission', async () => {
      ok(!(await p.$('.askbox')), 'permission was present before it became available');
      const callsBeforeReturn = feedCall;
      permissionAvailable = true;
      await p.evaluate(() => window.dispatchEvent(new Event('focus')));
      await p.waitForSelector('.askbox', { timeout: 1500 });
      ok(feedCall > callsBeforeReturn, 'returning to the chat did not request current permission state');
    });
    await ctx.close();
  }

  group('Permission layout and live status');
  {
    const { ctx, p } = await signedIn(PHONES[1]);
    await p.route('**/api/panes', async (route) => {
      const response = await route.fetch();
      const payload = await response.json();
      payload.panes[0].attention = {
        kind: 'permission',
        title: 'Install the verified TermFleet release',
      };
      await route.fulfill({ response, json: payload });
    });
    await p.reload();
    await p.waitForSelector('.attention-panel');

    await check('the fleet opens with a visible list of terminals that need you', async () => {
      const panel = await p.$eval('.attention-panel', (element) => element.getBoundingClientRect().toJSON());
      const review = await p.$eval('.attention-review', (element) => element.getBoundingClientRect().toJSON());
      const text = await p.textContent('.attention-panel');
      const viewportHeight = p.viewportSize()?.height ?? 0;
      ok(panel.top >= 0 && panel.bottom <= viewportHeight, 'attention panel is not visible without scrolling');
      ok(review.height >= 44 && review.width >= 44, 'review action is not a comfortable tap target');
      ok(text.includes('Needs you'), 'attention heading is missing');
      ok(text.includes('Install the verified TermFleet release'), 'approval summary is missing');
    });

    await check('the Needs you panel stays collapsed after the fleet refreshes', async () => {
      await p.click('.attention-panel summary');
      ok(!(await p.$eval('.attention-panel', (element) => element.open)), 'attention panel did not collapse');
      await p.reload();
      await p.waitForSelector('.attention-panel');
      ok(!(await p.$eval('.attention-panel', (element) => element.open)), 'attention panel reopened after refresh');
      await p.click('.attention-panel summary');
    });

    await check('tapping Review opens the terminal that requested approval', async () => {
      const expected = await p.$eval('.attention-review', (element) => element.dataset.id);
      await p.click('.attention-review');
      await p.waitForSelector('.composer', { timeout: 10000 });
      const hash = new URL(p.url()).hash;
      ok(hash !== '', 'terminal deep link is missing');
      const actual = decodeURIComponent(hash.slice(1));
      ok(actual === expected, `opened ${actual} instead of ${expected}`);
      await p.goBack();
      await p.waitForSelector('.attention-panel');
      await wait(100);
      const review = await p.$eval('.attention-review', (element) => element.getBoundingClientRect().toJSON());
      const viewportHeight = p.viewportSize()?.height ?? 0;
      ok(review.top >= 0 && review.bottom <= viewportHeight, 'Back returned to the project card instead of the review row');
    });

    const paneId = await p.$eval('.pane', (element) => element.dataset.id);
    const workingSince = Date.now() - 61_000;
    const approvals = [];
    await p.route('**/api/feed**', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          pane: {
            id: paneId,
            project: 'termfleet',
            provider: 'codex',
            emoji: '🧭',
            task: 'Checking mobile approvals',
            workingSince,
            limits: {
              fiveHour: { remainingPercent: 73 },
              weekly: { remainingPercent: 87 },
            },
          },
          version: 'test',
          live: 'waiting',
          producing: false,
          reachedStart: true,
          pending: ['exec_command'],
          events: [
            { kind: 'assistant', text: 'I need permission to continue.', at: new Date(Date.now() - 60_000).toISOString() },
            ...(approvals.length ? [{ kind: 'assistant', text: 'I continued after approval.', at: new Date(Date.now() + 1_000).toISOString() }] : []),
            { kind: 'tool', name: 'exec', summary: 'exec_command' },
          ],
          ask: {
            id: 'codex:session:1:permission_prompt:permission:test',
            kind: 'permission',
            title: '/home/endlessblink/.cargo/bin/lean-ctx -c '
              + "'VPS_HOST=84.46.253.137 VPS_USER=root ./scripts/deploy-electron-update.sh "
              + '--notes "BUG-2084: share focused timeline order and restore Pomodoro cycle" '
              + "--skip-guard --skip-tests'",
            detail: 'Allow building and uploading the FlowState Electron update to the configured VPS, '
              + 'then verify every public updater artifact before continuing.',
            screen: 'Would you like to run the following command?\n\n'
              + Array.from({ length: 18 }, (_, index) => `command detail line ${index + 1}`).join('\n')
              + '\n\n1. Yes, proceed\n2. Yes, and remember\n3. No',
            options: [
              { key: 'yes', label: 'Yes' },
              { key: 'yesAlways', label: "Yes, don't ask again" },
              { key: 'no', label: 'No' },
            ],
          },
        }),
      });
    });
    await p.route('**/api/send', async (route) => {
      approvals.push(JSON.parse(route.request().postData() || '{}'));
      await route.fulfill({ contentType: 'application/json', body: '{"ok":true}' });
    });
    await p.click('.pane');
    await p.waitForSelector('.askbox');

    await check('the real permission prompt stays above a usable reply box', async () => {
      const ask = await p.$eval('.askbox', (element) => element.getBoundingClientRect().toJSON());
      const composer = await p.$eval('.composer', (element) => element.getBoundingClientRect().toJSON());
      const choices = await p.$$eval('.askbox [data-choice]', (elements) => elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
      }));
      ok(Boolean(await p.$('.composer textarea:not([disabled])')), 'reply box is not usable during the permission request');
      ok(ask.bottom <= composer.top, 'permission choices do not stay above the reply box');
      ok(choices.length === 3, `only ${choices.length} permission choices are rendered`);
      choices.forEach((choice, index) => {
        ok(choice.width > 0 && choice.height >= 44, `permission choice ${index + 1} is not a visible tap target`);
        ok(choice.top >= ask.top && choice.bottom <= ask.bottom, `permission choice ${index + 1} requires scrolling inside the card`);
        ok(choice.bottom <= composer.top, `permission choice ${index + 1} is covered by the reply box`);
      });
      ok((await p.textContent('.askscreen')).includes('Would you like to run'), 'terminal prompt is missing');
    });

    await check('tool hooks and internal running rows stay hidden', async () => {
      const text = await p.textContent('body');
      ok(!text.includes('exec_command'), 'internal tool name is visible');
      ok(!text.includes('running ·'), 'internal running row is visible');
    });

    await check('both limits and a ticking work timer are visible', async () => {
      const first = await p.textContent('#chat-status .workingtime');
      const status = await p.textContent('#chat-status');
      ok(status.includes('5-hour 73% left'), '5-hour limit is missing');
      ok(status.includes('weekly 87% left'), 'weekly limit is missing');
      await wait(1100);
      const second = await p.textContent('#chat-status .workingtime');
      ok(first !== second, `timer did not move from ${first}`);
      return `${first} to ${second}`;
    });

    await check('one tap sends the bound permission answer once', async () => {
      await p.click('.askbox [data-choice="yes"]');
      await wait(300);
      ok(approvals.length === 1, `sent ${approvals.length} answers`);
      ok(approvals[0].pane === paneId, 'answer was sent to another terminal');
      ok(approvals[0].askId === 'codex:session:1:permission_prompt:permission:test', 'request identity was lost');
      ok(approvals[0].choice === 'yes', 'wrong permission choice was sent');
    });

    await check('the delivered permission answer appears in the terminal chat', async () => {
      await p.waitForSelector('.msg.user .bubble');
      const replies = await p.$$eval('.msg.user .bubble', (elements) => elements.map((element) => element.textContent));
      ok(replies.includes('Permission answer: Yes'), `chat did not record the answer: ${JSON.stringify(replies)}`);
    });

    await check('new agent replies stay below older permission answers', async () => {
      await p.waitForFunction(() => document.body.textContent.includes('I continued after approval.'));
      const bubbles = await p.$$eval('.msg .bubble', (elements) => elements.map((element) => element.textContent));
      ok(bubbles.at(-1) === 'I continued after approval.', `old permission answer covered the newest reply: ${JSON.stringify(bubbles.slice(-3))}`);
    });
    await ctx.close();
  }

  await browser.close();
  cleanup();
  process.removeListener('exit', cleanup);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log('\nFailures:'); for (const [n, e] of failures) console.log(`  - ${n}: ${e}`); process.exit(1); }
}
main().catch((e) => { console.error('test run itself failed:', e); process.exit(2); });
