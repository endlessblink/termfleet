#!/usr/bin/env node
// Screen gate. Noam 2026-10-27: "never run headed tests that take over my screen unless I approve them with a
// button question in the app". A PreToolUse hook for Claude Code (Bash and browser tools) and Codex (shell).
//  - Claude Code: answers "ask", so Claude Code shows its own Allow / Deny prompt, which TermFleet already draws
//    as a button card in the app. Noam taps Allow or Deny; nothing runs on his screen before that.
//  - Codex (no "ask" decision): blocks with exit 2 and tells the agent to ask Noam first.
// Private virtual screens (xvfb-run) and headless browsers pass. Off switch: TERMFLEET_SCREEN_GATE=off.
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { screenRisk } from './lib/screen-rules.mjs';

export function decide(payload, env = process.env) {
  if (env.TERMFLEET_SCREEN_GATE === 'off') return { allow: true, why: 'off' };
  const tool = payload?.tool_name || payload?.toolName || '';
  const input = payload?.tool_input || payload?.toolInput || {};
  const why = screenRisk(tool, typeof input === 'string' ? (() => { try { return JSON.parse(input); } catch { return { command: input }; } })() : input);
  if (!why) return { allow: true, why: 'no screen takeover' };
  const codex = /\.codex\//.test(String(payload?.transcript_path || '')) || /^(shell|local_shell|exec_command|container\.exec)$/.test(tool);
  const reason = `This ${why}. Noam's rule: nothing runs on his screen unless he approves it with a button. Prefer a headless run or a private virtual screen (xvfb-run).`;
  return { allow: false, codex, reason };
}

const startedAsCommand = (() => {
  try { return realpathSync(process.argv[1] ?? '') === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
})();
if (startedAsCommand) {
  let payload = {};
  try { payload = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { process.exit(0); }
  const result = decide(payload);
  if (!result.allow) {
    if (result.codex) {
      process.stderr.write(`Screen gate: ${result.reason} Ask Noam first with a button question in the app, and do not run it until he approves.\n`);
      process.exit(2);
    }
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: result.reason } }));
  }
}
