#!/usr/bin/env node
// Authenticated loopback read-back. Only attempts a launch after the loaded
// policy receipt declares Claude denied; never invokes a provider binary.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { requestDaemon, defaultDaemonSocket } from './termfleetctl.mjs';

const origin = 'http://127.0.0.1:7810';
const signIn = await fetch(`${origin}/embed`, { redirect: 'manual', headers: { 'sec-fetch-dest': 'iframe' } });
assert.equal(signIn.status, 302, 'local owner embed sign-in available');
const cookie = signIn.headers.get('set-cookie')?.split(';')[0];
assert.ok(cookie, 'owner session issued internally');
const headers = { cookie, origin, 'content-type': 'application/json' };
const before = await requestDaemon({ type: 'listSessions' }, defaultDaemonSocket());
assert.equal(before.ok, true);
const getPolicy = async () => {
  const response = await fetch(`${origin}/api/provider-policy`, { headers });
  assert.equal(response.status, 200, 'loaded bridge exposes launch policy');
  return response.json();
};
const policy = await getPolicy();
const expected = createHash('sha256').update(fs.readFileSync(new URL('./lib/provider-launch-policy.mjs', import.meta.url))).digest('hex');
assert.equal(policy.implementationHash, expected, 'loaded policy matches tested implementation');
assert.equal(policy.claudeAllowed, false);
assert.equal(policy.standingRule, 'owner-approval-required');
const denied = await fetch(`${origin}/api/spawn`, { method: 'POST', headers,
  body: JSON.stringify({ provider: 'claude', task: 'Check quota denial without starting a provider' }) });
assert.equal(denied.status, 403);
const result = await denied.json();
assert.equal(result.code, 'CLAUDE_LAUNCH_DENIED');
assert.ok(result.auditId, 'this denial has a durable receipt');
assert.ok(!policy.recent.some(x => x.id === result.auditId), 'receipt did not exist before this request');
const afterPolicy = await getPolicy();
assert.ok(afterPolicy.recent.some(x => x.id === result.auditId && x.surface === 'web-spawn' && x.outcome === 'denied'), 'this exact durable denial visible to owner');
const after = await requestDaemon({ type: 'listSessions' }, defaultDaemonSocket());
assert.equal(after.ok, true);
const identities = value => value.sessions.map(x => ({ id: x.id, pid: x.pid, runtimeRunId: x.runtimeRunId })).sort((a, b) => a.id.localeCompare(b.id));
assert.deepEqual(identities(after.value), identities(before.value), 'denied launch preserves daemon sessions');
console.log(JSON.stringify({ result: 'PASS', bridgePolicyHash: policy.implementationHash,
  webClaudeStatus: denied.status, denial: result.code, ownerAuditVisible: true,
  daemonSessionsUnchanged: true, protection: policy.protection,
  credentialIsolation: policy.credentialIsolation, auditId: result.auditId,
  proofScope: 'HTTP denial, exact new audit receipt, unchanged daemon sessions; provider calls not instrumented' }));
