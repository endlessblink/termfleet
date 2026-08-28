import fs from 'node:fs';

/**
 * Read the last `bytes` of a file as whole lines. Agent transcripts grow into
 * the hundreds of megabytes; loading one whole for a phone screen would spike
 * memory and stall the request, so we only ever touch the end of it.
 */
export function tailLines(file, bytes = 512 * 1024) {
  let fd;
  try {
    const { size } = fs.statSync(file);
    const start = Math.max(0, size - bytes);
    const length = size - start;
    if (length === 0) return [];

    fd = fs.openSync(file, 'r');
    const buf = Buffer.allocUnsafe(length);
    fs.readSync(fd, buf, 0, length, start);
    const text = buf.toString('utf8');
    const lines = text.split('\n').filter(Boolean);
    // The first line is probably a fragment of a record we cut in half.
    if (start > 0) lines.shift();
    return lines;
  } catch {
    return [];
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* ignore */ }
  }
}
