import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { contextReceipt } from '../bridge/provider-context.mjs';
import { Bots, brainCommand, brainBrief, briefStamp, parseBrainLine, brainReplyText, runBrain, activityLine, brainEnv, isLimitText, resetTime } from '../bridge/bots.mjs';

// TF-096 part 1: bots are managers outside the terminals (Grok Bot's model). These
// tests never call Claude or Codex: the brain is a stand-in.
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tf-bots-'));
// A pretend computer: both tools signed in and the terminal service running.
function readyComputer() {
  const home = tmp();
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', '.credentials.json'), '{}');
  fs.writeFileSync(path.join(home, '.codex', 'auth.json'), '{}');
  const socket = path.join(home, 'daemon.sock');
  fs.writeFileSync(socket, '');
  return { home, socket };
}
const settle = async (bots, id) => { for (let i = 0; i < 200 && bots.running.has(id); i++) await new Promise((r) => setTimeout(r, 5)); };

test('a bot is created with a name, job, rules and a home folder, and listed', () => {
  const bots = new Bots({ checks: readyComputer(),  dir: tmp(), run: async () => ({ text: 'hi' }) });
  const made = bots.create({ name: ' Quill ', job: 'Keeps the phone app working', rules: 'Never push without asking.', provider: 'claude', cwd: os.tmpdir() });
  assert.equal(made.ok, true);
  assert.equal(made.bot.name, 'Quill');
  assert.equal(bots.list().length, 1);
  assert.match(bots.create({ name: 'quill', cwd: os.tmpdir() }).error, /already has that name/);
  assert.match(bots.create({ name: '"; rm', cwd: os.tmpdir() }).error, /letters, numbers/);
  assert.match(bots.create({ name: 'Ghost', cwd: '/no/such/folder' }).error, /does not exist/);
});

test('a message gets an answer from the brain, and the chat keeps both', async () => {
  const seen = [];
  const bots = new Bots({ checks: readyComputer(),  dir: tmp(), run: async (bot, text, { onEvent }) => { seen.push(text); onEvent({ activity: 'Reading files' }); return { text: `Answer to: ${text}` }; } });
  const { bot } = bots.create({ name: 'Baltata', cwd: os.tmpdir() });
  assert.equal(bots.send(bot.id, 'What is running?').ok, true);
  await settle(bots, bot.id);
  const roles = bots.view(bot.id).messages.map((m) => m.role);
  assert.deepEqual(roles, ['system', 'operator', 'activity', 'bot']);
  assert.equal(bots.view(bot.id).messages.at(-1).text, 'Answer to: What is running?');
  assert.equal(bots.summary(bot.id).state, 'idle');
});

test('messages sent while the bot works are answered together next, oldest first', async () => {
  let release;
  const calls = [];
  const bots = new Bots({ checks: readyComputer(),  dir: tmp(), run: (bot, text) => { calls.push(text); return calls.length === 1 ? new Promise((r) => { release = () => r({ text: 'first' }); }) : Promise.resolve({ text: 'second' }); } });
  const { bot } = bots.create({ name: 'Hogan', cwd: os.tmpdir() });
  bots.send(bot.id, 'one');
  assert.equal(bots.summary(bot.id).state, 'working');
  bots.send(bot.id, 'two');
  bots.send(bot.id, 'three');
  release();
  await settle(bots, bot.id);
  assert.deepEqual(calls, ['one', '(1) two\n\n(2) three']);
});

test('a failed run is shown plainly and the bot stays usable', async () => {
  const bots = new Bots({ checks: readyComputer(),  dir: tmp(), run: async () => ({ error: 'Usage limit reached' }) });
  const { bot } = bots.create({ name: 'Craig', cwd: os.tmpdir() });
  bots.send(bot.id, 'hi');
  await settle(bots, bot.id);
  assert.equal(bots.summary(bot.id).state, 'failed');
  assert.equal(bots.view(bot.id).messages.at(-1).role, 'error');
});

test('the Claude brain reads and checks itself but cannot edit, and directs terminals through termfleet-team', () => {
  const bot = { id: 'abcdefabcdef', name: 'Quill', job: 'Phone app', rules: 'Never push.', provider: 'claude', cwd: '/tmp', sessions: { claude: { id: 'S1', started: false } } };
  const first = brainCommand(bot, 'hello', { bins: { claude: '/bin/claude' } });
  assert.equal(first.bin, '/bin/claude');
  assert.deepEqual(first.args.slice(0, 2), ['-p', 'hello']);
  assert.ok(first.args.includes('--session-id') && first.args.includes('S1'));
  assert.ok(first.args.includes('Bash(termfleet-team:*)'));
  const denied = first.args.slice(first.args.indexOf('--disallowedTools') + 1);
  assert.ok(denied.includes('Edit') && denied.includes('Write'));
  assert.ok(first.args.includes('dontAsk'));
  const later = brainCommand({ ...bot, sessions: { claude: { id: 'S1', started: true } } }, 'again');
  assert.ok(later.args.includes('--resume') && !later.args.includes('--session-id'));
  const brief = brainBrief(bot);
  assert.match(brief, /You are "Quill"/);
  assert.match(brief, /Never push\./);
  assert.match(brief, /termfleet-team start/);
  assert.match(brief, /Never say "done" without proof/);
});

test('the Codex brain gets the brief on its first message and resumes after', () => {
  const bot = { id: 'abcdefabcdef', name: 'Shaoruru', provider: 'codex', cwd: '/tmp', sessions: { codex: null } };
  const first = brainCommand(bot, 'hello', { bins: { codex: '/bin/codex' } });
  assert.deepEqual(first.args.slice(0, 2), ['exec', '--json']);
  assert.match(first.args.at(-1), /You are "Shaoruru"[\s\S]*Noam says:\nhello/);
  const later = brainCommand({ ...bot, sessions: { codex: 'T9' }, codexBrief: { session: 'T9', stamp: briefStamp(bot) } }, 'again', { bins: { codex: '/bin/codex' } });
  assert.deepEqual(later.args.slice(0, 3), ['exec', 'resume', 'T9']);
  const roots = first.args.find(arg => arg.startsWith('sandbox_workspace_write.writable_roots='));
  assert.match(roots, /writable_roots=.*terminal-workspace/, 'the bot can reach the terminal service');
  assert.ok(first.args.includes('sandbox_mode="workspace-write"'));
  assert.ok(first.args.includes('approval_policy="never"'), 'never waits for a keyboard');
  assert.equal(later.args.at(-1), 'again');
});

test('brain output becomes plain activity lines and a final answer', () => {
  assert.deepEqual(parseBrainLine('claude', JSON.stringify({ type: 'system', subtype: 'init', session_id: 'S1' })), { session: 'S1' });
  assert.deepEqual(parseBrainLine('claude', JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'termfleet-team start --provider claude --task x' } }] } })), { activity: 'Starting a terminal agent' });
  assert.deepEqual(parseBrainLine('claude', JSON.stringify({ type: 'result', subtype: 'success', result: 'All good.' })), { text: 'All good.', final: true });
  assert.equal(parseBrainLine('claude', JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'boom' })).error, 'boom');
  assert.deepEqual(parseBrainLine('codex', JSON.stringify({ type: 'thread.started', thread_id: 'T1' })), { session: 'T1' });
  assert.deepEqual(parseBrainLine('codex', JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Done.' } })), { text: 'Done.' });
  assert.equal(parseBrainLine('codex', 'not json'), null);
  assert.equal(activityLine('Read', {}), 'Reading files');
});

test('a real background run reads the brain stream end to end (stand-in brain program)', async () => {
  const dir = tmp();
  const fake = path.join(dir, 'fake-codex.mjs');
  fs.writeFileSync(fake, `#!/usr/bin/env node
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
out({ type: 'thread.started', thread_id: 'S-fake' });
out({ type: 'item.started', item: { type: 'command_execution', id: 'list', command: 'termfleet-team list' } });
out({ type: 'item.completed', item: { type: 'agent_message', text: 'Two agents are working: ' + process.env.TERMFLEET_BOT_NAME } });
out({ type: 'turn.completed' });
`, { mode: 0o755 });
  const bots = new Bots({ checks: readyComputer(), dir, bins: { codex: fake }, run: (bot, text, options) => runBrain(bot, text, { ...options, env: { ...process.env, TERMFLEET_GENTLE_BRAINS: '0' } }) });
  const { bot } = bots.create({ name: 'Quill', provider: 'codex', cwd: dir });
  bots.send(bot.id, 'Who is working?');
  await settle(bots, bot.id);
  const msgs = bots.view(bot.id).messages;
  assert.deepEqual(msgs.map((m) => m.role), ['system', 'operator', 'activity', 'bot']);
  assert.equal(msgs[2].text, 'Checking who is working');
  assert.equal(msgs[3].text, 'Two agents are working: Quill');
  assert.equal(bots.read(bot.id).sessions.codex, 'S-fake');
});

test('a brain program that is missing or crashes ends as a plain error, not a hang', async () => {
  const r = await runBrain({ id: 'abcdefabcdef', name: 'X', provider: 'codex', cwd: os.tmpdir(), sessions: {} }, 'hi', { bins: { codex: '/nonexistent/codex' }, env: { ...process.env, TERMFLEET_GENTLE_BRAINS: '0' } });
  assert.ok(r.error);
  assert.doesNotMatch(r.error, /Claude launch denied/);
});

test('deleting a bot removes it and its chat', () => {
  const bots = new Bots({ checks: readyComputer(),  dir: tmp(), run: async () => ({ text: '' }) });
  const { bot } = bots.create({ name: 'Temp', cwd: os.tmpdir() });
  assert.equal(bots.remove(bot.id).ok, true);
  assert.equal(bots.list().length, 0);
  assert.throws(() => bots.folder('../etc'), /Unknown bot/);
});

test('a bot never inherits the terminal identity of whatever started it', () => {
  const env = brainEnv({ id: 'abcdefabcdef', name: 'Quill' }, { PATH: '/usr/bin', TERMFLEET_PANE_ID: 'terminal-x', CODEX_THREAD_ID: 't', CLAUDECODE: '1', HOME: '/home/n' });
  assert.equal(env.TERMFLEET_PANE_ID, undefined);
  assert.equal(env.CODEX_THREAD_ID, undefined);
  assert.equal(env.CLAUDECODE, undefined);
  assert.equal(env.TERMFLEET_BOT_NAME, 'Quill');
  assert.equal(env.GIT_TERMINAL_PROMPT, '0');
  assert.match(env.PATH, /\.local\/bin:\/usr\/bin$/);
});

// TF-096 part 4: "Each bot has a default plan and a backup. It switches between turns,
// tells you in one line, and switches back after the reset."
test('each tool\'s own out-of-credits words are recognised, and ordinary errors are not', () => {
  for (const t of ["You've hit your session limit · resets 3:45pm", "You've hit your weekly limit · resets Mon 12:00am", 'Usage limit reached · continuing automatically at 3:45pm', 'You’ve hit your usage limit. Visit … or try again at 12:48 AM.', 'AI_APICallError: Weekly usage limit reached. Resets in 3 days', 'Your workspace is out of credits']) assert.equal(isLimitText(t), true, t);
  for (const t of ['Overloaded', '529 overloaded_error', 'authentication_failed', 'Request timed out']) assert.equal(isLimitText(t), false, t);
  const now = new Date('2026-10-16T14:00:00').getTime();
  assert.equal(new Date(resetTime('resets 3:45pm', now)).getHours(), 15);
  assert.equal(new Date(resetTime('try again at 12:48 AM', now)).getDate(), 17, 'a time already passed today means tomorrow');
  assert.equal(new Date(resetTime('resets Mon 12:00am', now)).getDay(), 1);
  assert.equal(resetTime('no time here', now), null);
  assert.ok(parseBrainLine('claude', JSON.stringify({ type: 'result', is_error: true, result: "You've hit your session limit · resets 3:45pm" })).limit);
  assert.ok(parseBrainLine('claude', JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: 1792900000 } })).limit.resetsAt > 1e12);
  assert.ok(parseBrainLine('codex', JSON.stringify({ type: 'turn.failed', error: { message: 'You’ve hit your usage limit. Try again at 12:48 AM.' } })).limit);
});

test('out of credits: the bot switches to its backup between turns, says so in one line, and answers', async () => {
  let now = new Date('2026-10-16T14:00:00').getTime();
  const used = [];
  const sources = tmp();
  const bots = new Bots({ checks: readyComputer(), dir: tmp(), now: () => now, bins: { claude: '/c', codex: '/x' }, fill: () => null, providerGate: () => {},
    contextOptions: { resolveTranscript: bot => {
      const provider = bot.active || bot.provider, file = path.join(sources, `${provider}.jsonl`);
      fs.writeFileSync(file, JSON.stringify(provider === 'codex' ? { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Keep the phone list calm' }] } } : { type: 'user', message: { content: 'Keep the phone list calm' } }) + '\n');
      return file;
    } },
    run: async (bot, text, { extras, onEvent }) => {
      if (extras.validateHandoff) {
        const json = text.split(/<portable-context[^>]*>\n/)[1].split('\n</portable-context>')[0];
        onEvent({ session: `${bot.provider}-test-session` });
        used.push({ provider: bot.provider, handover: json, receipt: true });
        return { text: JSON.stringify(contextReceipt(JSON.parse(json), crypto.createHash('sha256').update(json).digest('hex'))) };
      }
      used.push({ provider: bot.provider });
      return bot.provider === 'claude' && now < new Date('2026-10-16T15:45:00').getTime() ? { limit: { text: "You've hit your session limit · resets 3:45pm", resetsAt: new Date('2026-10-16T15:45:00').getTime() }, error: 'usage limit' } : { text: `answer from ${bot.provider}` };
    } });
  const { bot } = bots.create({ name: 'Quill', cwd: os.tmpdir() });
  bots.append(bot.id, { role: 'operator', text: 'Keep the phone list calm' });
  bots.send(bot.id, 'status?');
  await settle(bots, bot.id);
  const chat = bots.view(bot.id).messages;
  assert.ok(chat.some((m) => m.role === 'system' && /Claude reached its limit \(resets 15:45\), so Quill is continuing on Codex\./.test(m.text)));
  assert.equal(chat.at(-1).text, 'answer from codex');
  assert.deepEqual(used.filter(u => !u.receipt).map((u) => u.provider), ['claude', 'codex']);
  assert.match(used[1].handover, /Keep the phone list calm/, 'the backup acknowledges the actual retained conversation first');
  assert.equal(bots.summary(bot.id).active, 'codex');
  now = new Date('2026-10-16T15:50:00').getTime();
  bots.send(bot.id, 'and now?');
  await settle(bots, bot.id);
  const after = bots.view(bot.id).messages;
  assert.ok(after.some((m) => m.role === 'system' && /Back on Claude: its limit has reset/.test(m.text)));
  assert.equal(after.at(-1).text, 'answer from claude');
  assert.equal(bots.summary(bot.id).active, 'claude');
});

test('with no backup free, the message is kept and answered by itself after the reset', async () => {
  let now = new Date('2026-10-16T14:00:00').getTime();
  const resetAt = new Date('2026-10-16T15:00:00').getTime();
  const bots = new Bots({ checks: readyComputer(),  dir: tmp(), now: () => now, bins: { claude: '/c', codex: '/x' }, fill: () => null,
    run: async (bot) => (now < resetAt ? { limit: { text: 'usage limit reached', resetsAt: resetAt }, error: 'usage limit' } : { text: `late answer from ${bot.provider}` }) });
  const { bot } = bots.create({ name: 'Hogan', cwd: os.tmpdir() });
  bots.markLimited('codex', { text: 'backup already limited', resetsAt: resetAt });
  bots.send(bot.id, 'please check the build');
  await settle(bots, bot.id);
  assert.match(bots.view(bot.id).messages.at(-1).text, /kept your message and will answer it by itself at 15:00/);
  bots.retryDue();
  await settle(bots, bot.id);
  assert.equal(bots.view(bot.id).messages.filter((m) => m.role === 'bot').length, 0, 'not before the reset');
  now = resetAt + 60_000;
  bots.retryDue();
  await settle(bots, bot.id);
  const chat = bots.view(bot.id).messages;
  assert.ok(chat.some((m) => /A plan has reset, so Hogan is answering your earlier message now/.test(m.text)));
  assert.match(chat.at(-1).text, /late answer from/);
  assert.equal(chat.filter((m) => m.role === 'operator').length, 1, 'his message is not duplicated');
});

// R-7394: "ממשיך לקבל את השגיאה הזו" — the bot answered, then marked his request with one
// more tool step, so the turn's final text was empty and he only ever saw the placeholder.
test('a Claude turn that answers and then takes one more step still shows the answer without launching Claude', () => {
  const answer = parseBrainLine('claude', JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'תיקנתי, הסטטוס יתעדכן.' }, { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'termfleet-asks done R-1 "x"' } }] } }));
  const final = parseBrainLine('claude', JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '' }));
  assert.equal(final.text, '');
  assert.equal(brainReplyText('claude', { completed: true, finalText: final.text, spoken: [answer.said] }), 'תיקנתי, הסטטוס יתעדכן.');
  assert.equal(brainReplyText('codex', { completed: false, lastText: 'Opening update', spoken: ['Opening update'] }), '', 'an interrupted Codex update is not a completed answer');
  assert.equal(brainReplyText('codex', { completed: true, lastText: 'Final Codex answer' }), 'Final Codex answer');
});

test('a real brain that hits its limit is stopped at once instead of waiting for the reset', async () => {
  const dir = tmp();
  const fake = path.join(dir, 'fake-codex.mjs');
  fs.writeFileSync(fake, `#!/usr/bin/env node
process.stdout.write(JSON.stringify({ type: 'thread.started', thread_id: 'S1' }) + '\\n');
process.stdout.write(JSON.stringify({ type: 'turn.failed', error: { message: 'Usage limit reached · continuing automatically at 3:45pm · esc or type to cancel' } }) + '\\n');
setTimeout(() => {}, 60000);
`, { mode: 0o755 });
  const t0 = Date.now();
  const r = await runBrain({ id: 'abcdefabcdef', name: 'X', provider: 'codex', cwd: dir, sessions: {} }, 'hi', { bins: { codex: fake }, env: { ...process.env, TERMFLEET_GENTLE_BRAINS: '0' } });
  assert.ok(r.limit, 'reported as a limit');
  assert.ok(Date.now() - t0 < 10000, 'did not sit in the wait');
});

// TF-096 part 5: "Bots check before starting, reconnect by themselves, ask you with one
// tap on your phone, and show a health light."
test('before starting, a missing login stops the bot with one plain ask, and one tap retries', async () => {
  const checks = readyComputer();
  fs.rmSync(path.join(checks.home, '.claude', '.credentials.json'));
  const runs = [];
  const bots = new Bots({ checks, dir: tmp(), bins: { claude: '/c', codex: null }, fill: () => null, run: async (bot, text) => { runs.push(text); return { text: 'done' }; } });
  const { bot } = bots.create({ name: 'Quill', cwd: os.tmpdir(), fallback: 'none' });
  bots.send(bot.id, 'check the build');
  await settle(bots, bot.id);
  assert.equal(runs.length, 0, 'nothing ran half-ready');
  const s = bots.summary(bot.id);
  assert.equal(s.state, 'needs-you');
  assert.equal(s.health.level, 'bad');
  assert.match(bots.view(bot.id).messages.at(-1).text, /Claude is not signed in on this computer\. Sign in to Claude once in a terminal, then tap Retry\./);
  fs.writeFileSync(path.join(checks.home, '.claude', '.credentials.json'), '{}');
  assert.equal(bots.retry(bot.id).ok, true);
  await settle(bots, bot.id);
  assert.deepEqual(runs, ['check the build']);
  assert.equal(bots.summary(bot.id).health.level, 'ok');
});

test('if only the main plan is not ready, the bot uses its backup instead of stopping', async () => {
  const checks = readyComputer();
  fs.rmSync(path.join(checks.home, '.claude', '.credentials.json'));
  const used = [];
  const bots = new Bots({ checks, dir: tmp(), bins: { claude: '/c', codex: '/x' }, fill: () => null, run: async (bot) => { used.push(bot.provider); return { text: 'ok' }; } });
  const { bot } = bots.create({ name: 'Hogan', cwd: os.tmpdir() });
  bots.send(bot.id, 'hi');
  await settle(bots, bot.id);
  assert.deepEqual(used, ['codex']);
  assert.ok(bots.view(bot.id).messages.some((m) => /Claude isn't ready \(signed out\), so Hogan is using Codex for now/.test(m.text)));
});

test('the terminal service being down or the disk being full is asked about plainly', () => {
  const checks = readyComputer();
  const bots = new Bots({ checks, dir: tmp(), bins: { claude: '/c', codex: '/x' }, run: async () => ({ text: '' }) });
  const bot = { name: 'Q', cwd: os.tmpdir(), provider: 'claude' };
  assert.equal(bots.preflight(bot).ok, true);
  fs.rmSync(checks.socket);
  assert.match(bots.preflight(bot).problems[0].ask, /terminal service isn't running/);
  assert.match(bots.preflight({ ...bot, cwd: '/no/such' }).problems.map((p) => p.ask).join(' '), /home folder is gone/);
});

test('a turn cut off by a restart is picked up again by a fresh bridge', async () => {
  const dir = tmp();
  const checks = readyComputer();
  const first = new Bots({ checks, dir, bins: { claude: '/c' }, fill: () => null, run: () => new Promise(() => {}) });
  const { bot } = first.create({ name: 'Craig', cwd: os.tmpdir() });
  first.send(bot.id, 'build the release');
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(first.read(bot.id).inflight, 'the running turn is written down');
  const seen = [];
  const second = new Bots({ checks, dir, bins: { claude: '/c' }, fill: () => null, run: async (b, text) => { seen.push(text); return { text: 'picked up' }; } });
  assert.equal(second.resumeInterrupted(), 1);
  await settle(second, bot.id);
  assert.match(seen[0], /You were cut off by a restart[\s\S]*build the release/);
  assert.ok(second.view(bot.id).messages.some((m) => /Craig was cut off by a restart and is picking up where it was/.test(m.text)));
  assert.equal(second.read(bot.id).inflight, undefined);
});

test('a brain that goes silent is stopped and reported, not waited on', async () => {
  const dir = tmp();
  const fake = path.join(dir, 'silent.mjs');
  fs.writeFileSync(fake, '#!/usr/bin/env node\nsetTimeout(() => {}, 60000);\n', { mode: 0o755 });
  const t0 = Date.now();
  const r = await runBrain({ id: 'abcdefabcdef', name: 'X', provider: 'codex', cwd: dir, sessions: {} }, 'hi', { bins: { codex: fake }, idleMs: 300, env: { ...process.env, TERMFLEET_GENTLE_BRAINS: '0' } });
  assert.match(r.error, /went quiet for too long/);
  assert.ok(Date.now() - t0 < 5000);
});

test('a started bot can be moved to another model; it is checked, kept with its plan, and used on the next turn only on that plan', () => {
  const calls = [];
  const bots = new Bots({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'tf-model-')), run: async (bot, text) => { calls.push({ provider: bot.provider, model: bot.model }); return { text: 'ok' }; }, fill: () => null, checks: { home: os.homedir() } });
  bots.codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-codexhome-'));
  fs.mkdirSync(path.join(bots.codexHome, '.codex'));
  fs.writeFileSync(path.join(bots.codexHome, '.codex', 'models_cache.json'), JSON.stringify({ models: [{ slug: 'gpt-x', display_name: 'GPT X', visibility: 'list' }, { slug: 'secret', visibility: 'hide' }] }));
  const { bot } = bots.create({ name: 'Quill', cwd: os.tmpdir() });
  assert.equal(bots.update(bot.id, { model: 'opus' }).bot.model, 'opus');
  assert.match(bots.update(bot.id, { model: 'gpt-x' }).error, /not available for this plan/);
  assert.equal(bots.update(bot.id, { model: '' }).bot.model, null, 'empty = the plan\'s default');
  bots.update(bot.id, { model: 'sonnet' });
  // Changing the plan drops a model that belongs to the old one.
  assert.equal(bots.update(bot.id, { provider: 'codex' }).bot.model, null);
  assert.equal(bots.update(bot.id, { model: 'gpt-x' }).bot.model, 'gpt-x');
  assert.match(bots.update(bot.id, { model: 'secret' }).error, /not available/);
  // The command carries the model for each plan.
  const claude = brainCommand({ id: 'b', name: 'Q', provider: 'claude', model: 'opus', cwd: '/tmp', sessions: { claude: { id: 'abc', started: true } } }, 'hi');
  assert.deepEqual(claude.args.slice(claude.args.indexOf('--model'), claude.args.indexOf('--model') + 2), ['--model', 'opus']);
  const codexFirst = brainCommand({ id: 'b', name: 'Q', provider: 'codex', model: 'gpt-x', cwd: '/tmp', sessions: {} }, 'hi');
  assert.deepEqual(codexFirst.args.slice(codexFirst.args.indexOf('-m'), codexFirst.args.indexOf('-m') + 2), ['-m', 'gpt-x']);
  const codexResume = brainCommand({ id: 'b', name: 'Q', provider: 'codex', model: 'gpt-x', cwd: '/tmp', sessions: { codex: 't1' } }, 'hi');
  assert.ok(codexResume.args.includes('resume') && codexResume.args.includes('gpt-x'), 'a resumed Codex chat switches model too');
  assert.ok(!brainCommand({ id: 'b', name: 'Q', provider: 'claude', cwd: '/tmp', sessions: {} }, 'hi').args.includes('--model'), 'no model chosen = today\'s behaviour');
});

test('a bot waiting on a terminal agent says so (not a bare "Checking something") and is told it waits at most 20 seconds', () => {
  assert.equal(activityLine('Bash', { command: 'termfleet-team ask paper-bot "status?"' }), 'Waiting for a terminal agent\'s answer');
  assert.equal(activityLine('Bash', { command: 'termfleet-team wait paper-bot' }), 'Waiting for a terminal agent to finish');
  assert.equal(activityLine('Bash', { command: 'termfleet-team send paper-bot "go"' }), 'Handing work to a terminal agent');
  assert.match(brainBrief({ id: 'b', name: 'Q', job: 'x', rules: '' }, {}), /waits at most 20 seconds[^`]*woken when it finishes/);
});

test('the bot summary says when the current step started', () => {
  const bots = new Bots({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'tf-since-')), run: () => new Promise(() => {}), fill: () => null, checks: { home: os.homedir() } });
  const { bot } = bots.create({ name: 'Quill', cwd: os.tmpdir() });
  assert.equal(bots.summary(bot.id).activitySince, null, 'idle bot: nothing running');
  bots.running.set(bot.id, { activity: 'Checking something', startedAt: 1000, activityAt: 5000 });
  assert.equal(bots.summary(bot.id).activitySince, 5000);
});

test('bots can read web pages through the plugin\'s read-only fetch and search, but never its code-running tool', () => {
  const { args } = brainCommand({ id: 'b', name: 'Q', provider: 'claude', cwd: '/tmp', sessions: {} }, 'hi');
  const allowed = args.slice(args.indexOf('--allowedTools') + 1, args.indexOf('--disallowedTools'));
  for (const tool of ['WebFetch', 'WebSearch', 'mcp__plugin_context-mode_context-mode__ctx_fetch_and_index', 'mcp__plugin_context-mode_context-mode__ctx_search']) assert.ok(allowed.includes(tool), tool);
  assert.ok(!allowed.some((t) => /ctx_execute|ctx_batch_execute/.test(t)), 'no arbitrary code through the plugin');
});

// A Codex bot gets its brief only inside its conversation, so a conversation started
// before a rule changed (the question tool) never learned it. It is sent again once,
// whenever the brief differs from the one that conversation last received.
test('a resumed Codex conversation gets the current brief again only when it changed', () => {
  const bot = { id: 'abcdefabcdef', name: 'Shaoruru', provider: 'codex', cwd: '/tmp', sessions: { codex: 'T9' } };
  const old = brainCommand(bot, 'again', { bins: { codex: '/bin/codex' } });
  assert.match(old.args.at(-1), /You are "Shaoruru"[\s\S]*question tool[\s\S]*Noam says:\nagain$/, 'an older conversation with no record gets it');
  const stamp = briefStamp(bot);
  const same = brainCommand({ ...bot, codexBrief: { session: 'T9', stamp } }, 'again', { bins: { codex: '/bin/codex' } });
  assert.equal(same.args.at(-1), 'again', 'unchanged brief is not repeated');
  const changed = brainCommand({ ...bot, rules: 'New rule.', codexBrief: { session: 'T9', stamp } }, 'again', { bins: { codex: '/bin/codex' } });
  assert.match(changed.args.at(-1), /New rule\.[\s\S]*Noam says:\nagain$/);
  const otherChat = brainCommand({ ...bot, codexBrief: { session: 'OLD', stamp } }, 'again', { bins: { codex: '/bin/codex' } });
  assert.match(otherChat.args.at(-1), /You are "Shaoruru"/, 'a record from another conversation does not count');
  assert.notEqual(briefStamp(bot, { card: 'memory changes' }), undefined);
  assert.equal(briefStamp(bot, { card: 'memory changes' }), stamp, 'memory/handover changes alone do not resend');
});

test('after a Codex turn the bot records which brief its conversation has', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-cb-'));
  for (const d of ['.claude', '.codex']) fs.mkdirSync(path.join(home, d));
  fs.writeFileSync(path.join(home, '.claude', '.credentials.json'), '{}');
  fs.writeFileSync(path.join(home, '.codex', 'auth.json'), '{}');
  fs.writeFileSync(path.join(home, 'daemon.sock'), '');
  const seen = [];
  const bots = new Bots({ checks: { home, socket: path.join(home, 'daemon.sock') }, dir: fs.mkdtempSync(path.join(os.tmpdir(), 'tc-cb-bots-')), notify: () => {},
    run: async (runner, text, { onEvent }) => { seen.push(brainCommand(runner, text).args.at(-1)); onEvent({ session: 'T1' }); return { text: 'ok' }; } });
  const { bot } = bots.create({ name: 'Cody', cwd: os.tmpdir(), provider: 'codex' });
  for (const msg of ['one', 'two']) {
    bots.send(bot.id, msg);
    for (let i = 0; i < 200 && bots.running.has(bot.id); i++) await new Promise((r) => setTimeout(r, 5));
  }
  assert.equal(bots.read(bot.id).codexBrief.session, 'T1');
  assert.equal(bots.read(bot.id).codexBrief.stamp, briefStamp(bots.read(bot.id)));
  assert.match(seen[0], /You are "Cody"/);
  assert.equal(seen[1], 'two', 'the second turn is not padded with the brief');
});

// Noam 2026-10-23: a bot ended "Waiting for Noam: say go when you want me to build the
// sandwich, workout and cooking plans." — "זו לא סיבה שהיא יעצור".
test('every bot is told to keep going on safe work and to stop only for real reasons', () => {
  const brief = brainBrief({ id: 'b', name: 'Coach', job: 'health coach', rules: '' }, {});
  assert.match(brief, /Keep going:[^\n]*do it now[^\n]*Never stop to ask for his go/);
  assert.match(brief, /Waiting for Noam[^\n]*only for spending money, posting publicly, messaging people, deleting/);
  assert.match(brief, /Go ahead buttons[^\n]*only/);
  assert.doesNotMatch(brief, /say plainly that it is waiting for Noam\./, 'no open-ended permission to stop');
});
