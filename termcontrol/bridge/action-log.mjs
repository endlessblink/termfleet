import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

/**
 * Per-bot action log (TF-098, idea from CopilotKit OpenBot's action gateway: every action
 * is recorded after it happens, with what started it). Record only in this version: nothing
 * is blocked. Each consequential action a bot or one of the terminal agents it started takes
 * becomes one plain line with who approved it. Approval is shown only from evidence that
 * matches that exact action: an approval-card "yes" for that tool call, or a scoped standing
 * allow rule that covers it. Anything else is "approval not recorded" (a claim about the
 * record, not about what happened); for a post, send, delete or spend the app shows it in red.
 *
 * Storage is plain files on this PC, no database:
 *   <config>/bots/<id>/actions.jsonl          what the bot's own brain did
 *   <config>/actions/<pane>.jsonl             what a terminal agent did (written by a hook)
 * A bot's Activity view joins its own file with the files of the terminals it started.
 */

export const NEEDS_APPROVAL = new Set(['post', 'send', 'delete', 'spend']);
export const APPROVAL_LABEL = {
  'approval-card': 'Noam approved it on the approval card',
  'standing-rule': 'Allowed by a standing rule',
  'not-needed': 'No approval needed',
  none: 'Approval not recorded',
};
/** The words shown for one entry's approval. */
export function approvalText(e) {
  if (e.approval === 'standing-rule' && e.rule) return `Allowed by a standing rule: ${e.rule}`;
  if (e.approval === 'none' && e.asked) return 'Approval not recorded (it asked first)';
  return APPROVAL_LABEL[e.approval] || APPROVAL_LABEL.none;
}
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

/** The command with here-document bodies and quoted strings emptied (URLs in quotes are kept for opens). */
export function withoutText(command) {
  let out = '';
  const lines = String(command || '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    out += lines[i] + '\n';
    const doc = /<<-?\s*['"]?([A-Za-z_][\w-]*)['"]?/.exec(lines[i]);
    if (doc) { while (i + 1 < lines.length && lines[i + 1].trim() !== doc[1]) i++; }
  }
  return out.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, (q) => (/^["']https?:\/\/\S+["']$/.test(q) ? q : '""'));
}

/** One shell command → a plain action, or null when it only reads or checks. */
export function classifyCommand(command, cwd = '') {
  const raw = String(command || '');
  if (!raw.trim()) return null;
  // What a command DOES is in its words, not in text it carries: quoted strings and
  // here-documents ("please rm the build", a note being written) are blanked first.
  const cmd = withoutText(raw);
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
  if (/\bgit\s+push\b[^;&|]*(--dry-run|\s-n\b)/.test(cmd)) return null;
  if (/\bgit\s+push\b/.test(cmd)) return { kind: 'post', text: `Pushed code from ${project()}${/--force\b|\s-f\b/.test(cmd) ? ' (forced)' : ''}` };
  if (/\bnpm\s+publish\b/.test(cmd)) return { kind: 'post', text: `Published a package from ${project()}` };
  if (/\b(vercel\b[^;&|]*--prod|wrangler\s+(deploy|pages\s+deploy)|netlify\s+deploy\b[^;&|]*--prod)/.test(cmd)) return { kind: 'post', text: `Published a site from ${project()}` };
  // Delete.
  if (/\bgws\s+\w+\b.*\b(delete|trash)\b/.test(cmd)) return { kind: 'delete', text: 'Deleted something in Google' };
  if (/\bgit\s+branch\s+-D\b/.test(cmd)) return { kind: 'delete', text: `Deleted a branch in ${project()}` };
  if (/\bgit\s+clean\s+-\w*f/.test(cmd)) return { kind: 'delete', text: `Deleted untracked files in ${project()}` };
  if (/\b(DROP\s+TABLE|DELETE\s+FROM)\b/i.test(cmd)) return { kind: 'delete', text: 'Deleted data from a database' };
  const RM = /(?:^|[\s;&|(])(rm|rmdir|trash-put|trash|shred|unlink)\s+([^;&|\n]*)/;
  if (RM.test(cmd)) {
    // Targets come from the real words (a quoted file name is still a file).
    const targets = (RM.exec(raw)?.[2] || '').split(/\s+/).map((a) => a.replace(/["']/g, '')).filter((a) => a && !a.startsWith('-') && !/^\d?>/.test(a));
    if (!targets.length) return { kind: 'delete', text: `Deleted files in ${project()}` };
    if (targets.length && !targets.every(isScratch)) {
      const name = path.basename(targets[0].replace(/\/+$/, '')) || targets[0];
      return { kind: 'delete', text: `Deleted ${short(name, 50)}${targets.length > 1 ? ` and ${targets.length - 1} more` : ''} in ${projectOf(targets[0], cwd)}` };
    }
  }
  // Terminals, handoffs, schedules, skills.
  if (/\btermfleet-(team\s+start|child\s+spawn)\b/.test(cmd)) return { kind: 'terminal', text: 'Started a terminal agent' };
  if (/\btermfleet-team\s+close\b/.test(cmd)) { const who = argAfter(raw, 'close'); return { kind: 'terminal', text: `Closed a terminal${who ? ` (${short(who, 40)})` : ''}` }; }
  if (/\btermfleet-team\s+send\b/.test(cmd)) { const who = argAfter(raw, 'send').replace(/^terminal-[0-9a-f-]{20,}$/i, 'a terminal agent'); return { kind: 'handoff', text: `Handed work to ${short(who || 'a terminal agent', 40)}` }; }
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
 * A bot's own action. A bot never sees a permission prompt, and a message from Noam (even
 * his signed own words) is an instruction, not an approval of a particular action. No
 * per-action grant exists for bots yet, so nothing is claimed. `chat` and `ownerIds` stay
 * in the signature for a future explicit grant.
 */
export function botApproval(action, chat = [], ownerIds = new Set()) {
  return action.needsApproval ? 'none' : 'not-needed';
}

const GRANTS = new Set(['yes', 'yesAlways'].map((a) => createHash('sha256').update(a).digest('hex')));

/**
 * A phone approval-card answer that granted this exact tool call: a permission card (not a
 * question) for this terminal whose source is this call id, confirmed sent, answered yes.
 * Claude's permission cards are not tied to a call id, so they never match.
 */
export function cardGrant(action, { receipts = {}, paneId = '' } = {}) {
  if (!action.toolUseId || !paneId) return false;
  for (const [key, rec] of Object.entries(receipts || {})) {
    if (rec?.state !== 'sent' || !GRANTS.has(rec.answerHash)) continue;
    let pane, askId;
    try { [pane, askId] = JSON.parse(key); } catch { continue; }
    const parts = String(askId || '').split(':');
    if (pane === paneId && parts[2] === action.toolUseId && parts[4] === 'permission') return true;
  }
  return false;
}

/**
 * A terminal agent's action. Approved only by a matching approval-card grant, or by a scoped
 * standing allow rule the hook found covering it when it ran. A permission request alone is
 * not an answer, and running without a prompt in normal mode is not a rule.
 */
export function paneApproval(action, { receipts = {}, paneId = '' } = {}) {
  if (!action.needsApproval) return 'not-needed';
  if (cardGrant(action, { receipts, paneId })) return 'approval-card';
  if (action.rule) return 'standing-rule';
  return 'none';
}

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const segments = (command) => withoutText(command).split(/&&|\|\||;|\||\n/).map((x) => x.trim()).filter(Boolean);
const words = (seg) => seg.split(/\s+/).filter((w) => !/^\w+=/.test(w));

/** Claude allow rules from the user's and the project's settings (deny rules are not grants). */
function claudeRules(home, cwd) {
  const files = [path.join(home, '.claude', 'settings.json'), path.join(home, '.claude', 'settings.local.json')];
  for (let d = path.resolve(cwd || home), i = 0; i < 30; i++) {
    if (d !== home) files.push(path.join(d, '.claude', 'settings.json'), path.join(d, '.claude', 'settings.local.json'));
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return files.flatMap((f) => (Array.isArray(readJson(f)?.permissions?.allow) ? readJson(f).permissions.allow : [])).map(String);
}

/** Codex allow rules: prefix_rule(pattern=[...], decision="allow") lines. */
function codexRules(home) {
  const dir = path.join(home, '.codex', 'rules');
  let out = [];
  try {
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.rules'))) {
      for (const m of fs.readFileSync(path.join(dir, f), 'utf8').matchAll(/prefix_rule\(\s*pattern\s*=\s*(\[[^\]]*(?:\[[^\]]*\][^\]]*)*\])\s*,\s*decision\s*=\s*"(\w+)"/g)) {
        if (m[2] !== 'allow') continue;
        try { out.push(JSON.parse(m[1])); } catch { /* unreadable rule */ }
      }
    }
  } catch { /* no rules */ }
  return out;
}

const globToRegex = (glob) => new RegExp(`^${glob.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
function claudeRuleCovers(rule, seg) {
  const m = /^Bash\((.+)\)$/.exec(rule);
  if (!m) return false;
  const spec = m[1].trim();
  if (!spec || spec === '*' || spec === ':*') return false;   // covers everything: not scoped
  if (spec.endsWith(':*')) { const pre = spec.slice(0, -2).trim(); return seg === pre || seg.startsWith(pre + ' '); }
  return spec.includes('*') ? globToRegex(spec).test(seg) : seg === spec;
}

/**
 * The scoped standing allow rule that covers this exact action, or null. Scoped means it
 * names this command (a "Bash(git push:*)" rule, a Codex prefix rule) or this one MCP tool;
 * a bare "Bash" or a whole MCP server allows everything and so proves nothing. For a shell
 * command the rule must cover the part that does the posting, sending, deleting or spending.
 */
export function standingRule(name, input = {}, { provider = 'claude', home = os.homedir(), cwd = '' } = {}) {
  const tool = String(name || '');
  if (/^mcp__/.test(tool)) {
    if (provider !== 'claude') return null;
    return claudeRules(home, cwd).find((r) => r === tool) || null;
  }
  if (!['Bash', 'command_execution', 'shell', 'exec_command', 'local_shell'].includes(tool)) return null;
  const command = Array.isArray(input?.command) ? input.command.join(' ') : String(input?.command || input?.cmd || '');
  const target = classifyCommand(command, cwd);
  if (!target) return null;
  const doing = segments(command).filter((seg) => classifyCommand(seg, cwd)?.kind === target.kind);
  if (!doing.length) return null;
  if (provider === 'codex') {
    const rules = codexRules(home);
    const covers = (seg) => rules.find((pattern) => { const w = words(seg); return pattern.length && pattern.every((p, i) => (Array.isArray(p) ? p.includes(w[i]) : p === w[i])); });
    const found = doing.map(covers);
    return found.every(Boolean) ? `prefix_rule ${JSON.stringify(found[0])} allow` : null;
  }
  const rules = claudeRules(home, cwd);
  const found = doing.map((seg) => rules.find((r) => claudeRuleCovers(r, words(seg).join(' '))));
  return found.every(Boolean) ? found[0] : null;
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
