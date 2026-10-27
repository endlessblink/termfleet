import { gentleCommand } from '../../scripts/lib/cpu-priority.mjs';
import { statedRules, withRules } from './stated-rules.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BotMemory, searchChat } from './memory.mjs';
import { contextFill } from './context-fill.mjs';
import { claudeTranscript } from './paths.mjs';
import { stalledFor, conversationMtime } from './session-status.mjs';
import { asksForFile } from '../../scripts/termfleet-asks.mjs';
import { uploadDir } from './uploads.mjs';
import { skillPrompt } from './skills.mjs';
import { parseQuestion, findMedia, MEDIA_RULE, QUESTION_RULE, markRepeatedQuestions, markRepeatedTerminalAsks, markWithdrawnQuestions, needsLink, sameQuestion, nearDuplicate, NOTHING_NEW, alreadyAnsweredNote } from './bot-questions.mjs';
import { parseChecklist, CHECKLIST_RULE, carryCard, checklistAnswer } from './bot-checklist.mjs';
import { defaultDaemonSocket, requestDaemon } from '../../scripts/termfleetctl.mjs';
import { endFollows } from './follows.mjs';
import { recordOwnerWords } from './owner-words.mjs';
import { captureMessage as captureRequirements, loadLedger as loadRequirements, ledgerDir as requirementsLedgerDir, projectOf as requirementsProject, markItem as markRequirement, record as recordRequirements, messageProblem, structureProblem } from './requirements.mjs';
import { testingHandoffProblem, readyThisTurn, saveTestingHandoff } from './bot-testing.mjs';
import { sidePrompt, parseSide, withPassedOn, putSteer, takeSteer, nextTurnText, steerDir } from './side-reply.mjs';
import { fnv, statusDir as agentStatusDir } from '../../scripts/lib/agent-status-paths.mjs';
import { BotGroups } from './bot-groups.mjs';
import { checkFolder } from './bot-folders.mjs';
import { brainTokenUsage, traceTokenUsage } from './token-monitor.mjs';
import { classifyTool, appendAction, readActions, paneLogFile, botApproval, paneApproval, foldFiles, approvalText } from './action-log.mjs';

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

/** What a bot is told when its card about looks or designs was held back for having no link. */
const heldCardNote = (q) => `[Event, not from Noam] Your question card "${String(q.text).slice(0, 300)}" was NOT shown to Noam: it asks him to choose between things he cannot see. Send the same card again now, with a line \`link: <web address or full file path>\` under the question for the page that shows all the answers, and \`- <answer> | <link>\` for each answer that has its own preview. Do not repeat the rest of your message. If there truly is nothing to look at, send the card again unchanged and it will be shown.]`;

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

/**
 * 👀 then ✓ on Noam's own messages (Noam 2026-10-24: "עדיין אין עיניים"): 'working' while the
 * bot has taken it and not answered yet, 'answered' once a reply covers it. A reply covers the
 * messages sent before its turn started (`answered` = that start; older replies cover all before
 * them). A failure or a stop just drops the eyes.
 */
export function markReceipts(chat, { busy = false } = {}) {
  return chat.map((m, i) => {
    if (m.role !== 'operator') return m;
    const later = chat.slice(i + 1);
    // A note only ends a turn when it belongs to one (the stop note carries `answered`); the
    // "Closed the …" notes a bot leaves mid-reply used to drop the eyes while it kept working.
    const reply = later.find((r) => ((r.role === 'bot' && !r.side) || ['error', 'needs-you'].includes(r.role) || (r.role === 'note' && r.answered != null)) && (r.answered == null || Number(r.answered) >= Number(m.at)));
    const status = reply ? (reply.role === 'bot' ? 'answered' : null)
      : busy ? 'working'
      : later.some((r) => r.role === 'bot' && !r.side) ? 'answered' : null;
    return status ? { ...m, status } : m;
  });
}
/** What counts as a new message for Noam: the bot's replies, failures and questions to him. */
const UNREAD_ROLES = new Set(['bot', 'error', 'needs-you']);

const clean = (v, max) => String(v ?? '').trim().slice(0, max);
const ownHome = (name) => path.join(BOTS_HOME(), name.replace(/[^\p{L}\p{N}._-]+/gu, '-'));
const newId = () => crypto.randomBytes(6).toString('hex');

/**
 * Bots Noam tagged by name in a message ("@Quill", "@Grok Bot", "@grok-bot"), longest name
 * first so "@Agent-Manager" never also counts as "@Agent" (Noam 2026-10-21: "אפשר גם שאני
 * אוכל לתייג סוכן אחר בהודעה ואז הוא יגיב גם").
 */
export function mentionedBots(text, bots) {
  const body = String(text || '');
  const spans = [];
  for (const b of bots || []) {
    const parts = String(b?.name || '').trim().split(/[\s_-]+/).filter(Boolean);
    if (!parts.length) continue;
    const re = new RegExp(`(?:^|[^\\p{L}\\p{N}_])@(${parts.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s_-]+')})(?![\\p{L}\\p{N}])`, 'giu');
    for (const m of body.matchAll(re)) { const start = m.index + m[0].length - m[1].length; spans.push({ bot: b, start, end: start + m[1].length }); }
  }
  spans.sort((a, b) => (b.end - b.start) - (a.end - a.start));
  const taken = [], found = new Map();
  for (const s of spans) {
    if (taken.some((t) => s.start < t.end && t.start < s.end)) continue;
    taken.push(s);
    found.set(s.bot.id, s.bot);
  }
  return [...found.values()];
}

/** "@all" / "@כולם" in a group: every member answers. */
export const TAGS_EVERYONE = (text) => /(?:^|[^\p{L}\p{N}_])@(?:all|everyone|כולם)(?![\p{L}\p{N}])/iu.test(String(text || ''));

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
    '  `termfleet-team send <who> "<task>"` (hand work over), `termfleet-team ask <who> "<question>"` (waits at most 20 seconds for the answer; if it is not ready you are woken when it finishes, so then just tell Noam it is in progress and stop: never wait or poll in a loop),',
    '  `termfleet-team start --cwd <folder> --task "<task>"` (open a new terminal agent for a job; it starts in Codex. Add `--provider claude` only when the job needs complex reasoning or handling a conversation),',
    '  `termfleet-session-digest recent --cwd <folder>` and `termfleet-session-digest search <words> --cwd <folder>` (what earlier terminal agent sessions in a folder said and decided, from their own records: look there before telling Noam you do not know),',
    "  never run a headed (visible) browser or test, drive Noam's real Chrome, or open a window on his screen unless he approves it with a button question in the app: use headless runs or a private virtual screen (xvfb-run),",
    '  give every terminal you start a short plain name with `--name "<2-5 words>"` (it shows on its card and in Noam\'s terminal list),',
    '  `termfleet-team routine add --time 09:00 --days weekdays --message "<text>"` (a scheduled message).',
    '- Say which terminal agent you handed work to, and check its result before telling Noam it is done.',
    '- When Noam approves or decides something here that a terminal agent needs (e.g. "Yes add the images"), pass on his own words, never a retelling: `termfleet-team send <who> --owner-words latest "<what to do with it>"` attaches his exact latest message here as a record the agent can check (use a message id from `termfleet-team verify` instead of latest for an older one). Never ask Noam to repeat an approval he already gave; if an agent still refuses, send it his words this way again.',
    '- When the work involves a picture Noam sent, pass the picture itself: add `--image <full path>` (once per picture) to `termfleet-team send`, `ask` or `start`. A path written inside your sentence reaches the terminal as plain text, and the agent there does not see the picture.',
    '- Always close a terminal you started once its work is done: right after you checked its result and told Noam, run `termfleet-team close <who>`, unless you are sending it more work now. Never leave a finished terminal open "just in case"; Noam does not want finished terminals piling up. The command refuses while one is working, waiting for Noam, or has unsaved work: then leave it open, say why, and close it once that is resolved. A terminal agent may also close itself when its work is done (`termfleet-team close self`); that is fine.',
    '- Keep Noam\'s requests in his exact words. For a new or unclear request, read it back as a short numbered list first.',
    '- Every reply reporting a fix, version, release or ready item must include a plain line: Try: <exact action Noam should take> <working https://link>. Open that exact link with your browser in this turn first; the Stop hook and chat publication block missing or unchecked handoffs.',
    '- Never say "done" without proof (what ran and what it showed). If you did less than asked, say so in your first sentence.',
    '- Never spend money, post publicly, send messages to people, or delete things without Noam\'s explicit yes.',
    '- Keep going: when Noam asked for something, or the next step is safe and can be undone (reading, planning, drafting, building, testing, saving, handing work to a terminal), do it now in this same turn. Never stop to ask for his go ("say go when you want me to", "want me to start?") for that: he does not want the flow to stop. End with "Waiting for Noam: <what>" only for spending money, posting publicly, messaging people, deleting, a step only he can do (signing in, a code, trying it), or a real choice between two truly different outcomes (ask that as a question card). The Go ahead buttons under your messages are for those real approvals only.',
    '- Write to Noam in his language (Hebrew when he writes Hebrew, English when he writes English), in short, plain, everyday sentences: no code, file paths or jargon unless he asks.',
    '- In Hebrew his name is written נועם. Never נוח or any other spelling.',
    QUESTION_RULE,
    MEDIA_RULE,
    CHECKLIST_RULE,
    '',
    'Your memory:',
    '- `termfleet-memory search "<words>"` finds anything said in your past conversations with Noam, word for word. Use it before guessing what was decided.',
    '- `termfleet-memory propose "<one or two sentences>" --kind preference|decision|fact|lesson` suggests something to remember; it counts only after Noam approves it.',
    '- `termfleet-asks done|ready|partial|dropped <n> "<proof or note>"` marks his numbered requests. Use `ready` (not `partial`) when it is built and live but Noam has not tried it yet; the note says exactly what he should try, in a few words (e.g. "open a bot chat on the phone and tap 25/30"). It stays quiet: no notification, and it is NOT in his "Waiting for you" list (that list is only for approvals and questions that block work until he acts); untried work goes into one quiet "try later" task, never a ping. When he says it works, mark it `done`.',
    '- Every message from Noam is also split into items with ids (R-12), each in his exact words (`termfleet-asks items` lists them). You cannot end a turn while one is untaken. Take each one: hand it to a terminal with `termfleet-team send <who> --req R-12,R-13 "<task>"` (his words for those items, his open words on the same topic and the ones he already approved go with it automatically; the send fails loudly if the terminal did not really receive it), answer it (`termfleet-asks answered R-12 "<answer>"`), ask him (`termfleet-asks waiting R-12 "<question>"`) or mark it background (`termfleet-asks context R-12 "<why>"`). Give items a topic (`termfleet-asks topic R-12 title-strip`). Before you tell him an item is ready, check its evidence in the list (`termfleet-asks items`) against his words; ready/done needs evidence per item (`--evidence "<screenshot or test output>"`). Tell Noam the result in 1-3 plain sentences: what is now true, what is not done yet, what to try. No item ids, no quoted words, no table: the chat shows the per-item list (his words, what was done, the evidence) under your reply\'s Details toggle. When he says an item works, lock it (`termfleet-asks lock R-12 --owner-words <his message id>`): later work on that topic must re-check it first.',
    '- You wake up by yourself on schedules (`termfleet-team routine add --time 09:00 --days weekdays --message "<what to do>"`), when a terminal agent you started finishes, and when new code lands in a folder you watch (`termfleet-team watch add <folder>`). Messages starting with [Event] come from these, not from Noam.',
    '- Skills: Noam\'s shared skill library holds tested ways of doing recurring jobs; when he says "Use the <name> skill" or types /<name>, follow it. `termfleet-skill list` shows them, and his own skills in ~/.claude/skills, ~/.codex/skills and ~/.config/opencode/skills work the same way (read <folder>/<name>/SKILL.md and follow it). Never say a bot cannot run a skill. When a process worked and will recur, offer to save it: `termfleet-skill save <name-with-dashes> --description "<when to use it>" --body "<the steps, what to check, what needs Noam\'s approval>"`. It is only a suggestion until he approves it.',
    '- The bots\' browser: Chrome on Noam\'s PC that only bots use, with shared sign-ins. Use the browser tools for web tasks that need clicking or signing in (plain reading can use web search). You get your own window there: you see only your own pages, other bots browse at the same time in theirs, and your window closes when your task ends. If the browser tools cannot connect, run `termfleet-browser start` once. Never type passwords, codes or card numbers. When a step needs Noam (signing in, a code, a choice), run `termfleet-browser ask-noam "<exactly what he should do in your window>"`, tell him the same in one line, and stop: your window stays open, and when he hands it back his note arrives as a message; then look at the page and carry on. If a browser tool says Noam has taken over, stop and wait for his note. Before anything that pays, sends, posts or deletes, ask him first.',
    '- You only act when a message or an event arrives; nothing runs between them. So never say you will check or do something later unless you set up the wake-up first: `termfleet-team follow <who>` wakes you once when that agent finishes (then the follow ends; `termfleet-team unfollow <who>` or `unfollow --all` stops it sooner), `termfleet-team routine add` wakes you at a time. Report on another agent\'s work only when Noam asked for it. Otherwise do it now; say it is waiting for Noam only for one of the real reasons above. Do not end with "Next I\'m doing" unless a wake-up is set.',
    card ? `\n${card}` : '',
    handover ? `\nYou are continuing after a fresh start (your previous conversation filled up). Pick up exactly here:\n${handover}` : '',
  ].filter((l) => l !== '').join('\n');
}

/**
 * Which brief a conversation holds: the bot's own rules and how it works, without the
 * memory card or handover (those change often and must not make it resend).
 */
export const briefStamp = (bot) => crypto.createHash('sha256').update(brainBrief(bot)).digest('hex').slice(0, 16);

const CLAUDE_TOOLS = ['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Skill', 'Grep', 'Glob', 'Bash(termfleet-team:*)', 'Bash(termfleet-memory:*)', 'Bash(termfleet-asks:*)', 'Bash(termfleet-skill:*)', 'Bash(termfleet-browser:*)', 'mcp__browser', 'Bash(git status:*)', 'Bash(git log:*)', 'Bash(git diff:*)', 'Bash(ls:*)', 'WebSearch', 'WebFetch', 'mcp__plugin_context-mode_context-mode__ctx_fetch_and_index', 'mcp__plugin_context-mode_context-mode__ctx_search'];
const CLAUDE_DENY = ['mcp__browser__browser_run_code_unsafe'];
const STEER_HOOK = fileURLToPath(new URL('../../scripts/termfleet-bot-steer-hook.mjs', import.meta.url));

/** One tool step of a running turn, for the side responder's view of progress (R-7173). */
export function stepLine(use = {}) {
  const input = use.input || {};
  const detail = input.command || input.description || input.query || input.url || input.file_path || input.pattern || input.prompt || '';
  return `${activityLine(use.name, input)}${detail ? `: ${String(detail).replace(/\s+/g, ' ').slice(0, 140)}` : ''}`;
}

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
// Each bot's browser tools see only that bot's own window (Codex hands an MCP server
// only a few of its settings, so the bot is named in the arguments, not the settings).
export const browserMcp = (bot) => ({ command: BROWSER_MCP.command, args: [...BROWSER_MCP.args, '--bot', String(bot?.id || ''), '--bot-name', String(bot?.name || '')] });

const HANDOFF_PROMISE = /\b(?:i'?ll|i will|i'?m going to)\s+(?:have|get|ask|send|hand|start|open|spin up|put|assign)\b[^.\n]{0,80}\b(?:agent|terminal|helper)s?\b|(?:אעביר|אפתח|אתן ל|אשלח ל|אבקש מ)[^.\n]{0,60}(?:סוכן|טרמינל|מסוף)/i;

/** The hand-off a reply promises, when no hand-off was recorded since the turn began; else null. */
export function brokenHandoff(text, chat, turnStart) {
  const m = HANDOFF_PROMISE.exec(String(text || ''));
  if (!m) return null;
  const handed = (chat || []).some((x) => x.role === 'handoff' && Number(x.at) >= turnStart && !/^NOT /.test(String(x.text || '')));
  return handed ? null : m[0].trim();
}

// "It is fixed / done / ready" said to Noam. 19 of 40 such claims in a week were false
// because nobody had looked at what he sees, after the install or restart (#13).
const HEB = (w) => `(?<![\\u0590-\\u05FF])(?:${w})(?![\\u0590-\\u05FF])`;
const DONE_CLAIM = new RegExp(`${HEB('תוקן|תוקנו|תיקנתי|טופל|טופלו|בוצע|בוצעו|הושלם|הושלמו|סיימתי|ניקיתי|מוכן|מוכנים|כמוכן|עובד עכשיו|כבר עשיתי')}|\\b(?:fixed|resolved|works now|now works|is live|cleaned up|i'?ve (?:already )?done it|all done|it'?s done|is done|are done|ready to try)\\b`, 'i');
const NOT_YET = new RegExp(`${HEB('לא|טרם|עוד לא|כש\\S*|אחרי ש\\S*|ברגע ש\\S*|אם|אולי|מחכה|ממתין|ממתינה')}|\\b(?:not|never|yet|still|once|when|if|will|until|waiting|being|next|can'?t|cannot|isn'?t|aren'?t|wasn'?t|didn'?t|hasn'?t)\\b`, 'i');
const SEEN_LIVE = /צילום|screenshot|בדקתי (?:אצלך|בטלפון|במסך|באפליקציה)|ראיתי (?:אצלך|בטלפון|במסך|באפליקציה)|אישרת|(?:checked|saw|opened|tried) it (?:on|in) (?:your|the) (?:phone|screen|app)|you confirmed/i;

/** The sentence where a reply tells Noam something is fixed or ready, with nothing to show it was seen working; else null. */
export function unprovenClaim(text, { media = 0 } = {}) {
  // Words in quotes are a name or a quote ("בוצע חלקית" as a label), not a claim.
  const msg = String(text || '').replace(/"[^"\n]{0,80}"|“[^”\n]{0,80}”|`[^`\n]*`/g, '""').trim();
  if (!msg || media > 0 || SEEN_LIVE.test(msg)) return null;
  // A reply that opens with "not fixed yet" is an honest status, whatever follows.
  if (/^\W*(?:עוד לא|טרם|לא)(?![֐-׿])|^\W*(?:not (?:fixed|done|ready)|still not|not yet)\b/i.test(msg)) return null;
  for (const sentence of msg.split(/(?<=[.!?\n])\s*|\s+[-—]\s+/)) {
    if (DONE_CLAIM.test(sentence) && !NOT_YET.test(sentence)) return sentence.trim().slice(0, 140);
  }
  return null;
}

/** The pictures the bridge's own "[Noam attached N picture(s)…: a , b]" notes name in a message, that exist. */
export function attachedPictures(text) {
  const out = [];
  for (const m of String(text || '').matchAll(/\[Noam attached \d+ pictures?\.[^\]:]*: ([^\]]+)\]/g)) {
    for (const p of m[1].split(' , ').map((s) => s.trim())) if (p && !out.includes(p) && fs.existsSync(p)) out.push(p);
  }
  return out;
}

export function brainCommand(bot, text, { bins = {}, extras = {} } = {}) {
  if (bot.provider === 'codex') {
    const bin = bins.codex || 'codex';
    const first = !bot.sessions?.codex;
    // Codex keeps its brief only inside the conversation, so a conversation that started
    // before the brief changed (e.g. the question tool) gets the current one again, once.
    const knows = !first && bot.codexBrief?.session === bot.sessions.codex && bot.codexBrief?.stamp === briefStamp(bot);
    const prompt = first ? `${brainBrief(bot, extras)}\n\n---\nNoam says:\n${text}`
      : knows ? text
      : `Your instructions were updated. They replace the earlier ones:\n${brainBrief(bot, extras)}\n\n---\nNoam says:\n${text}`;
    // Codex runs in its write-limited safety box; open only what a bot needs to direct
    // terminal agents (the helper-request folder, the terminal service's socket, its
    // own bot folder), and never stop to ask: nobody is at a bot's keyboard.
    const runtime = process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid?.() ?? 1000}`;
    const roots = [path.join(os.homedir(), '.local', 'share', 'terminal-workspace'), path.join(runtime, 'terminal-workspace'), defaultDir(), BOTS_HOME()];
    const config = ['-c', `sandbox_workspace_write.writable_roots=${JSON.stringify(roots)}`, '-c', 'sandbox_workspace_write.network_access=true', '-c', 'approval_policy="never"',
      '-c', `mcp_servers.browser.command=${JSON.stringify(BROWSER_MCP.command)}`, '-c', `mcp_servers.browser.args=${JSON.stringify(browserMcp(bot).args)}`, '-c', 'mcp_servers.browser.disabled_tools=["browser_run_code_unsafe"]',
      '-c', 'mcp_servers.browser.default_tools_approval_mode="approve"', '-c', 'mcp_servers.node_repl.enabled=false', '-c', 'plugins."unified-computer-use@openai-bundled".enabled=false'];
    // A path in the words is not a picture to Codex: attached, it is (0 of the pictures sent to Codex
    // bots were ever viewed; 2026-10-26). `=` keeps the flag to one file, so the prompt stays the prompt.
    const images = attachedPictures(text).map((p) => `--image=${p}`);
    const args = first
      ? ['exec', '--json', '--skip-git-repo-check', '-C', bot.cwd, '-s', 'workspace-write', ...(bot.model ? ['-m', bot.model] : []), ...config, ...images, prompt]
      : ['exec', 'resume', bot.sessions.codex, '--json', '--skip-git-repo-check', ...(bot.model ? ['-m', bot.model] : []), ...config, ...images, prompt];
    return { bin, args };
  }
  const bin = bins.claude || 'claude';
  const session = bot.sessions?.claude;
  const args = ['-p', text, '--output-format', 'stream-json', '--verbose',
    '--append-system-prompt', brainBrief(bot, extras),
    '--add-dir', uploadDir(),   // pictures Noam attaches
    '--permission-mode', 'dontAsk',
    ...(bot.model ? ['--model', bot.model] : []),
    '--mcp-config', JSON.stringify({ mcpServers: { browser: browserMcp(bot) } }),
    // Only the bot's own browser tool: the ~18 global tool servers it may not use cost ~1.7 s per turn (2026-10-26).
    ...(process.env.TC_BOT_FULL_TOOLS === '1' ? [] : ['--strict-mcp-config']),
    '--allowedTools', ...CLAUDE_TOOLS,
    '--disallowedTools', ...CLAUDE_DENY,
    // Noam's mid-turn instructions reach the running turn after its next tool step (R-7173).
    ...(bot.steerFolder ? ['--settings', JSON.stringify({ hooks: { PostToolUse: [{ hooks: [{ type: 'command', command: `${JSON.stringify(process.execPath)} ${JSON.stringify(STEER_HOOK)}`, timeout: 5 }] }] } })] : []),
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

/** Every tool call in one brain output line, for the bot's action log (TF-098). */
export function brainToolUses(provider, line) {
  let o;
  try { o = JSON.parse(line); } catch { return []; }
  if (provider === 'codex') {
    if (o.type !== 'item.started' || !o.item) return [];
    if (o.item.type === 'command_execution') return [{ id: o.item.id || null, name: 'command_execution', input: { command: o.item.command } }];
    if (o.item.type === 'mcp_tool_call') return [{ id: o.item.id || null, name: `mcp__${o.item.server}__${o.item.tool}`, input: o.item.arguments || {} }];
    return [];
  }
  if (o.type !== 'assistant') return [];
  return (o.message?.content || []).filter((b) => b?.type === 'tool_use').map((b) => ({ name: b.name, input: b.input || {}, id: b.id || null }));
}

/** Which tool calls finished in one brain output line, and whether each worked (a denied or failed call did nothing). */
export function brainToolResults(provider, line) {
  let o;
  try { o = JSON.parse(line); } catch { return []; }
  if (provider === 'codex') {
    if (o.type !== 'item.completed' || !o.item?.id) return [];
    if (o.item.type === 'command_execution') return [{ id: o.item.id, ok: o.item.exit_code === 0 && o.item.status !== 'failed' && o.item.status !== 'declined' }];
    if (o.item.type === 'mcp_tool_call') return [{ id: o.item.id, ok: o.item.status === 'completed' && !o.item.error }];
    return [];
  }
  if (o.type !== 'user') return [];
  const content = Array.isArray(o.message?.content) ? o.message.content : [];
  return content.filter((b) => b?.type === 'tool_result' && b.tool_use_id).map((b) => ({ id: b.tool_use_id, ok: b.is_error !== true }));
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
    // What the bot wrote along the way: only the final text is its reply, but a list or
    // question card written earlier is carried into it (carryCard).
    const said = (o.message?.content || []).filter((b) => b?.type === 'text' && b.text).map((b) => b.text).join('\n\n');
    if (uses.length) return { activity: activityLine(uses[0].name, uses[0].input), ...(said ? { said } : {}) };
    return said ? { said } : null;
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
    TERMFLEET_BOT_TURN_STARTED_AT: String(Date.now()),
    ...(bot.steerFolder ? { TERMFLEET_BOT_STEER: bot.steerFolder } : {}),   // the bot's folder; its steer/ inbox is inside
    PATH: `${path.join(os.homedir(), '.local', 'bin')}:${env.PATH || '/usr/bin:/bin'}`,
    PAGER: 'cat', GIT_PAGER: 'cat', GIT_EDITOR: 'true', EDITOR: 'true', GIT_TERMINAL_PROMPT: '0', DEBIAN_FRONTEND: 'noninteractive',
    // Bots do not use lean-ctx; its per-step hooks cost ~0.6 s on every tool call (2026-10-26).
    ...(env.TC_BOT_FULL_TOOLS === '1' ? {} : { LEAN_CTX_DISABLED: '1' }),
  };
}

/** Runs one brain turn as a child process and reports events as they come. */
export function runBrain(bot, text, { onEvent, onStart, onUsage = traceTokenUsage, bins, extras, env = process.env, timeoutMs = 30 * 60 * 1000, idleMs = 10 * 60 * 1000, logPath = null } = {}) {
  const command = brainCommand(bot, text, { bins, extras });
  // Brains (and every test suite they run) yield CPU and disk to Noam's own apps: their own
  // gentle scope beside the bridge, idle disk class (Agent-Manager 2026-10-22, PC unusable).
  const { bin, args } = env.TERMFLEET_GENTLE_BRAINS === '0' ? command
    : gentleCommand(command.bin, command.args, { unit: `termfleet-bot-${String(bot.id).replace(/[^A-Za-z0-9]/g, '')}-${Date.now()}` });
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
    const spoken = [];
    const calls = new Map();   // tool calls waiting for their result (action log)
    let usageModel = bot.model || 'unknown';
    const recordUsage = (line) => {
      try {
        const event = JSON.parse(line);
        if (event.type === 'system' && event.subtype === 'init' && event.model) usageModel = event.model;
        for (const u of brainTokenUsage(bot.provider, event, usageModel)) {
          onUsage(bot.name, bot.provider, u.model, u.inputTokens, u.outputTokens, u.cost);
        }
      } catch { /* missing usage or monitoring failure must not interrupt the reply */ }
    };
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
        recordUsage(line);
        // An action is logged only once its call succeeded: a denied or failed call never happened.
        for (const use of brainToolUses(bot.provider, line)) { if (use.id) calls.set(use.id, use); onEvent?.({ step: use }); }
        for (const done of brainToolResults(bot.provider, line)) { const use = calls.get(done.id); calls.delete(done.id); if (use && done.ok) onEvent?.({ action: use }); }
        const ev = parseBrainLine(bot.provider, line);
        if (!ev) continue;
        if (ev.limit) { limit = limit || ev.limit; if (!ev.final) { ownKill = true; child.kill('SIGTERM'); } }
        if (ev.text) { lastText = ev.text; if (ev.final) finalText = ev.text; else spoken.push(ev.text); }
        if (ev.said) spoken.push(ev.said);
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
      // A Claude turn that ends on a tool step (e.g. marking his request) has an empty final
      // text even though the bot answered just before it: that answer is the reply, never
      // "Done, with nothing to add." (R-7394).
      const lastSaid = bot.provider === 'codex' ? '' : [...spoken].reverse().find((s) => String(s || '').trim()) || '';
      const text = unfinished ? '' : carryCard(finalText.trim() || lastText.trim() || lastSaid, spoken);
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
    recent.length ? 'The latest messages, word for word:\n' + recent.map((m) => `${m.role === 'operator' ? 'Noam' : m.guest ? m.guest.name : 'You'}: ${String(m.text).slice(0, 1500)}`).join('\n') : '',
    'Older conversation: search it with termfleet-memory search.',
  ].filter(Boolean).join('\n\n');
}

/**
 * What a brain conversation that starts fresh needs to know (#25, Noam: "אני לא יודע על אילו בעיות אתה מדבר"):
 * the chat so far, word for word. Empty when the conversation is already running or the chat is new.
 */
export function freshStartHandover(bot, chat, text = '') {
  const provider = bot.active || bot.provider;
  const fresh = provider === 'claude' ? !bot.sessions?.claude?.started : !bot.sessions?.codex;
  if (!fresh) return '';
  const earlier = (chat || []).slice();
  // The message being answered now is already in the chat; it goes to the brain on its own.
  for (let i = earlier.length - 1; i >= 0; i--) {
    if (earlier[i].role === 'operator') { if (String(text).startsWith(String(earlier[i].text || '').slice(0, 200))) earlier.splice(i, 1); break; }
  }
  return earlier.some((m) => m.role === 'operator' || m.role === 'bot') ? handoverText(bot, earlier) : '';
}

const providerName = (p) => (p === 'codex' ? 'Codex' : 'Claude');
const clock = (ms) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

export class Bots {
  constructor({ dir = defaultDir(), run = runBrain, side = null, bins = { claude: findBinary('claude'), codex: findBinary('codex') }, now = () => Date.now(), fill = defaultFill, checks = { home: process.env.TC_BOT_CHECK_HOME || undefined }, notify = () => {} } = {}) {
    // The quick side responder for messages that arrive mid-turn (R-7173). Off unless given:
    // the bridge passes runSide; tests pass a stand-in and never reach a real plan.
    this.side = side;
    this.sides = new Map();     // id -> { busy, pending: [entry] }
    this.handed = new Map();    // his message id -> { bot, brain, items }: what a delete pulls back out of the line
    this.retracted = new Set(); // his message ids he deleted: never handed on to the bot after that
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
    this.waitedFor = new Map(); // id -> [{ msgId, items }] of Noam's messages queued while a turn ran
    this.closing = false;       // the service is restarting: finish running replies, start no new ones
    this.resumed = new Set();   // bots whose interrupted turn is being re-run (only once)
    this.echoes = new Map();    // id -> Set of 'bot:<id>' / 'group:<id>' where Noam tagged it; its next answer is shown there too
    this.groups = new BotGroups({ dir: path.join(dir, 'groups'), now: this.now, botExists: (id) => Boolean(this.read(id)) });
    this.live = { at: 0, ids: null }; // running terminals, refreshed in the background (a turn never waits for it)
    this.handoffNudged = new Map(); // id -> when it was last told to keep a hand-off promise
    this.claimNudged = new Map(); // id -> when it was last asked to show a "fixed" claim working
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
    const openTasks = [...loadRequirements({ dir: this.reqDir() }).items.values()].filter((item) =>
      item.source === `bot:${id}` && !item.locked && !['done', 'ready', 'answered', 'context', 'dropped'].includes(item.status)).length;
    return {
      memoryPending: this.memory(id).pendingCount(),
      pinned: Boolean(bot.pinned), hidden: Boolean(bot.hidden), notify: bot.notify !== false,
      proposedProfile: bot.proposedProfile || null,
      helpers: this.helpers(id),
      mainResetsAt: (bot.active && bot.active !== bot.provider) ? (this.health()[bot.provider]?.limitedUntil || null) : null,
      id: bot.id, name: bot.name, job: bot.job, provider: bot.provider, model: bot.model || null, fallback: bot.fallback || null, active: bot.active || bot.provider, cwd: bot.cwd, ownFolder: path.dirname(bot.cwd || '') === path.resolve(BOTS_HOME()), createdAt: bot.createdAt,
      state: working ? 'working' : bot.blocked ? 'needs-you' : last?.role === 'error' ? 'failed' : openTasks ? 'pending' : 'idle',
      openTasks,
      blocked: bot.blocked ? { ask: bot.blocked.ask, at: bot.blocked.at } : null,
      waitingForReset: bot.retry ? bot.retry.at : null,
      health: bot.blocked ? { level: 'bad', text: 'Needs you' }
        : last?.role === 'error' ? { level: 'bad', text: 'Last reply failed' }
          : bot.retry ? { level: 'warn', text: 'Waiting for a plan to reset' }
            : (bot.active && bot.active !== bot.provider) ? { level: 'warn', text: `On its backup plan` }
              : working ? { level: 'busy', text: 'Working' } : openTasks ? { level: 'warn', text: `${openTasks} open tasks` } : { level: 'ok', text: 'Ready' },
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
    // A picked project folder is only checked, never made (Noam 2026-10-22).
    const picked = checkFolder(cwd);
    if (picked.error) return { error: picked.error };
    let folder = picked.folder;
    if (!folder) {
      folder = ownHome(n);
      try { fs.mkdirSync(folder, { recursive: true }); } catch { return { error: 'Could not make the bot\'s folder.' }; }
    }
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
    // How many terminals this bot may run at once (#8); the default 3 applies when unset.
    if ('maxTerminals' in patch) {
      const n = Math.round(Number(patch.maxTerminals));
      if (!Number.isFinite(n) || n < 1 || n > 8) return { error: 'Pick a number of terminals from 1 to 8.' };
      next.maxTerminals = n;
    }
    if ('rules' in patch) next.rules = clean(patch.rules, LIMITS.rules);
    if ('provider' in patch && PROVIDERS.includes(patch.provider)) { next.provider = patch.provider; if (!next.active || next.active === bot.provider) next.active = patch.provider; if (patch.provider !== bot.provider) next.model = null; }
    if ('model' in patch) {
      const wanted = String(patch.model || '').trim();
      if (wanted && !modelChoices(next.provider, { home: this.codexHome }).some((m) => m.id === wanted)) return { error: 'That model is not available for this plan.' };
      next.model = wanted || null;
    }
    if ('fallback' in patch) next.fallback = PROVIDERS.includes(patch.fallback) && patch.fallback !== next.provider ? patch.fallback : null;
    // A new folder (Noam 2026-10-22): empty means back to its own home folder. The brain's
    // conversation belongs to the old folder, so it starts fresh there with a handover.
    let moved = null;
    if ('cwd' in patch) {
      const picked = checkFolder(patch.cwd);
      if (picked.error) return { error: picked.error };
      const folder = picked.folder || ownHome(next.name);
      if (folder !== bot.cwd) {
        if (this.running.has(id)) return { error: `Wait until ${bot.name} finishes its reply, then change the folder.` };
        if (!picked.folder) { try { fs.mkdirSync(folder, { recursive: true }); } catch { return { error: 'Could not make the bot\'s folder.' }; } }
        let asks = [];
        try { const file = bot.sessions?.claude?.started ? claudeTranscript(bot.cwd, bot.sessions.claude.id) : null; if (file) asks = asksForFile(file); } catch { asks = []; }
        next.handover = handoverText(bot, this.messages(id), { asks });
        next.sessions = { ...bot.sessions, claude: { id: crypto.randomUUID(), started: false }, codex: null };
        next.cwd = folder;
        moved = folder;
      }
    }
    this.write(next);
    if (moved) this.append(id, { role: 'system', text: `${next.name} now works in ${moved}. It started a fresh conversation there and kept your open requests and the latest messages.` });
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

  /** When a helper's own conversation record was last written; 0 when unknown. */
  recordAt(pane) { return pane.sessionId ? conversationMtime(pane) : 0; }

  /** Terminals whose program still runs, from the terminal service; null when it cannot be asked. */
  async liveTerminalIds() {
    try {
      const res = await requestDaemon({ type: 'listSessions' }, defaultDaemonSocket());
      if (res?.ok !== true) return null;
      return new Set((res.value?.sessions || []).filter((s) => s.lastExit == null).map((s) => s.id));
    } catch { return null; }
  }

  /**
   * The running terminals as last seen (under a minute old), else null. A turn must claim its bot
   * synchronously (drain is guarded by `running`), so it reads this and starts a refresh for later.
   */
  liveNow() {
    const refresh = () => {
      if (this.live.busy) return;
      this.live.busy = true;
      this.liveTerminalIds().then((ids) => { Object.assign(this.live, { at: this.now(), ids, busy: false }); }, () => { this.live.busy = false; });
    };
    // Kept warm from the first use on, so the next turn reads a fresh list.
    if (!this.live.timer) { this.live.timer = setInterval(refresh, 15_000); this.live.timer.unref?.(); }
    if (this.now() - this.live.at > 15_000) refresh();
    return this.now() - this.live.at < 60_000 ? this.live.ids : null;
  }

  /** `live`: the running terminals; a closed one is left out (it used to be listed by its last word, "working"). */
  terminalDigest(id, live = null) {
    const helpers = this.helpers(id);
    const active = helpers.filter((h) => !h.ended);
    if (!active.length) return '';
    const dir = agentStatusDir();
    const now = this.now();
    const seen = new Set();
    const lines = [];
    for (const h of active) {
      if (seen.has(h.paneId)) continue;
      seen.add(h.paneId);
      if (live && !live.has(h.paneId)) continue;
      let s = null;
      try { s = JSON.parse(fs.readFileSync(path.join(dir, `pane-${fnv(h.paneId)}.json`), 'utf8')); } catch { /* no status file */ }
      const fresh = s && typeof s.updatedAt === 'number' && now - s.updatedAt < 30 * 60_000;
      const activity = fresh ? String(s.now || s.narration || '').replace(/\s+/g, ' ').trim().slice(0, 120) : '';
      const task = String(s?.mainTask || h.task || '').replace(/\s+/g, ' ').trim().slice(0, 150);
      const turn = s?.turn || (fresh && s?.turnEventAt && now - s.turnEventAt < 5 * 60_000 ? 'working' : 'unknown');
      const provider = h.provider || s?.provider || '';
      const name = h.paneId.length > 30 ? h.paneId.slice(9, 21) : h.paneId;
      // "working" is only the agent's last word about itself; a crashed agent never takes it back
      // (2026-10-26: this bot was told a dead Codex was working for 2 hours). Its own record decides.
      const stalled = turn === 'working' ? stalledFor({ turn, updatedAt: s?.updatedAt }, {}, 0, now, this.recordAt({ provider, sessionId: s?.sessionId, cwd: s?.cwd || h.cwd })) : 0;
      if (stalled) { lines.push(`- ${name} (${provider}, STUCK: no progress for ${Math.round(stalled / 60_000)} minutes, the agent has most likely crashed. Close it (termfleet-team close ${h.paneId}) and start a fresh one for its task${task ? `: ${task.slice(0, 100)}` : ''})`); continue; }
      lines.push(`- ${name} (${provider}, ${turn}${activity ? `, now: ${activity}` : ''}${task && task !== activity ? `, task: ${task.slice(0, 100)}` : ''})`);
    }
    if (!lines.length) return '';
    return `[Your terminals right now — use this to answer status questions directly instead of calling termfleet-team list/read:\n${lines.join('\n')}]`;
  }

  /** One tool call the bot's brain made, kept in its action log when it changes something. */
  recordAction(id, use) {
    const bot = this.read(id);
    if (!bot) return null;
    const action = classifyTool(use.name, use.input, bot.cwd);
    if (!action) return null;
    const entry = { at: this.now(), actor: 'bot', ...action, toolUseId: use.id || null };
    appendAction(path.join(this.folder(id), 'actions.jsonl'), entry);
    return entry;
  }

  /**
   * The bot's Activity view (TF-098): what it and the terminal agents it started did,
   * newest first, each with the approval evidence that matches it (an approval-card grant for
   * that call, or a scoped standing rule). Record only; a post, send, delete or spend without
   * such evidence comes back marked unapproved ("approval not recorded", shown in red).
   */
  activity(id, { only = null, receipts = {}, limit = 300 } = {}) {
    const bot = this.read(id);
    if (!bot) return null;
    const helpers = this.helpers(id);
    const out = [];
    for (const a of readActions(path.join(this.folder(id), 'actions.jsonl'))) {
      // Its starts come from the helpers list below, which also says what the terminal was for.
      if (a.kind === 'terminal' && /^Started/.test(a.text) && helpers.some((h) => Math.abs(Number(h.at) - a.at) < 3 * 60 * 1000)) continue;
      out.push({ ...a, who: bot.name, approval: botApproval(a) });
    }
    const seen = new Set();
    helpers.forEach((h, i) => {
      const label = `Terminal ${i + 1}${h.provider ? ` (${providerName(h.provider)})` : ''}`;
      out.push({ at: Number(h.at) || 0, actor: 'bot', kind: 'terminal', text: `Started a terminal agent${h.task ? `: ${String(h.task).replace(/\s+/g, ' ').slice(0, 120)}` : ''}`, who: bot.name, approval: 'not-needed', paneId: h.paneId });
      if (!h.paneId || seen.has(h.paneId)) return;
      seen.add(h.paneId);
      for (const a of readActions(paneLogFile(h.paneId, this.actionsDir))) {
        if (Number(a.at) < Number(h.at) - 60 * 1000) continue;   // before the bot started it
        out.push({ ...a, who: label, approval: paneApproval(a, { receipts, paneId: h.paneId }) });
      }
    });
    out.sort((a, b) => a.at - b.at);
    let list = foldFiles(out).reverse();
    for (const e of list) { e.text = String(e.text || '').replace(/\bterminal-[0-9a-f-]{12,}…?/gi, 'a terminal agent'); e.approvalText = approvalText(e); e.unapproved = Boolean(e.needsApproval) && e.approval === 'none'; }
    const counts = { all: list.length, approval: list.filter((e) => e.needsApproval).length, unapproved: list.filter((e) => e.unapproved).length };
    if (only === 'approval') list = list.filter((e) => e.needsApproval);
    return { bot: { id: bot.id, name: bot.name }, counts, actions: list.slice(0, limit).map(({ toolUseId, mode, asked, file, ...e }) => e) };
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

  /** End this bot's follow of one terminal (it finished the job it was followed for). */
  endFollow(id, paneId) {
    const file = path.join(this.folder(id), 'helpers.json');
    let list;
    try { list = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return 0; }
    const { list: next, count } = endFollows(list, { paneId, followedOnly: true, at: this.now() });
    if (count) fs.writeFileSync(file, JSON.stringify(next, null, 1), { mode: 0o600 });
    return count;
  }

  /** Explicit changes restart the brain without dropping queued work. */
  changeProvider(id, provider) {
    if (!PROVIDERS.includes(provider)) return { ok: false, error: 'Choose Claude or Codex.' };
    const bot = this.read(id);
    if (!bot) return { ok: false, error: 'Bot not found.' };
    if (bot.provider === provider && (bot.active || bot.provider) === provider && !this.running.get(id)?.providerChange) return { ok: true, bot: this.summary(id) };
    const current = this.running.get(id);
    if (current) {
      if (!current.stop) return { ok: false, error: 'The brain is starting. Please try again in a moment.' };
      current.providerChange = provider;
      current.stop();
      return { ok: true, bot: this.summary(id), pending: true };
    }
    bot.provider = provider;
    bot.model = null;
    delete bot.retry;
    delete bot.inflight;
    if (bot.fallback === provider) bot.fallback = PROVIDERS.find(p => p !== provider);
    this.write(bot);
    this.switchTo(id, provider, `Switched to ${providerName(provider)} with a fresh brain conversation.`);
    return { ok: true, bot: this.summary(id) };
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
    this.sides.get(id)?.pending.splice(0);
    try { takeSteer(this.folder(id)); } catch { /* nothing waiting */ }
    this.echoes.delete(id);
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
    const all = this.messages(id);
    const chat = all.slice(-MAX_CHAT_RETURNED);
    // A terminal's card still waiting for Noam is always returned, however busy the chat got since.
    chat.unshift(...all.slice(0, -MAX_CHAT_RETURNED).filter((m) => m.role === 'terminal-ask' && !m.settled));
    const busy = this.running.has(id) || (this.queues.get(id) || []).length > 0 || Boolean(bot.retry);
    return { bot: { ...this.summary(id), rules: bot.rules }, messages: markReceipts(markRepeatedTerminalAsks(markWithdrawnQuestions(markRepeatedQuestions(chat))), { busy }) };
  }

  /** Adds the operator's message and starts (or queues) the bot's turn. */
  send(id, text, { images = [], files = [], owner = false, answerTo = null, replyTo = null, replyMedia = null, listTo = null, choices = null, sendId = null } = {}) {
    const bot = this.read(id);
    if (!bot) return { error: 'That bot no longer exists.' };
    // Each send from the app carries its own id (Noam 2026-10-24: one message with a picture
    // arrived three times after a slow send was resent). A repeat of a saved id returns the
    // saved message: never stored, never handed to the bot again, even after a restart.
    const once = typeof sendId === 'string' && /^[\w-]{8,80}$/.test(sendId) ? sendId : null;
    const saved = once ? this.messages(id).find((m) => m.role === 'operator' && m.sendId === once) : null;
    if (saved) return { ok: true, message: saved, repeated: true };
    // Pictures come from the app's own upload folder only (never any path on the PC).
    const dir = path.resolve(this.picturesDir || uploadDir());
    const pictures = (Array.isArray(images) ? images : []).slice(0, 10).map((p) => path.resolve(String(p)))
      .filter((p) => p.startsWith(dir + path.sep) && fs.existsSync(p));
    if ((images || []).length && pictures.length !== Math.min(images.length, 10)) return { error: 'A picture could not be found. Attach it again.' };
    // Other files (dragged or attached): same folder rule, kept under their own names.
    const attached = (Array.isArray(files) ? files : []).slice(0, 10).map((p) => path.resolve(String(p)))
      .filter((p) => p.startsWith(dir + path.sep) && fs.existsSync(p));
    if ((files || []).length && attached.length !== Math.min(files.length, 10)) return { error: 'A file could not be found. Attach it again.' };
    const body = clean(text, LIMITS.message) || (pictures.length ? (pictures.length === 1 ? 'Here is a picture.' : 'Here are some pictures.') : '') || (attached.length ? (attached.length === 1 ? 'Here is a file.' : 'Here are some files.') : '');
    if (!body) return { error: 'Nothing to send.' };
    // An answer typed or tapped on one of the bot's question cards stays tied to that card
    // (Noam 2026-10-21: "זה לא מאפשר לי לכתוב את התשובה שלי"), even when it is no longer the newest.
    const asked = answerTo ? this.messages(id).find((m) => m.id === String(answerTo) && m.role === 'bot' && m.question) : null;
    // A reply to one message of THIS chat, picked from its menu (Noam 2026-10-21: "אני צריך להיות
    // מסוגל להגיב להודעה הזו מכאן"). Only this bot gets it; the quote is context, never a new
    // request or approval, and a bot named inside it is not contacted.
    let replied = null;
    if (replyTo) {
      // A reply can be to one picture or video the message showed (Noam 2026-10-24: "צריך להיות
      // מסוגל להגיב על תמונה"); such a message may have no text of its own.
      const pic = replyMedia ? String(replyMedia) : null;
      const target = this.messages(id).find((m) => m.id === String(replyTo) && ['operator', 'bot'].includes(m.role) && (m.text || m.question || m.checklist || (pic && (m.media || []).length)));
      if (!target) return { error: 'The message you are replying to is no longer in this chat. Your reply was not sent.' };
      const media = pic ? (target.media || []).find((x) => x.href === pic) : null;
      if (pic && !media) return { error: 'That picture is no longer in this chat. Your reply was not sent.' };
      // A checklist or question card keeps its words in the card itself (Noam 2026-10-24: "צריך להיות מסוגל להגיב גם על אלמנט כזה").
      const said = String(target.text || (target.checklist ? `List: ${target.checklist.title || ''}` : '') || (target.question ? `Question: ${target.question.text || ''}` : ''));
      replied = { id: target.id, role: target.role, text: said.length > 300 ? `${said.slice(0, 299)}…` : said, ...(media ? { media: { kind: media.kind, href: media.href, name: media.name } } : {}) };
    }
    // His choices on one of the bot's lists ([checklist]): tied to that list, which then
    // locks; a second send on the same list is refused (one answer per list).
    let list = null;
    if (listTo) {
      const chat = this.messages(id);
      list = chat.find((m) => m.id === String(listTo) && m.role === 'bot' && m.checklist);
      if (!list) return { error: 'That list is no longer in this chat. Your choices were not sent.' };
      if (chat.some((m) => m.role === 'operator' && m.listTo === list.id)) return { error: 'You already sent your choices on this list.' };
    }
    // The ticks and notes he sent, kept with his message so the locked card shows them on any device.
    const n = list?.checklist.rows.length || 0;
    const listChoices = list && choices && Array.isArray(choices.checked) ? {
      checked: Array.from({ length: n }, (_, i) => Boolean(choices.checked[i])),
      notes: Array.from({ length: n }, (_, i) => clean(String(choices.notes?.[i] || ''), 300)),
      note: clean(String(choices.note || ''), 1000),
    } : null;
    const said0 = listChoices ? checklistAnswer(list.checklist, listChoices) : body;
    const msg = this.append(id, { role: 'operator', text: said0, ...(once ? { sendId: once } : {}), ...(pictures.length ? { images: pictures.length } : {}), ...(attached.length ? { files: attached.map((p) => path.basename(p)) } : {}), ...(asked ? { answerTo: asked.id } : {}), ...(replied ? { replyTo: replied } : {}), ...(list ? { listTo: list.id } : {}), ...(listChoices ? { listChoices } : {}) });
    // Typed by Noam in the app (not a routine, an event or another agent): keep a signed
    // copy so the bot can pass his exact words on and the receiver can check them.
    if (owner) { try { recordOwnerWords({ id: msg.id, at: msg.at, botId: id, bot: bot.name, text: said0 }, this.ownerWordsBase ? { base: this.ownerWordsBase } : {}); } catch { /* the message itself is saved */ } }
    // TF-102: his message, split into items (R-n) the bot cannot end its turn without taking.
    const items = owner ? this.captureRequirements(id, bot, msg, said0) : [];
    const said = skillPrompt(said0) || said0;   // "/grill-me" etc. carry the skill's steps
    const quoted = replied?.media ? `[Noam is replying to ${replied.role === 'bot' ? 'your' : 'his own'} ${replied.media.kind === 'video' ? 'video' : 'picture'} "${replied.media.name}" (${replied.media.href}) from message ${replied.id} in this chat. His words below are about that ${replied.media.kind === 'video' ? 'video' : 'picture'}; the quote is context only, not a new request or approval.${replied.text ? `\nThat message said: "${replied.text}"` : ''}]\n`
      : replied ? `[Noam is replying to ${replied.role === 'bot' ? 'your' : 'his own'} earlier message in this chat (message ${replied.id}), quoted as context only, not as a new request or approval:\n"${replied.text}"]\n` : '';
    const answered = quoted + (asked ? `[Noam's answer to your question "${asked.question.text}"]\n${said}` : said);
    let forBrain = pictures.length ? `${answered}\n\n[Noam attached ${pictures.length} picture${pictures.length === 1 ? '' : 's'}. Look at each one before answering (open the file to see it): ${pictures.join(' , ')}]` : answered;
    if (attached.length) forBrain += `\n\n[Noam attached ${attached.length} file${attached.length === 1 ? '' : 's'}. Read each one before answering (open the file): ${attached.join(' , ')}]`;
    forBrain = this.withTags(id, bot, msg, body, forBrain, { owner, pictures });
    this.handed.set(msg.id, { bot: id, brain: forBrain, items: (items || []).map((it) => it?.id).filter(Boolean) });
    if (this.handed.size > 300) this.handed.delete(this.handed.keys().next().value);
    if (owner) this.append(id, { role: 'activity', text: 'קיבלתי, עובד על זה...' });
    if (owner) {
      // A lasting rule he states is kept in this bot's standing rules now, and he sees that once.
      try {
        const added = withRules(bot.rules, statedRules(said0));
        if (added && !this.update(id, { rules: added.rules }).error) this.append(id, { role: 'note', text: `Saved as a rule: ${added.added.join(' · ').slice(0, 300)}` });
      } catch { /* the message itself is already on its way */ }
    }
    if (owner && this.side && this.running.has(id)) {
      this.sideAnswer(id, { at: msg.at, msgId: msg.id, text: said0, pictures, brain: forBrain, items: (items || []).map((it) => it?.id).filter(Boolean) });
      return { ok: true, message: msg, queued: true, side: true };
    }
    const queue = this.queues.get(id) || [];
    queue.push(forBrain);
    this.queues.set(id, queue);
    if (this.running.has(id)) this.waitedFor.set(id, [...(this.waitedFor.get(id) || []), { msgId: msg.id, items: (items || []).map((it) => it?.id).filter(Boolean) }]);
    if (!this.running.has(id)) this.drain(id);
    return { ok: true, message: msg, queued: this.running.has(id) && queue.length > 0 };
  }

  /**
   * Noam deletes one of his own messages (Noam 2026-10-25: "צריך שתהיה אפשרות לעצור הודעה
   * מוסימת אם בטעות מקלידים טעות"). Still waiting in line: it is pulled out, so the bot never
   * sees it. Already handed to the bot: the turn finishes as it is. Either way the chat keeps
   * only a "deleted" mark in its place, never the words.
   */
  retract(id, msgId) {
    if (!this.read(id)) return { error: 'That bot no longer exists.' };
    const key = String(msgId || '');
    const chat = this.messages(id);
    const at = chat.findIndex((m) => m.id === key);
    const msg = chat[at];
    if (!msg || msg.role !== 'operator') return { error: 'That message is not one of yours in this chat.' };
    if (msg.deleted) return { ok: true, message: msg, cancelled: Boolean(msg.deleted.cancelled), repeated: true };
    const cancelled = this.unqueue(id, key);
    this.retracted.add(key);
    const gone = { id: msg.id, at: msg.at, role: 'operator', ...(msg.sendId ? { sendId: msg.sendId } : {}), deleted: { at: this.now(), cancelled } };
    const file = path.join(this.folder(id), 'chat.jsonl');
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    const line = lines.findIndex((l) => { try { return JSON.parse(l).id === key; } catch { return false; } });
    if (line < 0) return { error: 'That message is no longer in this chat.' };
    lines[line] = JSON.stringify(gone);
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, lines.join('\n'), { mode: 0o600 });
    fs.renameSync(tmp, file);
    // The bot never saw it: the items it carried are dropped, so no one is held to them.
    const items = cancelled ? this.handed.get(key)?.items || [] : [];
    this.handed.delete(key);
    for (const rid of items) {
      try { const r = markRequirement({ status: 'dropped', id: rid, note: 'Noam deleted this message before the bot saw it.', by: 'message-delete' }, { dir: this.reqDir() }); if (r?.events) recordRequirements(r.events, { dir: this.reqDir() }); } catch { /* the message itself is gone */ }
    }
    return { ok: true, message: gone, cancelled };
  }

  /** Pulls his message out of every place it waits before reaching the bot. True when it was still waiting. */
  unqueue(id, msgId) {
    const brain = this.handed.get(msgId)?.brain;
    const queue = this.queues.get(id) || [];
    const i = brain == null ? -1 : queue.lastIndexOf(brain);
    if (i >= 0) {
      queue.splice(i, 1);
      this.waitedFor.set(id, (this.waitedFor.get(id) || []).filter((w) => w.msgId !== msgId));
      return true;
    }
    const side = this.sides.get(id);
    const j = side ? side.pending.findIndex((e) => e.msgId === msgId) : -1;
    if (j >= 0) { side.pending.splice(j, 1); return true; }
    // Being read by the quick side responder right now: it is never answered or passed on to the bot (see sideLoop).
    if (side?.inflight?.some((e) => e.msgId === msgId)) return true;
    try {
      const dir = steerDir(this.folder(id));
      for (const name of fs.readdirSync(dir).filter((n) => n.endsWith(`-${String(msgId).replace(/[^\w-]/g, '')}.json`) && !n.startsWith('.'))) {
        try { fs.unlinkSync(path.join(dir, name)); return true; } catch { /* the running turn just took it */ }
      }
    } catch { /* no steer inbox */ }
    const bot = this.read(id);
    if (brain != null && bot?.queued?.includes(brain)) {
      bot.queued.splice(bot.queued.lastIndexOf(brain), 1);
      this.write(bot);
      return true;
    }
    return false;
  }

  /**
   * @-tags in a message Noam typed to a bot: each tagged bot gets the message too and its
   * answer shows in this chat. Only his own typed messages tag; routines, events and bot
   * answers never bring a bot in (Noam: "אבל סתם ככה זה יוצר כאוס"). Also hands this bot
   * what tagged bots answered here since it last heard from him.
   */
  withTags(id, bot, msg, body, forBrain, { owner = false, pictures = [] } = {}) {
    let out = forBrain;
    const tagged = owner ? mentionedBots(body, this.list().filter((b) => b.id !== id)) : [];
    if (tagged.length) {
      const context = this.recentLines(this.messages(id).filter((m) => m.id !== msg.id), bot.name);
      for (const other of tagged) this.ask(other.id, { text: body, origin: { kind: 'bot', id, name: bot.name }, context, pictures });
      const one = tagged.length === 1;
      out += `\n\n[Noam also tagged ${tagged.map((b) => b.name).join(', ')} in this message. ${one ? 'It answers for itself' : 'They answer for themselves'} here in this chat; do not do ${one ? 'its' : 'their'} part or message ${one ? 'it' : 'them'}.]`;
    }
    const fresh = this.read(id);
    if (fresh?.guestNotes?.length) {
      out = `[Since your last message, bots Noam tagged answered in this chat:\n${fresh.guestNotes.map((n) => `- ${n.name}: ${n.text}`).join('\n')}]\n\n${out}`;
      delete fresh.guestNotes;
      this.write(fresh);
    }
    return out;
  }

  /** The last few lines of a chat, word for word, for a bot that was just tagged into it. */
  recentLines(chat, hostName = null, limit = 8) {
    return chat.filter((m) => m.role === 'operator' || m.role === 'bot').slice(-limit)
      .map((m) => `${m.role === 'operator' ? 'Noam' : m.guest?.name || hostName || 'Bot'}: ${String(m.text || '').replace(/\s+/g, ' ').slice(0, 600)}`).join('\n');
  }

  /**
   * Noam tagged this bot in another bot's chat or in a group. The message lands in its own
   * chat too (marked where it came from), is recorded as his own words so approvals in it
   * count, and the bot's next answer is also posted back where he tagged it.
   */
  /** Noam's bot message into the requirements ledger, keyed by his real message id. */
  // A Bots made for a test (its own folder) keeps its ledger there, never in Noam's real one.
  reqDir() {
    return this.requirementsDir || (this.ownerWordsBase ? path.join(this.ownerWordsBase, 'requirements')
      : this.dir && path.resolve(this.dir) !== path.resolve(defaultDir()) ? path.join(this.dir, 'requirements') : requirementsLedgerDir());
  }

  captureRequirements(id, bot, msg, text) {
    try {
      const dir = Bots.prototype.reqDir.call(this);   // also called on a plain object by tests
      const project = bot.project || (path.dirname(bot.cwd || '') === path.resolve(BOTS_HOME()) ? String(bot.name || id).toLowerCase() : requirementsProject(bot.cwd));
      return captureRequirements({ text, msgId: msg.id, at: msg.at, project, source: `bot:${id}` }, { dir });
    } catch { return []; }
  }

  ask(id, { text, origin, context = '', pictures = [] } = {}) {
    const bot = this.read(id);
    if (!bot || !origin?.id) return null;
    const msg = this.append(id, { role: 'operator', text, from: { kind: origin.kind, id: origin.id, name: origin.name }, ...(pictures.length ? { images: pictures.length } : {}) });
    try { recordOwnerWords({ id: msg.id, at: msg.at, botId: id, bot: bot.name, text }, this.ownerWordsBase ? { base: this.ownerWordsBase } : {}); } catch { /* the message itself is saved */ }
    this.captureRequirements(id, bot, msg, text);
    const where = origin.kind === 'group' ? `the group chat "${origin.name}"` : `his chat with the bot "${origin.name}"`;
    const brain = [
      `[Noam tagged you (@${bot.name}) in ${where}. He typed this himself: treat it as his own message to you, approvals included. Your answer is shown there under your name and here in your own chat. Answer only your part. Never message other bots or that chat yourself; if another bot should help, tell Noam to tag it.]`,
      context ? `The latest messages there, word for word:\n${context}` : '',
      `Noam's message:\n${skillPrompt(text) || text}`,
      pictures.length ? `[Noam attached ${pictures.length} picture${pictures.length === 1 ? '' : 's'}. Look at each one before answering (open the file to see it): ${pictures.join(' , ')}]` : '',
    ].filter(Boolean).join('\n\n');
    const queue = this.queues.get(id) || [];
    queue.push(brain);
    this.queues.set(id, queue);
    const echo = this.echoes.get(id) || new Set();
    echo.add(`${origin.kind}:${origin.id}`);
    this.echoes.set(id, echo);
    if (!this.running.has(id)) this.drain(id);
    return msg;
  }

  /** Noam writes in a group: only the bots he tags (or @all) answer; untagged, nobody does. */
  sendGroup(groupId, text) {
    const group = this.groups.read(groupId);
    if (!group) return { error: 'That group no longer exists.' };
    const body = clean(text, LIMITS.message);
    if (!body) return { error: 'Nothing to send.' };
    const members = group.members.map((m) => this.read(m)).filter(Boolean);
    const tagged = TAGS_EVERYONE(body) ? members : mentionedBots(body, members);
    const before = this.groups.messages(groupId);
    const msg = this.groups.append(groupId, { role: 'operator', text: body, tagged: tagged.map((b) => b.id) });
    const context = this.recentLines(before);
    for (const b of tagged) this.ask(b.id, { text: body, origin: { kind: 'group', id: groupId, name: group.name }, context });
    return { ok: true, message: msg, tagged: tagged.map((b) => ({ id: b.id, name: b.name })) };
  }

  groupView(groupId) {
    const group = this.groups.read(groupId);
    if (!group) return null;
    const members = group.members.map((m) => this.summary(m)).filter(Boolean)
      .map((b) => ({ id: b.id, name: b.name, state: b.state, activity: b.activity, answering: this.echoes.get(b.id)?.has(`group:${groupId}`) || this.running.get(b.id)?.echo?.includes(`group:${groupId}`) || false }));
    return { group: { id: group.id, name: group.name, members }, messages: this.groups.messages(groupId).slice(-MAX_CHAT_RETURNED) };
  }

  /** A tagged bot's answer, posted back in the chat or group where Noam tagged it. */
  postEcho(id, targets, entry) {
    const bot = this.read(id);
    if (!bot) return;
    for (const target of targets) {
      const [kind, where] = target.split(':');
      const posted = { ...entry, guest: { id, name: bot.name } };
      if (kind === 'group') { this.groups.append(where, posted); continue; }
      const host = this.read(where);
      if (!host) continue;
      this.append(where, posted);
      host.guestNotes = [...(host.guestNotes || []), { name: bot.name, text: String(entry.text || '').replace(/\s+/g, ' ').slice(0, 1200) }].slice(-6);
      this.write(host);
    }
  }

  async drain(id) {
    while ((this.queues.get(id) || []).length) {
      if (this.closing) { this.saveQueue(id); return; }
      const texts = this.queues.get(id).splice(0);
      // His messages that waited behind a turn which replied after they arrived (Noam 2026-10-24:
      // "אין שום סיבה לחזרה הזו"): the bot is shown that reply and must not say it again.
      // Only when that turn already took every one of his items in them (the reminder showed it his words).
      const waited = (this.waitedFor.get(id) || []).splice(0);
      let since = null;
      if (waited.length && waited.every((w) => w.items.length)) {
        let ledger = null;
        try { ledger = loadRequirements({ dir: this.reqDir() }).items; } catch { ledger = null; }
        const taken = ledger && waited.every((w) => w.items.every((n) => ledger.get(n) && ledger.get(n).status !== 'new'));
        const chat = taken ? this.messages(id) : [];
        const ids = new Set(waited.map((w) => w.msgId));
        const lastWaited = chat.findLastIndex((m) => ids.has(m.id));
        since = lastWaited >= 0 ? chat.slice(lastWaited + 1).filter((m) => m.role === 'bot' && !m.side && m.text).pop() || null : null;
      }
      // Messages that arrived while the bot was busy go in together, oldest first.
      const digest = this.terminalDigest(id, this.liveNow());
      const text = this.withSideNotes(id, (digest ? `${digest}\n\n` : '') + (since ? `${alreadyAnsweredNote(since.text)}\n\n` : '') + (texts.length === 1 ? texts[0] : texts.map((t, i) => `(${i + 1}) ${t}`).join('\n\n')));
      const echo = [...(this.echoes.get(id) || [])];
      this.echoes.delete(id);
      this.running.set(id, { activity: 'Thinking', startedAt: this.now(), echo, task: texts.join('\n\n'), steps: [], said: [] });
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
      const requestedProvider = this.running.get(id)?.providerChange;
      if (requestedProvider) {
        this.queueLeftSteer(id);
        this.running.delete(id);
        this.changeProvider(id, requestedProvider);
        this.queues.get(id).unshift(...texts);
        continue;
      }
      let bot = this.read(id);
      if (!bot) { this.running.delete(id); return; }
      delete bot.inflight;
      this.write(bot);
      if (bot && !result.error) {
        if ((bot.active || bot.provider) === 'claude') bot.sessions.claude = { ...bot.sessions.claude, started: true };
        else if (bot.sessions?.codex) bot.codexBrief = { session: bot.sessions.codex, stamp: briefStamp(bot) };
        delete bot.handover;   // the new conversation has it now
        this.write(bot);
      }
      // A [question] block becomes a card the chat can answer with one tap.
      // A [checklist] block becomes a list he can tick, note and send back.
      const asked = result.error ? null : parseQuestion(result.text || '');
      const listed = asked ? parseChecklist(asked.text) : null;
      if (listed) asked.text = listed.text;
      // "Nothing new" about messages it already answered: no second reply.
      const nothingNew = Boolean(asked && !asked.question && !listed?.checklist && new RegExp(`^\\W*${NOTHING_NEW}\\W*$`).test(asked.text || ''));
      if (asked) asked.text = String(asked.text || '').replace(new RegExp(`\\s*\\b${NOTHING_NEW}\\b\\s*`, 'g'), ' ').trim();
      // A card asking him to choose between looks/designs/pages with no link (Noam 2026-10-24:
      // "שתמיד יהיה לינק עם אופציות"): held back once, and the bot adds the link first.
      let held = false;
      if (bot && asked?.question) {
        const fresh = this.read(id);
        const again = fresh?.heldQuestion && sameQuestion(fresh.heldQuestion, asked.question);
        if (fresh && needsLink(asked.question) && !again) {
          fresh.heldQuestion = { text: asked.question.text, options: asked.question.options };
          this.write(fresh);
          const queue = this.queues.get(id) || [];
          queue.unshift(heldCardNote(asked.question));
          this.queues.set(id, queue);
          asked.question = null;
          held = true;
        } else if (fresh?.heldQuestion) { delete fresh.heldQuestion; this.write(fresh); }
      }
      // Providers that do not run Stop hooks still cannot publish an unchecked fix report.
      if (asked && !result.error && !result.stopped) {
        const since = this.running.get(id)?.startedAt || this.now() - 30 * 60_000;
        const markedReady = readyThisTurn([...loadRequirements({ dir: this.reqDir() }).items.values()], id, since).length > 0;
        const problem = testingHandoffProblem(asked.text, { botId: id, since, markedReady });
        if (problem) {
          const fresh = this.read(id);
          const attempts = (fresh.heldTestingHandoff || 0) + 1;
          fresh.heldTestingHandoff = attempts;
          this.write(fresh);
          if (attempts <= 2) {
            this.queues.get(id).unshift(`[Testing handoff blocked] ${problem} Correct the reply now. The unchecked report was not shown to Noam.`);
          } else {
            this.append(id, { role: 'error', text: 'The testing report is held because its link or testing instructions could not be verified. The work remains open.' });
          }
          this.queueLeftSteer(id);
          this.running.delete(id);
          continue;
        }
        saveTestingHandoff(asked.text, id, since, { dir: this.reqDir() });
        const fresh = this.read(id);
        if (fresh.heldTestingHandoff) { delete fresh.heldTestingHandoff; this.write(fresh); }
      }
      // The same reply twice in a row (no message from him in between) is kept but not shown.
      let duplicate = false;
      if (bot && asked && !asked.question && !listed?.checklist && asked.text && !findMedia(asked.text).media.length) {
        const chat = this.messages(id);
        for (let k = chat.length - 1; k >= 0; k--) {
          const e = chat[k];
          if (e.role === 'operator') break;
          if (e.role === 'bot' && e.text && !e.side && !e.duplicate) { duplicate = nearDuplicate(e.text, asked.text); break; }
        }
      }
      // Pictures, GIFs and videos it made show right in the chat (Noam 2026-10-24).
      const shown = asked && !result.error ? findMedia(asked.text) : { media: [] };
      if (shown.media.length) asked.text = shown.text;
      const silent = !result.error && !result.stopped && !shown.media.length && (nothingNew || (held && !asked.text));
      const answered = this.running.get(id)?.startedAt;
      if (bot && result.stopped) this.append(id, { role: 'note', text: 'You stopped this reply. Ask again any time.', answered: answered || Date.now() });
      else if (bot && !silent) this.append(id, result.error ? { role: 'error', text: result.error, ...(answered ? { answered } : {}) } : { role: 'bot', ...(answered ? { answered } : {}), text: asked.text || (asked.question || listed.checklist || shown.media.length ? '' : 'This turn ended without a written reply.'), ...(asked.question ? { question: asked.question } : {}), ...(listed.checklist ? { checklist: listed.checklist } : {}), ...(shown.media.length ? { media: shown.media } : {}), ...(duplicate ? { duplicate: true } : {}) });
       // Guard: check for hollow messages and poor structure
       if (bot && !silent && !result.error && asked.text) {
         const msg = asked.text;
         const hollow = messageProblem(msg);
         if (hollow) {
           console.error(`[${bot.name}] Hollow message: ${hollow}`);
         }
         const structure = structureProblem(msg);
         if (structure) {
           console.error(`[${bot.name}] Message structure issue: ${structure}`);
         }
         // Told Noam it would hand this to an agent, and did not (10 of 20 such promises in a week).
         const promise = brokenHandoff(msg, this.messages(id), answered || 0);
         if (promise && this.now() - (this.handoffNudged.get(id) || 0) > 10 * 60_000) {
           this.handoffNudged.set(id, this.now());
           this.wake(id, `You just told Noam "${promise}", but no terminal got that work in this turn. Hand it over now (termfleet-team start or send), or tell him plainly that you will not.`);
         }
         const claim = unprovenClaim(msg, { media: shown.media.length });
         if (claim && this.now() - (this.claimNudged.get(id) || 0) > 10 * 60_000) {
           this.claimNudged.set(id, this.now());
           console.error(`[${bot.name}] Unproven claim: ${claim}`);
           this.wake(id, `You just told Noam "${claim}". Did you see it working where he uses it, after any install or restart (his app, his phone, his screen)? If yes, send him a screenshot of it working now. If not, tell him plainly that it is built but not checked yet, and check it.`);
         }
       }
      // Tagged elsewhere: the same answer also shows there, under this bot's name.
      if (bot && echo.length && !result.stopped && !silent && !duplicate) {
        this.postEcho(id, echo, result.error ? { role: 'error', text: result.error } : { role: 'bot', text: [asked.text, asked.question ? [asked.question.text, asked.question.link && /^https?:/.test(asked.question.link) ? `Open to compare: ${asked.question.link}` : ''].filter(Boolean).join('\n') : '', listed?.checklist ? `${listed.checklist.title || 'A list for you'} (tick it in my own chat):\n${listed.checklist.rows.map((r) => `- ${r.label}`).join('\n')}` : ''].filter(Boolean).join('\n\n') || 'Done, with nothing to add.' });
      }
      const [echoKind, echoAt] = (echo[0] || '').split(':');
      if (bot && bot.notify !== false && !result.stopped && !silent && !duplicate) {
        try { this.notify({ title: result.error ? `${bot.name} could not answer` : bot.name, body: String(result.error || (asked?.question ? asked.question.text : listed?.checklist ? `${listed.checklist.title || 'A list for you'} (${listed.checklist.rows.length} rows to tick)` : result.text) || '').replace(/\s+/g, ' ').slice(0, 200), url: echoAt ? `/#${echoKind}:${echoAt}` : `/#bot:${id}` }); } catch { /* never block a bot on a notification */ }
      }
      // Mid-turn messages the turn ended before taking: they start the next turn (R-7173).
      this.queueLeftSteer(id);
      this.running.delete(id);
    }
  }

  /**
   * Noam wrote while the bot is busy (R-7173): a quick side responder answers within seconds,
   * beside the running turn. Messages that arrive while it is answering are taken together next.
   */
  sideAnswer(id, entry) {
    const state = this.sides.get(id) || { busy: false, pending: [] };
    state.pending.push(entry);
    this.sides.set(id, state);
    if (!state.busy) this.sideLoop(id);
  }

  async sideLoop(id) {
    const state = this.sides.get(id);
    if (!state || state.busy) return;
    state.busy = true;
    try {
      while (state.pending.length) {
        let batch = state.pending.splice(0);
        state.inflight = batch;
        const bot = this.read(id);
        if (!bot) return;
        const current = this.running.get(id);
        // The turn ended before the side answer started: the normal next turn answers it.
        if (!current) { for (const e of batch) this.handOn(id, e, null); continue; }
        const provider = bot.active || bot.provider;
        const runner = { ...bot, provider, model: provider === bot.provider ? (bot.model || null) : null };
        const chat = this.messages(id).filter((m) => (m.role === 'operator' || m.role === 'bot') && m.text && !batch.some((e) => e.msgId === m.id)).slice(-10)
          .map((m) => ({ who: m.role === 'operator' ? 'Noam' : m.guest?.name || bot.name, text: m.text }));
        const openWork = this.openWork(id);
        let terminals = '';
        try { terminals = this.terminalDigest(id, this.liveNow()); } catch { terminals = ''; }
        const copy = provider === 'claude' && process.env.TC_SIDE_FORK !== '0' && bot.sessions?.claude?.started && bot.sessions.claude.id
          ? { session: bot.sessions.claude.id, addDirs: [uploadDir()] } : {};
        const prompt = sidePrompt({ bot, task: current.task, startedAt: current.startedAt, steps: current.steps || [], said: current.said || [], chat, incoming: batch.map((e) => (e.pictures?.length ? `${e.text}\n[Noam attached ${e.pictures.length} picture${e.pictures.length === 1 ? '' : 's'}. Open each one before answering: ${e.pictures.join(' , ')}]` : e.text)), openWork, terminals, forked: Boolean(copy.session), now: this.now() });
        const cwd = path.join(this.folder(id), 'side');
        try { fs.mkdirSync(cwd, { recursive: true, mode: 0o700 }); } catch { /* the folder is there */ }
        const t0 = this.now();
        let res;
        // Claude bots answer from a forked copy of their own conversation (2026-10-26: the note-only
        // responder said "I don't know" in 296 of 446 quick replies). Off: TC_SIDE_FORK=0.
        try { res = this.available(provider) ? await this.side(runner, prompt, { bins: this.bins, cwd, ...copy, images: batch.flatMap((e) => e.pictures || []) }) : { error: 'plan limited' }; } catch (e) { res = { error: String(e?.message || e) }; }
        const ms = this.now() - t0;
        const parsed = res?.text ? parseSide(res.text) : null;
        if (!parsed?.reply) {
          // No quick answer: the message still reaches the bot exactly as before, just sooner.
          console.error(`[bots] side answer for ${bot.name} failed after ${ms} ms: ${res?.error || 'empty'}`);
          for (const e of batch) this.handOn(id, e, null);
          continue;
        }
        if (!this.read(id)) return;   // removed meanwhile
        // He deleted a message while the quick answer was being written: no answer to it, nothing passed on.
        batch = batch.filter((e) => !this.retracted.has(e.msgId));
        if (!batch.length) continue;
        const reply = withPassedOn(parsed.reply, parsed.forward, batch.map((e) => e.text));
        if (testingHandoffProblem(reply, { botId: id, since: t0 })) {
          for (const e of batch) this.handOn(id, e, null);
          continue;
        }
        this.append(id, { role: 'bot', text: reply, side: { ms, forward: parsed.forward, to: batch.map((e) => e.msgId) } });
        if (bot.notify !== false) { try { this.notify({ title: bot.name, body: reply.replace(/\s+/g, ' ').slice(0, 200), url: `/#bot:${id}` }); } catch { /* never block on a notification */ } }
        if (parsed.forward) { for (const e of batch) this.handOn(id, e, reply); continue; }
        // Only questions: answered. The bot hears about it at the start of its next turn.
        for (const e of batch) this.markAnswered(e.items, reply);
        const fresh = this.read(id);
        if (fresh) {
          fresh.sideNotes = [...(fresh.sideNotes || []), ...batch.map((e) => ({ at: e.at, text: String(e.text).slice(0, 1500), reply: reply.slice(0, 800) }))].slice(-6);
          this.write(fresh);
        }
      }
    } finally { state.busy = false; state.inflight = []; }
  }

  /** A mid-turn message goes on to the bot: into the running turn if there is one, else as its next turn. */
  handOn(id, entry, reply) {
    if (this.retracted.has(entry.msgId)) return;   // he deleted it while the quick answer ran
    if (this.running.has(id)) { putSteer(this.folder(id), { at: entry.at, msgId: entry.msgId, text: entry.text, brain: entry.brain, reply }); return; }
    const queue = this.queues.get(id) || [];
    queue.push(...nextTurnText([{ ...entry, reply }]));
    this.queues.set(id, queue);
    this.drain(id);
  }

  /** At the end of a turn, steer messages it never took are queued as the next turn. */
  queueLeftSteer(id) {
    let left = [];
    try { left = takeSteer(this.folder(id)); } catch { left = []; }
    if (!left.length) return;
    const queue = this.queues.get(id) || [];
    queue.push(...nextTurnText(left));
    this.queues.set(id, queue);
  }

  /** Questions the side responder answered, put in front of the bot's next turn so its memory stays whole. */
  withSideNotes(id, text) {
    const bot = this.read(id);
    if (!bot?.sideNotes?.length) return text;
    const notes = bot.sideNotes;
    delete bot.sideNotes;
    this.write(bot);
    return `[While you were busy, Noam asked and your quick side responder answered in the chat. Already answered: do not repeat these answers.\n${notes.map((n) => `- Noam: "${n.text}"\n  Answered: "${n.reply}"`).join('\n')}]\n\n${text}`;
  }

  /** His items the side answer took care of (a question answered), so the bot is not held to them again. */
  markAnswered(ids = [], reply) {
    if (!ids.length) return;
    const dir = this.reqDir();
    for (const rid of ids) {
      try { const r = markRequirement({ status: 'answered', id: rid, note: `Answered right away while busy: ${reply.slice(0, 400)}`, by: 'side-reply' }, { dir }); if (r?.events) recordRequirements(r.events, { dir }); } catch { /* the answer itself is in the chat */ }
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

  /** Noam's requests this bot owns that are not finished, newest first (what its header counts as open). */
  openWork(id) {
    try {
      return [...loadRequirements({ dir: this.reqDir() }).items.values()]
        .filter((item) => item.source === `bot:${id}` && !item.locked && !['done', 'ready', 'answered', 'context', 'dropped'].includes(item.status))
        .sort((a, b) => Number(b.at || 0) - Number(a.at || 0))
        .map((item) => ({ id: item.id, status: item.status, words: item.words, where: item.assigned?.at(-1)?.pane || null }));
    } catch { return []; }
  }

  /** One brain turn on whichever plan the bot is on now. */
  async turn(id, text) {
    let bot = this.read(id);
    if (!bot) return { error: 'That bot no longer exists.' };
    // Noam 2026-10-26: the header showed 8 open tasks the bot never worked on and could not name.
    // Every turn now carries the open list, so the orchestrator owns it instead of only the newest message.
    const open = this.openWork(id);
    if (open.length) {
      const shown = open.slice(0, 15).map((w) => `- ${w.id} [${w.status}] ${String(w.words || '').replace(/\s+/g, ' ').slice(0, 180)}${w.where ? ` (handed to ${w.where})` : ''}`).join('\n');
      text = `${text}\n\n[Your open requests from Noam: ${open.length}${open.length > 15 ? ' (newest 15 shown; `termfleet-asks items` lists all)' : ''}. You own every one. Before ending this turn, each must be moving: handed to a working terminal, finished and marked, asked about, or marked dropped/context if it is not a task. Never tell Noam you do not know what is open.\n${shown}]`;
    }
    const extras = { card: this.memory(id).card(), handover: bot.handover || freshStartHandover(bot, this.messages(id), text) };
    // The chosen model belongs to the main plan; on the backup plan it uses that plan's default.
    const runner = { ...bot, provider: bot.active || bot.provider, model: (bot.active || bot.provider) === bot.provider ? (bot.model || null) : null, ...(this.side ? { steerFolder: this.folder(id) } : {}) };
    return this.run(runner, text, {
        bins: this.bins,
        extras,
        logPath: path.join(this.folder(id), 'last-run.log'),
        onStart: (stop) => { const current = this.running.get(id); if (current) current.stop = stop; },
        onEvent: (ev) => {
          if (ev.action) { try { this.recordAction(id, ev.action); } catch { /* the log never stops a reply */ } return; }
          if (ev.step) { const current = this.running.get(id); if (current?.steps) { current.steps.push({ at: this.now(), text: stepLine(ev.step) }); if (current.steps.length > 60) current.steps.splice(0, current.steps.length - 60); } return; }
          if (ev.said) { const current = this.running.get(id); if (current?.said) { current.said.push(ev.said); if (current.said.length > 6) current.said.shift(); } }
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
