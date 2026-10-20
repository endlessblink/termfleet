import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * One shared skill library for every agent and bot (TF-096 part 8, grill decision
 * 12: "a skill saved by any teammate works for all of them"). Skills are folders
 * with a SKILL.md. A bot saves "what we just did" as a SUGGESTED skill; it joins the
 * library (and Claude, Codex and OpenCode) only when Noam approves it.
 */
const home = os.homedir();
export const PATHS = {
  library: () => process.env.TC_SKILLS_LIBRARY || path.join(home, '.local', 'share', 'termfleet', 'skills'),
  suggested: () => process.env.TC_SKILLS_SUGGESTED || path.join(home, '.local', 'share', 'termfleet', 'skills-suggested'),
  // Skills that ship with TermFleet (e.g. grill-me), so every bot has them without
  // a terminal. A library skill of the same name wins.
  builtin: () => process.env.TC_SKILLS_BUILTIN || fileURLToPath(new URL('../skills', import.meta.url)),
  providers: () => (process.env.TC_SKILLS_PROVIDERS ? process.env.TC_SKILLS_PROVIDERS.split(':') : [path.join(home, '.claude', 'skills'), path.join(home, '.codex', 'skills'), path.join(home, '.config', 'opencode', 'skills')]),
};

const NAME = /^[a-z0-9][a-z0-9-]{1,48}$/;

export function header(text) {
  const m = /^---\n([\s\S]*?)\n---/.exec(String(text || ''));
  const get = (k) => (m ? (new RegExp(`^${k}:\\s*(.*)$`, 'm').exec(m[1])?.[1] || '').trim() : '');
  return { name: get('name'), description: get('description') };
}

function read(dir, status) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  const out = [];
  for (const name of names) {
    const file = path.join(dir, name, 'SKILL.md');
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    const h = header(text);
    out.push({ name, description: h.description, status, by: (/^suggested-by:\s*(.*)$/m.exec(text)?.[1] || '').trim() || null, preview: text.replace(/^---[\s\S]*?---\n/, '').slice(0, 1200) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function listSkills() {
  const library = read(PATHS.library(), 'approved');
  const builtIn = read(PATHS.builtin(), 'approved').filter((k) => !library.some((l) => l.name === k.name)).map((k) => ({ ...k, builtIn: true }));
  return [...read(PATHS.suggested(), 'suggested'), ...[...library, ...builtIn].sort((a, b) => a.name.localeCompare(b.name))];
}

/** The full instructions of an approved skill (library first, then built-in). */
export function skillText(name) {
  const n = String(name || '').toLowerCase();
  if (!NAME.test(n)) return null;
  for (const dir of [PATHS.library(), PATHS.builtin()]) {
    try { return fs.readFileSync(path.join(dir, n, 'SKILL.md'), 'utf8').replace(/^---[\s\S]*?---\n/, '').trim(); } catch { /* next */ }
  }
  return null;
}

/**
 * A chat message that starts a skill ("/grill-me my plan" or the picker's
 * "Use the grill-me skill: my plan") reaches the bot with that skill's full
 * instructions, so any bot (Claude, Codex, OpenCode) can run it. Anything else,
 * or an unknown name, returns null and the message goes as typed.
 */
export function skillPrompt(text) {
  const m = /^\s*\/([a-z0-9][a-z0-9-]{1,48})(?:\s+([\s\S]*))?$/i.exec(String(text || ''))
    || /^\s*Use the ([a-z0-9][a-z0-9-]{1,48}) skill:?(?:\s+([\s\S]*))?$/i.exec(String(text || ''));
  if (!m) return null;
  const name = m[1].toLowerCase();
  const body = skillText(name);
  if (!body) return null;
  const rest = (m[2] || '').trim();
  return `Noam started the "${name}" skill in this chat. Follow these instructions from now until it is finished:\n\n${body}\n\n---\n${rest ? `What Noam wrote with it:\n${rest}` : 'Noam wrote nothing else with it yet.'}`;
}

/** Name and description checks, usable before there is a body (teach-a-task). */
export function checkSkill({ name, description }) {
  const n = String(name || '').toLowerCase().trim().replace(/\s+/g, '-');
  if (!NAME.test(n)) return { error: 'Name it with lowercase words joined by dashes, e.g. weekly-invoice-check.' };
  const desc = String(description || '').replace(/\s+/g, ' ').trim();
  if (desc.length < 20) return { error: 'Describe when to use it in one sentence (at least a few words).' };
  if (fs.existsSync(path.join(PATHS.library(), n))) return { error: `A skill named ${n} already exists. Pick another name.` };
  return { name: n, description: desc };
}

/** A bot (or Noam) suggests a skill; nothing uses it yet. */
export function suggestSkill({ name, description, body, by = null }) {
  const checked = checkSkill({ name, description });
  if (checked.error) return checked;
  const { name: n, description: desc } = checked;
  const text = String(body || '').trim();
  if (text.length < 40) return { error: 'Write the steps, what to check, and what needs Noam\'s approval.' };
  const dir = path.join(PATHS.suggested(), n);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${n}\ndescription: ${desc}\n---\nsuggested-by: ${by || 'a bot'}\n\n${text}\n`);
  return { ok: true, name: n };
}

/** Noam approves: the skill moves into the library and every agent kind gets it. */
export function approveSkill(name) {
  const n = String(name || '');
  if (!NAME.test(n)) return { error: 'Unknown skill.' };
  const from = path.join(PATHS.suggested(), n);
  if (!fs.existsSync(from)) return { error: 'That suggestion no longer exists.' };
  const to = path.join(PATHS.library(), n);
  if (fs.existsSync(to)) return { error: `A skill named ${n} already exists.` };
  fs.mkdirSync(PATHS.library(), { recursive: true });
  const text = fs.readFileSync(path.join(from, 'SKILL.md'), 'utf8').replace(/^suggested-by:.*\n\n?/m, '');
  fs.mkdirSync(to, { recursive: true });
  fs.writeFileSync(path.join(to, 'SKILL.md'), text);
  fs.rmSync(from, { recursive: true, force: true });
  const linked = [];
  for (const dir of PATHS.providers()) {
    if (!fs.existsSync(dir)) continue;
    const link = path.join(dir, n);
    if (fs.existsSync(link)) continue;   // never replace an existing skill of that name
    try { fs.symlinkSync(to, link); linked.push(dir); } catch { /* that agent just won't have it */ }
  }
  return { ok: true, linked: linked.length };
}

export function rejectSkill(name) {
  const n = String(name || '');
  if (!NAME.test(n)) return { error: 'Unknown skill.' };
  const dir = path.join(PATHS.suggested(), n);
  if (!fs.existsSync(dir)) return { error: 'That suggestion no longer exists.' };
  fs.rmSync(dir, { recursive: true, force: true });
  return { ok: true };
}
