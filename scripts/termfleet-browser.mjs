#!/usr/bin/env node
// The bots' browser on the PC (TF-096 part 8): one Chrome window with its own profile
// that bots drive and Noam can watch from his phone.
//
//   termfleet-browser start    open it if it is not open yet
//   termfleet-browser status   is it open, and which pages
//   termfleet-browser mcp      the browser tools for a bot brain (opens the browser on first use)
import fs, { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { BotBrowser } from '../termcontrol/bridge/bot-browser.mjs';
import { PLAYWRIGHT_MCP, BOTS_HOME } from '../termcontrol/bridge/bots.mjs';

/**
 * `termfleet-browser mcp`: the browser tools a bot brain gets. It passes MCP messages
 * (one JSON per line) straight through to the Playwright MCP, and the first time a
 * tool is actually called it opens the bots' browser if it is not open yet.
 */
export function mcpProxy({ input = process.stdin, output = process.stdout, browser = new BotBrowser(), launch = spawn, server = PLAYWRIGHT_MCP } = {}) {
  // Its cache must be writable inside Codex's sandbox: keep it in the bots' own folder.
  const cache = path.join(BOTS_HOME(), '.playwright');
  try { fs.mkdirSync(cache, { recursive: true }); } catch { /* the tools say so if it is missing */ }
  const child = launch(server.command, server.args, { stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: cache, XDG_CACHE_HOME: cache } });
  child.stdout.pipe(output);
  let ready = null, buffer = '', chain = Promise.resolve();
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
  child.on('exit', (code) => { if (input === process.stdin) process.exit(code ?? 0); });
  return child;
}

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
  return { ok: false, message: 'Use: termfleet-browser start | status' };
}

const startedAsCommand = (() => {
  try { return realpathSync(process.argv[1] ?? '') === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
})();
if (startedAsCommand && process.argv[2] === 'mcp') {
  mcpProxy();
} else if (startedAsCommand) {
  const result = await run(process.argv.slice(2));
  process.stdout.write(result.message + '\n');
  process.exit(result.ok ? 0 : 1);
}
