import { execFile } from 'node:child_process';
import os from 'node:os';
import { resolveLocalImage } from './local-image.mjs';

/**
 * Picture files copied in the PC's file manager and pasted with Ctrl+V in the PC app
 * (Noam 2026-10-23: "לא יכול להדביק תמונות בctrl+v"). The desktop engine tells the page
 * a file address is on the clipboard but blanks the address itself, so this server, on
 * the same PC, reads the copied files from the system clipboard instead.
 */
export const PASTE_ROOTS = () => [os.homedir(), os.tmpdir(), '/tmp', '/media', '/mnt'];

// Only a list made entirely of file:// addresses of pictures counts; anything else is text.
export function copiedPicturePaths(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const paths = lines.map((l) => {
    if (!l.startsWith('file://')) return '';
    try { return decodeURIComponent(new URL(l).pathname); } catch { return ''; }
  });
  return paths.length && paths.every((p) => /\.(png|jpe?g|webp|gif)$/i.test(p)) ? paths.slice(0, 10) : [];
}

const runFile = (cmd, args) => new Promise((resolve, reject) => {
  execFile(cmd, args, { timeout: 2000, maxBuffer: 1024 * 1024, encoding: 'utf8' }, (error, stdout) => (error ? reject(error) : resolve(stdout)));
});

export async function readCopiedPictureFiles({ run = runFile, env = process.env } = {}) {
  const [cmd, args] = env.WAYLAND_DISPLAY
    ? ['wl-paste', ['--no-newline', '--type', 'text/uri-list']]
    : ['xclip', ['-selection', 'clipboard', '-t', 'text/uri-list', '-o']];
  let text = '';
  try { text = await run(cmd, args); } catch { return []; }
  return copiedPicturePaths(text)
    .map((p) => resolveLocalImage(p, { roots: PASTE_ROOTS() })?.file)
    .filter(Boolean);
}
