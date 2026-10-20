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
  assert.match(events, /has finished\. Read its result[^`]*Then close it \(termfleet-team close \$\{h\.paneId\}\) unless you are sending it more work now/);
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
