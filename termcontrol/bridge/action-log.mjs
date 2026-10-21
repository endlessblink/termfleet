import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Per-bot action log (TF-098, idea from CopilotKit OpenBot's action gateway: every action
 * is recorded after it happens, with what started it). Record only in this version: nothing
 * is blocked. Each consequential action a bot or one of the terminal agents it started takes
 * becomes one plain line with who approved it. A post, send, delete or spend with no
 * recorded approval is flagged so the app can show it in red.
 *
 * Storage is plain files on this PC, no database:
 *   <config>/bots/<id>/actions.jsonl          what the bot's own brain did
 *   <config>/actions/<pane>.jsonl             what a terminal agent did (written by a hook)
 * A bot's Activity view joins its own file with the files of the terminals it started.
 */

export const NEEDS_APPROVAL = new Set(['post', 'send', 'delete', 'spend']);
export const APPROVAL_LABEL = {
  'noam-chat': 'Noam, in chat',
  'approval-card': 'Noam, on the approval card',
  'noam-prompt': 'Noam, at the prompt',
  'standing-rule': 'A standing rule',
  'not-needed': 'No approval needed',
  none: 'No approval recorded',
};
const MAX_BYTES = 512 * 1024;

const configDir = () => process.env.TC_CONFIG_DIR || path.join(os.homedir(), '.config', 'termcontrol');
export const paneLogDir = () => path.join(configDir(), 'actions');
export const paneLogFile = (paneId, dir = paneLogDir()) => path.join(dir, `${String(paneId).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 160)}.jsonl`);

const hostOf = (url) => { try { return new URL(String(url)).host.replace(/^www\./, '') || null; } catch { return null; } };
const short = (s, n = 80) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const isScratch = (p) => /^(\/tmp\/|\/var\/tmp\/)|\/\.cache\/|\/scratchpad\//.test(String(p || ''));
const serviceName = (server) => server.replace(/^claude_ai_/, '').replace(/_/g, ' ');

/** The project a path belongs to: the folder holding .git, else the file's own folder. */
export function projectOf(p, cwd = '') {
  let dir = path.resolve(cwd || '/', String(p || cwd || '.'));
  try { if (!fs.statSync(dir).isDirectory()) dir = path.dirname(dir); } catch { dir = path.dirname(dir); }
  for (let d = dir, i = 0; i < 30; i++) {
    // A git folder at the home folder itself says nothing about the project: name the file's folder.
    if (d === os.homedir()) break;
    try { if (fs.existsSync(path.join(d, '.git'))) return path.basename(d); } catch { /* keep walking */ }
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return path.basename(dir) || dir;
}

const argAfter = (cmd, verb) => {
  const m = new RegExp(`${verb}\\s+((?:--?[\\w-]+\\s+)*)("[^"]*"|'[^']*'|\\S+)`).exec(cmd);
  return m ? m[2].replace(/^["']|["']$/g, '') : '';
};

/** One shell command → a plain action, or null when it only reads or checks. */
export function classifyCommand(command, cwd = '') {
  const cmd = String(command || '');
  if (!cmd.trim()) return null;
  const project = () => projectOf(cwd, cwd);
  // Spend: paid generation services and our own paid-action broker.
  if (/codex-image\b/.test(cmd)) return { kind: 'spend', text: 'Generated an image (GPT Image)' };
  if (/\b(api\.)?kie\.ai\b|magnific|higgsfield|paid-action-broker|fal\.run|api\.replicate\.com|seedream/i.test(cmd)) {
    return { kind: 'spend', text: /image|seedream|gpt-?image/i.test(cmd) ? 'Generated an image on a paid service' : 'Used a paid service' };
  }
  // Send: messages that leave this PC.
  if (/\bgws\s+gmail\b.*\b(send|reply|forward)\b/.test(cmd)) return { kind: 'send', text: 'Sent an email' };
  if (/api\.telegram\.org\/bot[^/\s]*\/send/i.test(cmd)) return { kind: 'send', text: 'Sent a Telegram message' };
  if (/hooks\.slack\.com|slack\.com\/api\/chat\.postMessage/i.test(cmd)) return { kind: 'send', text: 'Sent a Slack message' };
  if (/(^|[\s;&|])(sendmail|mailx?)\s/.test(cmd)) return { kind: 'send', text: 'Sent an email' };
  // Post: things that go public.
  const gh = /\bgh\s+(pr|issue|release|gist|repo)\s+(create|comment|edit|review|merge|delete)\b/.exec(cmd);
  const ghThing = (t) => (t === 'pr' ? 'pull request' : t);
  if (gh && gh[2] === 'delete') return { kind: 'delete', text: `Deleted a GitHub ${ghThing(gh[1])}` };
  if (gh) return { kind: 'post', text: `${{ comment: 'Commented on', merge: 'Merged', edit: 'Edited', review: 'Reviewed' }[gh[2]] || 'Opened'} a GitHub ${ghThing(gh[1])} in ${project()}` };
  if (/\bgit\s+push\b[^;&|]*(--delete|\s:\S)/.test(cmd)) return { kind: 'delete', text: `Deleted a branch on GitHub from ${project()}` };
  if (/\bgit\s+push\b/.test(cmd)) return { kind: 'post', text: `Pushed code from ${project()}${/--force\b|\s-f\b/.test(cmd) ? ' (forced)' : ''}` };
  if (/\bnpm\s+publish\b/.test(cmd)) return { kind: 'post', text: `Published a package from ${project()}` };
  if (/\b(vercel\b[^;&|]*--prod|wrangler\s+(deploy|pages\s+deploy)|netlify\s+deploy\b[^;&|]*--prod)/.test(cmd)) return { kind: 'post', text: `Published a site from ${project()}` };
  // Delete.
  if (/\bgws\s+\w+\b.*\b(delete|trash)\b/.test(cmd)) return { kind: 'delete', text: 'Deleted something in Google' };
  if (/\bgit\s+branch\s+-D\b/.test(cmd)) return { kind: 'delete', text: `Deleted a branch in ${project()}` };
  if (/\bgit\s+clean\s+-\w*f/.test(cmd)) return { kind: 'delete', text: `Deleted untracked files in ${project()}` };
  if (/\b(DROP\s+TABLE|DELETE\s+FROM)\b/i.test(cmd)) return { kind: 'delete', text: 'Deleted data from a database' };
  const rm = /(?:^|[\s;&|(])(rm|rmdir|trash-put|trash|shred|unlink)\s+([^;&|]*)/.exec(cmd);
  if (rm) {
    const targets = rm[2].split(/\s+/).map((a) => a.replace(/["']/g, '')).filter((a) => a && !a.startsWith('-') && !/^\d?>/.test(a));
    if (targets.length && !targets.every(isScratch)) {
      const name = path.basename(targets[0].replace(/\/+$/, '')) || targets[0];
      return { kind: 'delete', text: `Deleted ${short(name, 50)}${targets.length > 1 ? ` and ${targets.length - 1} more` : ''} in ${projectOf(targets[0], cwd)}` };
    }
  }
  // Terminals, handoffs, schedules, skills.
  if (/\btermfleet-(team\s+start|child\s+spawn)\b/.test(cmd)) return { kind: 'terminal', text: 'Started a terminal agent' };
  if (/\btermfleet-team\s+close\b/.test(cmd)) { const who = argAfter(cmd, 'close'); return { kind: 'terminal', text: `Closed a terminal${who ? ` (${short(who, 40)})` : ''}` }; }
  if (/\btermfleet-team\s+send\b/.test(cmd)) { const who = argAfter(cmd, 'send'); return { kind: 'handoff', text: `Handed work to ${short(who || 'a terminal agent', 40)}` }; }
  if (/\btermfleet-team\s+routine\s+add\b/.test(cmd)) return { kind: 'schedule', text: 'Set a schedule' };
  if (/\btermfleet-skill\s+save\b/.test(cmd)) return { kind: 'skill', text: 'Suggested a new skill' };
  if (/\bgit\s+commit\b/.test(cmd)) return { kind: 'files', text: `Saved a commit in ${project()}` };
  const open = /\b(xdg-open|termfleet-browser\s+open)\s+["']?(https?:\/\/[^\s"']+)/.exec(cmd);
  if (open && hostOf(open[2])) return { kind: 'site', text: `Opened ${hostOf(open[2])}`, url: open[2] };
  return null;
}

/** Files touched by an apply_patch body. */
const patchFiles = (patch) => [...String(patch || '').matchAll(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/gm)].map((m) => m[1].trim());

/**
 * One tool call → a plain action { kind, text, needsApproval } or null when it only reads.
 * Works for Claude tool names, Codex tool names and MCP tools (mcp__<server>__<tool>).
 */
export function classifyTool(name, input = {}, cwd = '') {
  const tool = String(name || '');
  const args = input && typeof input === 'object' ? input : {};
  let out = null;
  if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'mcp__lean-ctx__ctx_patch'].includes(tool)) {
    const file = args.file_path || args.notebook_path || args.path || '';
    if (!isScratch(file)) out = { kind: 'files', text: `Changed files in ${projectOf(file, cwd)}`, file: path.basename(String(file)) };
  } else if (tool === 'apply_patch') {
    const body = String(args.patch || args.input || args.command || (typeof input === 'string' ? input : ''));
    const files = patchFiles(body).map((f) => path.resolve(cwd || '/', f)).filter((f) => !isScratch(f));
    if (files.length) {
      const deleted = /^\*\*\* Delete File:/m.test(body);
      out = { kind: deleted ? 'delete' : 'files', text: `${deleted ? 'Deleted files' : 'Changed files'} in ${projectOf(files[0], cwd)}`, file: files.map((f) => path.basename(f)).slice(0, 3).join(', ') };
    }
  } else if (['Bash', 'command_execution', 'shell', 'exec_command', 'local_shell', 'mcp__lean-ctx__ctx_shell'].includes(tool)) {
    const command = Array.isArray(args.command) ? args.command.join(' ') : (args.command || args.cmd || '');
    out = classifyCommand(command, args.cwd || args.workdir || cwd);
  } else if (tool === 'WebFetch') {
    const host = hostOf(args.url);
    if (host) out = { kind: 'site', text: `Read ${host}`, url: String(args.url) };
  } else if (/^mcp__/.test(tool)) {
    out = classifyMcp(tool, args);
  }
  return out ? { ...out, needsApproval: NEEDS_APPROVAL.has(out.kind) } : null;
}

function classifyMcp(tool, args) {
  const [, server = '', op = ''] = tool.split('__');
  const s = server.toLowerCase(), o = op.toLowerCase();
  if (/navigate|open_?url/.test(o) && !/back|forward/.test(o)) {
    const host = hostOf(args.url);
    return host ? { kind: 'site', text: `Opened ${host}`, url: String(args.url) } : null;
  }
  if (/gmail/.test(s)) {
    if (/^(send_message|reply|forward)$/.test(o)) return { kind: 'send', text: `Sent an email${args.to ? ` to ${short([].concat(args.to).join(', '), 60)}` : ''}` };
    if (/trash|delete/.test(o) && !/untrash/.test(o)) return { kind: 'delete', text: 'Deleted an email' };
    if (/create_draft|update_draft/.test(o)) return { kind: 'files', text: 'Wrote an email draft' };
    return null;
  }
  if (/calendar/.test(s)) {
    if (/delete/.test(o)) return { kind: 'delete', text: 'Deleted a calendar event' };
    if (/create_event|update_event|respond/.test(o)) return { kind: 'send', text: `${/create/.test(o) ? 'Added' : /respond/.test(o) ? 'Answered' : 'Changed'} a calendar event${args.summary ? `: ${short(args.summary, 50)}` : ''}` };
    return null;
  }
  if (/^(get|list|show|search|read|query)|status|_wait$|^wait/.test(o)) return null;
  const paid = /magnific|higgsfield|kie|fal|replicate|heygen|hyperframes/.test(s);
  if (/publish|deploy|^post|tiktok_prepare/.test(o) && !/unpublish|preview/.test(o)) return { kind: 'post', text: `Published on ${serviceName(server)}` };
  if (/delete|remove|trash/.test(o) && !/background/.test(o)) return { kind: 'delete', text: `Deleted something on ${serviceName(server)}` };
  if (/^(send|reply|forward)/.test(o)) return { kind: 'send', text: `Sent a message on ${serviceName(server)}` };
  if (paid && /generate|upscale|render|animate|create_voice|tts|speak|music|sfx|reimagine|relight|expand|restyle|variations|_batch|execute_preset|motion|dubbing|voice_change|run$/.test(o)) {
    return { kind: 'spend', text: /image|upscale|reimagine|relight|expand|restyle|variations/.test(o) ? `Generated an image on ${serviceName(server)}` : `Used paid ${serviceName(server)} (${op.replace(/_/g, ' ')})` };
  }
  return null;
}

/** Appends one line; a file that grows past 512 KB keeps its newest half. */
export function appendAction(file, entry) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.appendFileSync(file, JSON.stringify(entry) + '\n', { mode: 0o600 });
  try {
    if (fs.statSync(file).size > MAX_BYTES) {
      const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, lines.slice(Math.floor(lines.length / 2)).join('\n') + '\n', { mode: 0o600 });
      fs.renameSync(tmp, file);
    }
  } catch { /* the line itself is written */ }
}

export function readActions(file) {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

/**
 * Who approved a bot's own action. A bot never sees a prompt, so the only approval is
 * Noam's own typed message that started the turn (OpenBot's "initiator": a routine, an
 * event or another bot is not Noam).
 */
export function botApproval(action, chat = [], ownerIds = new Set()) {
  if (!action.needsApproval) return 'not-needed';
  let trigger = null;
  for (const m of chat) {
    if ((m.role === 'operator' || m.role === 'event') && Number(m.at) <= Number(action.at) && (!trigger || Number(m.at) >= Number(trigger.at))) trigger = m;
  }
  return trigger && trigger.role === 'operator' && ownerIds.has(trigger.id) ? 'noam-chat' : 'none';
}

/**
 * Who approved a terminal agent's action. A receipt from the phone's approval card for
 * that exact tool call wins; then a prompt the agent showed for it (answered at the
 * terminal); then an action the agent ran without asking in normal mode (a saved allow
 * rule let it through). Never-ask modes record no approval.
 */
export function paneApproval(action, { receipts = {}, paneId = '' } = {}) {
  if (!action.needsApproval) return 'not-needed';
  if (action.toolUseId) {
    for (const [key, rec] of Object.entries(receipts)) {
      if (rec?.state === 'sent' && key.includes(paneId) && key.includes(action.toolUseId)) return 'approval-card';
    }
  }
  if (action.asked) return 'noam-prompt';
  // Auto mode lets a classifier decide, not Noam, so it records no approval.
  if (action.mode && !/bypass|never|auto|danger|yolo|dontask/i.test(action.mode)) return 'standing-rule';
  return 'none';
}

/** Consecutive file changes in the same project by the same actor fold into one line. */
export function foldFiles(entries, windowMs = 15 * 60 * 1000) {
  const out = [];
  for (const e of entries) {
    const prev = out[out.length - 1];
    if (prev && e.kind === 'files' && prev.kind === 'files' && prev.text === e.text && prev.actor === e.actor && Math.abs(prev.at - e.at) < windowMs) {
      prev.count = (prev.count || 1) + 1;
      if (e.file && !prev.files.includes(e.file)) prev.files = [...prev.files, e.file].slice(0, 6);
      prev.at = Math.max(prev.at, e.at);
      continue;
    }
    out.push({ ...e, files: e.file ? [e.file] : [] });
  }
  return out;
}
