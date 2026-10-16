import test from 'node:test';
import assert from 'node:assert/strict';
import { decide, sureVerdict, exempt, targetFile } from '../../scripts/termfleet-sure-gate.mjs';

// Noam 2026-10-16: "create a gate that forces you to run /sure and pass it only on high".
const claude = (type, text) => JSON.stringify({ type, message: { role: type, content: [{ type: 'text', text }] } });
const toolResult = () => JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }] } });
const codex = (role, text) => JSON.stringify({ type: 'response_item', payload: { type: 'message', role, content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }] } });
const sure = (level) => `1. **Root cause:** the header reads the wrong field.\n2. **Confidence:** ${level}\n3. -\n4. Fix the field.\n5. None.`;
const edit = { tool_name: 'Edit', tool_input: { file_path: '/repo/src/app.ts' }, transcript_path: '/t.jsonl' };
const run = (lines, payload = edit) => decide(payload, { readLines: () => lines });

test('a code edit without /sure since the operator spoke is blocked with the exact steps', () => {
  const r = run([claude('user', 'fix the header'), claude('assistant', 'Looking.'), toolResult()]);
  assert.equal(r.allow, false);
  assert.match(r.message, /record your \/sure answer by running: termfleet-sure/);
});

test('HIGH unlocks code changes until the operator writes again', () => {
  const lines = [claude('user', 'fix the header'), claude('assistant', sure('HIGH')), toolResult()];
  assert.equal(run(lines).allow, true);
  assert.equal(run([...lines, claude('user', 'now the footer too')]).allow, false, 'a new operator message needs a new /sure');
});

test('MEDIUM or LOW keeps it locked and says to research first; a later HIGH unlocks', () => {
  const lines = [claude('user', 'fix it'), claude('assistant', sure('MEDIUM'))];
  const r = run(lines);
  assert.equal(r.allow, false);
  assert.match(r.message, /latest \/sure answer is MEDIUM/);
  assert.equal(run([...lines, toolResult(), claude('assistant', sure('HIGH'))]).allow, true);
  assert.equal(run([claude('user', 'x'), claude('assistant', sure('HIGH')), claude('assistant', sure('LOW'))]).allow, false, 'the newest answer counts');
});

test('injected reminders and tool results are not the operator speaking', () => {
  const lines = [claude('user', 'fix it'), claude('assistant', sure('HIGH')), claude('user', '<system-reminder>context</system-reminder>'), toolResult()];
  assert.equal(run(lines).allow, true);
});

test('notes, plans, memory and scratch files are never gated', () => {
  for (const f of ['/repo/MASTER_PLAN.md', '/tmp/x.py', `${process.env.HOME}/.cache/x/scratchpad/a.py`, `${process.env.HOME}/.claude/projects/p/memory/a.mjs`]) assert.equal(exempt(f), true, f);
  assert.equal(exempt('/repo/src/app.ts'), false);
  assert.equal(run([claude('user', 'x')], { ...edit, tool_input: { file_path: '/repo/MASTER_PLAN.md' } }).allow, true);
  assert.equal(run([claude('user', 'x')], { ...edit, tool_name: 'Read' }).allow, true);
});

test('Codex patches are gated the same way', () => {
  const patch = { tool_name: 'apply_patch', tool_input: { command: "apply_patch <<'EOF'\n*** Begin Patch\n*** Update File: src/app.ts\n@@\n-a\n+b\n*** End Patch\nEOF" }, transcript_path: '/r.jsonl' };
  assert.equal(targetFile('apply_patch', patch.tool_input), 'src/app.ts');
  assert.equal(run([codex('user', '<environment_context>cwd</environment_context>'), codex('user', 'fix it')], patch).allow, false);
  assert.equal(run([codex('user', 'fix it'), codex('assistant', sure('HIGH'))], patch).allow, true);
});

test('the verdict reads the usual /sure answer shapes', () => {
  assert.equal(sureVerdict('### 1. Root Cause\nx\n### 2. Confidence Rating\n**HIGH** — seen it before'), 'HIGH');
  assert.equal(sureVerdict('Root cause: x. Confidence: medium.'), 'MEDIUM');
  assert.equal(sureVerdict('I have high confidence'), null, 'no root cause, not a /sure answer');
});

test('a /sure answer recorded with the termfleet-sure command unlocks, even if the text reply was not saved', () => {
  const call = (cmd) => JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command: cmd } }] } });
  assert.equal(run([claude('user', 'fix it'), call(`termfleet-sure "${sure('HIGH')}"`)]).allow, true);
  assert.equal(run([claude('user', 'fix it'), call(`termfleet-sure "${sure('LOW')}"`)]).allow, false);
  assert.equal(run([claude('user', 'fix it'), call('ls -la')]).allow, false, 'other commands are not a /sure answer');
  const codexCall = JSON.stringify({ type: 'response_item', payload: { type: 'function_call', name: 'shell', arguments: JSON.stringify({ command: ['bash', '-lc', `termfleet-sure "${sure('HIGH')}"`] }) } });
  const patch = { tool_name: 'apply_patch', tool_input: { command: '*** Update File: src/a.ts' }, transcript_path: '/r.jsonl' };
  assert.equal(run([codex('user', 'fix it'), codexCall], patch).allow, true);
});
