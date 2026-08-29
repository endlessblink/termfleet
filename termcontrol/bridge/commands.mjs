import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

/**
 * The slash commands an agent offers, read from the same places the agent
 * reads them: skills and command files on disk. Offering them in the app means
 * the phone does not have to reproduce a terminal menu to be useful.
 */
const home = os.homedir();

const SOURCES = {
  claude: [
    { dir: path.join(home, '.claude', 'skills'), kind: 'dir' },
    { dir: path.join(home, '.claude', 'commands'), kind: 'md' },
    { dir: path.join(home, '.claude', 'plugins', 'cache'), kind: 'plugins' },
  ],
  codex: [
    { dir: path.join(home, '.codex', 'skills'), kind: 'dir' },
    { dir: path.join(home, '.codex', 'prompts'), kind: 'md' },
  ],
};

/**
 * Built-in commands change with the agent's version, and offering one that
 * does not exist is worse than offering none. Each candidate is therefore
 * checked against the installed agent itself: a command only appears if its
 * name is present in the binary that will run it.
 */
const CANDIDATES = {
  claude: [
    ['clear', 'Clear the conversation'],
    ['compact', 'Summarise the conversation so far'],
    ['context', 'Show what is in context'],
    ['cost', 'Show token cost'],
    ['doctor', 'Check the installation'],
    ['exit', 'Leave'],
    ['help', 'List what is available'],
    ['login', 'Sign in'],
    ['logout', 'Sign out'],
    ['mcp', 'Manage MCP servers'],
    ['memory', 'Edit memory files'],
    ['model', 'Change the model'],
    ['permissions', 'Change what is allowed without asking'],
    ['resume', 'Pick up an earlier conversation'],
    ['review', 'Review the changes'],
    ['status', 'Show the current state'],
    ['terminal-setup', 'Set up the terminal'],
  ],
  codex: [
    ['approvals', 'Choose what needs your approval'],
    ['compact', 'Summarise the conversation so far'],
    ['diff', 'Show the changes made'],
    ['fast', 'Turn the fast tier on or off'],
    ['init', 'Write an AGENTS.md for this project'],
    ['logout', 'Sign out'],
    ['mcp', 'Manage MCP servers'],
    ['mention', 'Mention a file'],
    ['model', 'Change the model'],
    ['new', 'Start a new conversation'],
    ['personality', 'Change how it talks'],
    ['plan', 'Show the plan'],
    ['prompts', 'Show example prompts'],
    ['quit', 'Leave'],
    ['review', 'Start a review'],
    ['status', 'Show the current state'],
    ['undo', 'Undo the last change'],
  ],
};

const BINARIES = {
  claude: [
    path.join(home, '.npm-global', 'lib', 'node_modules', '@anthropic-ai', 'claude-code'),
  ],
  codex: [
    path.join(home, '.npm-global', 'lib', 'node_modules', '@openai', 'codex'),
  ],
};

let verified = null;                     // provider -> Set of names present

let cache = { at: 0, byProvider: {} };
const CACHE_MS = 60_000;

function firstLine(file) {
  try {
    const text = fs.readFileSync(file, 'utf8').slice(0, 1200);
    const described = /^description:\s*(.+)$/im.exec(text);
    if (described) return described[1].replace(/^["']|["']$/g, '').slice(0, 110);
    const heading = text.split('\n').find((l) => l.trim() && !l.startsWith('---') && !/^name:/i.test(l));
    return (heading || '').replace(/^#+\s*/, '').slice(0, 110);
  } catch {
    return '';
  }
}

function fromDir(dir) {
  const out = [];
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (!e.isDirectory() && !e.isSymbolicLink()) continue;
    const skill = path.join(dir, e.name, 'SKILL.md');
    if (fs.existsSync(skill)) out.push({ name: e.name, detail: firstLine(skill) });
  }
  return out;
}

function fromMarkdown(dir) {
  const out = [];
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return out; }
  for (const n of names) {
    if (!n.endsWith('.md')) continue;
    out.push({ name: n.replace(/\.md$/, ''), detail: firstLine(path.join(dir, n)) });
  }
  return out;
}

function fromPlugins(dir) {
  const out = [];
  const walk = (d, depth) => {
    if (depth > 4) return;
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const here = path.join(d, e.name);
      if (e.name === 'skills') {
        for (const s of fromDir(here)) out.push(s);
        continue;
      }
      walk(here, depth + 1);
    }
  };
  walk(dir, 0);
  return out;
}

/**
 * Ask a running agent what it offers: type a slash, read the menu it draws,
 * then erase the slash. Nothing is submitted and the composer is left as it
 * was found.
 */
/**
 * Which candidate names actually exist in the installed agent. Read once from
 * the binary, then cached — the file is large, so this must not be per request.
 */
export function verifiedBuiltIns(provider) {
  if (!verified) verified = {};
  if (verified[provider]) return verified[provider];

  const names = new Set();
  const candidates = (CANDIDATES[provider] || []).map(([n]) => n);
  const binary = biggestFileUnder(BINARIES[provider] || []);

  if (binary) {
    try {
      const found = execFileSync('grep', ['-aoE', `\\b(${candidates.join('|')})\\b`, binary],
        { maxBuffer: 64 * 1024 * 1024, timeout: 25_000 }).toString();
      for (const hit of found.split('\n')) if (hit) names.add(hit);
    } catch { /* fall through: offer nothing rather than something wrong */ }
  }

  verified[provider] = names;
  return names;
}

function biggestFileUnder(roots) {
  let best = null;
  for (const root of roots) {
    const stack = [{ dir: root, depth: 0 }];
    while (stack.length) {
      const { dir, depth } = stack.pop();
      if (depth > 6) continue;
      let entries = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) { stack.push({ dir: full, depth: depth + 1 }); continue; }
        try {
          const { size } = fs.statSync(full);
          if (size > 5 * 1024 * 1024 && (!best || size > best.size)) best = { file: full, size };
        } catch { /* skip */ }
      }
    }
  }
  return best?.file || null;
}

export async function probeCommands(pane, { ask, screenOf }) {
  const held = probed.get(pane.provider);
  if (held && Date.now() - held.at < PROBE_MS) return held.list;
  if (pane.turn === 'working' || pane.producing) return held?.list || [];

  try {
    const before = await screenOf(pane.id, 40) || '';
    await ask({ type: 'writeSession', id: pane.id, data: '/' });
    await new Promise((r) => setTimeout(r, 700));
    const after = await screenOf(pane.id, 40) || '';
    // Erase what we typed; never submit it.
    await ask({ type: 'writeSession', id: pane.id, data: '\u007f' });

    const list = parseMenu(after, before);
    if (list.length) {
      probed.set(pane.provider, { at: Date.now(), list });
      return list;
    }
  } catch { /* fall back to what is on disk */ }

  return held?.list || [];
}

/** Pull "/name  description" rows out of the screen the agent just drew. */
function parseMenu(after, before) {
  const seen = new Set(before.split('\n').map((l) => l.trim()));
  const found = new Map();

  for (const raw of after.split('\n')) {
    const line = raw.replace(/[\u2500-\u257f\u2018\u2019\u25b6\u203a]/g, ' ').trim();
    if (!line || seen.has(raw.trim())) continue;
    const m = /^\/?([a-z][a-z0-9:_-]{1,40})\s{2,}(.{3,})$/i.exec(line)
      || /^\/([a-z][a-z0-9:_-]{1,40})\s*$/i.exec(line);
    if (!m) continue;
    const name = m[1].toLowerCase();
    const detail = (m[2] || '').replace(/\s+/g, ' ').slice(0, 110);
    if (!found.has(name)) found.set(name, { name, detail });
  }
  return [...found.values()];
}

export function commandsFor(provider) {
  const now = Date.now();
  if (now - cache.at > CACHE_MS) cache = { at: now, byProvider: {} };
  if (cache.byProvider[provider]) return cache.byProvider[provider];

  const found = new Map();
  const present = verifiedBuiltIns(provider);
  for (const [name, detail] of CANDIDATES[provider] || []) {
    if (present.has(name)) found.set(name, { name, detail });
  }
  for (const source of SOURCES[provider] || []) {
    const list = source.kind === 'md' ? fromMarkdown(source.dir)
      : source.kind === 'plugins' ? fromPlugins(source.dir)
      : fromDir(source.dir);
    for (const item of list) {
      if (!found.has(item.name) || found.get(item.name).detail === 'built in') found.set(item.name, item);
    }
  }

  const list = [...found.values()]
    .filter((c) => /^[a-z0-9][a-z0-9:_-]*$/i.test(c.name))
    .sort((a, b) => a.name.localeCompare(b.name));

  cache.byProvider[provider] = list;
  return list;
}
