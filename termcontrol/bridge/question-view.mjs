import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * A page on the PC that a question card links to (a comparison page, a mockup, a
 * picture), opened in Noam's browser on the PC and on the phone (Noam 2026-10-24:
 * "שתמיד יהיה לינק עם אופציות"). The link is /view/<folder>/<file>, so the page's
 * own pictures and styles load from the same folder. The link carries a key made for
 * that one folder, so the page and its pictures load in any browser he opens it in, while
 * the page itself runs walled off (it can never act as him on this app). Only web files, only under the
 * home, temp or data-drive folders (where the projects live), never a hidden folder, never outside the linked folder, and
 * only through a link the app itself made.
 */
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg',
  '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
};
const MAX_BYTES = 200 * 1024 * 1024;
// Agents' own temp folder (where they often save what they made) counts as a temp folder.
const defaultRoots = (home = os.homedir()) => [home, os.tmpdir(), '/tmp', path.join(home, '.cache', 'termfleet', 'tmp'), '/media', '/mnt'];
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64url');
const unb64 = (s) => { try { return Buffer.from(s, 'base64url').toString('utf8'); } catch { return ''; } };
const hidden = (rel) => rel.split(path.sep).some((part) => part.startsWith('.'));

// The path inside the closest allowed folder (the temp folder inside home counts as the temp folder).
function insideRoots(real, roots) {
  let best = null;
  for (const root of roots) {
    let base; try { base = fs.realpathSync(root); } catch { continue; }
    if (real === base || real.startsWith(base + path.sep)) { const rel = path.relative(base, real); if (best === null || rel.length < best.length) best = rel; }
  }
  return best;
}

const keyFile = () => path.join(process.env.TC_CONFIG_DIR || path.join(os.homedir(), '.config', 'termcontrol'), 'view.key');
function viewKey() {
  const file = keyFile();
  try { return fs.readFileSync(file); } catch { /* made below */ }
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  try { fs.writeFileSync(file, crypto.randomBytes(32), { mode: 0o600, flag: 'wx' }); } catch { /* made meanwhile */ }
  return fs.readFileSync(file);
}
const sign = (dir64, key) => crypto.createHmac('sha256', key || viewKey()).update(dir64).digest('base64url').slice(0, 22);

/** The /view/ link for a file path a bot wrote ("/home/…/compare.html", "~/…"), or null. */
export function viewHref(raw, { home = os.homedir(), roots = defaultRoots(home), key } = {}) {
  const asked = String(raw || '').trim().replace(/^file:\/\//, '');
  if (!asked || asked.includes('\0')) return null;
  const full = asked.startsWith('~/') ? path.join(home, asked.slice(2)) : asked;
  if (!path.isAbsolute(full)) return null;
  let real; try { real = fs.realpathSync(full); } catch { return null; }
  if (!TYPES[path.extname(real).toLowerCase()]) return null;
  const rel = insideRoots(real, roots);
  if (rel === null || hidden(rel)) return null;
  try { if (!fs.statSync(real).isFile()) return null; } catch { return null; }
  const dir64 = b64(path.dirname(real));
  return `/view/${sign(dir64, key)}/${dir64}/${encodeURIComponent(path.basename(real))}`;
}

/** The file a /view/ link points at, or null when it is not one that may be shown. */
export function resolveView(pathname, { home = os.homedir(), roots = defaultRoots(home), key } = {}) {
  const m = /^\/view\/([A-Za-z0-9_-]{22})\/([A-Za-z0-9_-]+)\/(.+)$/.exec(String(pathname || ''));
  if (!m) return null;
  const want = Buffer.from(sign(m[2], key)), got = Buffer.from(m[1]);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
  const dir = unb64(m[2]);
  let rel; try { rel = decodeURIComponent(m[3]); } catch { return null; }
  if (!dir || !path.isAbsolute(dir) || rel.includes('\0') || dir.includes('\0')) return null;
  let base; try { base = fs.realpathSync(dir); } catch { return null; }
  const baseRel = insideRoots(base, roots);
  if (baseRel === null || hidden(baseRel)) return null;
  let real; try { real = fs.realpathSync(path.resolve(base, rel)); } catch { return null; }
  if (!real.startsWith(base + path.sep) || hidden(path.relative(base, real))) return null;
  const type = TYPES[path.extname(real).toLowerCase()];
  if (!type) return null;
  let stat; try { stat = fs.statSync(real); } catch { return null; }
  if (!stat.isFile() || stat.size > MAX_BYTES) return null;
  return { file: real, type, size: stat.size };
}

/**
 * Links a terminal agent's question carries (web addresses or page/picture files in the
 * question or in an answer's description), as { label, href }: the answer's name, or
 * "" for the question itself. Shown under the card, since a button cannot hold a link.
 */
const FOUND = /https?:\/\/[^\s<>"'`)\]]+|(?<![\w.])~?\/(?:[\w.@+-]+\/)+[\w.@+-]+\.(?:html?|pdf|svg|png|jpe?g|webp|gif|mp4|webm)(?![\w.])/gi;
export function questionLinks(title, options = [], opts) {
  const out = [], seen = new Set();
  const take = (text, label) => {
    for (const raw of String(text || '').match(FOUND) || []) {
      const href = cardLink(raw, opts);
      if (href && !seen.has(href)) { seen.add(href); out.push({ label, href }); }
    }
  };
  take(title, '');
  for (const o of options) take(o.detail || o.description, String(o.label || ''));
  return out.slice(0, 6);
}

/** A link a bot gave: a web address stays as it is, a file on the PC becomes its /view/ link. */
export function cardLink(raw, opts) {
  const s = String(raw || '').trim().replace(/[).,;]+$/, '');
  if (/^https?:\/\/[^\s/]/i.test(s)) return s;
  if (/^(?:localhost|127\.0\.0\.1):\d+/i.test(s)) return `http://${s}`;
  return viewHref(s, opts);
}
