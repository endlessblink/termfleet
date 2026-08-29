import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Files in a terminal's project, for the "@" picker. Typing a path on a phone
 * is miserable; picking one is not.
 *
 * Git already knows which files matter — it excludes build output, caches and
 * anything ignored — so it is used when the folder is a repository, with a
 * bounded walk as the fallback.
 */
const cache = new Map();                 // cwd -> { at, files }
const CACHE_MS = 30_000;
const LIMIT = 4000;

const run = (cmd, args, cwd) => new Promise((resolve) => {
  execFile(cmd, args, { cwd, timeout: 4000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
    resolve(error ? null : String(stdout));
  });
});

function walk(root) {
  const out = [];
  const skip = new Set(['node_modules', '.git', 'target', 'dist', 'build', '.venv', '__pycache__', '.next', 'vendor']);
  const stack = [{ dir: root, depth: 0 }];
  while (stack.length && out.length < LIMIT) {
    const { dir, depth } = stack.pop();
    if (depth > 5) continue;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.name.startsWith('.') && e.name !== '.env') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!skip.has(e.name)) stack.push({ dir: full, depth: depth + 1 });
      } else if (out.length < LIMIT) {
        out.push(path.relative(root, full));
      }
    }
  }
  return out;
}

export async function filesIn(cwd) {
  if (!cwd || !fs.existsSync(cwd)) return [];
  const held = cache.get(cwd);
  if (held && Date.now() - held.at < CACHE_MS) return held.files;

  let files = [];
  const tracked = await run('git', ['ls-files', '--cached', '--others', '--exclude-standard'], cwd);
  if (tracked) files = tracked.split('\n').filter(Boolean).slice(0, LIMIT);
  if (!files.length) files = walk(cwd);

  cache.set(cwd, { at: Date.now(), files });
  return files;
}

/** Rank by where the query hits: the file's own name first, then its path. */
export function matchFiles(files, query, limit = 40) {
  const q = String(query || '').toLowerCase();
  if (!q) return files.slice(0, limit);

  const scored = [];
  for (const file of files) {
    const lower = file.toLowerCase();
    const name = lower.slice(lower.lastIndexOf('/') + 1);
    let score;
    if (name.startsWith(q)) score = 0;
    else if (name.includes(q)) score = 1;
    else if (lower.includes(q)) score = 2;
    else continue;
    scored.push({ file, score, length: file.length });
    if (scored.length > 2000) break;
  }

  return scored
    .sort((a, b) => a.score - b.score || a.length - b.length || a.file.localeCompare(b.file))
    .slice(0, limit)
    .map((s) => s.file);
}
