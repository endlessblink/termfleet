import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * A screenshot path an agent mentions ("/home/…/shot.png") opens as a picture
 * in the chat. Only picture files, only under the home folder or the temp
 * folder, and only to a signed-in viewer: nothing else on the PC is reachable.
 */
const TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
const MAX_BYTES = 25 * 1024 * 1024;

export function resolveLocalImage(raw, { home = os.homedir(), roots = [home, os.tmpdir(), '/tmp'] } = {}) {
  const asked = String(raw || '').trim();
  if (!asked || asked.includes('\0')) return null;
  const full = asked.startsWith('~/') ? path.join(home, asked.slice(2)) : asked;
  if (!path.isAbsolute(full)) return null;
  const type = TYPES[path.extname(full).toLowerCase()];
  if (!type) return null;
  let real;
  try { real = fs.realpathSync(full); } catch { return null; }
  // The real file decides, so a link from home to elsewhere is refused.
  if (!TYPES[path.extname(real).toLowerCase()]) return null;
  const inside = roots.some((root) => {
    let base; try { base = fs.realpathSync(root); } catch { return false; }
    return real === base || real.startsWith(base + path.sep);
  });
  if (!inside) return null;
  let stat; try { stat = fs.statSync(real); } catch { return null; }
  if (!stat.isFile() || stat.size > MAX_BYTES) return null;
  return { file: real, type, size: stat.size };
}

/**
 * Any file dragged from the PC's file manager onto a chat in the PC app (the engine
 * hands over only its address). Same places as a pasted picture; folders, links that
 * lead elsewhere and files over 25 MB are refused.
 */
export function resolveLocalFile(raw, { home = os.homedir(), roots = [home, os.tmpdir(), '/tmp'] } = {}) {
  const asked = String(raw || '').trim();
  if (!asked || asked.includes('\0')) return null;
  const full = asked.startsWith('~/') ? path.join(home, asked.slice(2)) : asked;
  if (!path.isAbsolute(full)) return null;
  let real;
  try { real = fs.realpathSync(full); } catch { return null; }
  const inside = roots.some((root) => {
    let base; try { base = fs.realpathSync(root); } catch { return false; }
    return real === base || real.startsWith(base + path.sep);
  });
  if (!inside) return null;
  let stat; try { stat = fs.statSync(real); } catch { return null; }
  if (!stat.isFile()) return null;
  if (stat.size > MAX_BYTES) return { error: 'That file is over 25 MB.' };
  return { file: real, type: TYPES[path.extname(real).toLowerCase()] || 'application/octet-stream', size: stat.size };
}
