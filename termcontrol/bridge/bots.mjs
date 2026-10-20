import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BotMemory, searchChat } from './memory.mjs';
import { contextFill } from './context-fill.mjs';
import { claudeTranscript } from './paths.mjs';
import { asksForFile } from '../../scripts/termfleet-asks.mjs';
import { uploadDir } from './uploads.mjs';
import { skillPrompt } from './skills.mjs';
import { parseQuestion, QUESTION_RULE } from './bot-questions.mjs';
import { defaultDaemonSocket } from '../../scripts/termfleetctl.mjs';

/**
 * Bots (TF-096, after Grok Bot): managers that run OUTSIDE the terminals. Each bot
 * has a profile (name, job, standing rules), one continuous chat, and a brain: a
 * background Claude or Codex run on the operator's own plans, resumed per bot. A bot
 * reads and checks things itself; real changes and long jobs go to terminal agents,
 * which it starts, steers and reads with `termfleet-team`. Terminals stay the workers.
 *
 * Stored on this machine: <config>/bots/<id>/bot.json and chat.jsonl.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const defaultDir = () => path.join(process.env.TC_CONFIG_DIR || path.join(os.homedir(), '.config', 'termcontrol'), 'bots');

export const PROVIDERS = ['claude', 'codex'];

// Which model a bot thinks with is a per-bot choice (TF-096, Noam 2026-10-19: "need a
// way to change the bots model after it was started"). Empty = the plan's own default.
const CLAUDE_MODELS = [
  { id: 'fable', label: 'Fable' }, { id: 'opus', label: 'Opus' }, { id: 'sonnet', label: 'Sonnet' }, { id: 'haiku', label: 'Haiku' },
];
export function modelChoices(provider, { home = os.homedir() } = {}) {
  if (provider === 'claude') return CLAUDE_MODELS;
  try {
    const cache = JSON.parse(fs.readFileSync(path.join(home, '.codex', 'models_cache.json'), 'utf8'));
    return (cache.models || []).filter((m) => m.visibility === 'list' && m.slug).map((m) => ({ id: m.slug, label: m.display_name || m.slug }));
  } catch { return []; }
}
/** Every bot works in its own folder side by side here (Noam: "each agent next to the other, under Termfleet"). */
export const BOTS_HOME = () => process.env.TC_BOTS_HOME || path.join(os.homedir(), 'TermFleet', 'bots');
export const LIMITS = { name: 40, job: 80, rules: 4000, message: 20000 };
/** A bot starts a fresh conversation once its working memory is this full (percent). */
export const FRESH_AT = Number(process.env.TC_BOT_FRESH_AT) || 80;
const MAX_CHAT_RETURNED = 300;
/** What counts as a new message for Noam: the bot's replies, failures and questions to him. */
const UNREAD_ROLES = new Set(['bot', 'error', 'needs-you']);

const clean = (v, max) => String(v ?? '').trim().slice(0, max);
const newId = () => crypto.randomBytes(6).toString('hex');

/** The brain binaries, found once. The bridge runs under systemd with a thin PATH. */
export function findBinary(name, env = process.env) {
  const override = env[`TC_${name.toUpperCase()}_BIN`];
  if (override) return override;
  const home = os.homedir();
  const candidates = [
    ...(env.PATH || '').split(':').filter(Boolean).map((d) => path.join(d, name)),
    path.join(home, '.npm-global', 'bin', name),
    path.join(home, '.local', 'bin', name),
    `/usr/local/bin/${name}`,
    `/usr/bin/${name}`,
  ];
  for (const c of candidates) {
    try { fs.accessSync(fs.realpathSync(c), fs.constants.X_OK); return fs.realpathSync(c); } catch { /* next */ }
  }
  return null;
}

/** What every bot is told about itself and how it works, on every run. */
export function brainBrief(bot, { card = '', handover = '' } = {}) {
  return [
    `You are "${bot.name}", a bot in TermFleet, Noam's agent cockpit. You run outside the terminals, like a Grok Bot teammate.`,
    bot.job ? `Your job: ${bot.job}.` : 'You do not have a job or standing rules yet. From what Noam asks in this first conversation, draft them and offer them to him with: `termfleet-memory profile --job "<your job in a few words>" --rules "<standing rules, one per line>"`. He approves or edits them; until then, just help with what he asks.',
    bot.rules ? `Standing rules from Noam (keep them above any single request):\n${bot.rules}` : '',
    '',
    'How you work:',
    '- Do light work yourself: read files, search, check status, answer questions.',
    '- Real changes, builds, tests and long jobs go to terminal agents, which you direct with the termfleet-team command:',
    '  `termfleet-team list` (who is working on what), `termfleet-team read <who>` (their latest messages),',
    '  `termfleet-team send <who> "<task>"` (hand work over), `termfleet-team ask <who> "<question>"` (wait up to 2 minutes for the answer; if it is not ready you are woken when it finishes, so then just tell Noam it is in progress and stop),',
    '  `termfleet-team start --provider claude|codex --cwd <folder> --task "<task>"` (open a new terminal agent for a job),',
    '  `termfleet-team routine add --time 09:00 --days weekdays --message "<text>"` (a scheduled message).',
    '- Say which terminal agent you handed work to, and check its result before telling Noam it is done.',
    '- After you checked a terminal agent\'s result and told Noam, close it with `termfleet-team close <who>` if nothing else is pending there, so finished terminals do not pile up. It only closes terminals you started, and refuses while one is working, waiting for Noam, or has unsaved work: then leave it open and say why.',
    '- Keep Noam\'s requests in his exact words. For a new or unclear request, read it back as a short numbered list first.',
    '- Never say "done" without proof (what ran and what it showed). If you did less than asked, say so in your first sentence.',
    '- Never spend money, post publicly, send messages to people, or delete things without Noam\'s explicit yes.',
    '- Write to Noam in short, plain, everyday sentences: no code, file paths or jargon unless he asks.',
    QUESTION_RULE,
    '',
    'Your memory:',
    '- `termfleet-memory search "<words>"` finds anything said in your past conversations with Noam, word for word. Use it before guessing what was decided.',
    '- `termfleet-memory propose "<one or two sentences>" --kind preference|decision|fact|lesson` suggests something to remember; it counts only after Noam approves it.',
    '- `termfleet-asks done|ready|partial|dropped <n> "<proof or note>"` marks his numbered requests. Use `ready` (not `partial`) when it is built and live but Noam has not tried it yet; the note says exactly what he should try, in a few words (e.g. "open a bot chat on the phone and tap 25/30"). It stays quiet: no notification, and it is NOT in his "Waiting for you" list (that list is only for approvals and questions that block work until he acts); untried work goes into one quiet "try later" task, never a ping. When he says it works, mark it `done`.',
    '- You wake up by yourself on schedules (`termfleet-team routine add --time 09:00 --days weekdays --message "<what to do>"`), when a terminal agent you started finishes, and when new code lands in a folder you watch (`termfleet-team watch add <folder>`). Messages starting with [Event] come from these, not from Noam.',
    '- Skills: Noam\'s shared skill library holds tested ways of doing recurring jobs; when he says "Use the <name> skill" or types /<name>, follow it. `termfleet-skill list` shows them. When a process worked and will recur, offer to save it: `termfleet-skill save <name-with-dashes> --description "<when to use it>" --body "<the steps, what to check, what needs Noam\'s approval>"`. It is only a suggestion until he approves it.',
    '- The bots\' browser: a Chrome window on Noam\'s PC that only bots use, with its own sign-ins. Use the browser tools for web tasks that need clicking or signing in (plain reading can use web search). If the browser tools cannot connect, run `termfleet-browser start` once. Noam can watch it from his phone and take over at the PC. Never type passwords, codes or card numbers: ask Noam to do that part at the PC. Before anything that pays, sends, posts or deletes, ask him first.',
    '- You only act when a message or an event arrives; nothing runs between them. So never say you will check or do something later unless you set up the wake-up first: `termfleet-team follow <who>` wakes you when that agent finishes, `termfleet-team routine add` wakes you at a time. Otherwise do it now, or say plainly that it is waiting for Noam. Do not end with "Next I\'m doing" unless a wake-up is set.',
    card ? `\n${card}` : '',
    handover ? `\nYou are continuing after a fresh start (your previous conversation filled up). Pick up exactly here:\n${handover}` : '',
  ].filter((l) => l !== '').join('\n');
}

const CLAUDE_TOOLS = ['Read', 'Grep', 'Glob', 'Bash(termfleet-team:*)', 'Bash(termfleet-memory:*)', 'Bash(termfleet-asks:*)', 'Bash(termfleet-skill:*)', 'Bash(termfleet-browser:*)', 'mcp__browser', 'Bash(git status:*)', 'Bash(git log:*)', 'Bash(git diff:*)', 'Bash(ls:*)', 'WebSearch', 'WebFetch', 'mcp__plugin_context-mode_context-mode__ctx_fetch_and_index', 'mcp__plugin_context-mode_context-mode__ctx_search'];
const CLAUDE_DENY = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'mcp__browser__browser_run_code_unsafe'];

/** The command that runs one bot turn. */
// The bots' browser (TF-096 part 8): one Chrome window on the PC, driven through the
// Playwright MCP over its local debugging port. Kept here (not in bot-browser.mjs) so
// this module has no import cycle.
export const BOT_BROWSER_PORT = Number(process.env.TC_BOT_BROWSER_PORT || 9333);
// Installed once on the PC: npx cannot run inside Codex's sandbox (it writes the npm
// cache and reaches the registry), so bots start this copy; npx only if it is missing.
export const PLAYWRIGHT_MCP_CLI = process.env.TC_PLAYWRIGHT_MCP_CLI || path.join(os.homedir(), '.local', 'share', 'termfleet', 'playwright-mcp', 'node_modules', '@playwright', 'mcp', 'cli.js');
export const PLAYWRIGHT_MCP = fs.existsSync(PLAYWRIGHT_MCP_CLI)
  ? { command: process.execPath, args: [PLAYWRIGHT_MCP_CLI, '--cdp-endpoint', `http://127.0.0.1:${BOT_BROWSER_PORT}`] }
  : { command: 'npx', args: ['-y', '@playwright/mcp@latest', '--cdp-endpoint', `http://127.0.0.1:${BOT_BROWSER_PORT}`] };
// Bots get it through `termfleet-browser mcp`, which opens the bots' browser the
// first time a browser tool is used (a bot never has to remember to start it).
export const BROWSER_MCP = { command: process.execPath, args: [fileURLToPath(new URL('../../scripts/termfleet-browser.mjs', import.meta.url)), 'mcp'] };

export function brainCommand(bot, text, { bins = {}, extras = {} } = {}) {
  if (bot.provider === 'codex') {
    const bin = bins.codex || 'codex';
    const first = !bot.sessions?.codex;
    const prompt = first ? `${brainBrief(bot, extras)}\n\n---\nNoam says:\n${text}` : text;
    // Codex runs in its write-limited safety box; open only what a bot needs to direct
    // terminal agents (the helper-request folder, the terminal service's socket, its
    // own bot folder), and never stop to ask: nobody is at a bot's keyboard.
    const runtime = process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid?.() ?? 1000}`;
    const roots = [path.join(os.homedir(), '.local', 'share', 'terminal-workspace'), path.join(runtime, 'terminal-workspace'), defaultDir(), BOTS_HOME()];
    const config = ['-c', `sandbox_workspace_write.writable_roots=${JSON.stringify(roots)}`, '-c', 'sandbox_workspace_write.network_access=true', '-c', 'approval_policy="never"',
      '-c', `mcp_servers.browser.command=${JSON.stringify(BROWSER_MCP.command)}`, '-c', `mcp_servers.browser.args=${JSON.stringify(BROWSER_MCP.args)}`, '-c', 'mcp_servers.browser.disabled_tools=["browser_run_code_unsafe"]',
      '-c', 'mcp_servers.browser.default_tools_approval_mode="approve"', '-c', 'mcp_servers.node_repl.enabled=false', '-c', 'plugins."unified-computer-use@openai-bundled".enabled=false'];
    const args = first
      ? ['exec', '--json', '--skip-git-repo-check', '-C', bot.cwd, '-s', 'workspace-write', ...(bot.model ? ['-m', bot.model] : []), ...config, prompt]
      : ['exec', 'resume', bot.sessions.codex, '--json', '--skip-git-repo-check', ...(bot.model ? ['-m', bot.model] : []), ...config, prompt];
    return { bin, args };
  }
  const bin = bins.claude || 'claude';
  const session = bot.sessions?.claude;
  const args = ['-p', text, '--output-format', 'stream-json', '--verbose',
    '--append-system-prompt', brainBrief(bot, extras),
    '--add-dir', uploadDir(),   // pictures Noam attaches
    '--permission-mode', 'dontAsk',
    ...(bot.model ? ['--model', bot.model] : []),
    '--mcp-config', JSON.stringify({ mcpServers: { browser: BROWSER_MCP } }),
    '--allowedTools', ...CLAUDE_TOOLS,
    '--disallowedTools', ...CLAUDE_DENY,
    ...(session?.started ? ['--resume', session.id] : ['--session-id', session?.id || crypto.randomUUID()])];
  return { bin, args };
}

/** Short plain line for a tool the brain used, shown while it works. */
export function activityLine(name, input = {}) {
  const cmd = String(input.command || '');
  if (/termfleet-team\s+start/.test(cmd)) return 'Starting a terminal agent';
  if (/termfleet-team\s+ask/.test(cmd)) return 'Waiting for a terminal agent\'s answer';
  if (/termfleet-team\s+wait/.test(cmd)) return 'Waiting for a terminal agent to finish';
  if (/termfleet-team\s+send/.test(cmd)) return 'Handing work to a terminal agent';
  if (/termfleet-team\s+(read|wait)/.test(cmd)) return 'Reading a terminal agent';
  if (/termfleet-team\s+list/.test(cmd)) return 'Checking who is working';
  if (/termfleet-team\s+routine/.test(cmd)) return 'Setting a schedule';
  if (/termfleet-team\s+follow/.test(cmd)) return 'Setting a reminder to check back';
  if (/termfleet-skill\s+save/.test(cmd)) return 'Saving a skill for Noam to approve';
  if (/termfleet-browser\s+start/.test(cmd)) return 'Opening the bots\' browser';
  if (String(name).startsWith('mcp__browser__')) return 'Using the browser';
  if (name === 'Read' || name === 'Grep' || name === 'Glob') return 'Reading files';
  if (name === 'WebSearch' || name === 'WebFetch') return 'Searching the web';
  if (name === 'Bash' || name === 'command_execution') return 'Checking something';
  return 'Working';
}

/**
 * Out of credits (TF-096 part 4). Exact wording from each tool (research,
 * docs/teammates-research-2026-10-16.md section 1). Overloaded, short throttles and
 * sign-in errors are NOT a limit: those are retried, never switched.
 */
const LIMIT_TEXT = /hit your (session|weekly|usage|opus|sonnet|monthly spend) limit|usage limit reached|weekly usage limit|5-hour usage limit|out of credits|spend cap|credit balance (is )?too low|monthly spend limit/i;
export const isLimitText = (text) => LIMIT_TEXT.test(String(text || ''));

/** When the limit lifts, from the tool's own words ("resets 3:45pm", "try again at 12:48 AM"). */
export function resetTime(text, now = Date.now()) {
  const m = /(?:resets|try again at|continuing automatically at)\s+(?:at\s+)?(?:(mon|tue|wed|thu|fri|sat|sun)\w*\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(String(text || ''));
  if (!m) return null;
  let hour = Number(m[2]) % 24;
  const minute = Number(m[3] || 0);
  if (m[4]) { const pm = m[4].toLowerCase() === 'pm'; hour = (hour % 12) + (pm ? 12 : 0); }
  const at = new Date(now);
  at.setSeconds(0, 0);
  at.setHours(hour, minute);
  if (m[1]) {
    const target = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(m[1].slice(0, 3).toLowerCase());
    while (at.getDay() !== target || at.getTime() <= now) at.setDate(at.getDate() + 1);
  } else if (at.getTime() <= now) at.setDate(at.getDate() + 1);
  return at.getTime();
}

/** Turns brain output lines into events: activity, final text, session id, failure. */
export function parseBrainLine(provider, line) {
  let o;
  try { o = JSON.parse(line); } catch { return null; }
  const limitFrom = (text) => (isLimitText(text) ? { limit: { text: String(text).slice(0, 300), resetsAt: resetTime(text) } } : null);
  if (provider === 'codex') {
    if (o.type === 'thread.started' && o.thread_id) return { session: o.thread_id };
    if ((o.type === 'turn.failed' || o.type === 'error') && limitFrom(o.error?.message || o.message)) return { ...limitFrom(o.error?.message || o.message), error: o.error?.message || o.message };
    if (o.type === 'item.started' && o.item?.type === 'command_execution') return { activity: activityLine('command_execution', { command: o.item.command }) };
    if (o.type === 'item.started' && o.item?.type === 'mcp_tool_call') return { activity: o.item.server === 'browser' ? 'Using the browser' : 'Working' };
    if (o.type === 'item.completed' && o.item?.type === 'agent_message' && o.item.text) return { text: o.item.text };
    if (o.type === 'turn.completed') return { completed: true };
    if (o.type === 'turn.failed' || o.type === 'error') return { error: o.error?.message || o.message || 'The run failed.' };
    return null;
  }
  if (o.type === 'system' && o.subtype === 'init' && o.session_id) return { session: o.session_id };
  if (o.type === 'rate_limit_event' && o.rate_limit_info?.status === 'rejected') {
    const r = Number(o.rate_limit_info.resetsAt);
    return { limit: { text: 'usage limit reached', resetsAt: Number.isFinite(r) ? (r < 1e12 ? r * 1000 : r) : null } };
  }
  // Claude now waits for the reset by itself; a bot must not sit in that wait.
  if (o.type === 'system' && limitFrom(o.content || o.message || o.text)) return limitFrom(o.content || o.message || o.text);
  if (o.type === 'assistant' && (o.isApiErrorMessage || o.error === 'rate_limit' || o.message?.model === '<synthetic>')) {
    const t = (o.message?.content || []).map((b) => b?.text || '').join(' ');
    if (limitFrom(t)) return limitFrom(t);
  }
  if (o.type === 'assistant') {
    const uses = (o.message?.content || []).filter((b) => b?.type === 'tool_use');
    if (uses.length) return { activity: activityLine(uses[0].name, uses[0].input) };
    return null;
  }
  if (o.type === 'result') {
    if (limitFrom(o.result)) return { ...limitFrom(o.result), error: String(o.result), final: true };
    if (o.is_error || (o.subtype && o.subtype !== 'success')) return { error: String(o.result || o.subtype || 'The run failed.') , final: true };
    return { text: String(o.result || ''), final: true };
  }
  return null;
}

/**
 * The brain's environment. A bot is never a terminal: anything that would tie it
 * to whichever terminal started the bridge (a live test once filed the bot's
 * helper under the tester's own card) is removed. Nothing interactive may block it.
 */
export function brainEnv(bot, env = process.env) {
  const out = { ...env };
  for (const key of ['TERMFLEET_PANE_ID', 'CODEX_THREAD_ID', 'CODEX_SESSION_ID', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SSE_PORT']) delete out[key];
  return {
    ...out,
    TERMFLEET_BOT_ID: bot.id, TERMFLEET_BOT_NAME: bot.name,
    PATH: `${path.join(os.homedir(), '.local', 'bin')}:${env.PATH || '/usr/bin:/bin'}`,
    PAGER: 'cat', GIT_PAGER: 'cat', GIT_EDITOR: 'true', EDITOR: 'true', GIT_TERMINAL_PROMPT: '0', DEBIAN_FRONTEND: 'noninteractive',
  };
}

/** Runs one brain turn as a child process and reports events as they come. */
export function runBrain(bot, text, { onEvent, onStart, bins, extras, env = process.env, timeoutMs = 30 * 60 * 1000, idleMs = 10 * 60 * 1000, logPath = null } = {}) {
  const { bin, args } = brainCommand(bot, text, { bins, extras });
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(bin, args, {
        cwd: bot.cwd,
        env: brainEnv(bot, env),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) { resolve({ error: String(error.message || error) }); return; }
    let buffer = '', stderr = '', finalText = '', error = null, lastText = '', limit = null, completed = false, stopped = false, ownKill = false;
    // Noam closing the bot stops this reply the way the timeout does: a polite SIGTERM.
    onStart?.(() => { stopped = true; child.kill('SIGTERM'); });
    // The last run's raw output, so a failure can be explained afterwards (capped).
    let log = null, logged = 0;
    if (logPath) { try { log = fs.openSync(logPath, 'w'); } catch { log = null; } }
    const keep = (prefix, chunk) => { if (log === null || logged > 2_000_000) return; const t = `${prefix}${chunk}`; logged += t.length; try { fs.writeSync(log, t); } catch { /* best effort */ } };
    const timer = setTimeout(() => { ownKill = true; error = 'The bot took too long and was stopped.'; child.kill('SIGTERM'); }, timeoutMs);
    // A brain that says nothing for a long time is stuck (a prompt nobody can answer,
    // a hung command): stop it and say so, instead of waiting out the full limit.
    let lastOutput = Date.now();
    const idle = setInterval(() => { if (Date.now() - lastOutput > idleMs) { ownKill = true; error = 'The bot went quiet for too long (it may have been stuck on something) and was stopped.'; child.kill('SIGTERM'); } }, Math.min(30_000, idleMs));
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      lastOutput = Date.now();
      keep('', chunk);
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl); buffer = buffer.slice(nl + 1);
        const ev = parseBrainLine(bot.provider, line);
        if (!ev) continue;
        if (ev.limit) { limit = limit || ev.limit; if (!ev.final) { ownKill = true; child.kill('SIGTERM'); } }
        if (ev.text) { lastText = ev.text; if (ev.final) finalText = ev.text; }
        if (ev.completed) completed = true;
        if (ev.error) error = ev.error;
        onEvent?.(ev);
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (c) => { keep('[stderr] ', c); stderr = (stderr + c).slice(-4000); });
    child.on('error', (e) => { error = String(e.message || e); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      clearInterval(idle);
      keep('', `\n[exit ${code}]\n`);
      if (log !== null) try { fs.closeSync(log); } catch { /* closed */ }
      if (!limit && isLimitText(stderr)) limit = { text: stderr.trim().split('\n').pop().slice(0, 300), resetsAt: resetTime(stderr) };
      if (stopped) { resolve({ stopped: true, error: 'Stopped by Noam.', code }); return; }
      if (limit) { resolve({ limit, error: 'usage limit', code }); return; }
      // Killed from outside (a service restart, a stray kill): the turn is re-run, not reported as an error.
      if (!ownKill && !completed && (code === 143 || code === 137 || signal === 'SIGTERM' || signal === 'SIGKILL')) { resolve({ killed: true, error: `The brain stopped (exit ${code ?? signal}).`, code }); return; }
      // Codex says what it is about to do before doing it; that opening line is not
      // the answer. Without a completed turn the run stopped partway: say so.
      const unfinished = bot.provider === 'codex' && !completed;
      if (unfinished && !error) error = `The bot stopped partway through (${(stderr.trim().split('\n').pop() || `exit ${code}`).slice(0, 300)}).`;
      const text = unfinished ? '' : (finalText || lastText);
      if (!text && !error && code !== 0) error = (stderr.trim().split('\n').pop() || `The brain stopped (exit ${code}).`).slice(0, 400);
      resolve({ text, error: text ? null : error, code });
    });
  });
}

/** How full the bot's current brain conversation is, from its own record. */
function defaultFill(bot) {
  const s = bot.sessions?.claude;
  if (bot.provider !== 'claude' || !s?.started) return null;
  return contextFill({ provider: 'claude', cwd: bot.cwd, sessionId: s.id })?.percent ?? null;
}

/**
 * What carries over to a fresh conversation: Noam's unfinished requests in his own
 * words and the latest messages, verbatim (research: hand over from the request
 * list and the record, not from a model's summary).
 */
export function handoverText(bot, chat, { asks = [] } = {}) {
  const open = asks.filter((a) => a.status === 'open' || a.status === 'partial' || a.status === 'ready');
  const recent = chat.filter((m) => m.role === 'operator' || m.role === 'bot').slice(-12);
  return [
    open.length ? "Noam's unfinished requests, in his words:\n" + open.map((a) => `- [${a.status}] "${a.text.slice(0, 800)}"${a.note ? ` (${a.note})` : ''}`).join('\n') : '',
    recent.length ? 'The latest messages, word for word:\n' + recent.map((m) => `${m.role === 'operator' ? 'Noam' : 'You'}: ${String(m.text).slice(0, 1500)}`).join('\n') : '',
    'Older conversation: search it with termfleet-memory search.',
  ].filter(Boolean).join('\n\n');
}

const providerName = (p) => (p === 'codex' ? 'Codex' : 'Claude');
const clock = (ms) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

export class Bots {
  constructor({ dir = defaultDir(), run = runBrain, bins = { claude: findBinary('claude'), codex: findBinary('codex') }, now = () => Date.now(), fill = defaultFill, checks = { home: process.env.TC_BOT_CHECK_HOME || undefined }, notify = () => {} } = {}) {
    this.codexHome = process.env.TC_CODEX_HOME || os.homedir();
    this.notify = notify;   // phone notification for a reply or a "needs you" (part 7)
    this.fill = fill;
    this.checks = checks;   // where to look for logins and the terminal service (tests point these elsewhere)
    this.dir = dir;
    this.run = run;
    this.bins = bins;
    this.now = now;
    this.running = new Map();   // id -> { activity, startedAt }
    this.queues = new Map();    // id -> [text]
    this.closing = false;       // the service is restarting: finish running replies, start no new ones
    this.resumed = new Set();   // bots whose interrupted turn is being re-run (only once)
  }

  folder(id) {
    if (!/^[0-9a-f]{12}$/.test(String(id))) throw new Error('Unknown bot.');
    return path.join(this.dir, id);
  }

  read(id) {
    try { return JSON.parse(fs.readFileSync(path.join(this.folder(id), 'bot.json'), 'utf8')); } catch { return null; }
  }

  write(bot) {
    const dir = this.folder(bot.id);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tmp = path.join(dir, `bot.json.${process.pid}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(bot, null, 1), { mode: 0o600 });
    fs.renameSync(tmp, path.join(dir, 'bot.json'));
  }

  messages(id) {
    try {
      return fs.readFileSync(path.join(this.folder(id), 'chat.jsonl'), 'utf8').split('\n').filter(Boolean)
        .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    } catch { return []; }
  }

  append(id, message) {
    const entry = { id: newId(), at: this.now(), ...message };
    fs.appendFileSync(path.join(this.folder(id), 'chat.jsonl'), JSON.stringify(entry) + '\n', { mode: 0o600 });
    return entry;
  }

  // Unread replies (Noam 2026-10-20: "the grey dot next to them doesn't help"): each bot keeps
  // when its chat was last open, in its own small file so it never races the bot's settings.
  // A bot that never had one counts as read up to now, so the first launch shows no flood.
  readAt(id) {
    const file = path.join(this.folder(id), 'read.json');
    try { return Number(JSON.parse(fs.readFileSync(file, 'utf8')).at) || 0; } catch { /* first time */ }
    return this.markRead(id);
  }

  markRead(id) {
    if (!this.read(id)) return 0;
    const at = this.now(), file = path.join(this.folder(id), 'read.json'), tmp = `${file}.${process.pid}.tmp`;
    try { fs.writeFileSync(tmp, JSON.stringify({ at }), { mode: 0o600 }); fs.renameSync(tmp, file); } catch { /* best effort */ }
    return at;
  }

  list() {
    let ids = [];
    try { ids = fs.readdirSync(this.dir).filter((d) => /^[0-9a-f]{12}$/.test(d)); } catch { return []; }
    // Pinned bots first (Grok Bot's pin), then the most recently active.
    return ids.map((id) => this.summary(id)).filter(Boolean).sort((a, b) => (Number(b.pinned) - Number(a.pinned)) || (b.lastAt || 0) - (a.lastAt || 0));
  }

  summary(id) {
    const bot = this.read(id);
    if (!bot) return null;
    const chat = this.messages(id);
    const last = [...chat].reverse().find((m) => m.role !== 'activity');
    const working = this.running.get(id);
    return {
      memoryPending: this.memory(id).pendingCount(),
      pinned: Boolean(bot.pinned), hidden: Boolean(bot.hidden), notify: bot.notify !== false,
      proposedProfile: bot.proposedProfile || null,
      helpers: this.helpers(id),
      mainResetsAt: (bot.active && bot.active !== bot.provider) ? (this.health()[bot.provider]?.limitedUntil || null) : null,
      id: bot.id, name: bot.name, job: bot.job, provider: bot.provider, model: bot.model || null, fallback: bot.fallback || null, active: bot.active || bot.provider, cwd: bot.cwd, createdAt: bot.createdAt,
      state: working ? 'working' : bot.blocked ? 'needs-you' : last?.role === 'error' ? 'failed' : 'idle',
      blocked: bot.blocked ? { ask: bot.blocked.ask, at: bot.blocked.at } : null,
      waitingForReset: bot.retry ? bot.retry.at : null,
      health: bot.blocked ? { level: 'bad', text: 'Needs you' }
        : last?.role === 'error' ? { level: 'bad', text: 'Last reply failed' }
          : bot.retry ? { level: 'warn', text: 'Waiting for a plan to reset' }
            : (bot.active && bot.active !== bot.provider) ? { level: 'warn', text: `On its backup plan` }
              : working ? { level: 'busy', text: 'Working' } : { level: 'ok', text: 'Ready' },
      activity: working?.activity || null,
      activitySince: working ? (working.activityAt || working.startedAt || null) : null,
      queued: (this.queues.get(id) || []).length,
      lastAt: last?.at || bot.createdAt,
      unread: (() => { const seen = this.readAt(id); return chat.filter((m) => UNREAD_ROLES.has(m.role) && Number(m.at) > seen).length; })(),
      last: last ? { role: last.role, text: String(last.text || '').slice(0, 160) } : null,
    };
  }

  create({ name, job, rules, provider = 'claude', fallback, cwd } = {}) {
    const n = clean(name, LIMITS.name).replace(/\s+/g, ' ');
    if (!n) return { error: 'Give the bot a name.' };
    if (!/^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u.test(n)) return { error: 'Use letters, numbers and spaces for the name.' };
    if (this.list().some((b) => b.name.toLowerCase() === n.toLowerCase())) return { error: 'Another bot already has that name.' };
    const p = PROVIDERS.includes(provider) ? provider : 'claude';
    // Bots live side by side in one place unless a folder is given on purpose.
    let folder = clean(cwd, 1000);
    if (!folder) {
      folder = path.join(BOTS_HOME(), n.replace(/[^\p{L}\p{N}._-]+/gu, '-'));
      try { fs.mkdirSync(folder, { recursive: true }); } catch { return { error: 'Could not make the bot\'s folder.' }; }
    }
    try { if (!fs.statSync(folder).isDirectory()) return { error: 'That home folder does not exist.' }; } catch { return { error: 'That home folder does not exist.' }; }
    const bot = {
      id: newId(), name: n, job: clean(job, LIMITS.job), rules: clean(rules, LIMITS.rules), provider: p,
      fallback: fallback === 'none' ? null : PROVIDERS.includes(fallback) && fallback !== p ? fallback : PROVIDERS.find((x) => x !== p), active: p, cwd: folder, createdAt: this.now(),
      sessions: { claude: { id: crypto.randomUUID(), started: false }, codex: null },
    };
    this.write(bot);
    this.append(bot.id, { role: 'system', text: `${n} was created.` });
    return { ok: true, bot: this.summary(bot.id) };
  }

  update(id, patch = {}) {
    const bot = this.read(id);
    if (!bot) return { error: 'That bot no longer exists.' };
    const next = { ...bot };
    if ('name' in patch) {
      const n = clean(patch.name, LIMITS.name).replace(/\s+/g, ' ');
      if (!n || !/^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u.test(n)) return { error: 'Use letters, numbers and spaces for the name.' };
      next.name = n;
    }
    if ('job' in patch) next.job = clean(patch.job, LIMITS.job);
    if ('pinned' in patch) next.pinned = Boolean(patch.pinned);
    if ('notify' in patch) next.notify = Boolean(patch.notify);
    if ('hidden' in patch) next.hidden = Boolean(patch.hidden);
    if ('rules' in patch) next.rules = clean(patch.rules, LIMITS.rules);
    if ('provider' in patch && PROVIDERS.includes(patch.provider)) { next.provider = patch.provider; if (!next.active || next.active === bot.provider) next.active = patch.provider; if (patch.provider !== bot.provider) next.model = null; }
    if ('model' in patch) {
      const wanted = String(patch.model || '').trim();
      if (wanted && !modelChoices(next.provider, { home: this.codexHome }).some((m) => m.id === wanted)) return { error: 'That model is not available for this plan.' };
      next.model = wanted || null;
    }
    if ('fallback' in patch) next.fallback = PROVIDERS.includes(patch.fallback) && patch.fallback !== next.provider ? patch.fallback : null;
    this.write(next);
    return { ok: true, bot: this.summary(id) };
  }

  remove(id) {
    const bot = this.read(id);
    if (!bot) return { error: 'That bot no longer exists.' };
    fs.rmSync(this.folder(id), { recursive: true, force: true });
    this.queues.delete(id);
    return { ok: true };
  }

  /** Remove from the list without losing anything: the folder moves to archived/ and can come back. */
  archive(id) {
    if (!this.read(id)) return { error: 'That bot no longer exists.' };
    this.stop(id);
    const shelf = path.join(this.dir, 'archived');
    fs.mkdirSync(shelf, { recursive: true, mode: 0o700 });
    if (fs.existsSync(path.join(shelf, id))) fs.renameSync(path.join(shelf, id), path.join(shelf, `${id}-${this.now()}`));
    fs.renameSync(this.folder(id), path.join(shelf, id));
    this.queues.delete(id);
    return { ok: true };
  }

  archived() {
    const shelf = path.join(this.dir, 'archived');
    let ids = [];
    try { ids = fs.readdirSync(shelf).filter((d) => /^[0-9a-f]{12}$/.test(d)); } catch { return []; }
    return ids.map((id) => {
      try { const b = JSON.parse(fs.readFileSync(path.join(shelf, id, 'bot.json'), 'utf8')); return { id, name: b.name, provider: b.provider, color: b.color }; } catch { return null; }
    }).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
  }

  restore(id) {
    if (!/^[0-9a-f]{12}$/.test(String(id))) return { error: 'Unknown bot.' };
    const from = path.join(this.dir, 'archived', id);
    let bot;
    try { bot = JSON.parse(fs.readFileSync(path.join(from, 'bot.json'), 'utf8')); } catch { return { error: 'That removed bot is not there any more.' }; }
    if (this.read(id)) return { error: 'That bot is already in your list.' };
    if (this.list().some((b) => b.name.toLowerCase() === String(bot.name).toLowerCase())) return { error: `Another bot is already called ${bot.name}. Rename it first.` };
    fs.renameSync(from, this.folder(id));
    return { ok: true, bot: this.summary(id) };
  }

  memory(id) { return new BotMemory(this.folder(id), { now: this.now }); }

  /** Terminal agents this bot started (newest last). */
  helpers(id) {
    try { return JSON.parse(fs.readFileSync(path.join(this.folder(id), 'helpers.json'), 'utf8')).slice(-20); } catch { return []; }
  }

  /** Search every bot's conversation (Grok Bot's search), best matches first. */
  search(query, { limit = 12 } = {}) {
    const hits = [];
    for (const b of this.list()) {
      for (const h of searchChat(this.messages(b.id), query, { limit: 4, now: this.now() })) hits.push({ bot: { id: b.id, name: b.name }, ...h });
    }
    return hits.slice(0, limit);
  }

  /** Which plans are out of credits, shared by all bots (one login per tool). */
  health() {
    try { return JSON.parse(fs.readFileSync(path.join(this.dir, 'provider-health.json'), 'utf8')) || {}; } catch { return {}; }
  }

  markLimited(provider, limit) {
    const health = this.health();
    health[provider] = { limitedUntil: limit?.resetsAt || this.now() + 30 * 60 * 1000, resetKnown: Boolean(limit?.resetsAt), text: limit?.text || '', at: this.now() };
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const file = path.join(this.dir, 'provider-health.json');
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(health, null, 1), { mode: 0o600 });
    fs.renameSync(tmp, file);
    return health[provider];
  }

  available(provider) {
    const h = this.health()[provider];
    return !h || !h.limitedUntil || h.limitedUntil <= this.now();
  }

  /** Moves a bot to another plan, starting a fresh brain conversation there with a handover. */
  switchTo(id, provider, line) {
    const bot = this.read(id);
    if (!bot) return null;
    let asks = [];
    try { const file = bot.sessions?.claude?.started ? claudeTranscript(bot.cwd, bot.sessions.claude.id) : null; if (file) asks = asksForFile(file); } catch { asks = []; }
    bot.handover = handoverText(bot, this.messages(id), { asks });
    bot.active = provider;
    if (provider === 'codex') bot.sessions = { ...bot.sessions, codex: null };
    else bot.sessions = { ...bot.sessions, claude: { id: crypto.randomUUID(), started: false } };
    this.write(bot);
    this.append(id, { role: 'system', text: line });
    return bot;
  }

  /** Back to the main plan once its limit has reset (only between messages). */
  returnIfReset(id) {
    const bot = this.read(id);
    if (!bot || !bot.active || bot.active === bot.provider) return;
    if (!this.available(bot.provider)) return;
    this.switchTo(id, bot.provider, `Back on ${providerName(bot.provider)}: its limit has reset. ${bot.name} carried the conversation over.`);
  }

  /**
   * A full brain conversation is replaced by a fresh one before the next message
   * (Noam chose "automatically when full"); the chat itself stays one conversation.
   */
  freshStartIfFull(id) {
    const bot = this.read(id);
    if (!bot) return;
    let percent = null;
    try { percent = this.fill(bot); } catch { percent = null; }
    if (percent == null || percent < FRESH_AT) return;
    let asks = [];
    try { const file = claudeTranscript(bot.cwd, bot.sessions.claude.id); if (file) asks = asksForFile(file); } catch { asks = []; }
    bot.handover = handoverText(bot, this.messages(id), { asks });
    bot.sessions = { ...bot.sessions, claude: { id: crypto.randomUUID(), started: false }, codex: null };
    this.write(bot);
    this.append(id, { role: 'system', text: `Fresh start: ${bot.name}'s working memory was ${percent}% full, so it began a new conversation. It kept your open requests, the latest messages and its memory card, and can search everything older.` });
  }

  /**
   * Something happened that this bot should act on (TF-096 part 7): a terminal agent
   * it started finished, an approval expired, code changed in a folder it watches.
   * Shown in its chat as an event and handled like a message.
   */
  wake(id, text) {
    const bot = this.read(id);
    if (!bot) return { error: 'That bot no longer exists.' };
    this.append(id, { role: 'event', text: String(text).slice(0, 2000) });
    const queue = this.queues.get(id) || [];
    queue.push(`[Event, not from Noam] ${text}`);
    this.queues.set(id, queue);
    if (!this.running.has(id)) this.drain(id);
    return { ok: true };
  }

  /**
   * Stop what the bot is doing right now (Noam's "close this bot"): the reply in
   * progress ends and messages waiting behind it are dropped. Its chat, memory and
   * conversation stay; the next message starts it again.
   */
  stop(id) {
    const current = this.running.get(id);
    this.queues.set(id, []);
    if (!current?.stop) return { ok: true, wasRunning: false };
    current.stop();
    return { ok: true, wasRunning: true };
  }

  /** Folders whose new code wakes the bot (git HEAD changes). */
  watches(id) { return Array.isArray(this.read(id)?.watches) ? this.read(id).watches : []; }

  setWatch(id, watch) {
    const bot = this.read(id);
    if (!bot) return;
    const list = Array.isArray(bot.watches) ? bot.watches.filter((w) => w.path !== watch.path) : [];
    if (!watch.remove) list.push({ path: watch.path, head: watch.head ?? null, ...(watch.paused ? { paused: true } : {}) });
    bot.watches = list.slice(-20);
    this.write(bot);
  }

  /** Noam's answer to the job and rules the bot drafted from the chat. */
  acceptProfile(id, { job, rules } = {}) {
    const bot = this.read(id);
    if (!bot?.proposedProfile) return { error: 'There is no suggestion to accept.' };
    bot.job = clean(job ?? bot.proposedProfile.job, LIMITS.job);
    bot.rules = clean(rules ?? bot.proposedProfile.rules, LIMITS.rules);
    delete bot.proposedProfile;
    this.write(bot);
    this.append(id, { role: 'system', text: `Noam set ${bot.name}'s job and rules.` });
    return { ok: true, bot: this.summary(id) };
  }

  dismissProfile(id) {
    const bot = this.read(id);
    if (!bot) return { error: 'That bot no longer exists.' };
    delete bot.proposedProfile;
    this.write(bot);
    return { ok: true };
  }

  view(id) {
    const bot = this.read(id);
    if (!bot) return null;
    const chat = this.messages(id).slice(-MAX_CHAT_RETURNED);
    return { bot: { ...this.summary(id), rules: bot.rules }, messages: chat };
  }

  /** Adds the operator's message and starts (or queues) the bot's turn. */
  send(id, text, { images = [] } = {}) {
    const bot = this.read(id);
    if (!bot) return { error: 'That bot no longer exists.' };
    // Pictures come from the app's own upload folder only (never any path on the PC).
    const dir = path.resolve(this.picturesDir || uploadDir());
    const pictures = (Array.isArray(images) ? images : []).slice(0, 10).map((p) => path.resolve(String(p)))
      .filter((p) => p.startsWith(dir + path.sep) && fs.existsSync(p));
    if ((images || []).length && pictures.length !== Math.min(images.length, 10)) return { error: 'A picture could not be found. Attach it again.' };
    const body = clean(text, LIMITS.message) || (pictures.length ? (pictures.length === 1 ? 'Here is a picture.' : 'Here are some pictures.') : '');
    if (!body) return { error: 'Nothing to send.' };
    const msg = this.append(id, { role: 'operator', text: body, ...(pictures.length ? { images: pictures.length } : {}) });
    const asked = skillPrompt(body) || body;   // "/grill-me" etc. carry the skill's steps
    const forBrain = pictures.length ? `${asked}\n\n[Noam attached ${pictures.length} picture${pictures.length === 1 ? '' : 's'}. Look at each one before answering (open the file to see it): ${pictures.join(' , ')}]` : asked;
    const queue = this.queues.get(id) || [];
    queue.push(forBrain);
    this.queues.set(id, queue);
    if (!this.running.has(id)) this.drain(id);
    return { ok: true, message: msg, queued: this.running.has(id) && queue.length > 0 };
  }

  async drain(id) {
    while ((this.queues.get(id) || []).length) {
      if (this.closing) { this.saveQueue(id); return; }
      const texts = this.queues.get(id).splice(0);
      // Messages that arrived while the bot was busy go in together, oldest first.
      const text = texts.length === 1 ? texts[0] : texts.map((t, i) => `(${i + 1}) ${t}`).join('\n\n');
      this.running.set(id, { activity: 'Thinking', startedAt: this.now() });
      this.returnIfReset(id);
      this.freshStartIfFull(id);
      {
        const bot = this.read(id);
        const check = this.preflight(bot);
        if (!check.ok) {
          const active = bot.active || bot.provider;
          const other = [bot.provider, bot.fallback].find((p) => p && p !== active && PROVIDERS.includes(p));
          const planProblem = check.problems.every((x) => x.provider === active);
          if (planProblem && other && this.preflight(bot, other).ok && this.available(other)) {
            this.switchTo(id, other, `${providerName(active)} isn't ready (${check.problems[0].code === 'signed-out' ? 'signed out' : 'not found'}), so ${bot.name} is using ${providerName(other)} for now.`);
          } else {
            this.block(id, text, check.problems[0]);
            this.running.delete(id);
            continue;
          }
        }
        const marked = this.read(id);
        marked.inflight = { text, at: this.now(), ...(this.resumed.delete(id) ? { resumed: true } : {}) };
        this.write(marked);
      }
      let result = await this.turn(id, text);
      // Killed from outside: during a restart keep the turn for after it; otherwise re-run it once now.
      if (result?.killed && this.closing) { this.running.delete(id); this.saveQueue(id); return; }
      if (result?.killed && !this.read(id)?.inflight?.resumed) {
        this.append(id, { role: 'system', text: 'The reply was cut off, so it is starting again.' });
        result = await this.turn(id, `(You were cut off while working on this; check what already happened before redoing anything.)\n\n${text}`);
        if (result?.killed && this.closing) { this.running.delete(id); this.saveQueue(id); return; }
      }
      // Out of credits: move to the next plan that is free, at most once per plan.
      for (let tries = 0; result?.limit && tries < PROVIDERS.length; tries++) {
        const bot = this.read(id);
        const from = bot.active || bot.provider;
        const limited = this.markLimited(from, result.limit);
        const backup = [bot.provider, bot.fallback].find((p) => p && p !== from && PROVIDERS.includes(p) && this.available(p) && this.bins[p]);
        const until = limited.resetKnown ? `resets ${clock(limited.limitedUntil)}` : 'reset time unknown, trying again in 30 minutes';
        if (backup) {
          this.switchTo(id, backup, `${providerName(from)} reached its limit (${until}), so ${bot.name} is continuing on ${providerName(backup)}.`);
          result = await this.turn(id, text);
          continue;
        }
        // Nothing to switch to: keep the message and answer it once a plan resets.
        const fresh = this.read(id);
        fresh.retry = { text, at: Math.min(...[bot.provider, bot.fallback].filter(Boolean).map((p) => this.health()[p]?.limitedUntil || this.now())) };
        this.write(fresh);
        result = { error: `${providerName(from)} reached its limit (${until}) and no backup plan is free right now. ${bot.name} kept your message and will answer it by itself at ${clock(fresh.retry.at)}.` };
      }
      let bot = this.read(id);
      if (!bot) { this.running.delete(id); return; }
      delete bot.inflight;
      this.write(bot);
      if (bot && !result.error) {
        if ((bot.active || bot.provider) === 'claude') bot.sessions.claude = { ...bot.sessions.claude, started: true };
        delete bot.handover;   // the new conversation has it now
        this.write(bot);
      }
      // A [question] block becomes a card the chat can answer with one tap.
      const asked = result.error ? null : parseQuestion(result.text || '');
      if (bot && result.stopped) this.append(id, { role: 'note', text: 'You stopped this reply. Ask again any time.' });
      else if (bot) this.append(id, result.error ? { role: 'error', text: result.error } : { role: 'bot', text: asked.text || (asked.question ? '' : 'Done, with nothing to add.'), ...(asked.question ? { question: asked.question } : {}) });
      if (bot && bot.notify !== false && !result.stopped) {
        try { this.notify({ title: result.error ? `${bot.name} could not answer` : bot.name, body: String(result.error || (asked?.question ? asked.question.text : result.text) || '').replace(/\s+/g, ' ').slice(0, 200), url: `/#bot:${id}` }); } catch { /* never block a bot on a notification */ }
      }
      this.running.delete(id);
    }
  }

  /** Answers messages that waited for a plan to reset; the bridge calls this every minute. */
  retryDue() {
    for (const { id } of this.list()) {
      const bot = this.read(id);
      if (!bot?.retry || bot.retry.at > this.now() || this.running.has(id)) continue;
      if (![bot.provider, bot.fallback].filter(Boolean).some((p) => this.available(p))) continue;
      const { text } = bot.retry;
      delete bot.retry;
      this.write(bot);
      this.append(id, { role: 'system', text: `A plan has reset, so ${bot.name} is answering your earlier message now.` });
      const queue = this.queues.get(id) || [];
      queue.unshift(text);
      this.queues.set(id, queue);
      this.drain(id);
    }
  }

  /**
   * Checks before a bot starts work (research: preflight on wake, one plain ask
   * before starting, never a failure halfway). Local checks only: nothing is sent
   * anywhere and no plan is spent.
   */
  preflight(bot, provider = bot.active || bot.provider, { home = this.checks.home || os.homedir(), socket = this.checks.socket || defaultDaemonSocket() } = {}) {
    const problems = [];
    const name = providerName(provider);
    if (!this.bins[provider]) problems.push({ code: 'brain-missing', provider, ask: `${name} is not installed where I can find it. Install it (or pick the other plan in the bot's settings), then tap Retry.` });
    const login = provider === 'codex' ? path.join(home, '.codex', 'auth.json') : path.join(home, '.claude', '.credentials.json');
    if (this.bins[provider] && !fs.existsSync(login)) problems.push({ code: 'signed-out', provider, ask: `${name} is not signed in on this computer. Sign in to ${name} once in a terminal, then tap Retry.` });
    try { if (!fs.statSync(bot.cwd).isDirectory()) throw new Error(); } catch { problems.push({ code: 'folder-missing', ask: `${bot.name}'s home folder is gone. Pick a new one in its settings, then tap Retry.` }); }
    try {
      const st = fs.statfsSync(bot.cwd);
      if (st.bavail * st.bsize < 500 * 1024 * 1024) problems.push({ code: 'disk-full', ask: 'The disk is almost full (under 500 MB free). Free some space, then tap Retry.' });
    } catch { /* not every system reports free space */ }
    if (!fs.existsSync(socket)) problems.push({ code: 'terminals-down', ask: "TermFleet's terminal service isn't running, so I can't direct terminal agents. Open TermFleet, then tap Retry." });
    return { ok: problems.length === 0, problems };
  }

  /** Stops a bot with one plain question for Noam and keeps its message for Retry. */
  block(id, text, problem) {
    const bot = this.read(id);
    if (!bot) return;
    bot.blocked = { ask: problem.ask, code: problem.code, text, at: this.now() };
    this.write(bot);
    this.append(id, { role: 'needs-you', text: problem.ask });
    if (bot.notify !== false) { try { this.notify({ title: `${bot.name} needs you`, body: problem.ask, url: `/#bot:${id}` }); } catch { /* never block a bot on a notification */ } }
  }

  /** Noam's one tap: run the kept message again. */
  retry(id) {
    const bot = this.read(id);
    if (!bot) return { error: 'That bot no longer exists.' };
    const text = bot.blocked?.text || bot.retry?.text;
    if (!text) return { error: 'There is nothing waiting to retry.' };
    delete bot.blocked;
    delete bot.retry;
    this.write(bot);
    const queue = this.queues.get(id) || [];
    queue.unshift(text);
    this.queues.set(id, queue);
    if (!this.running.has(id)) this.drain(id);
    return { ok: true };
  }

  /**
   * After the bridge restarts (a deploy, a crash, the memory guard), a turn that
   * was running is picked up again instead of being lost.
   */
  resumeInterrupted() {
    let resumed = 0;
    for (const { id } of this.list()) {
      const bot = this.read(id);
      if ((!bot?.inflight && !bot?.queued?.length) || this.running.has(id)) continue;
      const { inflight, queued = [] } = bot;
      delete bot.inflight; delete bot.queued;
      this.write(bot);
      const queue = this.queues.get(id) || [];
      queue.unshift(...queued);
      if (inflight?.resumed) {
        this.append(id, { role: 'error', text: `${bot.name} was cut off twice by restarts and could not finish. Ask again when you are ready.` });
      } else if (inflight) {
        this.append(id, { role: 'system', text: `${bot.name} was cut off by a restart and is picking up where it was.` });
        queue.unshift(`(You were cut off by a restart while working on this; check what already happened before redoing anything.)\n\n${inflight.text}`);
        this.resumed.add(id);
      }
      this.queues.set(id, queue);
      if (!queue.length) continue;
      this.drain(id);
      resumed++;
    }
    return resumed;
  }

  /** Messages that arrived during a restart wait in bot.json and are answered after it. */
  saveQueue(id) {
    const waiting = (this.queues.get(id) || []).splice(0);
    if (!waiting.length) return;
    const bot = this.read(id);
    if (!bot) return;
    bot.queued = [...(bot.queued || []), ...waiting].slice(-20);
    this.write(bot);
  }

  /**
   * A restart: start no new replies, let the running ones finish (up to maxMs), save what waits.
   * A reply still running at the end keeps its inflight note, so it is re-run after the restart.
   */
  async closeDown({ maxMs = 5 * 60 * 1000, pause = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
    this.closing = true;
    const deadline = this.now() + maxMs;
    while (this.running.size && this.now() < deadline) await pause(500);
    for (const id of this.queues.keys()) this.saveQueue(id);
    return { unfinished: [...this.running.keys()] };
  }

  /** One brain turn on whichever plan the bot is on now. */
  async turn(id, text) {
    let bot = this.read(id);
    if (!bot) return { error: 'That bot no longer exists.' };
    const extras = { card: this.memory(id).card(), handover: bot.handover || '' };
    // The chosen model belongs to the main plan; on the backup plan it uses that plan's default.
    const runner = { ...bot, provider: bot.active || bot.provider, model: (bot.active || bot.provider) === bot.provider ? (bot.model || null) : null };
    return this.run(runner, text, {
        bins: this.bins,
        extras,
        logPath: path.join(this.folder(id), 'last-run.log'),
        onStart: (stop) => { const current = this.running.get(id); if (current) current.stop = stop; },
        onEvent: (ev) => {
          if (ev.activity) {
            const current = this.running.get(id);
            if (current && current.activity !== ev.activity) { current.activity = ev.activity; current.activityAt = this.now(); this.append(id, { role: 'activity', text: ev.activity }); }
          }
          if (ev.session) {
            bot = this.read(id) || bot;
            if ((bot.active || bot.provider) === 'codex') bot.sessions = { ...bot.sessions, codex: ev.session };
            else bot.sessions = { ...bot.sessions, claude: { id: ev.session, started: true } };
            this.write(bot);
          }
        },
      });
  }
}
