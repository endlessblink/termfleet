import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const DIR = process.env.TC_CONFIG_DIR || path.join(os.homedir(), '.config', 'termcontrol');
const USERS = path.join(DIR, 'users.json');
const SECRET = path.join(DIR, 'session.key');

const readJson = (p, fallback) => {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
};

function ensureDir() {
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
}

/** One long-lived secret used to sign session cookies. */
function sessionSecret() {
  ensureDir();
  if (!fs.existsSync(SECRET)) {
    fs.writeFileSync(SECRET, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  }
  return fs.readFileSync(SECRET, 'utf8').trim();
}

const load = () => readJson(USERS, { users: [] });

function save(data) {
  ensureDir();
  fs.writeFileSync(USERS, JSON.stringify(data, null, 2), { mode: 0o600 });
}

export const hasAccount = () => load().users.length > 0;
export const normaliseEmail = (e) => String(e || '').trim().toLowerCase();

function hash(password, salt) {
  return crypto.scryptSync(String(password), salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
}

export function createAccount(email, password) {
  const mail = normaliseEmail(email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) return { error: 'That does not look like an email address.' };
  if (String(password).length < 8) return { error: 'Use at least 8 characters.' };

  const data = load();
  if (data.users.some((u) => u.email === mail)) return { error: 'That account already exists.' };

  const salt = crypto.randomBytes(16).toString('hex');
  data.users.push({ id: crypto.randomUUID(), email: mail, salt, hash: hash(password, salt), createdAt: Date.now() });
  save(data);
  return { ok: true, email: mail };
}

export function verify(email, password) {
  const mail = normaliseEmail(email);
  const user = load().users.find((u) => u.email === mail);
  // Hash regardless, so a wrong email costs the same time as a wrong password.
  const candidate = hash(password, user ? user.salt : 'absent-user-salt');
  if (!user) return null;
  const a = Buffer.from(candidate);
  const b = Buffer.from(user.hash);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return { id: user.id, email: user.email };
}

const DAYS = 120;

export function mintSession(user) {
  const expires = Date.now() + DAYS * 86400_000;
  const body = `${user.id}.${expires}`;
  const sig = crypto.createHmac('sha256', sessionSecret()).update(body).digest('hex');
  return { value: `${body}.${sig}`, maxAge: DAYS * 86400 };
}

export function readSession(cookie) {
  if (!cookie) return null;
  const parts = String(cookie).split('.');
  if (parts.length !== 3) return null;
  const [id, expires, sig] = parts;
  const expected = crypto.createHmac('sha256', sessionSecret()).update(`${id}.${expires}`).digest('hex');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (Number(expires) < Date.now()) return null;
  const user = load().users.find((u) => u.id === id);
  return user ? { id: user.id, email: user.email } : null;
}

/** Simple in-memory throttle: slows guessing without a database. */
const attempts = new Map();
export function tooManyAttempts(ip) {
  const now = Date.now();
  const rec = attempts.get(ip) || { count: 0, until: 0 };
  if (rec.until > now) return true;
  rec.count = now - (rec.last || 0) > 300_000 ? 1 : rec.count + 1;
  rec.last = now;
  if (rec.count > 8) { rec.until = now + 300_000; rec.count = 0; }
  attempts.set(ip, rec);
  return rec.until > now;
}
