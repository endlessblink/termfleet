import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { BotBrowser, cdp, stepsToSkill } from '../bridge/bot-browser.mjs';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { brainCommand, activityLine, runBrain, BROWSER_MCP, PLAYWRIGHT_MCP } from '../bridge/bots.mjs';
import { mcpProxy } from '../../scripts/termfleet-browser.mjs';

test('bot brains get the bots\' browser through the Playwright MCP, for both plans', () => {
  const claude = brainCommand({ id: 'b1', name: 'Quill', provider: 'claude', cwd: '/tmp', sessions: {} }, 'hi');
  const config = JSON.parse(claude.args[claude.args.indexOf('--mcp-config') + 1]);
  assert.deepEqual(config.mcpServers.browser, BROWSER_MCP);
  assert.equal(BROWSER_MCP.args.at(-1), 'mcp', 'through the go-between that opens the browser on first use');
  assert.ok(PLAYWRIGHT_MCP.args.includes('--cdp-endpoint'));
  assert.ok(claude.args.includes('mcp__browser') && claude.args.includes('Bash(termfleet-browser:*)') && claude.args.includes('Bash(termfleet-skill:*)'));
  const codex = brainCommand({ id: 'b1', name: 'Quill', provider: 'codex', cwd: '/tmp', sessions: {} }, 'hi');
  assert.ok(codex.args.some((a) => a.startsWith('mcp_servers.browser.args=') && a.includes('termfleet-browser.mjs')));
  assert.ok(codex.args.includes('mcp_servers.browser.default_tools_approval_mode="approve"'), 'nobody is there to approve a browser step');
  assert.ok(codex.args.includes('mcp_servers.node_repl.enabled=false') && codex.args.includes('plugins."unified-computer-use@openai-bundled".enabled=false'), 'no desktop control for bots');
  assert.ok(codex.args.includes('mcp_servers.browser.disabled_tools=["browser_run_code_unsafe"]'), 'no raw code through the browser');
  assert.ok(claude.args.includes('mcp__browser__browser_run_code_unsafe'), 'denied for Claude too');
  assert.equal(activityLine('mcp__browser__browser_click', {}), 'Using the browser');
});

test('taught steps become a plain skill body; secrets never appear', () => {
  const body = stepsToSkill([{ type: 'open', url: 'https://example.test/' }, { type: 'click', label: 'Sign in' }, { type: 'click', label: 'Sign in' }, { type: 'type', label: 'Email', value: 'a@b.c' }, { type: 'type', label: 'Password', value: null }], { when: new Date('2026-10-16T10:00:00Z') });
  assert.match(body, /1\. Open https:\/\/example\.test\/\n2\. Click "Sign in"\n3\. Type "a@b\.c" into "Email"\n4\. Fill "Password" — Noam fills this in himself/);
  assert.match(body, /ask Noam/);
});

const chrome = ['/usr/bin/google-chrome', '/usr/bin/chromium'].find((b) => fs.existsSync(b));

test('a real hidden Chrome: open, picture, teach a task, password left out', { skip: !chrome && 'no Chrome on this machine', timeout: 60000 }, async () => {
  const page = `<!doctype html><title>Invoices</title><form action="/done"><label>Email <input id="email" name="email"></label><label>Password <input id="pw" type="password" name="pw"></label><button id="go" type="button">Find unpaid</button></form>`;
  const site = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(req.url === '/done' ? '<title>Done</title>ok' : page); });
  await new Promise((r) => site.listen(0, '127.0.0.1', r));
  const siteUrl = `http://127.0.0.1:${site.address().port}/`;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-browser-'));
  const port = 9400 + Math.floor(Math.random() * 400);
  const browser = new BotBrowser({ port, profile, binary: chrome, headless: true });
  try {
    assert.equal((await browser.status()).running, false);
    assert.equal((await browser.start()).ok, true);
    assert.equal((await browser.start()).already, true, 'a second start reuses the open browser');
    const target = await browser.page();
    const c = await cdp(target.webSocketDebuggerUrl);
    await c.send('Page.enable');
    await c.send('Page.navigate', { url: siteUrl });
    await new Promise((r) => setTimeout(r, 800));
    const shot = await browser.screenshot();
    assert.equal(shot.image.subarray(0, 2).toString('hex'), 'ffd8', 'a JPEG picture for the phone');
    assert.equal((await browser.teachStart()).ok, true);
    assert.match((await browser.teachStart()).error, /Already/);
    const act = (js) => c.send('Runtime.evaluate', { expression: js });
    await act(`document.getElementById('email').value='noam@example.test';document.getElementById('email').dispatchEvent(new Event('change',{bubbles:true}))`);
    await act(`document.getElementById('pw').value='hunter2';document.getElementById('pw').dispatchEvent(new Event('change',{bubbles:true}))`);
    await act(`document.getElementById('go').click()`);
    await c.send('Page.navigate', { url: siteUrl + 'done' });
    await new Promise((r) => setTimeout(r, 800));
    assert.equal((await browser.status()).teaching.steps >= 4, true);
    c.close();
    const done = browser.teachStop();
    assert.equal(done.ok, true);
    assert.deepEqual(done.steps.map((s) => s.type), ['open', 'type', 'type', 'click', 'open']);
    assert.match(done.body, /Type "noam@example\.test" into "Email"/);
    assert.match(done.body, /Click "Find unpaid"/);
    assert.match(done.body, /Fill "Password" — Noam fills this in himself/);
    assert.doesNotMatch(done.body, /hunter2/);
    assert.match(browser.teachStop().error, /Nothing/);
  } finally {
    try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); const { webSocketDebuggerUrl } = await r.json(); const c = await cdp(webSocketDebuggerUrl); await c.send('Browser.close').catch(() => {}); c.close(); } catch { /* already closed */ }
    site.close();
    await new Promise((r) => setTimeout(r, 500));
    fs.rmSync(profile, { recursive: true, force: true });
  }
});

test('the go-between opens the bots\' browser only when a tool is first called, and passes everything through', async () => {
  const input = new PassThrough(), output = new PassThrough();
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough() });
  let starts = 0, sent = '';
  child.stdin.on('data', (c) => { sent += c; });
  mcpProxy({ input, output, launch: () => child, browser: { start: async () => { starts++; return { ok: true }; } } });
  input.write('{"jsonrpc":"2.0","id":1,"method":"initialize"}\n{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(starts, 0, 'listing tools does not open a window');
  input.write('{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"browser_navigate"}}\n{"jsonrpc":"2.0","id":4,"method":"tools/call"}\n');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(starts, 1, 'opened once');
  assert.equal(sent.trim().split('\n').length, 4, 'every message reached the browser tools in order');
  assert.match(sent.trim().split('\n')[2], /browser_navigate/);
});

test('a Codex run that stops partway is reported as a failure, not as its opening plan', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-codex-'));
  const fake = path.join(dir, 'codex');
  const lines = (done) => [
    '{"type":"thread.started","thread_id":"t1"}',
    '{"type":"item.completed","item":{"type":"agent_message","text":"1. Start a terminal. 2. Open the page."}}',
    ...(done ? ['{"type":"item.completed","item":{"type":"agent_message","text":"It printed ok-55; the word is ok-77."}}', '{"type":"turn.completed"}'] : []),
  ].map((l) => `echo '${l}'`).join('\n');
  try {
    fs.writeFileSync(fake, `#!/bin/sh\n${lines(false)}\necho 'tool server crashed' >&2\nexit 1\n`, { mode: 0o755 });
    const log = path.join(dir, 'last-run.log');
    const cut = await runBrain({ id: 'b', name: 'C', provider: 'codex', cwd: dir, sessions: {} }, 'go', { bins: { codex: fake }, logPath: log });
    assert.equal(cut.text, '');
    assert.match(cut.error, /stopped partway through \(tool server crashed\)/);
    assert.match(fs.readFileSync(log, 'utf8'), /\[stderr\] tool server crashed[\s\S]*\[exit 1\]/, 'the run is kept for diagnosis');
    fs.writeFileSync(fake, `#!/bin/sh\n${lines(true)}\n`, { mode: 0o755 });
    const ok = await runBrain({ id: 'b', name: 'C', provider: 'codex', cwd: dir, sessions: {} }, 'go', { bins: { codex: fake } });
    assert.equal(ok.text, 'It printed ok-55; the word is ok-77.');
    assert.equal(ok.error, null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a bot that cannot start Chrome itself asks the agents app, which opens it', { skip: !chrome && 'no Chrome on this machine', timeout: 60000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-browser-req-'));
  const port = 9400 + Math.floor(Math.random() * 400);
  const request = path.join(dir, 'bot-browser.request');
  const boxed = new BotBrowser({ port, profile: path.join(dir, 'p'), binary: '/nonexistent/chrome', request, waitMs: 20000 });
  const app = new BotBrowser({ port, profile: path.join(dir, 'p'), binary: chrome, headless: true, request });
  const timer = setInterval(() => { app.serveRequests().catch(() => {}); }, 200);
  try {
    const r = await boxed.start();
    assert.equal(r.ok, true);
    assert.equal(r.viaApp, true);
    assert.equal(fs.existsSync(request), false, 'the request was taken');
  } finally {
    clearInterval(timer);
    try { const v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); const c = await cdp(v.webSocketDebuggerUrl); await c.send('Browser.close').catch(() => {}); c.close(); } catch { /* closed */ }
    await new Promise((r) => setTimeout(r, 500));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
