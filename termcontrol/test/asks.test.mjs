import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { asksFrom, asksForFile, hook, cli, parseMark, ledgerText, acknowledgement, injected } from '../../scripts/termfleet-asks.mjs';

// TF-096 part 2. Noam: agents "compact too much or change course and forget things",
// "dont understand what I ask and build broken things", and a request "was just glossed over".
const user = (text) => JSON.stringify({ type: 'user', message: { role: 'user', content: text } });
const said = (text) => JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });
const ran = (command) => JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command } }] } });
const result = () => JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }] } });
const run = (payload, lines) => hook({ transcript_path: '/t.jsonl', ...payload }, { readLines: () => lines, env: {} });

test('his requests are numbered in his own words; answers, reminders and tool results are not requests', () => {
  const asks = asksFrom([user('Research long lasting memory'), said('ok'), result(), user('yes'), user('<system-reminder>x</system-reminder>'), user('Make it work on the phone too')]);
  assert.deepEqual(asks.map((a) => [a.n, a.text, a.status]), [[1, 'Research long lasting memory', 'open'], [2, 'Make it work on the phone too', 'open']]);
  assert.equal(acknowledgement('go'), true);
  assert.equal(acknowledgement('כן'), true);
  assert.equal(acknowledgement('go and fix the header please now'), false);
  assert.equal(injected('[Message from the bot "Quill" (bot:x), sent through TermFleet.] hi'), true);
  // 2026-10-26: a background helper's report showed up as Noam's request in every turn's list.
  assert.equal(injected('<agent-message from="a77c44fbd7ad613f3">\n[Subagent hand-back] The text below is the final report'), true);
});

test('marks from the termfleet-asks command set each request status; the newest mark wins', () => {
  const asks = asksFrom([user('first thing'), user('second thing'), ran('termfleet-asks partial 1 "light pass only"'), ran('termfleet-asks done 1,2 "tests 12/12 pass"')]);
  assert.deepEqual(asks.map((a) => [a.status, a.note]), [['done', 'tests 12/12 pass'], ['done', 'tests 12/12 pass']]);
  assert.deepEqual(parseMark("termfleet-asks dropped 3 'Noam said skip it'"), { status: 'dropped', nums: [3], note: 'Noam said skip it' });
  assert.equal(parseMark('echo hi'), null);
  const chained = asksFrom([user('one thing'), user('two thing'), user('three thing'), ran('termfleet-asks done 1 "proof one"; termfleet-asks partial 2 "missing x" && termfleet-asks dropped 3 "Noam said skip"')]);
  assert.deepEqual(chained.map((a) => a.status), ['done', 'partial', 'dropped'], 'every mark in a chained command counts');
});

test('each new message re-shows unfinished requests verbatim and asks for a read-back of a new one', () => {
  const out = run({ hook_event_name: 'UserPromptSubmit', prompt: 'Also add a search box' }, [user('Research long lasting memory'), ran('termfleet-asks done 1 "report saved, 44 sources"'), user('Make the phone list calmer')]);
  const ctx = out.hookSpecificOutput.additionalContext;
  assert.match(ctx, /#2 \[open\] "Make the phone list calmer"/);
  assert.match(ctx, /#3 \[open\] "Also add a search box"/);
  assert.doesNotMatch(ctx, /#1 \[/, 'finished requests are only counted');
  assert.match(ctx, /1\/3 done/);
  assert.match(ctx, /#3 is new\. If it is a new or unclear request, first read it back/);
});

test('a plain "go" adds nothing new but still re-shows what is open', () => {
  const out = run({ hook_event_name: 'UserPromptSubmit', prompt: 'go' }, [user('Fix the header')]);
  assert.match(out.hookSpecificOutput.additionalContext, /#1 \[open\] "Fix the header"/);
  assert.doesNotMatch(out.hookSpecificOutput.additionalContext, /is new/);
});

test('after a compaction his words come back, even though the summary dropped them', () => {
  const out = run({ hook_event_name: 'SessionStart', source: 'compact' }, [user('Research long lasting memory'), user('and switch models when credits run out')]);
  assert.match(out.hookSpecificOutput.additionalContext, /^After compact: /);
  assert.match(out.hookSpecificOutput.additionalContext, /"and switch models when credits run out"/);
  assert.equal(run({ hook_event_name: 'SessionStart', source: 'startup' }, []), null);
});

test('saying "done" with unmarked requests is refused once, with the open ones named', () => {
  const lines = [user('Research long lasting memory deeply'), said('Done — here is what I found.')];
  const out = run({ hook_event_name: 'Stop' }, lines);
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /#1 "Research long lasting memory deeply"/);
  assert.match(out.reason, /say so in your first sentence/);
  assert.equal(run({ hook_event_name: 'Stop', stop_hook_active: true }, lines), null, 'reminder mode: never loops');
  assert.equal(run({ hook_event_name: 'Stop' }, [user('fix it'), ran('termfleet-asks partial 1 "only the header part"'), said('Done with the header.')]), null);
  assert.equal(run({ hook_event_name: 'Stop' }, [user('what is running?'), said('Two agents are working.')]), null, 'no done claim, no reminder');
});

test('the command insists on proof for done and a reason otherwise', () => {
  assert.equal(cli(['done', '2', 'tests', '12/12', 'pass']).ok, true);
  assert.match(cli(['done', '2', 'yes']).message, /needs proof/);
  assert.match(cli(['partial', '2']).message, /what is still missing/);
  assert.match(cli(['finished', '2', 'x']).message, /Use: termfleet-asks/);
  assert.equal(cli(['dropped', '3,4', 'Noam', 'said', 'skip']).ok, true);
});

test('Codex records are read the same way', () => {
  const cu = (t) => JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: t }] } });
  const call = (cmd) => JSON.stringify({ type: 'response_item', payload: { type: 'function_call', name: 'shell', arguments: JSON.stringify({ command: ['bash', '-lc', cmd] }) } });
  const asks = asksFrom([cu('<environment_context>x</environment_context>'), cu('Build the bot list'), call('termfleet-asks done 1 "12 tests pass"')]);
  assert.deepEqual(asks.map((a) => [a.text, a.status]), [['Build the bot list', 'done']]);
});

test('the list stays readable when a conversation has many requests', () => {
  const asks = Array.from({ length: 30 }, (_, i) => ({ n: i + 1, text: `request ${i + 1}`, status: 'open', note: '' }));
  const text = ledgerText(asks);
  assert.match(text, /15 older unfinished requests not shown/);
  assert.ok(text.length < 6000);
});

test('request numbers stay the same as a long record keeps growing, and marks find the right request', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-asks-'));
  const file = path.join(dir, 'chat.jsonl');
  const cacheDir = path.join(dir, 'cache');
  const filler = said('x'.repeat(200000));
  fs.writeFileSync(file, [user('first request'), filler, filler, user('second request')].join('\n') + '\n');
  assert.deepEqual(asksForFile(file, { cacheDir }).map((a) => a.n + ':' + a.text), ['1:first request', '2:second request']);
  fs.appendFileSync(file, [filler, user('third request'), ran('termfleet-asks done 1 "report saved"'), ''].join('\n'));
  const asks = asksForFile(file, { cacheDir });
  assert.deepEqual(asks.map((a) => [a.n, a.text, a.status]), [[1, 'first request', 'done'], [2, 'second request', 'open'], [3, 'third request', 'open']]);
  fs.writeFileSync(file, user('rewritten') + '\n');
  assert.deepEqual(asksForFile(file, { cacheDir }).map((a) => a.text), ['rewritten'], 'a shorter record is read again from the start');
});

test('an agent that ends by promising a next step is told to do it now (once); honest waits pass', async () => {
  const { hook, promisedStep } = await import('../../scripts/termfleet-asks.mjs');
  const stop = (msg, active = false) => hook({ hook_event_name: 'Stop', last_assistant_message: msg, stop_hook_active: active }, { readLines: () => [] });
  for (const msg of [
    'The fix is live.\n\nNext I\'m doing: checking the helper\'s result once it finishes.',
    'Tests pass. I\'ll now run the phone check.',
    'Saved the page. Next step: deploy it to the server',
    'עדכנתי את הקובץ. אני אבדוק את התוצאה בהמשך',
  ]) {
    const r = stop(msg);
    assert.equal(r?.decision, 'block', msg);
    assert.match(r.reason, /Do it now/);
  }
  assert.equal(stop('Next I\'m doing: the deploy.', true), null, 'only once per finish, never a loop');
  for (const msg of [
    'All three fixes are in and tested.',
    'Waiting for Noam: tap "Turn on phone notifications" once.',
    'Next I\'m doing: the phone check, once you tap the link.',
    'Should I deploy it now?',
    'A background watcher will notify me when it finishes; next I\'m doing the review then.',
  ]) assert.equal(promisedStep(msg), null, msg);
});

// Noam 2026-10-23 (health-coach_dev ended "Waiting for Noam: say go when you want me to build
// the sandwich, workout and cooking plans."): "זו לא סיבה שהיא יעצור". Stopping for a go on
// safe work is refused once; money, posting, messaging, deleting, his own steps and real
// choices still stop.
test('stopping to wait for a go on safe work is refused once; real reasons still stop', async () => {
  const { hook, needlessWait } = await import('../../scripts/termfleet-asks.mjs');
  const stop = (msg, active = false) => hook({ hook_event_name: 'Stop', last_assistant_message: msg, stop_hook_active: active }, { readLines: () => [], env: {} });
  for (const msg of [
    'I mapped your week and your goals.\n\nWaiting for Noam: say go when you want me to build the sandwich, workout and cooking plans.',
    'I read the interview and picked the clip.\n\nWaiting for Noam: your go-ahead to start the sample from the interview.',
    'The plan is written. Want me to go ahead and build it?',
    'Everything is mapped out. Should I start on the tests now?',
    'Let me know when you want me to continue with part two.',
    'Part one is done. Next I\'m doing part two once you say go.',
    'הכנתי את התוכנית.\nממתין לאישור של נועם להתחיל.',
  ]) {
    const r = stop(msg);
    assert.equal(r?.decision, 'block', msg);
    assert.match(r.reason, /do it now/i, msg);
    assert.match(r.reason, /money|posting|deleting/i, 'names the only reasons that may stop');
  }
  assert.equal(stop('Waiting for Noam: say go when you want me to build the plans.', true), null, 'only once per finish, never a loop');
  for (const msg of [
    'All three fixes are in and tested.',
    'Waiting for Noam: your approval to post the draft on LinkedIn.',
    'Waiting for Noam: ok to spend about $3 of credits on the render.',
    'Waiting for Noam: your go-ahead to delete the old backups.',
    'Should I send the email to Dana now?',
    'Waiting for Noam: sign in to Google in your window, then hand it back.',
    'Waiting for Noam: tap "Turn on phone notifications" once.',
    'Waiting for Noam: try the new button on the phone.',
    'Waiting for Noam: approval of the list of jokes and fatalities, in the question above.',
    "Waiting for Noam: approve or decline the prompt that's stuck in the rough-cut terminal.",
    'Which design do you want, the dark one or the light one?',
    'The checker runs in the background and will wake me when it finishes.',
  ]) assert.equal(needlessWait(msg), null, msg);
});
