#!/usr/bin/env node
// The bots' browser on the PC (TF-096 part 8): one Chrome window with its own profile
// that bots drive and Noam can watch from his phone.
//
//   termfleet-browser start    open it if it is not open yet
//   termfleet-browser status   is it open, and which pages
//   termfleet-browser mcp      the browser tools for a bot brain (opens the browser on first use)
//   termfleet-browser windows  which bot has which window, and whether Noam has one
//   termfleet-browser ask-noam "<what he should do>"   a bot asks Noam to do a step in its window
import fs, { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { BotBrowser } from '../termcontrol/bridge/bot-browser.mjs';
import { PLAYWRIGHT_MCP, BOTS_HOME, BOT_BROWSER_PORT } from '../termcontrol/bridge/bots.mjs';
import { startWindowProxy, readWindows, setTakeover } from '../termcontrol/bridge/bot-windows.mjs';

/**
 * `termfleet-browser mcp`: the browser tools a bot brain gets. It passes MCP messages
 * (one JSON per line) straight through to the Playwright MCP, and the first time a
 * tool is actually called it opens the bots' browser if it is not open yet.
 */
export function mcpProxy({ input = process.stdin, output = process.stdout, browser = new BotBrowser(), launch = spawn, server = PLAYWRIGHT_MCP, bot = null, windowProxy = startWindowProxy } = {}) {
  // Its cache must be writable inside Codex's sandbox: keep it in the bots' own folder.
  const cache = path.join(BOTS_HOME(), '.playwright');
  try { fs.mkdirSync(cache, { recursive: true }); } catch { /* the tools say so if it is missing */ }
  // A bot's tools go through its own window go-between, so it sees only its own pages.
  const windows = bot?.id ? windowProxy({ botId: bot.id, botName: bot.name || '', upstreamPort: BOT_BROWSER_PORT }).catch(() => null) : Promise.resolve(null);
  let child = null;
  const started = windows.then((proxy) => {
    const args = proxy ? server.args.map((a) => (/^https?:\/\/127\.0\.0\.1:\d+$/.test(a) ? `http://127.0.0.1:${proxy.port}` : a)) : server.args;
    child = launch(server.command, args, { stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: cache, XDG_CACHE_HOME: cache } });
    child.stdout.pipe(output);
    child.on('exit', async (code) => {
      // Its task is over: close its windows (unless Noam has one) before leaving.
      await Promise.race([proxy?.close(), new Promise((r) => setTimeout(r, 5000))]);
      if (input === process.stdin) process.exit(code ?? 0);
    });
    return child;
  });
  let ready = null, buffer = '', chain = started.then(() => {});
  const forward = (line) => { chain = chain.then(async () => {
    if (!ready && /"method"\s*:\s*"tools\/call"/.test(line)) ready = browser.start().catch(() => null);
    if (ready) await ready;
    child.stdin.write(line + '\n');
  }); };
  input.setEncoding?.('utf8');
  input.on('data', (chunk) => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, nl); buffer = buffer.slice(nl + 1); if (line.trim()) forward(line); }
  });
  input.on('end', () => { chain.then(() => child.stdin.end()); });
  return started;
}

const flag = (args, name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] ?? '' : null; };

export async function run(args, browser = new BotBrowser()) {
  const [command] = args;
  if (command === 'start') {
    const r = await browser.start();
    return r.error ? { ok: false, message: r.error } : { ok: true, message: r.already ? 'The bots\' browser is already open.' : 'The bots\' browser is open on the PC.' };
  }
  if (command === 'status') {
    const st = await browser.status();
    return { ok: true, message: st.running ? `Open. Pages: ${st.pages.map((p) => `${p.title || 'untitled'} (${p.url})`).join('; ') || 'none'}` : 'Not open. Run: termfleet-browser start' };
  }
  if (command === 'windows') {
    const list = readWindows();
    return { ok: true, message: list.length ? list.map((w) => `${w.botName || w.botId}: ${w.targets.length} page(s)${w.takeover ? (w.takeover.by === 'noam' ? ', Noam has it now' : `, waiting for Noam: ${w.takeover.ask}`) : ''}`).join('\n') : 'No bot has a window open.' };
  }
  if (command === 'ask-noam') {
    const botId = process.env.TERMFLEET_BOT_ID;
    const ask = args.slice(1).join(' ').trim();
    if (!botId) return { ok: false, message: 'Only a bot can ask Noam to use its window.' };
    if (!ask) return { ok: false, message: 'Say what Noam should do: termfleet-browser ask-noam "<what to do>"' };
    setTakeover(botId, { ask, by: 'bot' });
    return { ok: true, message: 'Noam is asked. Your window stays open for him. Tell him the same in one line and stop; his note will arrive as a message when he hands it back.' };
  }
  return { ok: false, message: 'Use: termfleet-browser start | status | windows | ask-noam "<what Noam should do>"' };
}

const startedAsCommand = (() => {
  try { return realpathSync(process.argv[1] ?? '') === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
})();
if (startedAsCommand && process.argv[2] === 'mcp') {
  const args = process.argv.slice(3);
  const id = flag(args, '--bot') || process.env.TERMFLEET_BOT_ID || '';
  mcpProxy({ bot: id ? { id, name: flag(args, '--bot-name') || process.env.TERMFLEET_BOT_NAME || '' } : null });
} else if (startedAsCommand) {
  const result = await run(process.argv.slice(2));
  process.stdout.write(result.message + '\n');
  process.exit(result.ok ? 0 : 1);
}
