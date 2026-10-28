#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertProviderLaunch, evaluateClaudeQuota } from './lib/provider-launch-policy.mjs';

const directory = path.join(os.homedir(), '.local/share/terminal-workspace');
const read = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const [command, provider] = process.argv.slice(2);
if (command === 'check') {
  try {
    if (!['claude', 'codex', 'opencode', 'shell'].includes(provider)) throw new Error('Unknown provider: launch denied');
    assertProviderLaunch(provider, { surface: 'provider-adapter' });
  }
  catch (error) { console.error(error.message); process.exitCode = 4; }
} else if (command === 'status') {
  const quota = evaluateClaudeQuota(read(path.join(directory, 'usage/claude.json')), read(path.join(directory, 'provider-policy/claude-latch.json')));
  console.log(JSON.stringify({ standingRule: 'owner-approval-required', claudeAllowed: false, quota, protection: 'cooperative-launch-checks', credentialIsolation: false }, null, 2));
} else {
  console.error('Usage: termfleet-provider-gate.mjs check PROVIDER | status');
  process.exitCode = 2;
}
