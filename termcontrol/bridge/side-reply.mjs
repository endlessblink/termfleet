/**
 * Instant answers while a bot works (R-7173, Noam 2026-10-24: "when I ask questions - the
 * answers need to be instant while the bot is working").
 *
 * A bot's turn can run for many minutes, and a message that arrives meanwhile used to wait
 * for the whole turn. Now a quick side responder answers it within seconds, beside the
 * running turn and without stopping it. It is read-only: it gets the bot's brief, the recent
 * chat, what the turn is doing and the steps so far as text, has no tools, and never acts.
 * It says whether the message also asks for something to be done; if so, the message is
 * handed to the running turn through the steer inbox below (picked up after the turn's next
 * tool step), or, if the turn ends first, queued as the next turn. Either way the main brain
 * is told what was already answered, so its own reply does not repeat it.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { gentleCommand } from '../../scripts/lib/cpu-priority.mjs';

const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const hhmm = (ms) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const HEBREW = /[֐-׿]/;

/** Light and fast on the bot's own plan; no new paid service. Overridable for tuning. */
export const SIDE_MODEL = { claude: process.env.TC_SIDE_MODEL_CLAUDE || 'sonnet', codex: process.env.TC_SIDE_MODEL_CODEX || '' };
export const SIDE_TIMEOUT_MS = Number(process.env.TC_SIDE_TIMEOUT_MS) || 90_000;

/** Everything the side responder knows, as one prompt. It sees only this. */
export function sidePrompt({ bot, task = '', startedAt = null, steps = [], said = [], chat = [], incoming = [], openWork = [], terminals = '', forked = false, now = Date.now() }) {
  const mins = startedAt ? Math.max(0, Math.round((now - startedAt) / 60000)) : null;
  const lines = [
    `You are the quick side responder for "${bot.name}", a bot in TermFleet, Noam's agent cockpit. ${bot.name} is busy with a long piece of work right now and cannot read new messages until it finishes. Noam just wrote to it. Answer him now, as ${bot.name}, in 1 to 4 short plain sentences.`,
    '',
    'Rules:',
    '- When he asks about open tasks or what is happening, answer from the open requests and terminal agents listed below: name them and their state. Never say you have no information when they are listed.',
    forked ? `- You are a copy of ${bot.name}'s own conversation: everything above this message is what it knows and did. Answer from it. Open any picture or file Noam attached with the Read tool before answering. Never say you have no information about something that is in the conversation above.` : '',
    '- Answer his question directly and honestly: what you are doing right now, how far along you are, yes or no, a rough estimate when he asks for one. If the notes below do not tell you, say plainly that you do not know yet.',
    '- Use only what is written below. Never say something was done, checked, found or decided unless the steps or chat below show it. Never invent results or numbers.',
    '- You cannot act or change anything. If he asks for something to be done, changes or corrects the plan, say you passed it on to the work in progress (it picks it up at its next step); never promise the result.',
    '- Write in his language (Hebrew or English). No code, file names, commands or jargon. No greeting, no sign-off.',
    '',
    bot.job ? `${bot.name}'s job: ${clip(bot.job, 200)}` : '',
    bot.rules ? `Its standing rules from Noam:\n${String(bot.rules).slice(0, 1200)}` : '',
    '',
    `What it is working on now${mins != null ? ` (started ${mins} min ago, at ${hhmm(startedAt)})` : ''}:`,
    clip(task, 1500) || '(not recorded)',
    '',
    'Its steps so far, oldest first:',
    steps.length ? steps.slice(-25).map((s) => `- ${hhmm(s.at)} ${clip(s.text, 160)}`).join('\n') : '- (none yet; it has just started)',
    said.length ? `\nWhat it wrote along the way (not sent to Noam):\n${said.slice(-3).map((t) => `- ${clip(t, 500)}`).join('\n')}` : '',
    '',
    // Noam 2026-10-26: the quick answer said it knew nothing about the bot's 8 open tasks while the
    // header showed them. It now gets the same open list and terminal state the bot has.
    `Noam's requests to ${bot.name} that are not finished yet (${openWork.length}):`,
    openWork.length ? openWork.slice(0, 15).map((w) => `- [${w.status}] ${clip(w.words, 160)}${w.where ? ` (handed to ${clip(w.where, 60)})` : ''}`).join('\n') : '- (none)',
    '',
    terminals ? `Its terminal agents right now:\n${clip(terminals, 1500)}` : 'Its terminal agents right now: (none running)',
    '',
    'The recent chat, oldest first:',
    chat.length ? chat.map((m) => `${m.who}: ${clip(m.text, 500)}`).join('\n') : '(empty)',
    '',
    `Noam's new message${incoming.length === 1 ? '' : 's'}, to answer now:`,
    incoming.map((t) => `- ${clip(t, 1500)}`).join('\n'),
    '',
    'Reply in exactly this form, nothing else:',
    'REPLY: <your answer to Noam>',
    'PASS_ON: yes   <- if any new message asks for something to be done, or changes, corrects or adds to the plan',
    'PASS_ON: no    <- if they are only questions or remarks',
  ];
  return lines.filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n');
}

/** The side responder's answer and whether the message goes on to the running turn. Unclear means pass it on: an instruction must never be lost. */
export function parseSide(text) {
  const raw = String(text || '').trim();
  const pass = /PASS_ON:\s*(yes|no)\b/i.exec(raw);
  const forward = pass ? pass[1].toLowerCase() === 'yes' : true;
  let reply = raw;
  const r = /REPLY:\s*([\s\S]*?)(?:\n\s*PASS_ON:|$)/i.exec(raw);
  if (r) reply = r[1];
  else if (pass) reply = raw.slice(0, pass.index);
  reply = reply.replace(/\s*PASS_ON:.*$/gim, '').trim();
  return { reply, forward };
}

/** One sentence that the message was handed on, when the answer itself does not say so. */
export function withPassedOn(reply, forward, incoming = []) {
  if (!forward || /pass(ed)? (it|this|that)? ?on|handed|הועבר|העברתי/i.test(reply)) return reply;
  const he = HEBREW.test(incoming.join(' ')) || HEBREW.test(reply);
  return `${reply}${reply ? ' ' : ''}${he ? 'העברתי את זה לעבודה שרצה עכשיו, והיא תיקח את זה בצעד הבא שלה.' : 'I passed this on to the work in progress; it picks it up at its next step.'}`;
}

/** The command for one side answer: the bot's plan, no tools, no hooks, no saved session. */
export function sideCommand(bot, prompt, { bins = {}, cwd, session = null, addDirs = [] } = {}) {
  if (bot.provider === 'codex') {
    const model = bot.model || SIDE_MODEL.codex;
    return {
      bin: bins.codex || 'codex',
      args: ['exec', '--json', '--skip-git-repo-check', '--ephemeral', '--ignore-user-config', '-s', 'read-only', '-C', cwd,
        ...(model ? ['-m', model] : []), '-c', 'model_reasoning_effort="low"', '-c', 'approval_policy="never"', prompt],
    };
  }
  // With the bot's own conversation the responder is a copy of the bot (forked, never saved), so it
  // knows the history and can open pictures (Read); without one it stays the note-only responder.
  const copy = session ? ['--resume', session, '--fork-session', ...addDirs.flatMap((d) => ['--add-dir', d])] : [];
  return {
    bin: bins.claude || 'claude',
    args: ['-p', prompt, ...copy, '--output-format', 'json', '--model', SIDE_MODEL.claude,
      '--no-session-persistence', '--restricted', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
      '--settings', '{"disableAllHooks":true}', '--permission-mode', 'dontAsk',
      '--disallowedTools', 'Bash', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Task', 'Agent', 'Skill', ...(session ? [] : ['Read', 'Grep', 'Glob']), 'TodoWrite', 'TaskCreate', 'TaskUpdate'],
  };
}

/** The final text out of the side run's output. */
export function sideOutput(provider, stdout) {
  if (provider === 'codex') {
    let text = '';
    for (const line of String(stdout).split('\n')) {
      try { const o = JSON.parse(line); if (o.type === 'item.completed' && o.item?.type === 'agent_message' && o.item.text) text = o.item.text; } catch { /* not JSON */ }
    }
    return text ? { text } : { error: 'no answer' };
  }
  try {
    const o = JSON.parse(String(stdout).trim().split('\n').pop());
    if (o.is_error || (o.subtype && o.subtype !== 'success')) return { error: String(o.result || o.subtype || 'failed').slice(0, 300) };
    return o.result ? { text: String(o.result) } : { error: 'no answer' };
  } catch { return { error: 'no answer' }; }
}

/** Runs one side answer as a child process. Never throws; resolves with { text } or { error }. */
export function runSide(bot, prompt, { bins = {}, env = process.env, timeoutMs = SIDE_TIMEOUT_MS, cwd = os.tmpdir(), session = null, addDirs = [] } = {}) {
  // A forked copy must run in the bot's own folder: that is where its conversation is filed.
  if (session && bot.cwd) cwd = bot.cwd;
  const command = sideCommand(bot, prompt, { bins, cwd, session, addDirs });
  const { bin, args } = env.TERMFLEET_GENTLE_BRAINS === '0' ? command
    : gentleCommand(command.bin, command.args, { unit: `termfleet-side-${String(bot.id).replace(/[^A-Za-z0-9]/g, '')}-${Date.now()}` });
  return new Promise((resolve) => {
    let child;
    const clean = { ...env };
    for (const key of ['TERMFLEET_PANE_ID', 'CODEX_THREAD_ID', 'CODEX_SESSION_ID', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SSE_PORT', 'TERMFLEET_BOT_STEER']) delete clean[key];
    try { child = spawn(bin, args, { cwd, env: { ...clean, TERMFLEET_BOT_ID: bot.id, TERMFLEET_SIDE_REPLY: '1' }, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { resolve({ error: String(e.message || e) }); return; }
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill('SIGTERM'); }, timeoutMs);
    child.stdout.setEncoding('utf8'); child.stdout.on('data', (c) => { out += c; });
    child.stderr.setEncoding('utf8'); child.stderr.on('data', (c) => { err = (err + c).slice(-2000); });
    child.on('error', (e) => { err = String(e.message || e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      const got = sideOutput(bot.provider, out);
      if (got.text) resolve({ text: got.text });
      else resolve({ error: (got.error !== 'no answer' && got.error) || (err.trim().split('\n').pop() || `exit ${code}`).slice(0, 300) });
    });
  });
}

/* ---- The steer inbox: Noam's instruction, handed to a turn that is still running ---- */

export const steerDir = (folder) => path.join(folder, 'steer');

/** Leaves one message for the running turn. */
export function putSteer(folder, entry) {
  const dir = steerDir(folder);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const name = `${String(entry.at || Date.now()).padStart(15, '0')}-${String(entry.msgId || Math.random().toString(16).slice(2)).replace(/[^\w-]/g, '')}.json`;
  const tmp = path.join(dir, `.${name}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(entry), { mode: 0o600 });
  fs.renameSync(tmp, path.join(dir, name));
  return name;
}

/**
 * Takes every waiting message, oldest first. Each file is claimed by renaming it, so a
 * message is handed over exactly once even when two takers (a hook and the bridge) race.
 */
export function takeSteer(folder) {
  const dir = steerDir(folder);
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.json') && !n.startsWith('.')).sort(); } catch { return []; }
  const out = [];
  for (const name of names) {
    const claimed = path.join(dir, `.${name}.taken-${process.pid}`);
    try { fs.renameSync(path.join(dir, name), claimed); } catch { continue; }   // someone else took it
    try { out.push(JSON.parse(fs.readFileSync(claimed, 'utf8'))); } catch { /* unreadable: dropped */ }
    try { fs.unlinkSync(claimed); } catch { /* gone */ }
  }
  return out;
}

/** What the running turn is told about messages handed to it mid-way. */
export function steerText(entries) {
  if (!entries.length) return '';
  return [
    `[Noam wrote to you while you were working. ${entries.length === 1 ? 'This message was' : 'These messages were'} handed to you now, mid-turn. Your quick side responder already answered him in the chat (shown below); do not repeat that answer in your final reply. Act on what he asks or corrects as part of this same turn, and mention only what you did about it.]`,
    ...entries.map((e) => `- Noam (${hhmm(e.at || Date.now())}): "${String(e.brain || e.text || '').slice(0, 4000)}"${e.reply ? `\n  Already answered: "${String(e.reply).slice(0, 800)}"` : ''}`),
  ].join('\n');
}

/** The same messages, when the turn ended before it could take them: the start of the next turn. */
export function nextTurnText(entries) {
  return entries.map((e) => `${String(e.brain || e.text || '')}${e.reply ? `\n\n[While you were busy, your quick side responder already answered this in the chat: "${String(e.reply).slice(0, 800)}". Do not repeat that answer; act on what he asks or corrects, and add only what is new.]` : ''}`);
}

/** Hook output that hands the waiting messages to the running turn (Claude and Codex, after a tool step). */
export function steerHookOutput(folder) {
  const entries = takeSteer(folder);
  if (!entries.length) return null;
  return { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: steerText(entries) } };
}
