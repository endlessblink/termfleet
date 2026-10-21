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
