import fs from 'node:fs';
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

// Built into the agents themselves, so they never appear on disk.
const BUILT_IN = {
  claude: ['clear', 'compact', 'context', 'cost', 'help', 'model', 'resume', 'review', 'status'],
  codex: ['approvals', 'compact', 'diff', 'init', 'mention', 'model', 'new', 'quit', 'review', 'status'],
};

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

export function commandsFor(provider) {
  const now = Date.now();
  if (now - cache.at > CACHE_MS) cache = { at: now, byProvider: {} };
  if (cache.byProvider[provider]) return cache.byProvider[provider];

  const found = new Map();
  for (const name of BUILT_IN[provider] || []) {
    found.set(name, { name, detail: 'built in' });
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
