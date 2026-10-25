// R-15307 screen guard: agents marked UI work "done" once the code was committed, before Noam
// ever saw it. Items on a visual topic can be marked ready by an agent, never done; only his own
// verified message (owner-words) closes them. Non-visual topics stay done-with-evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { captureMessage, loadLedger, markItem, record, addTopic, setTopicVisual, isVisualTopic } from '../bridge/requirements.mjs';
import { recordOwnerWords } from '../bridge/owner-words.mjs';
import { cli, statusFromItems } from '../../scripts/termfleet-asks.mjs';

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const setup = () => {
  const dir = tmp('visual-guard-');
  const config = tmp('visual-guard-owner-');
  process.env.TC_CONFIG_DIR = config; // where Noam's recorded words live
  return { dir, config, env: { TERMFLEET_REQ_DIR: dir } };
};
const SHOT_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'visual-shot-')), 'shot.png');
fs.writeFileSync(SHOT_FILE, 'png');
const SHOT = `screenshot after relaunch: folders show in the sidebar ${SHOT_FILE}`;

test('defaults: the screen topics are visual, the plumbing topics are not, unknown topics are not', () => {
  for (const t of ['eyes-emoji', 'sidebar-folders', 'bot-menu-display', 'chat-jitter', 'scroll-jump-to-top', 'image-back-black-screen', 'inline-media', 'duplicate-messages', 'counter-card']) assert.equal(isVisualTopic(t), true, t);
  for (const t of ['model-routing', 'resource-balancing', 'token-optimization', 'codex-routing', 'reliability', 'something-new']) assert.equal(isVisualTopic(t), false, t);
});

test('an agent marking a screen item done is refused with a clear message; ready is allowed', () => {
  const { dir, env } = setup();
  captureMessage({ text: 'show my folders in the sidebar', project: 'tf', source: 's', msgId: 'a' }, { dir });
  addTopic(['R-1'], 'sidebar-folders', { dir });
  const refused = cli(['done', 'R-1', '--evidence', SHOT], env);
  assert.equal(refused.ok, false);
  assert.match(refused.message, /screen topic \(sidebar-folders\): an agent can mark it ready, never done/);
  assert.match(refused.message, /termfleet-asks lock R-1 --owner-words/);
  assert.equal(cli(['ready', 'R-1', '--evidence', SHOT], env).ok, true);
  assert.equal(loadLedger({ dir }).items.get('R-1').status, 'ready');
});

test('a non-screen item can still be marked done by an agent with evidence', () => {
  const { dir, env } = setup();
  captureMessage({ text: 'route small jobs to haiku', project: 'tf', source: 's', msgId: 'b' }, { dir });
  addTopic(['R-1'], 'model-routing', { dir });
  assert.equal(cli(['done', 'R-1', '--evidence', `router test: 12 of 12 passing ${SHOT_FILE}`], env).ok, true);
  assert.equal(loadLedger({ dir }).items.get('R-1').status, 'done');
});

test('writing around the command (raw ledger write, bots) is refused too, and an old unconfirmed done reads as ready', () => {
  const { dir } = setup();
  captureMessage({ text: 'stop the chat jitter', project: 'tf', source: 's', msgId: 'c' }, { dir });
  record([{ e: 'status', id: 'R-1', status: 'done', evidence: SHOT }], { dir }); // before it had a topic
  assert.equal(loadLedger({ dir }).items.get('R-1').status, 'done');
  addTopic(['R-1'], 'chat-jitter', { dir });
  assert.equal(loadLedger({ dir }).items.get('R-1').status, 'ready', 'unconfirmed done on a screen topic is ready');
  assert.throws(() => record([{ e: 'status', id: 'R-1', status: 'done', evidence: SHOT }], { dir }), /never done/);
  assert.throws(() => record([{ e: 'status', id: 'R-1', status: 'done', evidence: SHOT, ownerMsg: 'made-up' }], { dir }), /never done/);
  assert.throws(() => record([{ e: 'lock', id: 'R-1', by: 'Noam: works' }], { dir }), /never done/);
  assert.match(markItem({ status: 'done', id: 'R-1', evidence: SHOT }, { dir }).error, /never done/);
});

test('only his verified message closes a screen item: typed words are refused, owner-words work', () => {
  const { dir, env, config } = setup();
  captureMessage({ text: 'the eyes emoji shows while you work', project: 'tf', source: 's', msgId: 'd' }, { dir });
  addTopic(['R-1'], 'eyes-emoji', { dir });
  assert.equal(cli(['ready', 'R-1', '--evidence', `screenshot: eyes emoji on the bot card ${SHOT_FILE}`], env).ok, true);
  const typed = cli(['lock', 'R-1', '--noam-said', 'works'], env);
  assert.equal(typed.ok, false);
  assert.match(typed.message, /only Noam's own recorded message closes it/);
  assert.equal(cli(['lock', 'R-1', '--owner-words', 'nope123'], env).ok, false);
  recordOwnerWords({ id: 'abc123', at: Date.now(), botId: 'b', bot: 'Botty', text: 'עובד, תודה' }, { base: config });
  assert.equal(cli(['lock', 'R-1', '--owner-words', 'abc123'], env).ok, true);
  const it = loadLedger({ dir }).items.get('R-1');
  assert.equal(it.status, 'done');
  assert.equal(it.locked, true);
  assert.equal(it.confirmedBy, 'abc123');
});

test('the visual flag is topic metadata: anyone can turn it on, only his message can turn it off', () => {
  const { dir, env, config } = setup();
  captureMessage({ text: 'the new settings page', project: 'tf', source: 's', msgId: 'e' }, { dir });
  addTopic(['R-1'], 'settings-page', { dir });
  assert.equal(cli(['done', 'R-1', '--evidence', SHOT], env).ok, true, 'unknown topic: not visual by default');
  assert.equal(cli(['topic-meta', 'settings-page', '--visual', 'true'], env).ok, true);
  assert.equal(loadLedger({ dir }).items.get('R-1').status, 'ready', 'once visual, the agent-only done reads ready');
  const off = cli(['topic-meta', 'settings-page', '--visual', 'false'], env);
  assert.equal(off.ok, false);
  assert.match(off.message, /only Noam can say it is not/);
  assert.throws(() => setTopicVisual('sidebar-folders', false, { dir }), /only Noam can say it is not/);
  recordOwnerWords({ id: 'def456', at: Date.now(), botId: 'b', bot: 'Botty', text: 'settings page is not a screen thing' }, { base: config });
  assert.equal(cli(['topic-meta', 'settings-page', '--visual', 'false', '--owner-words', 'def456'], env).ok, true);
  assert.equal(loadLedger({ dir }).items.get('R-1').status, 'done');
  // Setting it while tagging: termfleet-asks topic R-n <topic> --visual true
  captureMessage({ text: 'the counter card', project: 'tf', source: 's', msgId: 'f' }, { dir });
  assert.equal(cli(['topic', 'R-2', 'stats-card', '--visual', 'true'], env).ok, true);
  assert.equal(loadLedger({ dir }).items.get('R-2').visual, true);
});

test('a whole request the agent marked done shows as ready while a screen part waits for Noam', () => {
  const parts = [{ id: 'R-1', status: 'done', visual: false }, { id: 'R-2', status: 'ready', visual: true }];
  assert.equal(statusFromItems({ n: 1, status: 'done' }, parts), 'ready');
  assert.equal(statusFromItems({ n: 1, status: 'done' }, [{ id: 'R-2', status: 'new', visual: true }]), 'ready');
  assert.equal(statusFromItems({ n: 1, status: 'done' }, [{ id: 'R-2', status: 'locked', visual: true }]), 'done');
  assert.equal(statusFromItems({ n: 1, status: 'done' }, [{ id: 'R-1', status: 'done', visual: false }]), 'done');
});
