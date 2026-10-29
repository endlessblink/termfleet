import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { Bots } from '../bridge/bots.mjs';
import { structureProblem } from '../bridge/requirements.mjs';
import { withPassedOn, takeSteer } from '../bridge/side-reply.mjs';

// Exact user-provided screenshot text, not a private transcript.
export const audit = 'Audit TermFleet end to end with a strict, evidence-based review: trace user messages through request tracking, assignment, worker acknowledgement, execution, verification, status updates, and replies. Investigate missing or stale updates, workers linked to the wrong chat, misleading running/completed states, unanswered requests, user checks that cannot actually be performed, lost context during provider switches, and whether Claude cloud can be connected for real task submission and result retrieval. For each failure, identify the root cause with code and runtime evidence, distinguish confirmed facts from hypotheses, and propose a concrete fix with a regression test; explicitly inspect missing evidence instead of guessing or treating queued delivery, assignment, or tool success as completion. Prioritize by user impact, explain any sequential or parallel scheduling decisions from recorded evidence, and return an actionable repair plan with clear acceptance criteria and remaining unknowns—do not spend money, publish, delete, or claim fixes without verification.';
export const tail = 'השאלה נשמרה בתור של העבודה; עדיין אין אישור שהעובד קרא אותה.';
const words = s => s.replace(/\s+/gu, ' ').trim();
const setup = t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-readable-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bots = new Bots({ dir });
  fs.mkdirSync(bots.folder('abcdefabcdef'), { recursive: true });
  return bots;
};

test('publication repairs screenshot audit plus Hebrew receipt before persistence, retaining every word', t => {
  const bots = setup(t), input = `${audit} ${tail}`;
  const entry = bots.append('abcdefabcdef', { role: 'bot', text: input });
  assert.ok(entry.text.split('\n\n').length >= 4);
  assert.equal(words(entry.text), words(input));
  for (const phrase of ['lost context during provider switches', 'distinguish confirmed facts', 'remaining unknowns']) assert.ok(entry.text.includes(phrase), 'existing clause boundaries should keep phrases together');
  assert.equal(structureProblem(entry.text), null);
  assert.equal(bots.messages('abcdefabcdef').at(-1).text, entry.text);
  assert.equal(bots.append('abcdefabcdef', { role: 'operator', text: input }).text, input);
});

test('one newline or one bullet cannot hide another giant prose wall', () => {
  for (const input of [`Intro\n${audit}`, `- A real bullet\n${audit}`, `# Heading\n${audit}`]) assert.ok(structureProblem(input));
});

test('genuinely unpunctuated walls use word gaps while unsplittable tokens retain all content', t => {
  const bots = setup(t), wall = `Intro\n${'מילים without punctuation '.repeat(60)}`;
  const entry = bots.append('abcdefabcdef', { role: 'bot', text: wall });
  assert.equal(words(entry.text), words(wall));
  assert.equal(structureProblem(entry.text), null);
  const token = 'x'.repeat(220);
  const unsplittable = bots.append('abcdefabcdef', { role: 'bot', text: token });
  assert.equal(unsplittable.text, token);
  assert.ok(unsplittable.structure.remaining, 'remaining issue is explicit, never fixed by deleting content');
  const list = bots.append('abcdefabcdef', { role: 'bot', text: `12. ${audit}` });
  assert.equal(words(list.text), `12. ${audit}`);
  assert.equal(structureProblem(list.text), null);
  assert.ok(list.text.includes('\n\n    '), 'continuation stays within the same ordered list item');
});

test('shared publication handles main, side and echo without touching code, URLs, RTL or good paragraphs', t => {
  const bots = setup(t);
  const code = '```js\nconst value = "' + 'code '.repeat(90) + '";\n```';
  const inline = '`literal code with spaces and periods. untouched`';
  const link = '[A descriptive link with spaces](https://example.test/a.b?q=1&x=2)';
  const input = `פסקה קצרה נשארת.\n\n${audit} ${inline} ${link}\n\n- Keep this list item\n- And the second item\n\n${code}\n\n${tail}`;
  for (const extra of [{}, { side: { forward: false } }, { echo: true }]) {
    const entry = bots.append('abcdefabcdef', { role: 'bot', text: input, ...extra });
    assert.equal(words(entry.text), words(input));
    for (const preserved of [code, inline, link, '- Keep this list item\n- And the second item', 'פסקה קצרה נשארת.\n\n', tail]) assert.ok(entry.text.includes(preserved));
    assert.equal(structureProblem(entry.text), null);
    assert.equal(bots.append('abcdefabcdef', { role: 'bot', text: entry.text }).text, entry.text, 'repair is idempotent');
  }
});

test('passed-on receipt starts a separate paragraph in both languages', () => {
  assert.equal(withPassedOn(audit, true, ['עברית']), `${audit}\n\n${tail}`);
  assert.match(withPassedOn('An answer.', true), /^An answer\.\n\nThe message/);
  assert.equal(withPassedOn('An answer.', false), 'An answer.');
});

test('real main-turn and side-loop answers reach the same pre-publication guard', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-readable-turns-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const home = path.join(dir, 'home');
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', '.credentials.json'), '{}');
  const socket = path.join(dir, 'daemon.sock'); fs.writeFileSync(socket, '');
  let release;
  const bots = new Bots({ dir: path.join(dir, 'bots'), checks: { home, socket }, bins: { claude: '/bin/true' },
    run: () => new Promise(resolve => { release = resolve; }),
    side: async () => ({ text: `REPLY: ${audit}\nPASS_ON: no` }) });
  bots.ownerWordsBase = path.join(dir, 'owner-words');
  const { bot } = bots.create({ name: 'Formatting turns', cwd: os.tmpdir() });
  const { bot: host } = bots.create({ name: 'Formatting host', cwd: os.tmpdir() });
  const { group } = bots.groups.create({ name: 'Formatting group', members: [bot.id] });
  const until = async fn => {
    for (let i = 0; i < 400; i++) { if (fn()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
    assert.fail('publication did not arrive');
  };
  bots.send(bot.id, 'Start the synthetic review', { owner: true });
  await until(() => release);
  bots.send(bot.id, 'What is the review scope?', { owner: true });
  await until(() => bots.messages(bot.id).some(m => m.side));
  const side = bots.messages(bot.id).find(m => m.side);
  assert.equal(words(side.text), audit);
  assert.ok(side.text.includes('\n\n'));
  assert.equal(structureProblem(side.text), null);
  // The fake running worker consumes the provisional answer review just as the
  // real inbox hook does; otherwise restart recovery schedules it again.
  const review = takeSteer(bots.folder(bot.id));
  assert.equal(review.length, 1);
  assert.equal(review[0].text, 'What is the review scope?');
  release({ text: audit });
  await until(() => !bots.running.has(bot.id));
  const main = bots.messages(bot.id).filter(m => m.role === 'bot' && !m.side).at(-1);
  assert.equal(words(main.text), audit);
  assert.ok(main.text.includes('\n\n'));
  assert.equal(structureProblem(main.text), null);
  bots.postEcho(bot.id, [`bot:${host.id}`, `group:${group.id}`], { role: 'bot', text: audit });
  for (const echo of [bots.messages(host.id).at(-1), bots.groups.messages(group.id).at(-1)]) {
    assert.equal(words(echo.text), audit);
    assert.equal(structureProblem(echo.text), null);
    assert.ok(echo.text.includes('\n\n'));
    assert.equal(echo.guest.id, bot.id);
  }
});

test('actual chat renders preserved audit as distinct paragraphs on desktop and phone', { timeout: 60000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-readable-ui-'));
  const configDir = path.join(dir, 'config'), botsHome = path.join(dir, 'home');
  fs.mkdirSync(configDir); fs.mkdirSync(botsHome);
  const port = 7900 + Math.floor(Math.random() * 100), base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['termcontrol/bridge/server.mjs'], { env: { ...process.env, TC_PORT: String(port), TC_CONFIG_DIR: configDir, TC_HOST: '127.0.0.1', TC_BOTS_HOME: botsHome, TC_NO_AGENT_HEALTH: '1', TC_NO_WATCHDOG: '1' }, stdio: 'ignore' });
  let browser;
  try {
    for (let i = 0; i < 80; i++) { try { await fetch(base + '/login'); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
    browser = await chromium.launch({ headless: true });
    const p = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
    await p.addInitScript(() => localStorage.setItem('termcontrol-fleet-tab', 'bots'));
    await p.goto(base);
    await p.evaluate(() => { document.querySelector('#email').value = 'owner@example.test'; document.querySelector('#password').value = 'synthetic-password'; document.querySelector('form').requestSubmit(); });
    await p.waitForSelector('.bots-home');
    const id = await p.evaluate(async () => (await (await fetch('/api/bots', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Readable audit fixture' }) })).json()).bot.id);
    const bots = new Bots({ dir: path.join(configDir, 'bots') });
    const entry = bots.append(id, { role: 'bot', text: withPassedOn(audit, true, ['עברית']), side: { forward: true } });
    for (const width of [1440, 390]) {
      await p.setViewportSize({ width, height: 1050 });
      await p.goto(base + '/#bot:' + id);
      const bubble = p.locator(`[data-mid="${entry.id}"] .bubble`);
      await bubble.waitFor();
      assert.ok(await bubble.locator('p').count() >= 5, 'real renderer must create separate paragraph elements');
      assert.equal(words(await bubble.innerText()), words(entry.text));
      assert.equal(await bubble.locator('p').last().getAttribute('dir'), 'rtl');
      assert.equal(await bubble.locator('p').last().innerText(), tail);
      assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.equal(await bubble.evaluate(el => el.scrollWidth > el.clientWidth + 1), false);
      if (process.env.TC_SHOT_DIR) {
        fs.mkdirSync(process.env.TC_SHOT_DIR, { recursive: true });
        await p.screenshot({ path: path.join(process.env.TC_SHOT_DIR, `readable-audit-${width}.png`), fullPage: true });
        await bubble.locator('p').first().scrollIntoViewIfNeeded();
        await p.screenshot({ path: path.join(process.env.TC_SHOT_DIR, `readable-audit-${width}-top.png`), fullPage: true });
        await bubble.locator('p').last().scrollIntoViewIfNeeded();
        await p.screenshot({ path: path.join(process.env.TC_SHOT_DIR, `readable-audit-${width}-bottom.png`), fullPage: true });
      }
    }
  } finally { await browser?.close(); server.kill('SIGKILL'); fs.rmSync(dir, { recursive: true, force: true }); }
});
