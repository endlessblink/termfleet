import fs from 'node:fs';

/**
 * Read the last `bytes` of a file as whole lines. Agent transcripts grow into
 * the hundreds of megabytes; loading one whole for a phone screen would spike
 * memory and stall the request, so we only ever touch the end of it.
 *
 * Transcripts only ever grow, and the bridge asks for the same windows every few
 * seconds while agents keep writing, so re-reading the whole window each time cost
 * ~7 MB/s (Agent-Manager 2026-10-22: the PC was unusable). The last window is kept
 * per file: an unchanged file is not read, a grown one is read only from where the
 * last read stopped, and a rewritten (smaller or replaced) file is read fresh.
 */
const windows = new Map();   // `${file}|${bytes}` -> { ino, size, lines, lens, frag }
const MAX_WINDOWS = 48;
let bytesRead = 0;

export const tailReadStats = () => ({ bytesRead, windows: windows.size });

const byteLen = (s) => Buffer.byteLength(s, 'utf8');

function readRange(file, start, end) {
  const length = end - start;
  if (length <= 0) return '';
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.allocUnsafe(length);
    const got = fs.readSync(fd, buf, 0, length, start);
    bytesRead += got;
    return buf.subarray(0, got).toString('utf8');
  } finally {
    try { fs.closeSync(fd); } catch { /* ignore */ }
  }
}

function fresh(file, size, bytes) {
  const start = Math.max(0, size - bytes);
  const parts = readRange(file, start, size).split('\n');
  const frag = parts.pop();                 // '' when the file ends with a newline
  if (start > 0) parts.shift();             // probably a fragment of a record cut in half
  const lines = parts.filter(Boolean);
  return { lines, lens: lines.map((l) => byteLen(l) + 1), frag };
}

export function tailLines(file, bytes = 512 * 1024) {
  try {
    const stat = fs.statSync(file);
    const key = `${file}|${bytes}`;
    let win = windows.get(key);
    if (win && (win.ino !== stat.ino || stat.size < win.size)) win = null;
    if (!win) {
      if (stat.size === 0) return [];
      win = { ino: stat.ino, size: stat.size, ...fresh(file, stat.size, bytes) };
    } else if (stat.size > win.size) {
      const parts = (win.frag + readRange(file, win.size, stat.size)).split('\n');
      win.frag = parts.pop();
      for (const line of parts) if (line) { win.lines.push(line); win.lens.push(byteLen(line) + 1); }
      win.size = stat.size;
      // Keep only whole lines that sit inside the last `bytes` bytes, as a fresh read would.
      let total = byteLen(win.frag) + win.lens.reduce((a, b) => a + b, 0);
      let drop = 0;
      while (drop < win.lines.length && total > bytes) total -= win.lens[drop++];
      if (drop) { win.lines.splice(0, drop); win.lens.splice(0, drop); }
    }
    windows.delete(key);
    windows.set(key, win);
    if (windows.size > MAX_WINDOWS) windows.delete(windows.keys().next().value);
    return win.frag ? [...win.lines, win.frag] : [...win.lines];
  } catch {
    return [];
  }
}
