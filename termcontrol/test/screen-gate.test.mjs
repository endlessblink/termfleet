import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { screenRisk, shellScreenRisk } from '../../scripts/lib/screen-rules.mjs';
import { decide } from '../../scripts/termfleet-screen-gate.mjs';

// Noam 2026-10-27: "never run headed tests that take over my screen unless I approve them with a button question in the app".

test('anything that opens a window on his real screen needs his approval', () => {
  for (const command of [
    'npx playwright test --headed',
    'PWDEBUG=1 npx playwright test foo.spec.ts',
    'npx playwright codegen http://localhost:3000',
    'npx playwright test --ui',
    'npm run tauri:dev',
    'npx tauri dev',
    './run-dev.sh',
    'DISPLAY=:0 node shot.mjs',
    'xdotool key ctrl+shift+e',
    'wmctrl -a TermFleet',
    'xdg-open http://localhost:1420',
    'google-chrome http://localhost:7810',
    'firefox --new-window http://x.test',
    'nice -n 15 timeout 60 chromium http://x.test',
    'python3 -c "p.chromium.launch(head' + 'less=False)"',
  ]) assert.ok(shellScreenRisk(command), `should ask first: ${command}`);
  for (const tool of ['mcp__claude-in-chrome__navigate', 'mcp__claude-in-chrome__computer', 'mcp__playwright__browser_navigate', 'mcp__playwright__browser_click', 'mcp__DaVinci_Resolve__launch_resolve']) {
    assert.ok(screenRisk(tool, {}), `should ask first: ${tool}`);
  }
});

test('a script that launches a visible browser is caught from its source', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-screen-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bad = path.join(dir, 'shot.mjs'); fs.writeFileSync(bad, 'const b = await chromium.launch({ head' + 'less: false });');
  const good = path.join(dir, 'ok.mjs'); fs.writeFileSync(good, 'const b = await chromium.launch({ head' + 'less: true });');
  assert.ok(shellScreenRisk(`node ${bad}`));
  assert.ok(shellScreenRisk(`timeout 60 python3 ${bad.replace('.mjs', '.py')}`) === null, 'a file that does not exist is not guessed at');
  assert.equal(shellScreenRisk(`node ${good}`), null);
});

test('private virtual screens, headless runs and ordinary work pass without a question', () => {
  for (const command of [
    'xvfb-run -a -s "-screen 0 1600x1000x24" npx tauri dev',
    'xvfb-run -a python3 scripts/verify-render-perf.py',
    'npx playwright test',
    'node --test termcontrol/test/screen-gate.test.mjs',
    'google-chrome --headless --screenshot=/tmp/x.png http://localhost:7810',
    'git status && git diff --stat',
    'grep -rn "--headed" scripts/',
    'rg "head' + 'less: false" termcontrol',
    'echo "run npx playwright test --headed later"',
    'termfleet-asks done 3 "ran xdotool in a private display"',
    'npm run build && node scripts/termfleet-session-digest.mjs recent',
    'systemctl --user restart termcontrol.service',
  ]) assert.equal(shellScreenRisk(command), null, `should not ask: ${command}`);
  for (const tool of ['Read', 'Edit', 'mcp__claude-in-chrome__tabs_context_mcp_FAKE_OK'.replace(/.*/, 'Write')]) assert.equal(screenRisk(tool, {}), null);
});

test('Claude Code gets an Allow / Deny question; Codex is blocked with the instruction to ask', () => {
  const claude = decide({ tool_name: 'Bash', tool_input: { command: 'npx playwright test --headed' }, transcript_path: '/home/x/.claude/projects/p/s.jsonl' }, {});
  assert.equal(claude.allow, false);
  assert.equal(claude.codex, false);
  assert.match(claude.reason, /visible \(headed\) browser/);
  const codex = decide({ tool_name: 'shell', tool_input: { command: ['npx', 'playwright', 'test', '--headed'] }, transcript_path: '/home/x/.codex/sessions/a.jsonl' }, {});
  assert.equal(codex.allow, false);
  assert.equal(codex.codex, true);
  assert.equal(decide({ tool_name: 'Bash', tool_input: { command: 'npx playwright test --headed' } }, { TERMFLEET_SCREEN_GATE: 'off' }).allow, true);
  assert.equal(decide({ tool_name: 'Bash', tool_input: { command: 'ls' } }, {}).allow, true);
});

test('as a real hook: asks (Claude) or exits 2 (Codex); silent when the call is fine', () => {
  const run = (payload) => spawnSync(process.execPath, [path.resolve('scripts/termfleet-screen-gate.mjs')], { input: JSON.stringify(payload), encoding: 'utf8', env: { ...process.env, TERMFLEET_SCREEN_GATE: '' } });
  const ask = run({ tool_name: 'mcp__claude-in-chrome__navigate', tool_input: { url: 'http://x.test' }, transcript_path: '/home/x/.claude/projects/p/s.jsonl' });
  assert.equal(ask.status, 0);
  assert.deepEqual(JSON.parse(ask.stdout).hookSpecificOutput.permissionDecision, 'ask');
  const block = run({ tool_name: 'shell', tool_input: { command: ['xdotool', 'key', 'a'] }, transcript_path: '/home/x/.codex/sessions/a.jsonl' });
  assert.equal(block.status, 2);
  assert.match(block.stderr, /Ask Noam first with a button question/);
  const fine = run({ tool_name: 'Bash', tool_input: { command: 'git status' } });
  assert.equal(fine.status, 0);
  assert.equal(fine.stdout, '');
});
