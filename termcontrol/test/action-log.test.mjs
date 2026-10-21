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
import { classifyTool, classifyCommand, botApproval, paneApproval, foldFiles, paneLogFile, appendAction, readActions } from '../bridge/action-log.mjs';
import { Bots, brainToolUses } from '../bridge/bots.mjs';
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
  assert.equal(classifyTool('apply_patch', { patch: '*** Begin Patch\n*** Delete File: a.txt\n*** End Patch' }, repo).kind, 'delete');
  const loose = path.join(os.homedir(), 'tc-actlog-loose-folder', 'x.sh');
  assert.equal(classifyTool('Write', { file_path: loose }).text, 'Changed files in tc-actlog-loose-folder', 'never the home folder\'s name');
  for (const read of [['Read', { file_path: '/x' }], ['Grep', {}], ['Bash', { command: 'git status' }], ['Bash', { command: 'ls -la' }], ['WebSearch', { query: 'x' }]]) assert.equal(classifyTool(...read), null, read[0]);
  assert.equal(classifyCommand('curl -s https://api.telegram.org/bot123:abc/sendMessage -d x').kind, 'send');
});

test('who approved: Noam typing in chat, approval card, prompt, standing rule, or nothing', () => {
  const chat = [{ id: 'm1', role: 'operator', at: 100 }, { id: 'e1', role: 'event', at: 200 }, { id: 'm2', role: 'operator', at: 300 }];
  const owner = new Set(['m1']);
  assert.equal(botApproval({ at: 150, needsApproval: true }, chat, owner), 'noam-chat');
  assert.equal(botApproval({ at: 250, needsApproval: true }, chat, owner), 'none', 'an event started this turn, not Noam');
  assert.equal(botApproval({ at: 350, needsApproval: true }, chat, owner), 'none', 'a routine message is not his own typed words');
  assert.equal(botApproval({ at: 350, needsApproval: false }, chat, owner), 'not-needed');
  const receipts = { '["pane-1","claude:s:toolu_9::x"]': { state: 'sent' } };
  assert.equal(paneApproval({ needsApproval: true, toolUseId: 'toolu_9' }, { receipts, paneId: 'pane-1' }), 'approval-card');
  assert.equal(paneApproval({ needsApproval: true, asked: true }, { receipts, paneId: 'pane-1' }), 'noam-prompt');
  assert.equal(paneApproval({ needsApproval: true, mode: 'default' }, {}), 'standing-rule');
  assert.equal(paneApproval({ needsApproval: true, mode: 'bypassPermissions' }, {}), 'none');
  assert.equal(paneApproval({ needsApproval: true, mode: 'auto' }, {}), 'none', 'a classifier is not Noam');
  assert.equal(paneApproval({ needsApproval: true }, {}), 'none');
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

test('the terminal hook records an action and whether the agent asked first; a bot brain is skipped', () => {
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-actlog-hook-'));
  const old = process.env.TC_CONFIG_DIR;
  process.env.TC_CONFIG_DIR = cfg;
  try {
    const env = { TERMFLEET_PANE_ID: 'terminal-a-b' };
    const input = { command: 'git push origin main' };
    assert.equal(handle({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: input }, env, 1000).asked.length, 16);
    const e = handle({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: input, tool_use_id: 'toolu_1', permission_mode: 'default', cwd: repo }, env, 2000);
    assert.equal(e.asked, true);
    assert.equal(e.kind, 'post');
    assert.equal(handle({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: input, cwd: repo }, env, 3000).asked, false, 'the ask is used once');
    assert.equal(handle({ hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: {} }, env), null);
    assert.equal(handle({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: input }, { ...env, TERMFLEET_BOT_ID: 'abc' }), null);
    assert.equal(handle({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: input }, {}), null);
    assert.equal(readActions(paneLogFile('terminal-a-b', path.join(cfg, 'actions'))).length, 2);
  } finally { if (old === undefined) delete process.env.TC_CONFIG_DIR; else process.env.TC_CONFIG_DIR = old; fs.rmSync(cfg, { recursive: true, force: true }); }
});

test('brain output lines give every tool call, Claude and Codex', () => {
  const claude = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'x' }, { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'git push' } }, { type: 'tool_use', id: 'toolu_2', name: 'Read', input: {} }] } });
  assert.deepEqual(brainToolUses('claude', claude).map((u) => u.name), ['Bash', 'Read']);
  assert.deepEqual(brainToolUses('codex', JSON.stringify({ type: 'item.started', item: { type: 'mcp_tool_call', server: 'browser', tool: 'browser_navigate', arguments: { url: 'https://x.org' } } })), [{ name: 'mcp__browser__browser_navigate', input: { url: 'https://x.org' } }]);
  assert.deepEqual(brainToolUses('claude', 'nope'), []);
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
    { at: now - 5 * 60000, actor: 'terminal', kind: 'post', text: 'Opened a GitHub pull request in termfleet', needsApproval: true, mode: 'default' },
  ];
  for (const a of term) appendAction(paneLogFile(pane, path.join(cfgDir, 'actions')), { ...a, paneId: pane });
  fs.writeFileSync(path.join(cfgDir, 'choice-receipts.json'), JSON.stringify({ [JSON.stringify([pane, 'claude:s:toolu_card::question:Push?'])]: { state: 'sent', at: now - 40 * 60000 } }));
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
      ['Sent an email to editor@example.com', 'noam-chat'],
      ['Opened example.com', 'not-needed'],
    ]);
    assert.equal(view.actions.find((a) => a.kind === 'files').count, 2);
    assert.deepEqual(view.counts, { all: 8, approval: 5, unapproved: 2 });
    assert.deepEqual(view.actions.filter((a) => a.unapproved).map((a) => a.who), ['Terminal 1 (Claude)', 'Herald']);
    assert.deepEqual(bots.activity(bot.id, { receipts, only: 'approval' }).actions.map((a) => a.kind), ['post', 'delete', 'spend', 'post', 'send']);
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
      assert.deepEqual(seen.red, ['Deleted old-build in termfleet', 'Generated an image on Magnific']);
      assert.equal(seen.border, 'rgb(229, 72, 77)');
      assert.match(seen.warn, /2 post, send, delete or spend actions were done without a recorded approval/);
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
