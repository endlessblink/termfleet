// Where a bot works (Noam 2026-10-22): a project folder he picks, or its own home folder.
// Existing folders are only checked and listed here. The one thing this file makes is an
// EMPTY new folder he names, inside the folder he is looking at; it never replaces anything.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

/** A typed or picked folder → { folder } (null when left empty) or { error }. */
export function checkFolder(value) {
  let raw = String(value ?? '').trim();
  if (!raw) return { folder: null };
  if (raw.includes('\0') || raw.length > 1000) return { error: 'That folder path is not valid.' };
  if (raw === '~' || raw.startsWith('~/')) raw = path.join(os.homedir(), raw.slice(1));
  if (!path.isAbsolute(raw)) return { error: 'Give the full folder path, starting with / or ~.' };
  const folder = path.resolve(raw);
  let st;
  try { st = fs.statSync(folder); } catch { return { error: 'That folder does not exist.' }; }
  if (!st.isDirectory()) return { error: 'That is a file, not a folder.' };
  return { folder };
}

/** Folders the fleet already knows (saved projects, live terminals, other bots), once each. */
export function knownFolders({ projects = [], panes = [], bots = [] } = {}) {
  const seen = new Map();
  const add = (cwd, name) => {
    if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) return;
    const folder = path.resolve(cwd);
    if (seen.has(folder) || !isDir(folder)) return;
    seen.set(folder, { name: name || path.basename(folder) || folder, cwd: folder });
  };
  for (const p of projects) add(p?.cwd, p?.name);
  for (const p of panes) add(p?.cwd);
  for (const b of bots) add(b?.cwd);
  return [...seen.values()];
}

/**
 * Where browsing starts: his projects area, the deepest folder that holds most of the known
 * projects (they can sit on more than one drive). Never the top of the disk; else home.
 */
export function startFolder(known = []) {
  const dirs = [...new Set(known.map((k) => k?.cwd).filter((c) => typeof c === 'string' && path.isAbsolute(c)).map((c) => path.resolve(c)))];
  const counts = new Map();
  for (const d of dirs) for (let up = path.dirname(d); up !== path.parse(up).root; up = path.dirname(up)) counts.set(up, (counts.get(up) || 0) + 1);
  const best = [...counts].filter(([dir, n]) => n > dirs.length / 2 && isDir(dir)).sort((a, b) => b[0].length - a[0].length)[0];
  return best ? best[0] : os.homedir();
}

/** The folders inside one folder (no hidden ones), for browsing. */
export function subfolders(dir) {
  const { folder, error } = checkFolder(dir);
  if (error || !folder) return { error: error || 'That folder does not exist.' };
  let entries = [];
  try { entries = fs.readdirSync(folder, { withFileTypes: true }); } catch { return { error: 'That folder cannot be opened.' }; }
  const dirs = entries.filter((e) => !e.name.startsWith('.') && (e.isDirectory() || (e.isSymbolicLink() && isDir(path.join(folder, e.name)))))
    .map((e) => ({ name: e.name, cwd: path.join(folder, e.name) }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  const parent = path.dirname(folder);
  return { path: folder, parent: parent === folder ? null : parent, dirs };
}

/** Makes one empty new folder named `name` inside `dir`. Fails if anything has that name. */
export function makeFolder(dir, name) {
  const { folder: parent, error } = checkFolder(dir);
  if (error || !parent) return { error: error || 'That folder does not exist.' };
  const n = String(name ?? '').trim();
  if (!n || n.length > 120 || n === '.' || n === '..' || n.startsWith('.') || /[/\\\0]/.test(n)) return { error: 'Use a plain name for the new folder (no / and not starting with a dot).' };
  const folder = path.join(parent, n);
  if (path.dirname(folder) !== parent) return { error: 'Use a plain name for the new folder.' };
  try { fs.mkdirSync(folder); } catch (e) {
    return { error: e.code === 'EEXIST' ? 'Something with that name is already there.' : 'Could not make the folder there.' };
  }
  return { folder };
}
