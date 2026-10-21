// TF-098 (Noam: "Yes, build the log"; idea from CopilotKit OpenBot's action gateway): every
// consequential action a bot or the terminal agents it started take is recorded in plain
// words with who approved it, shown as Activity per bot on phone and PC. Record only. A post,
// send, delete or spend with no recorded approval is shown in red.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { classifyTool, classifyCommand, botApproval, paneApproval, standingRule, approvalText, foldFiles, paneLogFile, appendAction, readActions } from '../bridge/action-log.mjs';
import { Bots, brainToolUses, brainToolResults } from '../bridge/bots.mjs';
import { recordOwnerWords } from '../bridge/owner-words.mjs';
import { handle } from '../../scripts/termfleet-action-log-hook.mjs';

const repo = path.resolve('.');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('tool calls become plain actions; reads and checks are not recorded', () => {
  const repoName = path.basename(repo);
  assert.deepEqual(classifyTool('Edit', { file_path: path.join(repo, 'README.md') }, repo), { kind: 'files', text: `Changed files in ${repoName}`, file: 'README.md', needsApproval: false });
  assert.equal(classifyTool('mcp__browser__browser_navigate', { url: 'https://www.example.com/a?b=1' }).text, 'Opened example.com');
  assert.equal(classifyTool('Bash', { command: 'git push origin main' }, repo).kind, 'post');
  assert.equal(classifyTool('Bash', { command: 'gh pr create --title x' }, repo).text, `Opened a GitHub pull request in ${repoName}`);
  assert.equal(classifyTool('Bash', { command: 'rm -rf old-build' }, repo).text, `Deleted old-build in ${repoName}`);
  assert.equal(classifyTool('Bash', { command: 'rm -f /tmp/x.txt' }, repo), null, 'scratch files are not news');
  assert.equal(classifyTool('Bash', { command: '~/.claude/bin/codex-image "a cat" out.png' }).kind, 'spend');
  assert.equal(classifyTool('mcp__claude_ai_Magnific__images_generate', { prompt: 'x' }).kind, 'spend');
  assert.equal(classifyTool('mcp__claude_ai_Magnific__creations_list', {}), null);
  assert.equal(classifyTool('mcp__claude_ai_Gmail__send_message', { to: 'a@b.c' }).text, 'Sent an email to a@b.c');
  assert.equal(classifyTool('mcp__claude_ai_Gmail__create_draft', {}).kind, 'files', 'a draft is not a send');
  assert.equal(classifyTool('Bash', { command: 'termfleet-team start --provider claude --task "x"' }).kind, 'terminal');
  assert.equal(classifyTool('Bash', { command: 'termfleet-team close Quill' }).text, 'Closed a terminal (Quill)');
  assert.equal(classifyTool('Bash', { command: 'termfleet-team send @Quill "fix it"' }).text, 'Handed work to @Quill');
  assert.equal(classifyCommand('termfleet-team send terminal-622321cf-4778-47e9-b594-802260ca6129-79885725 "x"').text, 'Handed work to a terminal agent');
  assert.equal(classifyTool('apply_patch', { patch: '*** Begin Patch\n*** Delete File: a.txt\n*** End Patch' }, repo).kind, 'delete');
  const loose = path.join(os.homedir(), 'tc-actlog-loose-folder', 'x.sh');
  assert.equal(classifyTool('Write', { file_path: loose }).text, 'Changed files in tc-actlog-loose-folder', 'never the home folder\'s name');
  for (const read of [['Read', { file_path: '/x' }], ['Grep', {}], ['Bash', { command: 'git status' }], ['Bash', { command: 'ls -la' }], ['WebSearch', { query: 'x' }]]) assert.equal(classifyTool(...read), null, read[0]);
  assert.equal(classifyCommand('curl -s https://api.telegram.org/bot123:abc/sendMessage -d x').kind, 'send');
});

const yes = (a) => createHash('sha256').update(String(a)).digest('hex');

// The three ways the first version claimed an approval it had no proof of (orchestrator review 2026-10-21).
test('false positive 1: a signed Noam message before a bot action is not an approval of that action', () => {
  const chat = [{ id: 'm1', role: 'operator', at: 100 }];
  assert.equal(botApproval({ at: 150, needsApproval: true, kind: 'send' }, chat, new Set(['m1'])), 'none');
  assert.equal(botApproval({ at: 150, needsApproval: false, kind: 'site' }, chat, new Set(['m1'])), 'not-needed');
});

test('false positive 2: the agent asking permission is a request, not a granted answer', () => {
  assert.equal(paneApproval({ needsApproval: true, asked: true, mode: 'default' }, {}), 'none');
  assert.equal(approvalText({ needsApproval: true, asked: true, approval: 'none' }), 'Approval not recorded (it asked first)');
});

test('false positive 3: normal permission mode is not a standing rule; only a matching scoped rule is', () => {
  assert.equal(paneApproval({ needsApproval: true, mode: 'default' }, {}), 'none');
  assert.equal(paneApproval({ needsApproval: true, mode: 'acceptEdits' }, {}), 'none');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-actlog-rules-'));
  try {
    fs.mkdirSync(path.join(home, '.claude'));
    fs.mkdirSync(path.join(home, '.codex', 'rules'), { recursive: true });
    fs.writeFileSync(path.join(home, '.codex', 'rules', 'default.rules'), 'prefix_rule(pattern=["git", "push"], decision="allow")\nprefix_rule(pattern=["rm"], decision="prompt")\n');
    const set = (allow) => fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({ permissions: { allow } }));
    set(['Bash', 'Bash(git status:*)', 'mcp__claude_ai_Gmail']);
    assert.equal(standingRule('Bash', { command: 'git push origin main' }, { provider: 'claude', home, cwd: home }), null, 'an unscoped "Bash" rule covers everything, so it proves nothing');
    assert.equal(standingRule('mcp__claude_ai_Gmail__send_message', {}, { provider: 'claude', home, cwd: home }), null, 'a whole-server rule is not scoped to this tool');
    set(['Bash(git push:*)', 'mcp__claude_ai_Gmail__send_message']);
    assert.equal(standingRule('Bash', { command: 'cd x && git push origin main' }, { provider: 'claude', home, cwd: home }), 'Bash(git push:*)');
    assert.equal(standingRule('Bash', { command: 'git status && rm -rf build' }, { provider: 'claude', home, cwd: home }), null, 'the rule must cover the part that deletes');
    assert.equal(standingRule('mcp__claude_ai_Gmail__send_message', {}, { provider: 'claude', home, cwd: home }), 'mcp__claude_ai_Gmail__send_message');
    assert.equal(standingRule('Bash', { command: 'git push' }, { provider: 'codex', home, cwd: home }), 'prefix_rule ["git","push"] allow');
    assert.equal(standingRule('Bash', { command: 'rm -rf build' }, { provider: 'codex', home, cwd: home }), null, 'a "prompt" rule is not an allow rule');
    assert.equal(paneApproval({ needsApproval: true, mode: 'default', rule: 'Bash(git push:*)' }, {}), 'standing-rule');
    assert.equal(approvalText({ needsApproval: true, approval: 'standing-rule', rule: 'Bash(git push:*)' }), 'Allowed by a standing rule: Bash(git push:*)');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('an approval card counts only when its answer granted that exact tool call', () => {
  const key = (askId) => JSON.stringify(['pane-1', askId]);
  const action = { needsApproval: true, toolUseId: 'call_7' };
  const card = (askId, answer, state = 'sent') => ({ [key(askId)]: { state, answerHash: yes(answer) } });
  assert.equal(paneApproval(action, { paneId: 'pane-1', receipts: card('codex:S:call_7::permission:Run git push?', 'yes') }), 'approval-card');
  assert.equal(paneApproval(action, { paneId: 'pane-1', receipts: card('codex:S:call_7::permission:Run git push?', 'yesAlways') }), 'approval-card');
  assert.equal(paneApproval(action, { paneId: 'pane-1', receipts: card('codex:S:call_7::permission:Run git push?', 'no') }), 'none', 'a "no" is not a grant');
  assert.equal(paneApproval(action, { paneId: 'pane-1', receipts: card('codex:S:call_7::question:Which one?', 'yes') }), 'none', 'a question answer is not a permission');
  assert.equal(paneApproval(action, { paneId: 'pane-2', receipts: card('codex:S:call_7::permission:Run?', 'yes') }), 'none', 'another terminal');
  assert.equal(paneApproval(action, { paneId: 'pane-1', receipts: card('codex:S:call_77::permission:Run?', 'yes') }), 'none', 'a different call');
  assert.equal(paneApproval(action, { paneId: 'pane-1', receipts: card('codex:S:call_7::permission:Run?', 'yes', 'dispatching') }), 'none', 'not confirmed sent');
  assert.equal(paneApproval({ needsApproval: true }, { paneId: 'pane-1', receipts: card('claude:S:vendor:123::permission:Allow?', 'yes') }), 'none', 'a card not tied to a tool call proves nothing');
});

test('quoted text, here-documents and dry runs are not actions', () => {
  assert.equal(classifyCommand('termfleet-team send @Quill "please rm -rf build, then git push"').kind, 'handoff');
  assert.equal(classifyCommand("cat > notes.md <<'EOF'\nrm -rf everything\ngit push\nEOF"), null);
  assert.equal(classifyCommand('git push --dry-run origin main'), null);
  assert.equal(classifyCommand('echo "gh pr create" > how-to.txt'), null);
});

test('file changes in one project fold into one line', () => {
  const rows = foldFiles([
    { at: 1, actor: 'terminal', kind: 'files', text: 'Changed files in A', file: 'a.js' },
    { at: 2, actor: 'terminal', kind: 'files', text: 'Changed files in A', file: 'b.js' },
    { at: 3, actor: 'terminal', kind: 'post', text: 'Pushed code from A' },
    { at: 4, actor: 'terminal', kind: 'files', text: 'Changed files in A', file: 'a.js' },
  ]);
  assert.equal(rows.length, 3);
  assert.deepEqual([rows[0].count, rows[0].files], [2, ['a.js', 'b.js']]);
});

test('the terminal hook records successful actions with the request and any scoped rule; failures and bot brains are skipped', () => {
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-actlog-hook-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-actlog-home-'));
  fs.mkdirSync(path.join(home, '.claude'));
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({ permissions: { allow: ['Bash(git push:*)'] } }));
  const old = process.env.TC_CONFIG_DIR;
  process.env.TC_CONFIG_DIR = cfg;
  try {
    const env = { TERMFLEET_PANE_ID: 'terminal-a-b', HOME: home };
    const input = { command: 'gh pr create --title x' };
    assert.equal(handle({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: input }, env, 1000).asked.length, 16);
    const e = handle({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: input, tool_use_id: 'toolu_1', permission_mode: 'default', cwd: repo }, env, 2000);
    assert.deepEqual([e.kind, e.asked, e.rule], ['post', true, null]);
    assert.equal(handle({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: input, cwd: repo }, env, 3000).asked, false, 'the request mark is used once');
    assert.equal(handle({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'git push origin main' }, cwd: repo }, env, 3500).rule, 'Bash(git push:*)');
    assert.equal(handle({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'git push' }, tool_response: { exit_code: 1 }, cwd: repo }, env), null, 'a failed command did nothing');
    assert.equal(handle({ hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: {} }, env), null);
    assert.equal(handle({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: input }, { ...env, TERMFLEET_BOT_ID: 'abc' }), null);
    assert.equal(handle({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: input }, { HOME: home }), null);
    assert.equal(readActions(paneLogFile('terminal-a-b', path.join(cfg, 'actions'))).length, 3);
  } finally { if (old === undefined) delete process.env.TC_CONFIG_DIR; else process.env.TC_CONFIG_DIR = old; fs.rmSync(cfg, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true }); }
});

test('brain output lines give every tool call and whether it succeeded, Claude and Codex', () => {
  const claude = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'x' }, { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'git push' } }, { type: 'tool_use', id: 'toolu_2', name: 'Read', input: {} }] } });
  assert.deepEqual(brainToolUses('claude', claude).map((u) => u.name), ['Bash', 'Read']);
  assert.deepEqual(brainToolResults('claude', JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', is_error: true }, { type: 'tool_result', tool_use_id: 'toolu_2' }] } })), [{ id: 'toolu_1', ok: false }, { id: 'toolu_2', ok: true }]);
  assert.deepEqual(brainToolUses('codex', JSON.stringify({ type: 'item.started', item: { id: 'item_3', type: 'mcp_tool_call', server: 'browser', tool: 'browser_navigate', arguments: { url: 'https://x.org' } } })), [{ id: 'item_3', name: 'mcp__browser__browser_navigate', input: { url: 'https://x.org' } }]);
  assert.deepEqual(brainToolResults('codex', JSON.stringify({ type: 'item.completed', item: { id: 'item_4', type: 'command_execution', exit_code: 1, status: 'failed' } })), [{ id: 'item_4', ok: false }]);
  assert.deepEqual(brainToolResults('codex', JSON.stringify({ type: 'item.completed', item: { id: 'item_3', type: 'mcp_tool_call', status: 'completed' } })), [{ id: 'item_3', ok: true }]);
  assert.deepEqual(brainToolUses('claude', 'nope'), []);
});

test('a bot action is recorded only once its tool call succeeded; denied or failed calls never happened', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-actlog-brain-'));
  const lines = [
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'mcp__browser__browser_navigate', input: { url: 'https://example.com' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1' }] } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'gh pr create --title x' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't2', is_error: true, content: 'This command requires approval' }] } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't3', name: 'Bash', input: { command: 'git push' } }] } },
    { type: 'result', subtype: 'success', result: 'done' },
  ];
  const bin = path.join(dir, 'fake-claude.mjs');
  fs.writeFileSync(bin, `#!${process.execPath}\n${lines.map((l) => `console.log(${JSON.stringify(JSON.stringify(l))});`).join('\n')}\n`, { mode: 0o755 });
  try {
    const bots = new Bots({ dir: path.join(dir, 'bots'), bins: { claude: bin, codex: bin }, fill: () => null, checks: { home: os.homedir() } });
    const { bot } = bots.create({ name: 'Brainy', cwd: dir });
    const r = await bots.turn(bot.id, 'go');
    assert.equal(r.text, 'done');
    assert.deepEqual(readActions(path.join(dir, 'bots', bot.id, 'actions.jsonl')).map((a) => a.text), ['Opened example.com']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

/** A bot with its own actions and one terminal agent it started, on disk the way the bridge keeps them. */
function seed(cfgDir, botId, botName, now = Date.now()) {
  const folder = path.join(cfgDir, 'bots', botId);
  const pane = 'terminal-seed-pane';
  const owner = path.join(cfgDir);
  const chat = [{ id: 'op1', role: 'operator', text: 'Check the site and post the release note', at: now - 50 * 60000 }, { id: 'ev1', role: 'event', text: 'A schedule ran', at: now - 20 * 60000 }];
  fs.appendFileSync(path.join(folder, 'chat.jsonl'), chat.map((m) => JSON.stringify(m)).join('\n') + '\n');
  recordOwnerWords({ id: 'op1', at: now - 50 * 60000, botId, bot: botName, text: chat[0].text }, { base: owner });
  const own = [
    { at: now - 49 * 60000, actor: 'bot', kind: 'site', text: 'Opened example.com', needsApproval: false },
    { at: now - 48 * 60000, actor: 'bot', kind: 'send', text: 'Sent an email to editor@example.com', needsApproval: true },
    { at: now - 19 * 60000, actor: 'bot', kind: 'spend', text: 'Generated an image on Magnific', needsApproval: true },
  ];
  for (const a of own) appendAction(path.join(folder, 'actions.jsonl'), a);
  fs.writeFileSync(path.join(folder, 'helpers.json'), JSON.stringify([{ paneId: pane, provider: 'claude', task: 'Fix the release notes page', cwd: repo, at: now - 47 * 60000 }]));
  const term = [
    { at: now - 46 * 60000, actor: 'terminal', kind: 'files', text: 'Changed files in termfleet', file: 'notes.md', needsApproval: false },
    { at: now - 45 * 60000, actor: 'terminal', kind: 'files', text: 'Changed files in termfleet', file: 'page.html', needsApproval: false },
    { at: now - 40 * 60000, actor: 'terminal', kind: 'post', text: 'Pushed code from termfleet', needsApproval: true, toolUseId: 'toolu_card', mode: 'bypassPermissions' },
    { at: now - 10 * 60000, actor: 'terminal', kind: 'delete', text: 'Deleted old-build in termfleet', needsApproval: true, mode: 'bypassPermissions' },
    { at: now - 5 * 60000, actor: 'terminal', kind: 'post', text: 'Opened a GitHub pull request in termfleet', needsApproval: true, mode: 'default', rule: 'Bash(gh pr create:*)' },
  ];
  for (const a of term) appendAction(paneLogFile(pane, path.join(cfgDir, 'actions')), { ...a, paneId: pane });
  fs.writeFileSync(path.join(cfgDir, 'choice-receipts.json'), JSON.stringify({ [JSON.stringify([pane, 'codex:s:toolu_card::permission:Push?'])]: { state: 'sent', at: now - 40 * 60000, answerHash: createHash('sha256').update('yes').digest('hex') } }));
}

test('a bot\'s activity joins its own actions with its terminals, newest first, and flags unapproved ones', () => {
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-actlog-'));
  const old = process.env.TC_CONFIG_DIR;
  process.env.TC_CONFIG_DIR = cfg;
  try {
    const bots = new Bots({ dir: path.join(cfg, 'bots'), run: async () => ({ text: 'ok' }), fill: () => null });
    bots.ownerWordsBase = cfg;
    const { bot } = bots.create({ name: 'Herald', cwd: os.tmpdir() });
    seed(cfg, bot.id, 'Herald');
    const receipts = JSON.parse(fs.readFileSync(path.join(cfg, 'choice-receipts.json'), 'utf8'));
    const view = bots.activity(bot.id, { receipts });
    const lines = view.actions.map((a) => [a.text, a.approval]);
    assert.deepEqual(lines, [
      ['Opened a GitHub pull request in termfleet', 'standing-rule'],
      ['Deleted old-build in termfleet', 'none'],
      ['Generated an image on Magnific', 'none'],
      ['Pushed code from termfleet', 'approval-card'],
      ['Changed files in termfleet', 'not-needed'],
      ['Started a terminal agent: Fix the release notes page', 'not-needed'],
      ['Sent an email to editor@example.com', 'none'],
      ['Opened example.com', 'not-needed'],
    ]);
    assert.equal(view.actions.find((a) => a.kind === 'files').count, 2);
    assert.deepEqual(view.counts, { all: 8, approval: 5, unapproved: 3 });
    assert.deepEqual(view.actions.filter((a) => a.unapproved).map((a) => a.who), ['Terminal 1 (Claude)', 'Herald', 'Herald']);
    assert.equal(view.actions[0].approvalText, 'Allowed by a standing rule: Bash(gh pr create:*)');
    assert.deepEqual(bots.activity(bot.id, { receipts, only: 'approval' }).actions.map((a) => a.kind), ['post', 'delete', 'spend', 'post', 'send']);
    appendAction(path.join(cfg, 'bots', bot.id, 'actions.jsonl'), { at: Date.now() - 1000, actor: 'bot', kind: 'handoff', text: 'Handed work to terminal-622321cf-4778-47e9-b594-802260…', needsApproval: false });
    assert.equal(bots.activity(bot.id).actions[0].text, 'Handed work to a terminal agent', 'older lines read plainly too');
    // the brain's own tool calls land in the log while it works
    bots.recordAction(bot.id, { name: 'Bash', input: { command: 'gws gmail +send --to x' } });
    assert.equal(bots.activity(bot.id).actions[0].text, 'Sent an email');
  } finally { if (old === undefined) delete process.env.TC_CONFIG_DIR; else process.env.TC_CONFIG_DIR = old; fs.rmSync(cfg, { recursive: true, force: true }); }
});

test('Activity on phone and PC: newest first, filter, unapproved rows in red', { timeout: 120000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-actlog-ui-'));
  for (const d of ['cfg', 'home']) fs.mkdirSync(path.join(tmp, d));
  const shots = process.env.TC_SHOT_DIR || tmp;
  const port = 7900 + Math.floor(Math.random() * 300), base = `http://localhost:${port}`;
  const child = spawn(process.execPath, [path.join(repo, 'termcontrol/bridge/server.mjs')], { env: { ...process.env, TC_PORT: String(port), TC_CONFIG_DIR: tmp + '/cfg', TC_HOST: '127.0.0.1', TC_BOTS_HOME: tmp + '/home', TC_NO_AGENT_HEALTH: '1' }, stdio: 'ignore' });
  for (let i = 0; i < 80; i++) { try { await fetch(`http://127.0.0.1:${port}/login`); break; } catch { await wait(150); } }
  const browser = await chromium.launch();
  try {
    let seeded = null;
    for (const [phone, width, height] of [[true, 390, 844], [false, 1400, 900]]) {
      const p = await (await browser.newContext({ viewport: { width, height }, hasTouch: phone, isMobile: phone })).newPage();
      const errors = []; p.on('pageerror', (e) => errors.push(String(e)));
      await p.goto(base + '/');
      await p.evaluate(() => { const e = document.querySelector('#email'); if (e) e.value = 'owner@example.test'; document.querySelector('#password').value = 'a-good-password'; document.querySelector('form').requestSubmit(); });
      await p.waitForFunction(() => document.querySelector('.fleet-tabs'), null, { timeout: 20000, polling: 250 });
      if (!seeded) {
        seeded = await p.evaluate(async () => (await (await fetch('/api/bots', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Herald', provider: 'claude' }) })).json()).bot.id);
        seed(path.join(tmp, 'cfg'), seeded, 'Herald');
      }
      await p.goto(base + '/#bot:' + seeded);
      await p.waitForSelector('.bot-menu-button', { timeout: 15000 });
      await p.click('.bot-menu-button');
      await p.click('.bot-menu-sheet [data-act=activity]');
      await p.waitForSelector('.act-dialog .act-row', { timeout: 10000 });
      const seen = await p.evaluate(() => ({
        rows: [...document.querySelectorAll('.act-dialog .act-row')].map((r) => r.querySelector('.act-what').textContent),
        red: [...document.querySelectorAll('.act-dialog .act-row.unapproved .act-what')].map((r) => r.textContent),
        border: getComputedStyle(document.querySelector('.act-row.unapproved')).borderTopColor,
        warn: document.querySelector('.act-warn')?.textContent || '',
        fits: document.querySelector('.act-dialog').getBoundingClientRect().right <= innerWidth && document.querySelector('.act-dialog .room-cancel').getBoundingClientRect().bottom <= innerHeight,
      }));
      assert.equal(seen.rows[0], 'Opened a GitHub pull request in termfleet', 'newest first');
      assert.deepEqual(seen.red, ['Deleted old-build in termfleet', 'Generated an image on Magnific', 'Sent an email to editor@example.com']);
      assert.equal(seen.border, 'rgb(229, 72, 77)');
      assert.match(seen.warn, /3 post, send, delete or spend actions have no recorded approval/);
      assert.equal(seen.fits, true);
      assert.equal(await p.textContent('.act-dialog h2'), 'What Herald did');
      await p.screenshot({ path: path.join(shots, `activity-${phone ? 'phone' : 'pc'}.png`) });
      await p.click('.act-filters [data-only=approval]');
      await p.waitForFunction(() => document.querySelectorAll('.act-dialog .act-row').length === 5, null, { timeout: 5000 });
      await p.screenshot({ path: path.join(shots, `activity-${phone ? 'phone' : 'pc'}-needs-approval.png`) });
      assert.deepEqual(errors, []);
    }
  } finally { await browser.close(); child.kill('SIGKILL'); fs.rmSync(tmp, { recursive: true, force: true }); }
});
