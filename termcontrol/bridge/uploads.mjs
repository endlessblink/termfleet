import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * Images sent from the phone. An agent in a terminal cannot receive a file
 * over the wire — but it can read one off the disk, so the image is saved on
 * the machine and the agent is handed its path.
 */
const DIR = process.env.TC_UPLOAD_DIR
  || path.join(os.homedir(), 'Pictures', 'termcontrol');

const KINDS = new Map([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif'],
  ['image/heic', '.heic'],
]);

const MAX_BYTES = 25 * 1024 * 1024;

export function uploadLimits() {
  return { maxBytes: MAX_BYTES, kinds: [...KINDS.keys()] };
}

/** Read a whole request body, refusing anything oversized. */
export function readBody(req, limit = MAX_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { req.destroy(); reject(new Error('too large')); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * Pull the first file out of a multipart body. Small and deliberate rather
 * than a dependency: one file, one field, nothing else.
 */
export function firstFile(buffer, contentType) {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  const boundary = match && (match[1] || match[2]);
  if (!boundary) return null;

  const sep = Buffer.from(`--${boundary}`);
  const parts = [];
  let index = buffer.indexOf(sep);
  while (index !== -1) {
    const next = buffer.indexOf(sep, index + sep.length);
    if (next === -1) break;
    parts.push(buffer.subarray(index + sep.length, next));
    index = next;
  }

  for (const part of parts) {
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;
    const headers = part.subarray(0, headerEnd).toString('utf8');
    if (!/filename="/i.test(headers)) continue;

    const type = (/content-type:\s*([^\r\n;]+)/i.exec(headers)?.[1] || '').trim().toLowerCase();
    const name = /filename="([^"]*)"/i.exec(headers)?.[1] || 'image';
    let body = part.subarray(headerEnd + 4);
    if (body.length >= 2 && body[body.length - 2] === 0x0d) body = body.subarray(0, body.length - 2);
    return { type, name, body };
  }
  return null;
}

export function saveImage({ type, name, body }) {
  const ext = KINDS.get(type) || path.extname(name).toLowerCase();
  if (!KINDS.has(type) && !['.png', '.jpg', '.jpeg', '.webp', '.gif', '.heic'].includes(ext)) {
    return { error: 'That file type is not supported. Send a photo or a screenshot.' };
  }
  if (!body?.length) return { error: 'The image was empty.' };
  if (body.length > MAX_BYTES) return { error: 'That image is too large.' };

  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = path.join(DIR, `${stamp}-${crypto.randomBytes(3).toString('hex')}${ext || '.png'}`);
  fs.writeFileSync(file, body, { mode: 0o600 });
  return { ok: true, path: file, bytes: body.length };
}
