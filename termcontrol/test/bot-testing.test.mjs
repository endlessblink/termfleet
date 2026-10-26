import test from 'node:test';
import assert from 'node:assert/strict';
import { testingHandoffProblem, tryNowItems } from '../bridge/bot-testing.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hook } from '../../scripts/termfleet-asks.mjs';
import { recordBrowserReceipt } from '../bridge/browser-receipts.mjs';
import { captureMessage, record, loadLedger, markItem } from '../bridge/requirements.mjs';
import { saveTestingHandoff } from '../bridge/bot-testing.mjs';
import { startLinkServer } from './helpers/link-server.mjs';
import { Bots } from '../bridge/bots.mjs';

const ok = { botId: 'abc123abc123', since: 100, hasReceipt: () => true, checkLink: () => null };
test('reported fixes and versions need a specific testing line and link', () => {
  for (const text of ['The fix is ready.', 'Deployed version A2r7.', 'Keyboard selection is fixed.', 'תוקן הסאונד.', 'תיקנתי את הבחירה.', 'The sound is not fixed; keyboard selection is fixed.']) assert.match(testingHandoffProblem(text, ok), /Try:/);
  assert.equal(testingHandoffProblem('The fix is ready.\nTry: Select two fighters using the arrow keys https://example.org/game', ok), null);
  assert.equal(testingHandoffProblem('It is not ready; the build failed.', ok), null);
  assert.equal(testingHandoffProblem('I am investigating the sound issue.', ok), null);
});
test('a receipt from this bot and turn plus a working response are required', () => {
  const text = 'Version A2r7 is ready.\nTry: Choose two fighters https://example.org/game';
  assert.match(testingHandoffProblem(text, { ...ok, hasReceipt: () => false }), /browser/);
  assert.match(testingHandoffProblem(text, { ...ok, checkLink: () => 'answered 404' }), /404/);
  assert.match(testingHandoffProblem('Ready.\nTry: https://example.org/game', ok), /specific/);
  assert.match(testingHandoffProblem('Here is the result.', { ...ok, markedReady: true }), /Try:/);
});
test('Try now uses every ready ledger item, including legacy gaps, without a cap', () => {
  const items = Array.from({ length: 75 }, (_, i) => ({ id: `R-${i}`, status: 'ready', words: `Task ${i}`, note: 'Try: Choose two fighters https://example.org/game' }));
  items.push({ id: 'R-old', status: 'ready', words: 'Old task', note: '', evidence: [] });
  items.push({ id: 'R-done', status: 'done', words: 'Closed' });
  const out = tryNowItems(items);
  assert.equal(out.length, 76);
  assert.equal(out[0].link, 'https://example.org/game');
  assert.equal(out[0].tryText, 'Choose two fighters');
  assert.equal(out.at(-1).link, null);
});

test('real Stop blocks repeat attempts, a stale receipt and HTTP errors; valid browser handoff passes', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-handoff-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const srv = await startLinkServer();
  t.after(() => srv.stop());
  const botId = 'abc123abc123', since = Date.now();
  const env = { TERMFLEET_BOT_ID: botId, TERMFLEET_REQ_DIR: dir, TERMFLEET_BROWSER_RECEIPTS_DIR: dir, TERMFLEET_BOT_TURN_STARTED_AT: String(since), TERMFLEET_REQUIREMENTS: 'off' };
  const run = (text) => hook({ hook_event_name: 'Stop', stop_hook_active: true, last_assistant_message: text }, { env, readLines: () => [] });
  for (let i = 0; i < 6; i++) assert.equal(run('The fix is ready.').decision, 'block');
  const url = srv.url('/ok'), text = `The fix is ready.\nTry: Pick two fighters ${url}`;
  recordBrowserReceipt({ botId, url, at: since - 1000 }, { dir });
  assert.match(run(text).reason, /browser/);
  recordBrowserReceipt({ botId, url }, { dir });
  assert.equal(run(text), null);
  const missing = srv.url('/missing');
  recordBrowserReceipt({ botId, url: missing }, { dir });
  assert.match(run(`The fix is ready.\nTry: Pick two fighters ${missing}`).reason, /404/);
  const [item] = captureMessage({ text: 'Repair selection', source: `bot:${botId}`, project: 'fixture' }, { dir });
  assert.match(markItem({ status: 'ready', id: item.id, evidence: `Browser verification passes at ${url}` }, { dir }).error, /Try:/);
  record([{ e: 'status', id: item.id, status: 'ready', evidence: 'fixture' }], { dir });
  assert.match(run('Here is the result.').reason, /Try:/, 'a ready mark cannot be hidden by neutral wording');
  saveTestingHandoff(text, botId, since, { dir });
  assert.equal(tryNowItems([...loadLedger({ dir }).items.values()])[0].link, url);
});

test('publication backstop holds unchecked reports and bounds failed repair retries', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-publication-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [folder, file] of [['.claude', '.credentials.json'], ['.codex', 'auth.json']]) {
    fs.mkdirSync(path.join(dir, folder)); fs.writeFileSync(path.join(dir, folder, file), '{}');
  }
  const socket = path.join(dir, 'daemon.sock'); fs.writeFileSync(socket, '');
  let calls = 0;
  const bots = new Bots({ dir: path.join(dir, 'bots'), checks: { home: dir, socket }, run: async () => { calls++; return { text: 'The fix is ready.' }; } });
  const { bot } = bots.create({ name: 'Testing handoff fixture', cwd: dir });
  bots.send(bot.id, 'Check the fix');
  for (let i = 0; i < 200 && bots.running.has(bot.id); i++) await new Promise((r) => setTimeout(r, 5));
  assert.equal(calls, 3);
  assert.equal(bots.messages(bot.id).some((m) => m.role === 'bot' && /fix is ready/.test(m.text)), false);
  assert.match(bots.messages(bot.id).at(-1).text, /held/);
});

test('publication repairs an unchecked report and publishes a browser-checked testing action', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-publication-valid-'));
  const previous = process.env.TERMFLEET_BROWSER_RECEIPTS_DIR;
  process.env.TERMFLEET_BROWSER_RECEIPTS_DIR = dir;
  t.after(() => {
    if (previous === undefined) delete process.env.TERMFLEET_BROWSER_RECEIPTS_DIR;
    else process.env.TERMFLEET_BROWSER_RECEIPTS_DIR = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const srv = await startLinkServer(); t.after(() => srv.stop());
  for (const [folder, file] of [['.claude', '.credentials.json'], ['.codex', 'auth.json']]) {
    fs.mkdirSync(path.join(dir, folder)); fs.writeFileSync(path.join(dir, folder, file), '{}');
  }
  const socket = path.join(dir, 'daemon.sock'); fs.writeFileSync(socket, '');
  let calls = 0, id;
  const reply = `The fix is ready.\nTry: Pick two fighters ${srv.url('/ok')}`;
  const bots = new Bots({ dir: path.join(dir, 'bots'), checks: { home: dir, socket }, run: async () => {
    if (++calls === 1) return { text: 'The fix is ready.' };
    recordBrowserReceipt({ botId: id, url: srv.url('/ok') }, { dir });
    return { text: reply };
  } });
  id = bots.create({ name: 'Valid handoff fixture', cwd: dir }).bot.id;
  bots.send(id, 'Check the fix');
  for (let i = 0; i < 400 && bots.running.has(id); i++) await new Promise((r) => setTimeout(r, 5));
  assert.equal(calls, 2);
  assert.equal(bots.messages(id).filter((m) => m.role === 'bot' && m.text === reply).length, 1);
});
