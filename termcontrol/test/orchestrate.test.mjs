import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  resolvePane, stateOf, framedMessage, waitForReply, parentsByPane,
} from '../bridge/orchestrate.mjs';
import { parseArgs, parseDays } from '../../scripts/termfleet-team.mjs';
import { Routines } from '../bridge/routines.mjs';
import { Profiles, rulesMessage } from '../bridge/profiles.mjs';
import { foldCodexStatus } from '../bridge/session-status.mjs';

// TF-096: every agent is a teammate (Grok Bot's model) — no single lead.
const panes = [
  { id: 'terminal-aaa-111', project: 'termfleet', alive: true, turn: 'idle' },
  { id: 'terminal-bbb-222', project: 'botson', alive: true, turn: 'working' },
  { id: 'terminal-ccc-333', project: 'botson', alive: true, turn: 'idle' },
  { id: 'terminal-ddd-444', project: 'old', alive: false, turn: 'idle' },
];

test('a teammate is found by id, id fragment or unique project, never the caller itself', () => {
  assert.equal(resolvePane(panes, 'terminal-bbb-222').pane.id, 'terminal-bbb-222');
  assert.equal(resolvePane(panes, 'ccc').pane.id, 'terminal-ccc-333');
  assert.equal(resolvePane(panes, 'termfleet', { selfId: 'terminal-bbb-222' }).pane.id, 'terminal-aaa-111');
  assert.match(resolvePane(panes, 'botson').error, /matches 2 terminals/);
  assert.equal(resolvePane(panes, 'aaa', { selfId: 'terminal-aaa-111' }).error, 'That is your own terminal.');
  assert.match(resolvePane(panes, 'nothing').error, /No terminal matches/);
});

test('state words are plain: closed, waiting, working, idle', () => {
  assert.equal(stateOf(panes[3]), 'closed');
  assert.equal(stateOf(panes[1]), 'working');
  assert.equal(stateOf({ alive: true, turn: 'idle', producing: true }), 'working');
  assert.equal(stateOf({ alive: true, turn: 'waiting' }), 'waiting');
  assert.equal(stateOf(panes[0]), 'idle');
});

test('a handed-over message says which agent sent it and where the answer goes', () => {
  const text = framedMessage('Run the tests', { id: 'terminal-aaa-111', project: 'termfleet' });
  assert.match(text, /^\[Message from the agent in "termfleet" terminal \(terminal-aaa-111\)/);
  assert.match(text, /Run the tests/);
  assert.match(text, /sender reads your reply here/);
  assert.match(text, /Ask the operator before anything risky or public/);
});

test('waiting returns once the teammate has worked and gone quiet twice', async () => {
  const states = ['working', 'working', 'idle', 'idle'];
  let i = 0;
  const panesFn = async () => [{ id: 'x', provider: 'none', alive: true, turn: states[Math.min(i++, states.length - 1)] }];
  const result = await waitForReply('x', { pollMs: 1, timeoutMs: 2000, panesFn });
  assert.equal(result.state, 'idle');
});

test('waiting stops at once when the teammate needs a person', async () => {
  const panesFn = async () => [{ id: 'x', provider: 'none', alive: true, turn: 'waiting' }];
  const result = await waitForReply('x', { pollMs: 1, timeoutMs: 2000, panesFn });
  assert.equal(result.state, 'waiting');
  assert.match(result.note, /waiting for a person/);
});

test('helpers know who started them', () => {
  const ws = { tabs: [{ childOf: { parentPaneId: 'p1' }, terminals: [{ id: 'c1' }, { id: 'c2' }] }, { terminals: [{ id: 'p1' }] }] };
  const parents = parentsByPane(ws);
  assert.equal(parents.get('c1'), 'p1');
  assert.equal(parents.get('c2'), 'p1');
  assert.equal(parents.has('p1'), false);
});

test('the team command reads flags and words', () => {
  assert.deepEqual(parseArgs(['abc', 'run', 'tests', '--timeout', '30', '--json']), { positional: ['abc', 'run', 'tests'], flags: { timeout: '30', json: true } });
});

test('an agent can schedule its own routine in plain day words', () => {
  assert.deepEqual(parseDays('daily'), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(parseDays('sun-thu'), [0, 1, 2, 3, 4]);
  assert.deepEqual(parseDays('mon,wed'), [1, 3]);
  assert.deepEqual(parseDays('1,5'), [1, 5]);
});

test('a routine an agent writes from the command line reaches the running bridge', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tf-routines-')), 'routines.json');
  const bridge = new Routines({ file });
  assert.equal(bridge.forPane('p1').length, 0);
  const agent = new Routines({ file });
  assert.equal(agent.create({ pane: 'p1', text: 'Check the build', days: [1], time: '09:00', createdBy: 'p1' }).ok, true);
  const seen = bridge.forPane('p1');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].createdBy, 'p1');
  // The bridge saving its own change must not drop the agent's routine.
  bridge.create({ pane: 'p2', text: 'Morning summary', days: [0], time: '08:00' });
  assert.equal(new Routines({ file }).data.routines.length, 2);
});

const html = fs.readFileSync(path.join(import.meta.dirname, '../app/index.html'), 'utf8');
const server = fs.readFileSync(path.join(import.meta.dirname, '../bridge/server.mjs'), 'utf8');

test('the chat shows a handed-over message as coming from the sending agent', () => {
  const line = html.split('\n').find((l) => l.startsWith('const teammateHandoff='));
  assert.ok(line, 'handoff parser is on the page');
  const teammateHandoff = new Function(`${line}; return teammateHandoff;`)();
  const parsed = teammateHandoff(framedMessage('Please run the export tests\nand report back', { id: 'terminal-aaa-111', project: 'termfleet' }));
  assert.deepEqual(parsed, { project: 'termfleet', id: 'terminal-aaa-111', body: 'Please run the export tests\nand report back' });
  assert.equal(teammateHandoff('Please run the tests'), null);
  assert.match(html, /if\(handoff\)\{kind='handoff'/);
});

test('an agent that answered since you last looked is marked as a new answer', () => {
  const start = html.indexOf('const seenKey=');
  const end = html.indexOf('function rememberCurrentChat(){');
  assert.ok(start > 0 && end > start);
  const store = new Map();
  const localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const make = new Function('localStorage', 'focusedPane', `${html.slice(start, end)}; return { markSeen, hasNewAnswer };`);
  const { hasNewAnswer } = make(localStorage, 'focused');
  const now = Date.now();
  store.set('termcontrol-seen:a', String(now - 60000));
  assert.equal(hasNewAnswer({ id: 'a', alive: true, lastActiveAt: now }, false), true);
  assert.equal(hasNewAnswer({ id: 'a', alive: true, lastActiveAt: now }, true), false, 'a working agent shows working, not new');
  assert.equal(hasNewAnswer({ id: 'a', alive: true, lastActiveAt: now - 58000 }, false), false, 'output right after you looked is not new');
  assert.equal(hasNewAnswer({ id: 'b', alive: true, lastActiveAt: now }, false), false, 'never opened: no mark');
  assert.equal(hasNewAnswer({ id: 'focused', alive: true, lastActiveAt: now, lastUsedAt: 1 }, false), false, 'the open chat is never unread');
  assert.match(html, /\$\{unread\?' unread':''\}/);
});

test('a teammate profile keeps a clean name, job and rules, and says when the rules changed', () => {
  const store = new Profiles(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tf-profiles-')), 'profiles.json'));
  const first = store.save('p1', { name: '  Quill ', job: 'Owns   the phone app', rules: 'Never push without asking.' });
  assert.equal(first.profile.name, 'Quill');
  assert.equal(first.profile.job, 'Owns the phone app');
  assert.equal(first.rulesChanged, true);
  assert.equal(store.save('p1', { name: 'Quill', job: 'Phone app', rules: 'Never push without asking.' }).rulesChanged, false);
  assert.match(store.save('p1', { name: '"; rm -rf', job: '', rules: '' }).error, /letters, numbers/);
  assert.equal(store.save('p1', { name: '', job: '', rules: '' }).profile, null);
  assert.equal(store.get('p1'), null);
  assert.match(rulesMessage({ name: 'Quill', job: 'Owns the phone app', rules: 'Never push.' }), /^You are "Quill", Owns the phone app\. Standing rules from the operator/);
});

test('teammates can be called by their profile name', () => {
  const named = [...panes, { id: 'terminal-eee-555', project: 'botson', alive: true, turn: 'idle', profile: { name: 'Quill' } }];
  assert.equal(resolvePane(named, '@quill').pane.id, 'terminal-eee-555');
  assert.match(framedMessage('hi', { id: 'terminal-eee-555', project: 'botson', profile: { name: 'Quill' } }), /agent in "Quill" terminal/);
  assert.match(html, /async function profileDialog\(paneId\)/);
  assert.match(server, /url\.pathname === '\/api\/profile' && req\.method === 'POST'/);
});

test('a weekly-only Codex limit is not also shown as the 5-hour limit', () => {
  const at = '2026-10-16T10:00:00Z';
  const weeklyOnly = foldCodexStatus([{ timestamp: at, payload: { type: 'token_count', rate_limits: { primary: { used_percent: 26, window_minutes: 10080, resets_at: 1792900000 }, secondary: null } } }]);
  assert.equal(weeklyOnly.limits.fiveHour, null);
  assert.equal(weeklyOnly.limits.weekly.remainingPercent, 74);
  const both = foldCodexStatus([{ timestamp: at, payload: { type: 'token_count', rate_limits: { primary: { used_percent: 10, window_minutes: 300 }, secondary: { used_percent: 40, window_minutes: 10080 } } } }]);
  assert.equal(both.limits.fiveHour.remainingPercent, 90);
  assert.equal(both.limits.weekly.remainingPercent, 60);
  const old = foldCodexStatus([{ timestamp: at, payload: { type: 'token_count', rate_limits: { primary: { used_percent: 5 }, secondary: { used_percent: 50 } } } }]);
  assert.equal(old.limits.fiveHour.remainingPercent, 95, 'older logs without window lengths still read by position');
});
