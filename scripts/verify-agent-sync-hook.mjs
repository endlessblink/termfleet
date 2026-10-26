// Real external authority + existing Codex hook, isolated from live project state.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { agentOpsRoot } from './lib/agent-sync-hook.mjs';

const root = agentOpsRoot();
assert.ok(root, 'Configure the canonical agentOpsRoot before verification');
const dir = mkdtempSync(join(tmpdir(), 'tf-sync-integration-'));
const game = join(dir, 'game');
const outside = join(dir, 'outside');
const env = {
  ...process.env, TERMFLEET_AGENT_OPS_ROOT: root, TERMFLEET_PANE_ID: '', AGENT_SYNC_AGENT: '',
  AGENT_SYNC_HOME: join(dir, 'state'), AGENT_SYNC_CONFIG: join(dir, 'projects.json'),
  AGENT_SYNC_PLAN: join(dir, 'MASTER_PLAN.md'), TERMFLEET_ASKS: 'off',
};
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', env, ...options });
  assert.equal(result.status, 0, `${command}: ${result.stderr}`);
  return result.stdout;
}
const sync = (...args) => run('python3', [join(root, 'agent_sync.py'), ...args]);
function hook(event, cwd, session, pane = '') {
  const output = run(process.execPath, [resolve('scripts/termfleet-asks.mjs'), '--hook'], {
    input: JSON.stringify({ hook_event_name: event, cwd, session_id: session, stop_hook_active: event === 'Stop' }),
    env: { ...env, TERMFLEET_PANE_ID: pane },
  });
  return output.trim() ? JSON.parse(output) : null;
}
try {
  mkdirSync(game);
  run('git', ['init', '-q', '-b', 'main', game]);
  writeFileSync(join(game, 'a.txt'), 'initial\n');
  run('git', ['-C', game, 'add', '.']);
  run('git', ['-C', game, '-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'initial']);
  run('git', ['-C', game, 'worktree', 'add', '-q', '--detach', outside]);
  writeFileSync(env.AGENT_SYNC_PLAN, `# Plan\n\n### TASK-1: hook proof (IN PROGRESS)\n**Owner**: agent-a\n**Workspace**: \`${game}\`\n`);
  sync('register', 'fixture', '--root', game);
  sync('mode', 'fixture', 'enforce');
  sync('join', '--project', 'fixture', '--agent', 'agent-a', '--pane', 'pane-a', '--cwd', game);
  sync('join', '--project', 'fixture', '--agent', 'agent-b', '--pane', '', '--cwd', outside);
  assert.match(hook('SessionStart', game, 'sess-a', 'pane-a').hookSpecificOutput.additionalContext, /AGENT SYNC BOARD/);
  assert.match(hook('UserPromptSubmit', game, 'sess-a', 'pane-a').hookSpecificOutput.additionalContext, /mode: enforce/);
  assert.match(hook('UserPromptSubmit', outside, 'sess-b').hookSpecificOutput.additionalContext, /agent-b/);
  console.log('PASS two identities receive the enforced board, including an outside worktree');
  sync('send', '--project', 'fixture', '--to', 'agent-a', '--from', 'agent-b', '--text', 'outside agent update');
  assert.match(hook('UserPromptSubmit', game, 'sess-a', 'pane-a').hookSpecificOutput.additionalContext, /outside agent update/);
  assert.doesNotMatch(hook('UserPromptSubmit', game, 'sess-a', 'pane-a').hookSpecificOutput.additionalContext, /outside agent update/);
  console.log('PASS outside agent message is injected exactly once through Codex');
  writeFileSync(join(game, 'a.txt'), 'changed\n');
  assert.equal(hook('Stop', game, 'sess-a', 'pane-a')?.decision, 'block');
  sync('note', '--project', 'fixture', '--agent', 'agent-a', '--text', 'Changed a.txt; verifying the hook', '--cwd', game);
  assert.equal(hook('Stop', game, 'sess-a', 'pane-a'), null);
  console.log('PASS repeated Stop payload blocks unposted changes and permits a posted turn');
  hook('SessionStart', outside, 'sess-b-resumed');
  writeFileSync(join(outside, 'a.txt'), 'resumed agent change\n');
  hook('SessionStart', outside, 'sess-b-resumed');
  assert.equal(hook('Stop', outside, 'sess-b-resumed')?.decision, 'block');
  console.log('PASS resumed SessionStart establishes a baseline and cannot erase unposted changes');
  assert.equal(hook('SessionStart', dir, 'unregistered'), null);
  console.log('PASS unregistered projects remain silent');
} finally { rmSync(dir, { recursive: true, force: true }); }
