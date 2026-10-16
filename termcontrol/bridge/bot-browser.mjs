import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { BOTS_HOME, findBinary, BOT_BROWSER_PORT } from './bots.mjs';

/**
 * The bots' browser (TF-096 part 8, grill decisions 17-18). One Chrome window on the
 * PC with its own profile, separate from Noam's own browser. Bots drive it through the
 * Playwright MCP connected to its local debugging port; Noam watches it from the phone
 * as a live picture and takes over at the PC window (logins, codes, payments). "Teach
 * a task" records his clicks and typing there and turns them into a suggested skill.
 */
export const BROWSER_PORT = BOT_BROWSER_PORT;
export const browserEndpoint = (port = BROWSER_PORT) => `http://127.0.0.1:${port}`;
export const TEACH_LIMIT_MS = 10 * 60 * 1000;
// A Codex bot runs in a safety box that cannot start Chrome. It leaves this file
// instead (the folder is writable inside the box) and the agents app opens the browser.
export const requestFile = () => process.env.TC_BOT_BROWSER_REQUEST || path.join(process.env.HOME || '', '.local', 'share', 'terminal-workspace', 'bot-browser.request');


/** A tiny Chrome DevTools Protocol client over Node's built-in WebSocket. */
export function cdp(wsUrl, { timeoutMs = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let next = 0;
    const waiting = new Map(), listeners = new Map();
    const fail = setTimeout(() => { reject(new Error('The bots\' browser did not answer.')); try { ws.close(); } catch { /* closing */ } }, timeoutMs);
    ws.onerror = () => { clearTimeout(fail); reject(new Error('Could not reach the bots\' browser.')); };
    ws.onclose = () => { for (const { no } of waiting.values()) no(new Error('The bots\' browser closed.')); waiting.clear(); listeners.get('close')?.forEach((fn) => fn()); };
    ws.onmessage = (event) => {
      let msg; try { msg = JSON.parse(event.data); } catch { return; }
      if (msg.id && waiting.has(msg.id)) { const { yes, no } = waiting.get(msg.id); waiting.delete(msg.id); if (msg.error) no(new Error(msg.error.message)); else yes(msg.result); return; }
      listeners.get(msg.method)?.forEach((fn) => fn(msg.params || {}));
    };
    ws.onopen = () => {
      clearTimeout(fail);
      resolve({
        send: (method, params = {}) => new Promise((yes, no) => { const id = ++next; waiting.set(id, { yes, no }); ws.send(JSON.stringify({ id, method, params })); setTimeout(() => { if (waiting.delete(id)) no(new Error(`${method} took too long`)); }, timeoutMs); }),
        on: (method, fn) => { if (!listeners.has(method)) listeners.set(method, []); listeners.get(method).push(fn); },
        close: () => { try { ws.close(); } catch { /* already closed */ } },
      });
    };
  });
}

// Runs inside every page while teaching. Passwords, card numbers and codes are never
// recorded: the step says "Noam fills this in himself".
export const RECORDER = `(() => {
  if (window.__tfTeach || typeof tfTeach !== 'function') return; window.__tfTeach = true;
  const clean = (t) => String(t || '').replace(/\\s+/g, ' ').trim().slice(0, 70);
  const name = (el) => clean(el.getAttribute('aria-label') || el.innerText || el.value || el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('name') || el.tagName.toLowerCase());
  const field = (el) => clean((el.labels && el.labels[0] && el.labels[0].innerText) || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('name') || el.id || 'a field');
  const secret = (el) => el.type === 'password' || /pass|card|cvv|cvc|otp|one-time|code|ssn/i.test([el.name, el.id, el.autocomplete].join(' '));
  addEventListener('click', (e) => {
    const el = e.target.closest('a,button,select,[role=button],[role=link],[role=tab],[role=menuitem],input[type=checkbox],input[type=radio],input[type=submit]') || e.target;
    if (el.matches('input:not([type=checkbox]):not([type=radio]):not([type=submit]),textarea')) return;
    tfTeach(JSON.stringify({ type: 'click', label: name(el) }));
  }, true);
  addEventListener('change', (e) => {
    const el = e.target; if (!el.matches || !el.matches('input,select,textarea')) return;
    if (el.type === 'checkbox' || el.type === 'radio') return;
    tfTeach(JSON.stringify({ type: 'type', label: field(el), value: secret(el) ? null : clean(el.tagName === 'SELECT' ? el.selectedOptions[0]?.text : el.value) }));
  }, true);
})();`;

/** Recorded steps -> the body of a suggested skill. */
export function stepsToSkill(steps, { when = new Date() } = {}) {
  const lines = [];
  for (const s of steps) {
    const line = s.type === 'open' ? `Open ${s.url}`
      : s.type === 'click' ? `Click "${s.label}"`
        : s.type === 'type' ? (s.value === null ? `Fill "${s.label}" — Noam fills this in himself at the PC; never store or guess it.` : `Type "${s.value}" into "${s.label}"`)
          : null;
    if (line && lines[lines.length - 1] !== line) lines.push(line);
  }
  return [
    `Taught by Noam in the bots' browser on ${when.toISOString().slice(0, 10)}. Use the bots' browser (the Playwright browser tools) to repeat it.`,
    '',
    'Steps:',
    ...lines.map((l, i) => `${i + 1}. ${l}`),
    '',
    'Check each page looks as expected before the next step. If a page changed, describe what you see instead of guessing.',
    'Before anything that pays, sends, posts, deletes or signs in with a code, stop and ask Noam.',
  ].join('\n');
}

export class BotBrowser {
  constructor({ port = BROWSER_PORT, profile = path.join(BOTS_HOME(), '.browser'), binary = null, launch = spawn, headless = false, request = requestFile(), waitMs = 20000 } = {}) {
    this.port = port; this.profile = profile; this.launch = launch; this.headless = headless; this.request = request; this.waitMs = waitMs;
    this.binary = binary || findBinary('google-chrome') || findBinary('chromium') || findBinary('brave-browser');
    this.teaching = null;
  }

  async targets() {
    const r = await fetch(`${browserEndpoint(this.port)}/json/list`, { signal: AbortSignal.timeout(2000) });
    return (await r.json()).filter((t) => t.type === 'page' && !t.url.startsWith('devtools://'));
  }

  async status() {
    try {
      const pages = await this.targets();
      return { running: true, pages: pages.map((p) => ({ title: p.title, url: p.url })), teaching: this.teaching ? { steps: this.teaching.steps.length, startedAt: this.teaching.startedAt } : null };
    } catch { return { running: false, pages: [], teaching: null }; }
  }

  async start({ allowRequest = true } = {}) {
    if ((await this.status()).running) return { ok: true, already: true };
    const direct = await this.launchHere();
    if (direct.ok || !allowRequest) return direct;
    return this.askApp();
  }

  /** Ask the agents app (outside any safety box) to open the browser, and wait for it. */
  async askApp() {
    try { fs.mkdirSync(path.dirname(this.request), { recursive: true }); fs.writeFileSync(this.request, String(Date.now())); } catch { return { error: 'The bots\' browser did not start.' }; }
    for (let waited = 0; waited < this.waitMs; waited += 250) {
      if ((await this.status()).running) return { ok: true, viaApp: true };
      await new Promise((r) => setTimeout(r, 250));
    }
    return { error: 'The bots\' browser did not start (the agents app did not open it).' };
  }

  /** Called by the agents app every second: open the browser if a bot asked for it. */
  async serveRequests() {
    if (!fs.existsSync(this.request)) return false;
    try { fs.unlinkSync(this.request); } catch { /* another check took it */ return false; }
    await this.launchHere();
    return true;
  }

  async launchHere() {
    if ((await this.status()).running) return { ok: true, already: true };
    if (!this.binary) return { error: 'No Chrome or Chromium is installed on the PC.' };
    try { fs.mkdirSync(this.profile, { recursive: true }); } catch { return { error: 'The bots\' browser did not start.' }; }
    const args = [`--user-data-dir=${this.profile}`, `--remote-debugging-port=${this.port}`, '--remote-debugging-address=127.0.0.1', '--no-first-run', '--no-default-browser-check', '--window-size=1280,860', ...(this.headless ? ['--headless=new'] : []), 'about:blank'];
    let child;
    try { child = this.launch(this.binary, args, { detached: true, stdio: 'ignore' }); child.on?.('error', () => {}); child.unref?.(); } catch { return { error: 'The bots\' browser did not start.' }; }
    for (let i = 0; i < 40; i++) {
      if ((await this.status()).running) return { ok: true };
      await new Promise((r) => setTimeout(r, 250));
    }
    return { error: 'The bots\' browser did not start.' };
  }

  async page() {
    const [first] = await this.targets();
    if (!first) throw new Error('The bots\' browser has no open page.');
    return first;
  }

  /** A live picture for the phone. */
  async screenshot() {
    const target = await this.page();
    const c = await cdp(target.webSocketDebuggerUrl);
    try {
      const shot = await c.send('Page.captureScreenshot', { format: 'jpeg', quality: 55 });
      return { image: Buffer.from(shot.data, 'base64'), title: target.title, url: target.url };
    } finally { c.close(); }
  }

  async teachStart({ now = Date.now, limitMs = TEACH_LIMIT_MS } = {}) {
    if (this.teaching) return { error: 'Already recording a task.' };
    const target = await this.page();
    const c = await cdp(target.webSocketDebuggerUrl);
    const session = { c, steps: [{ type: 'open', url: target.url }], startedAt: now() };
    c.on('Runtime.bindingCalled', (p) => { if (p.name !== 'tfTeach' || session.expired || session.steps.length >= 300) return; try { session.steps.push(JSON.parse(p.payload)); } catch { /* ignore a broken step */ } });
    c.on('Page.frameNavigated', (p) => { if (!p.frame?.parentId && /^https?:/.test(p.frame?.url || '')) session.steps.push({ type: 'open', url: p.frame.url }); });
    c.on('close', () => { if (this.teaching === session) session.closed = true; });
    await c.send('Page.enable');
    await c.send('Runtime.enable');
    await c.send('Runtime.addBinding', { name: 'tfTeach' });
    await c.send('Page.addScriptToEvaluateOnNewDocument', { source: RECORDER });
    await c.send('Runtime.evaluate', { expression: RECORDER });
    session.timer = setTimeout(() => { session.expired = true; }, limitMs);
    session.timer.unref?.();
    this.teaching = session;
    return { ok: true };
  }

  teachStop() {
    const session = this.teaching;
    if (!session) return { error: 'Nothing is being recorded.' };
    this.teaching = null;
    clearTimeout(session.timer);
    session.c.close();
    const steps = session.steps.filter((s) => s.type !== 'open' || /^https?:/.test(s.url));
    return { ok: true, steps, body: stepsToSkill(steps) };
  }
}
