import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { mergeHookResults, projectSyncHook, agentOpsRoot } from '../../scripts/lib/agent-sync-hook.mjs';

test('both request and coordination Stop reasons survive', () => {
  assert.deepEqual(mergeHookResults({ decision: 'block', reason: 'mark requests' }, { decision: 'block', reason: 'post changes' }), { decision: 'block', reason: 'mark requests\n\npost changes' });
});

test('context survives silent hooks and combines when both speak', () => {
  const context = text => ({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } });
  assert.deepEqual(mergeHookResults(null, context('board')), context('board'));
  assert.deepEqual(mergeHookResults(context('requests'), null), context('requests'));
  assert.deepEqual(mergeHookResults(context('requests'), context('board')), context('requests\n\nboard'));
});

test('external hook uses the configured authority and normal JSON payload', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tf-sync-'));
  try {
    const root = join(dir, 'queue');
    mkdirSync(root);
    writeFileSync(join(root, 'agent_sync.py'), 'import json,sys\np=json.load(sys.stdin)\nprint(json.dumps({"decision":"block","reason":p["session_id"]}))\n');
    const config = join(dir, 'config.json');
    writeFileSync(config, JSON.stringify({ agentOpsRoot: root }));
    const env = { ...process.env, TERMFLEET_CONFIG_FILE: config, TERMFLEET_AGENT_OPS_ROOT: '' };
    assert.equal(agentOpsRoot(env), root);
    assert.deepEqual(projectSyncHook({ hook_event_name: 'Stop', session_id: 'outside-agent', stop_hook_active: true }, { env }), { decision: 'block', reason: 'outside-agent' });
    const cli = spawnSync(process.execPath, ['scripts/termfleet-asks.mjs', '--hook'], {
      input: JSON.stringify({ hook_event_name: 'Stop', session_id: 'running-codex', stop_hook_active: true }),
      encoding: 'utf8', env: { ...env, TERMFLEET_ASKS: 'off' },
    });
    assert.equal(cli.status, 0, cli.stderr);
    assert.deepEqual(JSON.parse(cli.stdout), { decision: 'block', reason: 'running-codex' }, 'existing trusted CLI invokes coordination even when the request hook is silent');
    assert.equal(agentOpsRoot({ ...env, TERMFLEET_AGENT_OPS_ROOT: '/other' }), '/other');
    writeFileSync(join(root, 'agent_sync.py'), 'print("not json")\n');
    assert.equal(projectSyncHook({ hook_event_name: 'Stop' }, { env }), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('unconfigured installations stay silent without selecting a different queue', () => {
  assert.equal(projectSyncHook({ hook_event_name: 'SessionStart' }, { env: { HOME: '/missing' } }), null);
});
