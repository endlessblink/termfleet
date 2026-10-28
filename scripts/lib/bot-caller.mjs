// Cooperative attribution, not isolation against code running as the same Unix user.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

export const BOT_CALLER_TOKEN_ENV = 'TERMFLEET_BOT_CALLER_TOKEN';
const TTL_MS = 24 * 60 * 60 * 1000;
const fail = () => { throw new Error('Bot caller context is missing, invalid, expired, or contradicts this command.'); };
const baseDir = (options) => options.base ?? path.join(os.userInfo().homedir, '.termfleet-bot-callers');
const clock = (options) => typeof options.now === 'function' ? options.now() : options.now ?? Date.now();
const value = (input) => typeof input === 'string' ? input.trim() : '';
const receiptPath = (base, token) => path.join(base, `${createHash('sha256').update(token).digest('hex')}.json`);

function checkStat(stat, directory = false) {
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())
    || stat.uid !== os.userInfo().uid || (stat.mode & 0o777) !== (directory ? 0o700 : 0o600)
    || (!directory && stat.nlink !== 1)) fail();
}

function checkDirectory(base, create = false) {
  if (create) {
    try { fs.mkdirSync(base, { mode: 0o700 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  checkStat(fs.lstatSync(base), true);
}

function validRecord(record) {
  return record && record.version === 1 && typeof record.id === 'string' && /^[0-9a-f]{12}$/.test(record.id)
    && typeof record.name === 'string' && record.name.trim().length > 0
    && typeof record.botFolder === 'string' && path.isAbsolute(record.botFolder) && !record.botFolder.includes('\0')
    && ['codex', 'claude'].includes(record.provider)
    && (record.sessionId === null || (typeof record.sessionId === 'string' && record.sessionId.length > 0))
    && Number.isFinite(record.expiresAt);
}

function readReceipt(base, file) {
  checkDirectory(base);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    checkStat(fs.fstatSync(fd));
    const record = JSON.parse(fs.readFileSync(fd, 'utf8'));
    if (!validRecord(record)) fail();
    return record;
  } finally { fs.closeSync(fd); }
}

/** Test options are explicit arguments, never values read from caller environment. */
export function issueBotCaller({ id, name, provider, botFolder, sessionId = null }, options = {}) {
  const ttlMs = options.ttlMs ?? TTL_MS;
  if (!(Number.isFinite(ttlMs) && ttlMs > 0)) fail();
  const record = { version: 1, id, name, provider, botFolder, sessionId, expiresAt: clock(options) + ttlMs };
  if (!validRecord(record)) fail();
  const base = baseDir(options), token = randomBytes(32).toString('hex');
  const file = receiptPath(base, token);
  checkDirectory(base, true);
  fs.writeFileSync(file, JSON.stringify(record), { flag: 'wx', mode: 0o600 });
  let revoked = false;
  return {
    token,
    updateSession(nextSessionId) {
      if (revoked || !value(nextSessionId)) fail();
      readReceipt(base, file);
      record.sessionId = value(nextSessionId);
      const temporary = `${file}.${randomBytes(8).toString('hex')}.tmp`;
      try {
        fs.writeFileSync(temporary, JSON.stringify(record), { flag: 'wx', mode: 0o600 });
        fs.renameSync(temporary, file);
      } finally { try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
    },
    revoke() {
      if (revoked) return;
      checkDirectory(base);
      try { fs.unlinkSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      revoked = true;
    },
  };
}

export function resolveBotCaller(env = process.env, options = {}) {
  const token = value(env[BOT_CALLER_TOKEN_ENV]);
  const id = value(env.TERMFLEET_BOT_ID), name = value(env.TERMFLEET_BOT_NAME);
  if (!token && !id && !name) return null;
  try {
    if (!/^[0-9a-f]{64}$/.test(token) || value(env.TERMFLEET_PANE_ID)) fail();
    const base = baseDir(options);
    const record = readReceipt(base, receiptPath(base, token));
    if (record.expiresAt <= clock(options) || (id && id !== record.id) || (name && name !== record.name)) fail();
    for (const key of ['CODEX_THREAD_ID', 'CODEX_SESSION_ID']) {
      if (value(env[key]) && (record.provider !== 'codex' || value(env[key]) !== record.sessionId)) fail();
    }
    return { kind: 'bot', botId: record.id, id: record.id, name: record.name, provider: record.provider, botFolder: record.botFolder, sessionId: record.sessionId, paneId: undefined };
  } catch { return fail(); }
}
