import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const implementationHash = createHash('sha256').update(fs.readFileSync(fileURLToPath(import.meta.url))).digest('hex');

// Cooperative launch protection, not a security boundary against the same Unix
// user editing this code or invoking a provider binary directly. No environment
// flag, task text or claimed owner-words receipt authorizes a Claude exception.
const WINDOWS = ['five_hour', 'seven_day'];
const MAX_AGE_MS = 5 * 60 * 1000;
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const timestamp = (value) => finite(value)
  ? (value < 10_000_000_000 ? value * 1000 : value)
  : typeof value === 'string' ? Date.parse(value) : NaN;

function validLatch(latch) {
  return latch?.version === 1 && latch.windows && !Array.isArray(latch.windows)
    && typeof latch.windows === 'object'
    && Object.entries(latch.windows).every(([kind, window]) => WINDOWS.includes(kind)
      && finite(window?.resetAt) && window.resetAt > 0
      && finite(window?.observedAt) && window.observedAt > 0);
}

/** Raw subscription windows, never rounded display percentages or clock-only renewal. */
export function evaluateClaudeQuota(record, latch, now = Date.now()) {
  if (latch != null && !validLatch(latch)) return { allowed: false, reason: 'invalid-latch', latch };
  const next = { version: 1, windows: structuredClone(latch?.windows || {}) };
  const result = (allowed, reason) => ({ allowed, reason, latch: next });
  const observedAt = record?.observedAt;
  if (!finite(now) || !finite(observedAt) || observedAt <= 0 || observedAt > now) return result(false, 'usage-unavailable');
  const fresh = now - observedAt <= MAX_AGE_MS;
  let complete = true;
  for (const kind of WINDOWS) {
    const raw = record?.rate_limits?.[kind];
    const used = raw?.used_percentage;
    const resetAt = timestamp(raw?.resets_at);
    if (!finite(used) || used < 0 || used > 100 || !finite(resetAt) || resetAt <= 0) {
      complete = false;
      continue;
    }
    const previous = next.windows[kind];
    // A historical threshold observation remains protective even when stale.
    if (used >= 85) {
      next.windows[kind] = {
        resetAt: Math.max(previous?.resetAt || 0, resetAt),
        observedAt: Math.max(previous?.observedAt || 0, observedAt),
      };
    } else if (previous && fresh && observedAt > previous.resetAt
      && resetAt > previous.resetAt && resetAt > now) {
      delete next.windows[kind];
    }
    if (resetAt <= now) complete = false;
  }
  if (Object.keys(next.windows).length) return result(false, 'quota-latched');
  if (!fresh) return result(false, 'usage-stale');
  if (!complete) return result(false, 'usage-unavailable');
  return result(true, 'quota-below-limit');
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function writeLatch(file, value) {
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  let fd;
  try {
    fd = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(fd, `${JSON.stringify(value)}\n`);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temporary, file);
    const dir = fs.openSync(path.dirname(file), 'r');
    try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

function appendAudit(file, entry) {
  // One small O_APPEND write per decision, including lock-contention denials.
  const fd = fs.openSync(file, 'a', 0o600);
  try {
    const line = Buffer.from(`${JSON.stringify(entry)}\n`);
    if (fs.writeSync(fd, line) !== line.length) throw new Error('Incomplete audit write');
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  for (const directory of [path.dirname(file), path.dirname(path.dirname(file))]) {
    const dir = fs.openSync(directory, 'r');
    try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
  }
}

/** Isolated roots are for tests; production callers use assertProviderLaunch below. */
export function createProviderLaunchPolicy({ root, now = Date.now } = {}) {
  const dataRoot = root || path.join(os.homedir(), '.local/share/terminal-workspace');
  const directory = path.join(dataRoot, 'provider-policy');
  const auditFile = path.join(directory, 'audit.jsonl');
  return {
    assertProviderLaunch(provider, { surface = 'unknown' } = {}) {
      if (provider !== 'claude') return { allowed: true, provider };
      const at = now();
      const lock = path.join(directory, 'claude.lock');
      let acquired = false;
      let quotaReason = 'policy-unavailable';
      try {
        fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
        try { fs.mkdirSync(lock, { mode: 0o700 }); acquired = true; }
        catch (error) { if (error.code === 'EEXIST') quotaReason = 'policy-busy'; throw error; }
        const latchFile = path.join(directory, 'claude-latch.json');
        const latch = readJson(latchFile);
        let usage = null;
        try { usage = readJson(path.join(dataRoot, 'usage/claude.json')); } catch { /* unknown usage denies */ }
        const decision = evaluateClaudeQuota(usage, latch, at);
        if (decision.reason !== 'invalid-latch') writeLatch(latchFile, decision.latch);
        quotaReason = decision.reason;
      } catch { /* every policy/storage failure denies; never discard a corrupt latch */ }
      finally {
        if (acquired) {
          try { fs.rmdirSync(lock); } catch { quotaReason = 'policy-unavailable'; }
        }
      }
      const reason = quotaReason === 'quota-below-limit' ? 'owner-approval-required' : quotaReason;
      const entry = {
        version: 1, id: randomUUID(), at, provider: 'claude', outcome: 'denied', reason,
        quotaReason, standingRule: 'owner-approval-required', pid: process.pid,
        surface: typeof surface === 'string' && /^[a-zA-Z0-9_.:/-]{1,100}$/.test(surface) ? surface : 'unknown',
      };
      let audited = false;
      try { appendAudit(auditFile, entry); audited = true; } catch { /* unavailable audit cannot authorize */ }
      const error = new Error(`Claude launch denied: ${audited ? reason : 'audit-unavailable'}. Noam must explicitly authorize Claude through a protected owner approval path; agent flags and environment variables are not approval.`);
      error.code = 'CLAUDE_LAUNCH_DENIED';
      error.reason = audited ? reason : 'audit-unavailable';
      error.auditFile = auditFile;
      error.auditId = audited ? entry.id : undefined;
      throw error;
    },
  };
}

export function assertProviderLaunch(provider, options) {
  return createProviderLaunchPolicy().assertProviderLaunch(provider, options);
}

/** Owner-readable diagnostics, with no prompts, command arguments or credentials. */
export function providerLaunchStatus() {
  const root = path.join(os.homedir(), '.local/share/terminal-workspace');
  let usage = null, latch = null, recent = [];
  try { usage = readJson(path.join(root, 'usage/claude.json')); } catch { /* deny unknown */ }
  try { latch = readJson(path.join(root, 'provider-policy/claude-latch.json')); } catch { latch = {}; }
  let fd;
  try {
    fd = fs.openSync(path.join(root, 'provider-policy/audit.jsonl'), 'r');
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - 65536);
    const buffer = Buffer.alloc(size - start);
    fs.readSync(fd, buffer, 0, buffer.length, start);
    const lines = buffer.toString('utf8').trim().split('\n');
    if (start) lines.shift();
    recent = lines.slice(-30).flatMap(line => {
      try { const x = JSON.parse(line); return [{ id: x.id, at: x.at, provider: x.provider, outcome: x.outcome, reason: x.reason, surface: x.surface }]; }
      catch { return []; }
    });
  } catch { /* no audit yet */ }
  finally { if (fd !== undefined) fs.closeSync(fd); }
  return { standingRule: 'owner-approval-required', claudeAllowed: false,
    quota: evaluateClaudeQuota(usage, latch), recent, implementationHash,
    protection: 'cooperative-launch-checks', credentialIsolation: false };
}
