import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// Match user_config.rs: environment, user configuration, then unconfigured.
export function agentOpsRoot(env = process.env) {
  if (env.TERMFLEET_AGENT_OPS_ROOT?.trim()) return env.TERMFLEET_AGENT_OPS_ROOT.trim();
  const config = env.TERMFLEET_CONFIG_FILE || join(env.XDG_CONFIG_HOME || join(env.HOME || homedir(), '.config'), 'termfleet/config.json');
  try {
    const root = JSON.parse(readFileSync(config, 'utf8')).agentOpsRoot;
    return typeof root === 'string' && root.trim() || null;
  } catch { return null; }
}

export function projectSyncHook(payload, { env = process.env } = {}) {
  const event = String(payload.hook_event_name || payload.hookEventName || '').replaceAll('_', '').toLowerCase();
  if (!['sessionstart', 'userpromptsubmit', 'stop'].includes(event)) return null;
  const root = agentOpsRoot(env);
  if (!root) return null;
  // The external authority selects registered projects and owns enforcement.
  // Its failure must never discard the independent request ledger gate.
  try {
    const child = spawnSync('python3', [join(root, 'agent_sync.py'), 'hook'], {
      input: JSON.stringify(payload), encoding: 'utf8', env,
      timeout: 5000, maxBuffer: 1024 * 1024,
    });
    if (child.error || child.status !== 0 || !child.stdout.trim()) return null;
    const result = JSON.parse(child.stdout);
    return result && typeof result === 'object' && !Array.isArray(result) ? result : null;
  } catch { return null; }
}

export function mergeHookResults(requests, sync) {
  if (!requests) return sync;
  if (!sync) return requests;
  const result = { ...requests, ...sync };
  const contexts = [requests.hookSpecificOutput, sync.hookSpecificOutput].filter(Boolean);
  if (contexts.length) result.hookSpecificOutput = {
    ...contexts[0], ...contexts[1],
    additionalContext: contexts.map(value => value.additionalContext).filter(Boolean).join('\n\n'),
  };
  if (requests.decision === 'block' || sync.decision === 'block') {
    result.decision = 'block';
    result.reason = [requests, sync].filter(value => value.decision === 'block').map(value => value.reason).filter(Boolean).join('\n\n');
  }
  return result;
}
