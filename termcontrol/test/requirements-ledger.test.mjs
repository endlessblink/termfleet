// TF-102 owner requirements ledger. Each test replays one failure from the politic-fighter
// bot (2026-10-22, docs/specs/owner-requirements-ledger.md), shows how the old path let it
// through, and proves the new gate blocks it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const REPO = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
import {
  splitMessage, captureMessage, loadLedger, markItem, record, addTopic, briefItems, briefBlock, briefedIds,
  stopProblem, ownerTextOf, itemsView, evidenceProblem, BRIEF_HEADER,
} from '../bridge/requirements.mjs';
import { confirmReceipt, confirmStarted, codexTrustPrompt, trustDecision, pendingCodexHooks, freshRecordsHave } from '../bridge/delivery.mjs';
import { framedMessage } from '../bridge/orchestrate.mjs';
import { asksFrom, hook, cli } from '../../scripts/termfleet-asks.mjs';
import { requirementIds } from '../../scripts/termfleet-team.mjs';
import { Bots } from '../bridge/bots.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'req-ledger-'));
const user = (text) => JSON.stringify({ type: 'user', message: { content: text }, timestamp: '2026-10-22T20:00:00Z' });
const assistantTool = (command) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', input: { command } }] } });
const assistantText = (text) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
const mark = (dir, status, id, extra = {}) => { const r = markItem({ status, id, ...extra }, { dir }); if (r.error) throw new Error(r.error); record(r.events, { dir }); };

const FOUR_PARTS = 'Fix the politic page:\n(1) the title strip faces must fill the strip\n(2) the faces loop endlessly\n(3) portraits keep their colours\n(4) the share button works on the phone';

test('failure 1: a four-part message was ONE request and a vague "partial" dropped parts; now each part is its own item and the turn cannot end with any untaken', () => {
  const dir = tmp();
  // The old tracker: one request for the whole message.
  assert.equal(asksFrom([user(FOUR_PARTS)]).length, 1, 'old tracker saw a single request');

  const items = captureMessage({ text: FOUR_PARTS, project: 'politic-fighter', source: 'conv-a', askN: 1 }, { dir });
  assert.deepEqual(items.map((it) => it.words), [
    'Fix the politic page:', 'the title strip faces must fill the strip', 'the faces loop endlessly', 'portraits keep their colours', 'the share button works on the phone',
  ]);
  assert.deepEqual(items.map((it) => it.id), ['R-1', 'R-2', 'R-3', 'R-4', 'R-5']);

  // The vague old-style "partial" on #1, with every part still untaken: the stop is blocked.
  const blocked = stopProblem({ source: 'conv-a', lastMessage: 'Partial: some of it is done.', askMarks: [{ status: 'partial', n: 1 }] }, { dir });
  assert.match(blocked, /5 items nobody has taken/);
  assert.match(blocked, /R-2 "the title strip faces must fill the strip"/);

  // partial must name exactly what is open.
  assert.match(markItem({ status: 'partial', id: 'R-2', note: 'mostly' }, { dir }).error, /must list exactly which parts are still open/);
  mark(dir, 'context', 'R-1', { note: 'heading of the list' });
  mark(dir, 'ready', 'R-2', { evidence: 'screenshot of the live page shows 9 faces across the full strip width' });
  mark(dir, 'partial', 'R-3', { open: ['loop stutters on Safari'] });
  mark(dir, 'waiting', 'R-4', { note: 'asked Noam which colours are the approved ones' });
  // An old-style "#1 done" while R-5 is still untaken is refused at stop.
  assert.match(stopProblem({ source: 'conv-a', askMarks: [{ status: 'done', n: 1 }] }, { dir }), /1 item nobody has taken/);
  mark(dir, 'assigned', 'R-5');
  assert.match(stopProblem({ source: 'conv-a', askMarks: [{ status: 'done', n: 1 }] }, { dir }), /Request #1 is marked done, but its parts R-3 \[partial\], R-4 \[waiting\], R-5 \[assigned\] are not/);
  assert.equal(stopProblem({ source: 'conv-a', askMarks: [{ status: 'partial', n: 1 }] }, { dir }), null, 'every part is accounted for');
});

test('failure 1 through the real hook: the message is split on submit, and Stop blocks every time (not once) until the items are taken', () => {
  const dir = tmp();
  const env = { TERMFLEET_REQ_DIR: dir, TERMFLEET_PROJECT: 'politic-fighter' };
  const lines = [];
  const payload = (event, extra = {}) => ({ hook_event_name: event, transcript_path: '/conv/b.jsonl', cwd: '/x', ...extra });
  const shown = hook(payload('UserPromptSubmit', { prompt: FOUR_PARTS }), { readLines: () => lines, env });
  assert.match(shown.hookSpecificOutput.additionalContext, /split into 5 items/);
  assert.match(shown.hookSpecificOutput.additionalContext, /R-4: "portraits keep their colours"/);
  lines.push(user(FOUR_PARTS));
  // The same prompt seen twice (hook re-run) never duplicates items.
  hook(payload('UserPromptSubmit', { prompt: FOUR_PARTS }), { readLines: () => [], env });
  assert.equal(loadLedger({ dir }).items.size, 5);
  lines.push(assistantText('Done, all fixed.'));
  const first = hook(payload('Stop'), { readLines: () => lines, env });
  assert.equal(first.decision, 'block');
  const again = hook(payload('Stop', { stop_hook_active: true }), { readLines: () => lines, env });
  assert.equal(again?.decision, 'block', 'the old reminder mode let the second stop through');
});

test('the gate cannot loop forever: after repeated blocks it lets go but puts the problem in Noam\'s own list', () => {
  const dir = tmp();
  const env = { TERMFLEET_REQ_DIR: dir, TERMFLEET_PROJECT: 'p' };
  const lines = [user('Make the header blue. Also add a logout button.')];
  hook({ hook_event_name: 'UserPromptSubmit', transcript_path: '/conv/c.jsonl', prompt: 'Make the header blue. Also add a logout button.' }, { readLines: () => [], env });
  const stop = () => hook({ hook_event_name: 'Stop', transcript_path: '/conv/c.jsonl', stop_hook_active: true }, { readLines: () => lines, env });
  for (let i = 0; i < 4; i++) assert.equal(stop()?.decision, 'block');
  assert.equal(stop(), null);
  const view = itemsView({ project: 'p' }, { dir });
  assert.equal(view.escalations.length, 1);
  assert.match(view.escalations[0].reason, /2 items nobody has taken/);
});

test('failure 2: the earlier "fill the strip and loop endlessly" was lost when the strip broke; now his earlier words on the topic travel with the new item', () => {
  const dir = tmp();
  const [early] = captureMessage({ text: 'The title strip faces must fill the strip and loop endlessly', project: 'politic-fighter', source: 'bot:aaaaaaaaaaaa', msgId: 'm1' }, { dir });
  addTopic([early.id], 'title-strip', { dir });
  const [later] = captureMessage({ text: "The title strip is empty", project: 'politic-fighter', source: 'bot:aaaaaaaaaaaa', msgId: 'm2' }, { dir });
  assert.deepEqual(later.topics, ['title-strip'], 'tagged automatically by the topic name in his words');
  const block = briefBlock(briefItems([later.id], { dir }));
  assert.match(block, /R-2 \(title-strip\): "The title strip is empty"/);
  assert.match(block, /Still open on the same topic[\s\S]*R-1 \(title-strip\): "The title strip faces must fill the strip and loop endlessly"/);
  // A Hebrew alias finds it too.
  addTopic([early.id], 'title-strip', { aliases: ['פס הכותרת'], dir });
  const [hebrew] = captureMessage({ text: 'פס הכותרת שוב ריק', project: 'politic-fighter', source: 'bot:aaaaaaaaaaaa', msgId: 'm3' }, { dir });
  assert.deepEqual(hebrew.topics, ['title-strip']);
});

test('failure 3: briefs paraphrased him; now a bot cannot hand work over without naming his items, and the brief carries his exact words', () => {
  const dir = tmp();
  const env = { TERMFLEET_BOT_ID: 'd557f3283bc8' };
  const [it] = captureMessage({ text: 'portraits must keep their original colours', project: 'politic-fighter', source: 'bot:d557f3283bc8', msgId: 'm9' }, { dir });
  const untaken = () => [it];
  const refused = requirementIds({}, 'please fix the portrait colours', { env, untaken });
  assert.match(refused.error, /Name the items of Noam's this hand-off is for/);
  assert.match(refused.error, /R-1 "portraits must keep their original colours"/);
  assert.deepEqual(requirementIds({ req: 'R-1' }, 'fix it', { env, untaken }).ids, ['R-1']);
  assert.deepEqual(requirementIds({}, 'work on R-1 please', { env, untaken }).ids, ['R-1'], 'an id in the text counts');
  assert.match(requirementIds({ 'no-req': true }, 'are you free?', { env, untaken }).error, /needs a reason/);
  assert.deepEqual(requirementIds({ 'no-req': 'only asking whether it is free' }, 'are you free?', { env, untaken }).ids, []);
  // Passing his own message on carries the items it was split into.
  assert.deepEqual(requirementIds({}, 'go', { env, untaken, ownerWords: { id: 'm9' }, itemsOf: (m) => (m === 'm9' ? ['R-1'] : []) }).ids, ['R-1']);
  const framed = framedMessage('fix the portraits', { bot: 'politic', id: 'bot:d557f3283bc8' }, { requirements: briefBlock(briefItems(['R-1'], { dir }), { delivery: 'D-1' }), delivery: 'D-1' });
  assert.ok(framed.includes('R-1: "portraits must keep their original colours"'), 'his words, verbatim');
  assert.equal(framed.split('[delivery D-1]').length, 2, 'one receipt mark');
  // The receiving agent knows exactly which items it was handed.
  assert.deepEqual(briefedIds([framed]), ['R-1']);
});

test('failure 4: a message to an idle Codex terminal was not received but counted as sent; now it is an error', async () => {
  const pane = { id: 'terminal-x', provider: 'codex', turn: 'idle', alive: true };
  const deps = { panes: async () => [pane], screen: async () => '› fix the portraits [delivery D-9]', transcript: () => null, write: async () => {}, pending: () => [], fresh: () => false };
  const r = await confirmReceipt(pane, { token: '[delivery D-9]', timeoutMs: 60, pollMs: 10, deps });
  assert.equal(r.received, false);
  assert.equal(r.reason, 'not-received');
  assert.match(r.message, /did not receive the message/);

  // Received once the mark is in its own record.
  const dir = tmp();
  const file = path.join(dir, 'rollout.jsonl');
  fs.writeFileSync(file, JSON.stringify({ type: 'response_item', payload: { role: 'user', content: [{ type: 'input_text', text: 'x [delivery D-9]' }] } }) + '\n');
  const ok = await confirmReceipt(pane, { token: '[delivery D-9]', timeoutMs: 200, pollMs: 10, deps: { ...deps, transcript: () => file } });
  assert.equal(ok.received, true);
});

test('failure 4d: a message steered into a busy Codex turn counted as NOT delivered because no record was linked to that terminal; a fresh record holding the mark now proves it', async () => {
  // politic bot 2026-10-23: "termfleet-team ask" to a working Codex terminal with no status hooks
  // printed NOT delivered; its rollout had the message 5 s later and it answered in the same turn.
  const home = tmp();
  const now = new Date();
  const day = path.join(home, '.codex', 'sessions', String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0'));
  fs.mkdirSync(day, { recursive: true });
  const rollout = path.join(day, 'rollout-busy.jsonl');
  fs.writeFileSync(path.join(day, 'rollout-other.jsonl'), '{"old":"[delivery D-aaaaaaaa]"}\n');
  const pane = { id: 'terminal-2f0f0028', provider: 'codex', turn: 'idle', producing: true, alive: true, cwd: home };
  let polls = 0;
  const deps = {
    panes: async () => [pane], screen: async () => '• Working (3m 10s)', transcript: () => null, write: async () => {}, pending: () => [],
    fresh: (token, since) => freshRecordsHave(token, since, { home, cwd: home }),
  };
  // Before the fix: no linked record, the turn never "starts" (it was already running) → NOT delivered.
  const before = await confirmReceipt(pane, { token: '[delivery D-12345678]', wasBusy: false, timeoutMs: 80, pollMs: 10, deps: { ...deps, fresh: () => false } });
  assert.equal(before.received, false);
  // The steered message lands in its rollout a moment after the send.
  const later = confirmReceipt(pane, { token: '[delivery D-12345678]', wasBusy: true, timeoutMs: 2000, pollMs: 20, deps: { ...deps, panes: async () => { if (++polls === 3) fs.writeFileSync(rollout, JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'x [delivery D-12345678]' }] } }) + '\n'); return [pane]; } } });
  const r = await later;
  assert.equal(r.received, true);
  assert.equal(r.how, 'record');
  // An old record with another mark, or a file older than the send, never counts.
  assert.equal(freshRecordsHave('[delivery D-aaaaaaaa]', Date.now() + 60_000, { home }), false);
  assert.equal(freshRecordsHave('[delivery D-99999999]', 0, { home }), false);
});

const TRUST_SCREEN = 'Hooks need review\nHooks can run outside the sandbox.\n  1. Review hooks\n› 2. Trust all and continue\n  3. Continue without trusting (hooks won\'t run)';

test('failure 4b: new Codex terminals sat on "Hooks need review" until someone sent 3 (which also left the hooks off); TermFleet\'s own hooks are now trusted and the start continues', async () => {
  assert.deepEqual(codexTrustPrompt(TRUST_SCREEN), { trustOption: '2', skipOption: '3' });
  const own = [{ command: `node "${fileURLToPath(new URL('../../scripts/termfleet-codex-status-hook.mjs', import.meta.url))}"` }];
  assert.deepEqual(trustDecision(TRUST_SCREEN, { pending: own, root: REPO }), { press: '2' });
  const foreign = [{ command: 'node /tmp/some-project/.codex/evil.mjs' }];
  assert.match(trustDecision(TRUST_SCREEN, { pending: foreign, root: REPO }).error, /waiting for Noam to review 1 unknown hook/);

  const writes = [];
  let started = false;
  const pane = { id: 'terminal-new', provider: 'codex', turn: 'idle' };
  const deps = {
    panes: async () => [{ ...pane, turn: started ? 'working' : 'idle' }],
    screen: async () => (started ? '' : TRUST_SCREEN),
    transcript: () => null,
    write: async (_id, data) => { writes.push(data); if (data === '\r') started = true; },
    pending: () => own.map((h) => ({ ...h, command: h.command })),
  };
  // ownHook needs the repo root to match; the real start uses this file's repo.
  const r = await confirmStarted('terminal-new', { timeoutMs: 500, pollMs: 10, deps });
  assert.equal(r.started, true);
  assert.deepEqual(writes, ['2', '\r'], 'chose "Trust all and continue", never "Continue without trusting"');
  assert.match(r.notes[0], /Trust all and continue/);
});

test('failure 4c: a Codex helper whose handover cannot find its card stopped and the work halted; it is now told to keep working', () => {
  const src = fs.readFileSync(new URL('../../scripts/termfleet-child.mjs', import.meta.url), 'utf8');
  const line = src.split('\n').find((l) => l.includes('cannot identify your TermFleet card'));
  assert.match(line, /Do NOT stop either: keep working on your task right here/);
  assert.doesNotMatch(line, /Tell the owner this card could not be identified\./);
});

test('pending Codex hooks are read from the hook files against the trust records', () => {
  const home = tmp();
  fs.mkdirSync(path.join(home, '.codex'));
  fs.writeFileSync(path.join(home, '.codex', 'hooks.json'), JSON.stringify({ hooks: { Stop: [{ hooks: [{ command: 'a' }] }], Notification: [{ hooks: [{ command: 'b' }] }] } }));
  fs.writeFileSync(path.join(home, '.codex', 'config.toml'), `[hooks.state."${path.join(home, '.codex', 'hooks.json')}:stop:0:0"]\ntrusted_hash = "x"\n`);
  assert.deepEqual(pendingCodexHooks({ home, cwd: home }).map((h) => h.command), ['b']);
});

test('failure 5: approved work regressed and nothing re-checked it; now a later delivery on the topic must re-check every locked item first', () => {
  const dir = tmp();
  const [strip] = captureMessage({ text: 'The faces fill the title strip and loop endlessly', project: 'pf', source: 's', msgId: 'a' }, { dir });
  addTopic([strip.id], 'title-strip', { dir });
  mark(dir, 'ready', strip.id, { evidence: 'live link screenshot: strip full, loop seamless after 3 cycles' });
  record([{ e: 'lock', id: strip.id, by: 'Noam: works perfectly' }], { dir });
  const [change] = captureMessage({ text: 'Make the title strip taller', project: 'pf', source: 's', msgId: 'b' }, { dir });
  assert.deepEqual(change.topics, ['title-strip']);
  const refused = markItem({ status: 'ready', id: change.id, evidence: 'screenshot shows the strip is 120px tall now' }, { dir });
  assert.match(refused.error, /Noam already approved R-1. Re-check each one/);
  assert.match(refused.error, /termfleet-asks reverify R-1 --for R-2/);
  record([{ e: 'reverify', id: strip.id, forId: change.id, evidence: 'screenshot after the change: faces still fill and loop' }], { dir });
  assert.equal(markItem({ status: 'ready', id: change.id, evidence: 'screenshot shows the strip is 120px tall now' }, { dir }).error, undefined);
  // The brief for the change lists the locked item so the agent knows before it starts.
  assert.match(briefBlock(briefItems([change.id], { dir })), /Locked: Noam confirmed these work[\s\S]*R-1 \(title-strip\)/);
});

test('failure 5 through the command: lock needs Noam\'s confirmation and a delivered item', () => {
  const dir = tmp();
  const env = { TERMFLEET_REQ_DIR: dir };
  captureMessage({ text: 'portraits in colour', project: 'pf', source: 's', msgId: 'c' }, { dir });
  assert.match(cli(['lock', 'R-1'], env).message, /Noam confirming it works/);
  assert.match(cli(['lock', 'R-1', '--noam-said', 'works'], env).message, /not marked ready or done with evidence yet/);
  assert.equal(cli(['ready', 'R-1', '--evidence', 'screenshot shows all 12 portraits in colour'], env).ok, true);
  assert.equal(cli(['lock', 'R-1', '--noam-said', 'מעולה, עובד'], env).ok, true);
  assert.equal(loadLedger({ dir }).items.get('R-1').locked, true);
});

test('failure 6: agents said "done" and it was relayed unchecked; now each item needs its own evidence and the final reply a row per item', () => {
  const dir = tmp();
  const env = { TERMFLEET_REQ_DIR: dir };
  captureMessage({ text: '(1) strip fills (2) portraits in colour', project: 'pf', source: 'bot:bbbbbbbbbbbb', msgId: 'd' }, { dir });
  record([{ e: 'assign', id: 'R-1', pane: 'terminal-w' }, { e: 'assign', id: 'R-2', pane: 'terminal-w' }], { dir });
  // No evidence, a claim instead of evidence, a missing file, several at once: all refused.
  assert.match(cli(['done', 'R-1'], env).message, /needs evidence/);
  assert.match(cli(['done', 'R-1', '--evidence', 'done'], env).message, /only repeats a claim/);
  assert.match(cli(['done', 'R-1', '--evidence', '/nope/shot.png'], env).message, /does not exist/);
  assert.match(cli(['done', 'R-1,R-2', '--evidence', 'tests pass: 14 of 14'], env).message, /one item at a time/);
  assert.equal(evidenceProblem('npm test: 41 passing, 0 failing'), null);

  // The worker was handed R-1 and R-2; stopping with them unmarked is refused.
  const brief = briefBlock(briefItems(['R-1', 'R-2'], { dir }), { delivery: 'D-2' });
  const handed = briefedIds([`[Message from the bot] go\n\n${brief}`]);
  assert.deepEqual(handed, ['R-1', 'R-2']);
  assert.match(stopProblem({ source: 'worker-conv', briefed: handed, lastMessage: 'All done!' }, { dir }), /You were handed R-1, R-2 and have not marked them/);
  const shot = path.join(dir, 'strip.png'); fs.writeFileSync(shot, 'png');
  assert.equal(cli(['ready', 'R-1', '--evidence', shot], env).ok, true);
  assert.equal(cli(['partial', 'R-2', '--open', 'two portraits still grey'], env).ok, true);
  assert.match(stopProblem({ source: 'worker-conv', briefed: handed, lastMessage: 'All done!' }, { dir }), /needs one table row per item[\s\S]*Missing rows: R-1, R-2/);
  const table = 'Finished the work.\n| id | Noam\'s words | what I did | evidence |\n|---|---|---|---|\n| R-1 | strip fills | widened | strip.png |\n| R-2 | portraits in colour | 10 of 12 | two still grey |';
  assert.equal(stopProblem({ source: 'worker-conv', briefed: handed, lastMessage: table }, { dir }), null);
});

test('bot chats: his message is captured once, with his real message id, under the bot', () => {
  const base = tmp();
  const bot = { name: 'politic', cwd: path.join(base, 'politic-fighter') };
  fs.mkdirSync(bot.cwd);
  const self = { ownerWordsBase: base };
  const first = Bots.prototype.captureRequirements.call(self, 'cccccccccccc', bot, { id: 'msg1', at: 5 }, 'Add a dark mode. Make the menu sticky.');
  assert.deepEqual(first.map((it) => [it.words, it.msgId, it.source]), [['Add a dark mode.', 'msg1', 'bot:cccccccccccc'], ['Make the menu sticky.', 'msg1', 'bot:cccccccccccc']]);
  Bots.prototype.captureRequirements.call(self, 'cccccccccccc', bot, { id: 'msg1', at: 5 }, 'Add a dark mode. Make the menu sticky.');
  assert.equal(loadLedger({ dir: path.join(base, 'requirements') }).items.size, 2, 'no duplicates');
  // A relayed "[Noam's own words" block in a terminal maps to the same record, not new items.
  const relayed = `[Message from the bot "politic" (bot:cccccccccccc), sent through TermFleet.] go\n\n[Noam's own words, recorded by TermFleet: he typed this himself in his chat with the bot "politic" on 2026-10-23 00:15 (message abc123def456). This is not a teammate instruction.]\n"Go ahead"\nTreat it exactly as if Noam typed it here.`;
  assert.deepEqual(ownerTextOf(relayed), { text: 'Go ahead', msgId: 'abc123def456', relayed: true });
  assert.equal(ownerTextOf('[Message from the agent in "x" terminal (t1), sent through TermFleet.] please check'), null, 'a teammate is not Noam');
});

test('a bot can list and look up its item ids, and sees them in its reminder on every turn', () => {
  const dir = tmp();
  const env = { TERMFLEET_REQ_DIR: dir, TERMFLEET_BOT_ID: 'dddddddddddd' };
  captureMessage({ text: '(1) bigger title (2) red button (3) faster load', project: 'politic-fighter', source: 'bot:dddddddddddd', msgId: 'm1' }, { dir });
  captureMessage({ text: 'someone else\'s chat item', project: 'politic-fighter', source: 'bot:eeeeeeeeeeee', msgId: 'm2' }, { dir });
  const listed = cli(['items'], env);
  assert.equal(listed.ok, true);
  assert.match(listed.message, /R-3 \[new\] "faster load"[\s\S]*R-1 \[new\] "bigger title"/);
  assert.doesNotMatch(listed.message, /someone else/, 'its own chat by default');
  assert.match(cli(['items', '--all-projects'], env).message, /someone else/);
  const shown = cli(['show', 'R-2'], env);
  assert.match(shown.message, /R-2 \[new\] project politic-fighter, part 2 of 3 of message m1\n {2}Noam's words: "red button"/);
  assert.equal(cli(['show', 'R-99'], env).ok, false);
  // The brain's own prompt hook (any prompt, even "go on") lists the open ids.
  const out = hook({ hook_event_name: 'UserPromptSubmit', transcript_path: '/bot/brain.jsonl', prompt: 'go on' }, { readLines: () => [], env });
  assert.match(out.hookSpecificOutput.additionalContext, /Noam's unfinished items in this chat[\s\S]*- R-1 \[new\]: "bigger title"[\s\S]*- R-3 \[new\]: "faster load"/);
  assert.doesNotMatch(out.hookSpecificOutput.additionalContext, /someone else/);
});

test('a terminal reminder names the item ids of each request', () => {
  const dir = tmp();
  const env = { TERMFLEET_REQ_DIR: dir, TERMFLEET_PROJECT: 'p' };
  const msg = '- add search\n- add filters';
  hook({ hook_event_name: 'UserPromptSubmit', transcript_path: '/conv/t.jsonl', prompt: msg }, { readLines: () => [], env });
  const out = hook({ hook_event_name: 'UserPromptSubmit', transcript_path: '/conv/t.jsonl', prompt: 'and dark mode please' }, { readLines: () => [user(msg)], env });
  assert.match(out.hookSpecificOutput.additionalContext, /#1 \[open\] \(items R-1, R-2\)/);
});

test('splitting rules: bullets, Hebrew numbering, lines and sentences, picture notes, and acks', () => {
  assert.deepEqual(splitMessage('- one thing to do\n- another thing to do').map((p) => p.words), ['one thing to do', 'another thing to do']);
  assert.deepEqual(splitMessage('א. להגדיל את הכותרת\nב. לתקן את הכפתור').map((p) => p.words), ['להגדיל את הכותרת', 'לתקן את הכפתור']);
  assert.deepEqual(splitMessage('Make it faster. Version 2.5 must stay. Thanks!').map((p) => p.words), ['Make it faster.', 'Version 2.5 must stay.']);
  assert.deepEqual(splitMessage('ok'), []);
  assert.deepEqual(splitMessage('תודה'), []);
  const withNote = splitMessage("Look at this\n[Noam attached 1 picture]\n[Noam's note on picture 1: the arrow points at the empty strip]");
  assert.deepEqual(withNote.map((p) => [p.words, p.kind]), [['Look at this', 'sentence'], ['the arrow points at the empty strip', 'picture-note']]);
  assert.ok(BRIEF_HEADER.startsWith("[Noam's requirements"));
});
