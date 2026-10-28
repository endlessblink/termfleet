import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { issueBotCaller, resolveBotCaller, BOT_CALLER_TOKEN_ENV } from '../../scripts/lib/bot-caller.mjs';
import { closeOwnTerminal } from '../../scripts/lib/team-close.mjs';
import { Bots } from '../bridge/bots.mjs';
import { leftOpen } from '../bridge/bot-events.mjs';
import { captureMessage, record } from '../bridge/requirements.mjs';

test('queued completion labels its snapshot and current fold excludes five subsequently transferred requests', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helper-transfer-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bots = new Bots({ dir: path.join(root, 'bots'), run: async () => ({ text: '' }), fill: () => null });
  const bot = bots.create({ name: 'Owner', cwd: root }).bot;
  const dir = bots.reqDir();
  const ids = Array.from({ length: 5 }, (_, n) => captureMessage({ text: `Complete request number ${n}`, msgId: `m-${n}`, project: root, source: `bot:${bot.id}`, at: 1 }, { dir })[0].id);
  record(ids.map(id => ({ e: 'assign', id, pane: 'quota-worker', delivery: 'D-old', at: 2 })), { dir });
  assert.equal(bots.openWork(bot.id).filter(item => item.where === 'quota-worker').length, 5);
  const queued = leftOpen(bots, bot.id, 'quota-worker', 1000);
  record(ids.map(id => ({ e: 'assign', id, pane: 'context-worker', delivery: 'D-new', at: 3 })), { dir });
  assert.equal(bots.openWork(bot.id).filter(item => item.where === 'quota-worker').length, 0);
  assert.equal(bots.openWork(bot.id).filter(item => item.where === 'context-worker').length, 5);
  assert.match(queued, /Historical snapshot recorded 1970-01-01T00:00:01.000Z: 5 unfinished requests were assigned/);
  assert.match(queued, /does not establish the current assignment/);
  assert.match(queued, /check its current assignments with termfleet-asks items/);
  assert.doesNotMatch(queued, /still holds/);
  const fresh = leftOpen(bots, bot.id, 'quota-worker', 2000);
  assert.doesNotMatch(fresh, /5 unfinished|R-1|Historical snapshot/);
  assert.match(fresh, /check its current assignments/);
});

test('validated historical owner survives a later observer, while unrelated bots and observers cannot close', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helper-close-owner-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const options = { base: path.join(root, 'receipts'), now: 1000 };
  const pane = { id: 'terminal-quota', sessionId: 'worker-session', provider: 'codex', turn: 'idle', alive: true };
  const ownerFolder = path.join(root, 'owner'), otherFolder = path.join(root, 'other');
  fs.mkdirSync(ownerFolder); fs.mkdirSync(otherFolder);
  const owner = issueBotCaller({ id: 'aaaaaaaaaaaa', name: 'Owner', provider: 'codex', botFolder: ownerFolder }, options);
  const observer = issueBotCaller({ id: 'bbbbbbbbbbbb', name: 'Observer', provider: 'codex', botFolder: otherFolder }, options);
  fs.writeFileSync(path.join(ownerFolder, 'helpers.json'), JSON.stringify([
    { paneId: pane.id, task: 'Original owned work', at: 1 },
    { paneId: pane.id, followed: true, ended: 5, task: 'Later observation', at: 2 },
  ]));
  fs.writeFileSync(path.join(otherFolder, 'helpers.json'), JSON.stringify([{ paneId: pane.id, followed: true, at: 3 }]));
  const requests = [], changes = () => null;
  const closeAs = async (run) => {
    const caller = resolveBotCaller({ [BOT_CALLER_TOKEN_ENV]: run.token }, options);
    const owned = JSON.parse(fs.readFileSync(path.join(caller.botFolder, 'helpers.json'), 'utf8')).filter(h => h?.paneId && !h.followed);
    return closeOwnTerminal({ query: pane.id, panes: [pane], owned,
      resolvePane: () => ({ pane }), stateOf: p => p.turn, changes, unsaved: () => [],
      request: async id => { requests.push(id); return { ok: true }; }, record: () => {}, by: `bot:${caller.botId}` });
  };
  assert.equal((await closeAs(owner)).ok, true, 'fake request accepts original ownership despite later observer');
  assert.equal(requests.length, 1);
  assert.match((await closeAs(observer)).text, /you did not start/);
  assert.equal(requests.length, 1, 'observer never reaches fake close');
  fs.writeFileSync(path.join(otherFolder, 'helpers.json'), '[]');
  assert.match((await closeAs(observer)).text, /you did not start/);
  assert.equal(requests.length, 1, 'unrelated bot never reaches fake close');
  assert.throws(() => resolveBotCaller({ [BOT_CALLER_TOKEN_ENV]: observer.token, TERMFLEET_BOT_ID: 'aaaaaaaaaaaa' }, options));
});
