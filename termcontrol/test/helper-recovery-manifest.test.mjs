import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { bindHelperRecoveryManifest } from '../../scripts/lib/helper-recovery-manifest.mjs';

const paneId = 'terminal-11111111-1111-4111-8111-111111111111-22222222-2222-4222-8222-222222222222';
const sessionId = '33333333-3333-4333-8333-333333333333';

function fixture(t, meta = {}) {
  const dataRoot = mkdtempSync(join(tmpdir(), 'helper-recovery-'));
  t.after(() => rmSync(dataRoot, { recursive: true, force: true }));
  const stem = join(dataRoot, 'sessions', Buffer.from(paneId).toString('hex'));
  mkdirSync(join(dataRoot, 'sessions'));
  const checkpoint = { cwd: '/project', command: 'codex task; exec bash', ...meta };
  writeFileSync(`${stem}.meta.json`, JSON.stringify(checkpoint));
  writeFileSync(`${stem}.lifecycle.json`, JSON.stringify('recoverable'));
  const requests = [];
  const args = {
    paneId, provider: 'codex', dataRoot,
    payload: { hook_event_name: 'SessionStart', session_id: sessionId, cwd: '/project' },
    ask: async (request) => {
      requests.push(request);
      return { ok: true, value: { type: 'recoveryUpdated', ok: true } };
    },
  };
  return { args, requests, stem, checkpoint };
}

test('known top-level identity binds its exact recoverable checkpoint through daemon IPC', async (t) => {
  const f = fixture(t);
  assert.equal(await bindHelperRecoveryManifest(f.args), true);
  assert.deepEqual(f.requests, [{ type: 'updateRecovery', id: paneId, update: {
    cwd: '/project', provider: 'codex', launchProfile: 'terminal', providerSessionId: sessionId,
  } }]);
  assert.deepEqual(JSON.parse(readFileSync(`${f.stem}.meta.json`)), f.checkpoint, 'hook must not rewrite checkpoints itself');
});

test('Codex prompt and Claude session events both bind known identities', async (t) => {
  for (const [provider, event] of [['codex', 'UserPromptSubmit'], ['claude', 'SessionStart']]) {
    const f = fixture(t);
    assert.equal(await bindHelperRecoveryManifest({ ...f.args, provider, payload: {
      hookEventName: event, sessionId, cwd: '/project',
    } }), true);
    assert.equal(f.requests[0].update.provider, provider);
  }
});

test('any existing conversation binding is immutable, including the same identity', async (t) => {
  for (const bound of [sessionId, '44444444-4444-4444-8444-444444444444']) {
    const f = fixture(t, { providerSessionId: bound });
    assert.equal(await bindHelperRecoveryManifest(f.args), false);
    assert.equal(f.requests.length, 0);
  }
});

test('unknown, closed and backup checkpoints cannot be promoted', async (t) => {
  for (const lifecycle of ['unknown', 'intentional-kill', 'backup-only', null]) {
    const f = fixture(t);
    if (lifecycle === null) rmSync(`${f.stem}.lifecycle.json`);
    else writeFileSync(`${f.stem}.lifecycle.json`, JSON.stringify(lifecycle));
    assert.equal(await bindHelperRecoveryManifest(f.args), false);
    assert.equal(f.requests.length, 0);
  }
});

test('reject nested agents, other events, invalid identities and cwd/provider mismatches', async (t) => {
  for (const patch of [
    { agent_id: 'worker' }, { agentId: 'worker' }, { subagent_id: 'worker' },
    { is_subagent: true }, { parent_session_id: sessionId },
    { hook_event_name: 'PostToolUse' }, { session_id: '' }, { session_id: 'unsafe; exit' },
    { cwd: '/another-project' }, { cwd: 'relative' },
  ]) {
    const f = fixture(t);
    assert.equal(await bindHelperRecoveryManifest({ ...f.args, payload: { ...f.args.payload, ...patch } }), false);
    assert.equal(f.requests.length, 0);
  }
  const f = fixture(t, { provider: 'claude' });
  assert.equal(await bindHelperRecoveryManifest(f.args), false);
  assert.equal(f.requests.length, 0);
});

test('authentication and resume failure fields are never cleared by identity binding', async (t) => {
  const f = fixture(t, { restoreStatus: 'needs-auth', restoreFailureReason: 'Sign in required' });
  assert.equal(await bindHelperRecoveryManifest(f.args), true);
  assert.equal('restoreStatus' in f.requests[0].update, false);
  assert.equal('restoreFailureReason' in f.requests[0].update, false);
});

test('missing/malformed metadata and unavailable daemon fail quietly', async (t) => {
  const f = fixture(t);
  assert.equal(await bindHelperRecoveryManifest({ ...f.args, ask: undefined, socketPath: join(f.args.dataRoot, 'missing.sock') }), false);
  assert.equal(await bindHelperRecoveryManifest({ ...f.args, ask: async () => { throw new Error('unavailable'); } }), false);
  assert.equal(await bindHelperRecoveryManifest({ ...f.args, ask: async () => ({ ok: false }) }), false);
  assert.equal(await bindHelperRecoveryManifest({ ...f.args, ask: async () => ({ ok: true, value: { type: 'error' } }) }), false);
  writeFileSync(`${f.stem}.meta.json`, '{');
  assert.equal(await bindHelperRecoveryManifest(f.args), false);
  rmSync(`${f.stem}.meta.json`);
  assert.equal(await bindHelperRecoveryManifest(f.args), false);
});

test('existing daemon client sends the camelCase recovery wire request to an isolated socket', async (t) => {
  const f = fixture(t);
  const socketPath = join(f.args.dataRoot, 'daemon.sock');
  const received = [];
  const server = createServer((socket) => {
    let raw = '';
    socket.on('data', (chunk) => { raw += chunk; });
    socket.on('end', () => {
      const request = JSON.parse(raw);
      received.push(request);
      // Model the existing daemon merge, preserving checkpoint fields.
      const meta = JSON.parse(readFileSync(`${f.stem}.meta.json`));
      writeFileSync(`${f.stem}.meta.json`, JSON.stringify({ ...meta, ...request.update, recoveryKind: 'agent-terminal' }));
      socket.end(JSON.stringify({ type: 'recoveryUpdated', ok: true }));
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const args = { ...f.args, ask: undefined, socketPath };
  assert.equal(await bindHelperRecoveryManifest(args), true);
  assert.equal(await bindHelperRecoveryManifest(args), false, 'later events must not send a second binding');
  assert.equal(received.length, 1);
  assert.equal(received[0].type, 'updateRecovery');
  const saved = JSON.parse(readFileSync(`${f.stem}.meta.json`));
  assert.equal(saved.providerSessionId, sessionId);
  assert.equal(saved.command, f.checkpoint.command);
  assert.equal(saved.recoveryKind, 'agent-terminal');
});
