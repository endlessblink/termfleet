import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { captureMessage, loadLedger, record } from '../bridge/requirements.mjs';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'requirements-lock-'));
  t.after(() => {
    fs.chmodSync(dir, 0o700);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

test('access denied creating the lock is reported immediately without stale-lock removal', (t) => {
  const dir = fixture(t), lock = path.join(dir, '.lock');
  fs.mkdirSync(lock);
  fs.utimesSync(lock, new Date(0), new Date(0));
  const denied = Object.assign(new Error(`EACCES: permission denied, mkdir '${lock}'`), { code: 'EACCES', path: lock, syscall: 'mkdir' });
  const mkdir = fs.mkdirSync;
  t.mock.method(fs, 'mkdirSync', (file, ...args) => {
    if (file === lock) throw denied;
    return mkdir(file, ...args);
  });
  let clock = 20000;
  t.mock.method(Date, 'now', () => clock += 6000);
  assert.throws(() => record([], { dir }), error => error === denied);
  assert.ok(fs.existsSync(lock), 'a denied caller cannot reap an existing writer lock');
});

test('an actual read-only ledger directory is not misreported as contention', (t) => {
  if (process.getuid?.() === 0) return t.skip('root bypasses directory mode restrictions');
  const dir = fixture(t);
  fs.chmodSync(dir, 0o500);
  let clock = 20000;
  t.mock.method(Date, 'now', () => clock += 6000);
  assert.throws(() => record([], { dir }), error =>
    error.code === 'EACCES' && error.path === path.join(dir, '.lock'));
});

test('storage failure preserves the actual filesystem code and ledger contents', (t) => {
  const dir = fixture(t);
  const [item] = captureMessage({ text: 'Keep the original request', project: 'lock-test', source: 'lock-test' }, { dir });
  const before = fs.readFileSync(path.join(dir, 'ledger.jsonl'));
  const fault = Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' });
  const mkdir = fs.mkdirSync;
  t.mock.method(fs, 'mkdirSync', (file, ...args) => {
    if (file === path.join(dir, '.lock')) throw fault;
    return mkdir(file, ...args);
  });
  let clock = 20000;
  t.mock.method(Date, 'now', () => clock += 6000);
  assert.throws(() => record([{ id: item.id, e: 'status', status: 'answered' }], { dir }), error => error === fault);
  assert.deepEqual(fs.readFileSync(path.join(dir, 'ledger.jsonl')), before);
  assert.equal(loadLedger({ dir }).items.get(item.id).status, 'new');
});

test('a current competing lock still reports contention without changing it', (t) => {
  const dir = fixture(t), lock = path.join(dir, '.lock');
  fs.mkdirSync(lock);
  const stamp = fs.statSync(lock).mtimeMs;
  let clock = stamp;
  t.mock.method(Date, 'now', () => clock += 3000);
  assert.throws(() => record([], { dir }), /ledger is busy/);
  assert.equal(fs.statSync(lock).mtimeMs, stamp);
});

test('normal capture and update retain identity and release their lock', (t) => {
  const dir = fixture(t);
  const message = { text: 'Keep delivery and updates working', project: 'lock-test', source: 'lock-test', msgId: 'stable-message' };
  const [item] = captureMessage(message, { dir });
  assert.equal(captureMessage(message, { dir })[0].id, item.id);
  record([{ id: item.id, e: 'status', status: 'answered', note: 'read back' }], { dir });
  assert.equal(loadLedger({ dir }).items.get(item.id).status, 'answered');
  assert.equal(fs.existsSync(path.join(dir, '.lock')), false);
});
