// Noam 2026-10-20: "כדאי לתת לסוכן את היכולת להרוג טרמינל שהוא פתח אחרי שהוא סיים".
// A bot closes only a terminal it started, only once it is done, and says so in its chat.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { closeOwnTerminal, unsavedWork, panesAfterTwoLooks } from '../../scripts/lib/team-close.mjs';
import { resolvePane, stateOf } from '../bridge/orchestrate.mjs';
import { Bots } from '../bridge/bots.mjs';

const pane = (id, turn, extra = {}) => ({ id, project: 'demo', provider: 'claude', alive: true, turn, cwd: null, ...extra });
const setup = () => {
  const requests = [], notes = [];
  return {
    requests, notes,
    run: (query, panes, owned, unsaved = () => []) => closeOwnTerminal({ query, panes, owned, resolvePane, stateOf, unsaved, by: 'bot:Quill',
      request: async (id) => { requests.push(id); return { ok: true }; }, record: (e) => notes.push(e) }),
  };
};
const panes = [pane('terminal-a-done', 'idle'), pane('terminal-b-busy', 'working'), pane('terminal-c-ask', 'waiting'), pane('terminal-d-other', 'idle')];
const owned = [{ paneId: 'terminal-a-done', task: 'run phone tests', at: 1 }, { paneId: 'terminal-b-busy', task: 'build', at: 1 }, { paneId: 'terminal-c-ask', task: 'render', at: 1 }];

test('a finished terminal the bot started closes, and the bot chat says so', async () => {
  const t = setup();
  const r = await t.run('terminal-a-done', panes, owned);
  assert.deepEqual([r.ok, t.requests], [true, ['terminal-a-done']]);
  assert.deepEqual(t.notes, [{ role: 'note', text: 'Closed the "run phone tests" terminal; its work was finished.' }]);
});

test('refused: still working, waiting for Noam, started by someone else, unsaved work', async () => {
  const t = setup();
  assert.match((await t.run('terminal-b-busy', panes, owned)).text, /still working/);
  assert.match((await t.run('terminal-c-ask', panes, owned)).text, /waiting on a prompt for Noam/);
  assert.match((await t.run('terminal-d-other', panes, owned)).text, /did not start/);
  assert.match((await t.run('terminal-a-done', panes, owned, () => ['src/app.ts'])).text, /unsaved work \(src\/app\.ts\)/);
  assert.deepEqual([t.requests, t.notes], [[], []], 'nothing closed, nothing said');
});

test('unsaved work counts only files changed after the terminal started', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-git-'));
  const git = (...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
  git('init', '-q');
  fs.writeFileSync(path.join(dir, 'old.txt'), 'someone else\'s edit');
  const old = Date.now() - 60_000; fs.utimesSync(path.join(dir, 'old.txt'), old / 1000, old / 1000);
  const started = Date.now() - 1000;
  fs.writeFileSync(path.join(dir, 'mine.txt'), 'its own edit');
  assert.deepEqual(unsavedWork(dir, started), ['mine.txt']);
  assert.deepEqual(unsavedWork(os.tmpdir() + '/no-such-folder-x', started), []);
});

test('bots are told to close their finished terminals', () => {
  const bots = new Bots({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'tc-bots-')), run: async () => ({ text: 'ok' }), fill: () => null, checks: { home: os.homedir() } });
  const src = fs.readFileSync(new URL('../bridge/bots.mjs', import.meta.url), 'utf8');
  assert.match(src, /termfleet-team close <who>/);
  assert.ok(bots);
});

test('bots are told to close a finished terminal they started, in the brief and in the finished wake-up', () => {
  // Noam 2026-10-20: 24 terminals open, 23 idle.
  const brief = fs.readFileSync(new URL('../bridge/bots.mjs', import.meta.url), 'utf8');
  assert.match(brief, /Always close a terminal you started once its work is done/);
  const events = fs.readFileSync(new URL('../bridge/bot-events.mjs', import.meta.url), 'utf8');
  assert.match(events, /has finished\. Read its result[\s\S]{0,400}Then close it \(termfleet-team close \$\{h\.paneId\}\) unless you are sending it more work now/);
});

test('only unsaved work the agent made itself blocks its close, not a stranger\'s files in the same folder', async () => {
  // Noam 2026-10-21: another agent's unsaved installer files blocked closing every terminal in termfleet.
  const { shellWriteTargets, changedByAgent, filesTheAgentChanged } = await import('../../scripts/lib/team-close.mjs');
  assert.deepEqual(shellWriteTargets('npm test 2>&1 | tail -5'), []);
  assert.deepEqual(shellWriteTargets('git diff scripts/install-release.sh > /tmp/x.diff'), ['/tmp/x.diff']);
  assert.deepEqual(shellWriteTargets("sed -i 's/a/b/' src/app.js"), ['src/app.js']);
  assert.deepEqual(shellWriteTargets('cp a.txt docs/b.txt && echo hi >> notes.md'), ['notes.md', 'docs/b.txt']);
  const record = [
    { message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: '/repo/src/mine.js' } }] } },
    { message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'cat scripts/install-release.sh; npm test 2>&1 | tail' } }] } },
    { message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: "sed -i 's/x/y/' docs/also-mine.md" } }] } },
  ].map((e) => JSON.stringify({ ...e, message: { ...e.message, content: e.message.content } }).replace('"content"', '"type":"assistant","content"')).join('\n');
  const changes = filesTheAgentChanged({ provider: 'claude', sessionId: 's' }, { transcriptOf: () => '/x.jsonl', read: () => record.replaceAll('"type":"assistant",', '') + '\n' + record });
  assert.equal(changedByAgent('src/mine.js', '/repo', changes), true);
  assert.equal(changedByAgent('docs/also-mine.md', '/repo', changes), true);
  assert.equal(changedByAgent('scripts/install-release.sh', '/repo', changes), false, 'only read, never written');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-fair-'));
  const run = (args) => args[0] === 'status' ? { status: 0, stdout: ' M src/mine.js\n M scripts/install-release.sh\n' } : { status: 0, stdout: dir + '\n' };
  assert.deepEqual(unsavedWork(dir, 0, run, { paths: new Set([path.join(dir, 'src/mine.js')]), commands: [] }), ['src/mine.js']);
  assert.deepEqual(unsavedWork(dir, 0, run, null), ['src/mine.js', 'scripts/install-release.sh'], 'no record (plain shell): the time rule still applies');
});

test('a busy plain shell is seen as working: the close looks twice before deciding', async () => {
  // One look from a fresh command never sees output move (live 2026-10-20: a shell printing every second read idle).
  let looks = 0;
  const look = async () => [{ id: 'terminal-t-p', alive: true, turn: 'idle', producing: ++looks > 1, cwd: null }];
  const panes = await panesAfterTwoLooks(look, async () => {});
  assert.equal(looks, 2);
  const r = await closeOwnTerminal({ query: 'terminal-t-p', panes, owned: [{ paneId: 'terminal-t-p', task: 'busy', at: 0 }], resolvePane, stateOf,
    request: async () => { throw new Error('must not close'); }, record: () => {}, unsaved: () => [] });
  assert.equal(r.ok, false);
  assert.match(r.text, /still working/);
});

test('work the agent already committed is not unsaved: only edits after its last commit count', async () => {
  // Agent-Manager 2026-10-22 for Noam: a finished agent could not close because MASTER_PLAN.md
  // still held other agents' edits after it had committed its own part.
  const { filesTheAgentChanged, changedByAgent } = await import('../../scripts/lib/team-close.mjs');
  const use = (name, input) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name, input }] } });
  const record = [
    use('Edit', { file_path: '/repo/MASTER_PLAN.md' }),
    use('Bash', { command: 'git add src/a.js MASTER_PLAN.md && git commit -m "done"' }),
    use('Edit', { file_path: '/repo/src/after.js' }),
  ].join('\n');
  const changes = filesTheAgentChanged({ provider: 'claude', sessionId: 's' }, { transcriptOf: () => '/x.jsonl', read: () => record });
  assert.equal(changedByAgent('MASTER_PLAN.md', '/repo', changes), false, 'committed, then others edited it');
  assert.equal(changedByAgent('src/after.js', '/repo', changes), true, 'edited after its commit: really its own unsaved work');
});

test('a plain shell only owns files changed while it was in use', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-shell-'));
  const run = (args) => args[0] === 'status' ? { status: 0, stdout: ' M early.txt\n M during.txt\n M later.txt\n' } : { status: 0, stdout: dir + '\n' };
  const at = (name, ms) => { fs.writeFileSync(path.join(dir, name), name); fs.utimesSync(path.join(dir, name), ms / 1000, ms / 1000); };
  const now = Date.now();
  at('early.txt', now - 10_000_000); at('during.txt', now - 5_000_000); at('later.txt', now - 1_000_000);
  assert.deepEqual(unsavedWork(dir, now - 6_000_000, run, null, now - 4_000_000), ['during.txt'], 'later edits are another agent\'s, the shell was quiet');
});

test('an agent can close its own terminal: refused with a plain reason, otherwise closed after its last reply is saved', async () => {
  const { closeSelf } = await import('../../scripts/lib/team-close.mjs');
  const me = { id: 'terminal-me', alive: true, turn: 'working', provider: 'claude', cwd: '/repo', startedAt: 1 };
  const scheduled = [];
  const base = { pane: me, unsaved: () => [], changes: () => null, schedule: (id) => { scheduled.push(id); return { ok: true }; } };
  assert.match((await closeSelf({ ...base, pane: null })).text, /cannot tell which terminal/);
  assert.match((await closeSelf({ ...base, pane: { ...me, attention: { kind: 'question' } } })).text, /waiting for Noam/);
  assert.match((await closeSelf({ ...base, unsaved: () => ['src/x.js'] })).text, /unsaved work \(src\/x\.js\)/);
  assert.deepEqual(scheduled, [], 'refusals close nothing');
  const ok = await closeSelf(base);
  assert.deepEqual([ok.ok, scheduled], [true, ['terminal-me']]);
  assert.match(ok.text, /closes as soon as this reply is saved/);
});

test('the self-close waits until the reply is finished, and gives up if Noam is asked something', async () => {
  const { closeWhenIdle } = await import('../../scripts/lib/team-close.mjs');
  const turns = ['working', 'working', 'idle', 'idle'];
  const closed = [];
  const r = await closeWhenIdle('terminal-me', { look: async () => [{ id: 'terminal-me', alive: true, turn: turns.shift() || 'idle', producing: false }], pause: async () => {}, request: async (id) => { closed.push(id); return { ok: true }; }, stateOf });
  assert.deepEqual([r.ok, closed], [true, ['terminal-me']]);
  const asked = await closeWhenIdle('terminal-me', { look: async () => [{ id: 'terminal-me', alive: true, turn: 'waiting' }], pause: async () => {}, request: async () => { throw new Error('must not close'); }, stateOf });
  assert.equal(asked.ok, false);
  assert.match(asked.text, /waiting for Noam/);
});

test('an agent may close a terminal it started itself (its child), not anyone else\'s', async () => {
  const { ownedChildren } = await import('../../scripts/lib/team-close.mjs');
  const panes = [{ id: 'terminal-kid', parentPaneId: 'terminal-me', startedAt: 5, statedTask: 'run tests' }, { id: 'terminal-other', parentPaneId: 'terminal-x' }];
  assert.deepEqual(ownedChildren(panes, 'terminal-me'), [{ paneId: 'terminal-kid', task: 'run tests', at: 5 }]);
});

test('every agent is told to close its own terminal once its work is done, checked and saved', () => {
  const home = os.homedir();
  for (const file of [path.join(home, '.claude/CLAUDE.md'), path.join(home, '.codex/AGENTS.md')]) {
    if (!fs.existsSync(file)) continue;
    assert.match(fs.readFileSync(file, 'utf8'), /Close your own terminal once your work is done, checked and saved \(committed\): `termfleet-team close self`/);
  }
  assert.match(fs.readFileSync(new URL('../../scripts/termfleet-team.mjs', import.meta.url), 'utf8'), /termfleet-team close self/);
});
