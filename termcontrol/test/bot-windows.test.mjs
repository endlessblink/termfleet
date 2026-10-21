import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BotBrowser } from '../bridge/bot-browser.mjs';
import { readWindows, setTakeover, clearTakeover, handBackText, sweepWindows } from '../bridge/bot-windows.mjs';
import { brainCommand, PLAYWRIGHT_MCP_CLI } from '../bridge/bots.mjs';

const chrome = ['/usr/bin/google-chrome', '/usr/bin/chromium'].find((b) => fs.existsSync(b));
const playwrightMcp = fs.existsSync(PLAYWRIGHT_MCP_CLI);
const SCRIPT = fileURLToPath(new URL('../../scripts/termfleet-browser.mjs', import.meta.url));

test('each bot brain is named to its browser tools, for both plans', () => {
  const claude = brainCommand({ id: 'b1', name: 'Quill', provider: 'claude', cwd: '/tmp', sessions: {} }, 'hi');
  const config = JSON.parse(claude.args[claude.args.indexOf('--mcp-config') + 1]);
  assert.deepEqual(config.mcpServers.browser.args.slice(-4), ['--bot', 'b1', '--bot-name', 'Quill']);
  const codex = brainCommand({ id: 'b2', name: 'Pip', provider: 'codex', cwd: '/tmp', sessions: {} }, 'hi');
  assert.ok(codex.args.some((a) => a.startsWith('mcp_servers.browser.args=') && a.includes('"--bot","b2"')));
});

test('the hand-back note reaches the bot in its own words', () => {
  assert.match(handBackText('I logged in'), /His note: "I logged in"/);
  assert.match(handBackText(''), /without a note/);
});

/** A bot's browser tools, the real way a bot brain starts them. */
function botTools(botId, env) {
  const child = spawn(process.execPath, [SCRIPT, 'mcp', '--bot', botId, '--bot-name', botId], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '', next = 1;
  const waiting = new Map();
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (d) => {
    buf += d; let nl;
    while ((nl = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, nl); buf = buf.slice(nl + 1); try { const m = JSON.parse(line); waiting.get(m.id)?.(m); } catch { /* log line */ } }
  });
  const call = (method, params = {}) => new Promise((resolve) => { const id = next++; waiting.set(id, resolve); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  const tool = async (name, args = {}) => { const r = await call('tools/call', { name, arguments: args }); return (r.result?.content || []).map((c) => c.text || '').join('\n') + (r.error ? r.error.message : ''); };
  const ready = call('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } })
    .then(() => child.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n'));
  const end = () => new Promise((resolve) => { child.on('exit', resolve); child.stdin.end(); });
  return { ready, tool, end, child };
}

test('two bots browse at the same time, each in its own window; Noam takes one over and hands it back', { skip: (!chrome && 'no Chrome on this machine') || (!playwrightMcp && 'no Playwright MCP installed'), timeout: 120000 }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-botwin-'));
  const port = 19300 + Math.floor(Math.random() * 500);
  const site = http.createServer((req, res) => {
    const name = req.url.slice(1) || 'home';
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<title>${name}</title><h1>${name}</h1><button onclick="document.title='clicked-${name}'">Press ${name}</button>`);
  });
  await new Promise((r) => site.listen(0, '127.0.0.1', r));
  const at = (p) => `http://127.0.0.1:${site.address().port}/${p}`;
  const env = { ...process.env, HOME: process.env.HOME, TC_BOTS_HOME: home, TC_BOT_BROWSER_PORT: String(port), TC_BOT_WINDOWS_DIR: path.join(home, 'state') };
  process.env.TC_BOT_WINDOWS_DIR = env.TC_BOT_WINDOWS_DIR;
  const browser = new BotBrowser({ port, profile: path.join(home, '.browser'), headless: !process.env.TC_SHOW_BROWSER, binary: chrome, windowsDir: env.TC_BOT_WINDOWS_DIR });
  const a = botTools('alpha', env), b = botTools('beta', env);
  try {
    assert.ok((await browser.start()).ok);
    await Promise.all([a.ready, b.ready]);
    // Both at once.
    const [na, nb] = await Promise.all([a.tool('browser_navigate', { url: at('alpha-page') }), b.tool('browser_navigate', { url: at('beta-page') })]);
    assert.match(na, /alpha-page/); assert.match(nb, /beta-page/);
    // Each sees only its own tabs.
    const [ta, tb] = await Promise.all([a.tool('browser_tabs', { action: 'list' }), b.tool('browser_tabs', { action: 'list' })]);
    assert.match(ta, /alpha-page/); assert.doesNotMatch(ta, /beta-page/);
    assert.match(tb, /beta-page/); assert.doesNotMatch(tb, /alpha-page/);
    // A second step in parallel keeps each in its own page.
    const [ca, cb] = await Promise.all([a.tool('browser_click', { element: 'Press button', target: (na.match(/button "Press alpha-page" \[ref=(\w+)\]/) || [])[1] || 'e3' }), b.tool('browser_navigate', { url: at('beta-two') })]);
    assert.match(ca, /clicked-alpha-page/); assert.match(cb, /beta-two/);
    const st = await browser.status();
    assert.deepEqual(st.windows.map((w) => w.botId).sort(), ['alpha', 'beta']);
    assert.ok(st.windows.find((w) => w.botId === 'beta').pages.every((p) => /beta-two/.test(p.url)));
    if (process.env.TC_SHOT_DIR) fs.writeFileSync(path.join(process.env.TC_SHOT_DIR, 'two-bots.json'), JSON.stringify({ port, ...st }, null, 2));
    if (process.env.TC_PAUSE_MS) await new Promise((r) => setTimeout(r, Number(process.env.TC_PAUSE_MS)));
    // Noam takes alpha's window: alpha cannot act there, beta carries on.
    setTakeover('alpha', { by: 'noam' }, env.TC_BOT_WINDOWS_DIR);
    const [blocked, still] = await Promise.all([a.tool('browser_navigate', { url: at('elsewhere') }), b.tool('browser_navigate', { url: at('beta-three') })]);
    assert.match(blocked, /Noam has taken over/);
    assert.match(still, /beta-three/);
    // Alpha's task ends while Noam has its window: it stays open. Beta's ends: its window closes.
    await Promise.all([a.end(), b.end()]);
    const after = await browser.status();
    assert.deepEqual(after.windows.map((w) => w.botId), ['alpha'], 'beta\'s window closed when its task ended');
    assert.ok(after.pages.filter((p) => p.url !== 'about:blank').every((p) => /alpha/.test(p.url)), 'no beta page is left');
    // He hands it back: the next task picks up the same window, where he left it.
    clearTakeover('alpha', env.TC_BOT_WINDOWS_DIR);
    const again = botTools('alpha', env);
    await again.ready;
    const tabs = await again.tool('browser_tabs', { action: 'list' });
    assert.match(tabs, /alpha-page/, 'it continues in the window Noam handed back');
    await again.end();
    assert.equal((await browser.status()).windows.length, 0, 'and closes it when that task ends');
    // A task that crashed leaves nothing behind for long.
    fs.mkdirSync(path.join(env.TC_BOT_WINDOWS_DIR, 'windows'), { recursive: true });
    fs.writeFileSync(path.join(env.TC_BOT_WINDOWS_DIR, 'windows', 'ghost.json'), JSON.stringify({ botId: 'ghost', pid: 0, targets: ['NOPE'] }));
    await sweepWindows({ port, dir: env.TC_BOT_WINDOWS_DIR });
    assert.equal(readWindows(env.TC_BOT_WINDOWS_DIR).length, 0);
  } finally {
    a.child.kill(); b.child.kill();
    try { await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json()).then(async (v) => { const ws = new WebSocket(v.webSocketDebuggerUrl); await new Promise((r) => { ws.onopen = r; }); ws.send(JSON.stringify({ id: 1, method: 'Browser.close' })); }); } catch { /* already closed */ }
    site.close();
    await new Promise((r) => setTimeout(r, 500));
    fs.rmSync(home, { recursive: true, force: true });
    delete process.env.TC_BOT_WINDOWS_DIR;
  }
});
