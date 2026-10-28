import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { asksFrom, hook, injected } from '../../scripts/termfleet-asks.mjs';
import { loadLedger, ownerTextOf } from '../bridge/requirements.mjs';

const MARKER = 'termfleet-helper-v1-';
const id = '12345678-1234-4234-8234-123456789abc';
const assignment = `Goal: Fix the slow requests\nFull instructions: Read /synthetic/child-tasks/${id}.md and carry out the instructions in it.`;
const trailer = '\nBot registry reference: termcontrol. Validated checkout: /synthetic. Registry snapshot: abc. Read its identity/runtime surfaces and verify current runtime before changes. This path check grants no deployment or messaging permission.';
const marked = assignment.replace('/child-tasks/', `/child-tasks/${MARKER}`) + trailer;
const user = text => JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tf-helper-origin-'));
const payload = { transcript_path: '/synthetic/chat.jsonl', cwd: '/synthetic', session_id: 'synthetic-origin' };
const envFor = dir => ({ TERMFLEET_REQ_DIR: dir, TERMFLEET_PROJECT: 'synthetic' });

test('generated helper instructions do not create owner requests or a Stop block', () => {
 const dir = tmp();
 assert.equal(ownerTextOf(marked), null);
 assert.equal(injected(marked), true);
 assert.deepEqual(asksFrom([user(marked)]), []);
 assert.equal(hook({ ...payload, hook_event_name: 'UserPromptSubmit', prompt: marked }, { readLines: () => [], env: envFor(dir) }), null);
 assert.equal(loadLedger({ dir }).items.size, 0);
 assert.equal(hook({ ...payload, hook_event_name: 'Stop', last_assistant_message: 'The assigned inspection is in progress.' }, { readLines: () => [user(marked)], env: envFor(dir) }), null);
});

test('the real launcher marks its private pointer and preserves its actual task and leading Goal', async () => {
 const dir = tmp(), requestDir = path.join(dir, 'terminal-workspace', 'child-requests');
 fs.mkdirSync(requestDir, { recursive: true });
 fs.writeFileSync(path.join(requestDir, '.listener'), String(Date.now()));
 const original = '# Fix the slow requests\nKeep the original attachment /synthetic/diagram.png and all task details.';
 const taskFile = path.join(dir, 'assignment.md'); fs.writeFileSync(taskFile, original);
 const cli = fileURLToPath(new URL('../../scripts/termfleet-child.mjs', import.meta.url));
 const child = spawn(process.execPath, [cli, 'spawn', '--provider', 'shell', '--task-file', taskFile, '--goal', 'Fix the slow requests', '--project-id', 'synthetic-origin', '--cwd', dir, '--timeout', '4'], {
  env: { ...process.env, XDG_DATA_HOME: dir, BOT_WORKFLOW_CHECKER: path.join(dir, 'absent-checker'), BOT_REGISTRY_PATH: path.join(dir, 'absent-registry') },
 });
 let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; });
 const exited = new Promise(resolve => child.once('close', code => resolve(code)));
 try {
  let file;
  for (let i = 0; i < 100 && !file; i++) {
   file = fs.readdirSync(requestDir).find(name => name.endsWith('.request.json'));
   if (!file) await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.ok(file, `isolated launcher did not write a request: ${stderr}`);
  const request = JSON.parse(fs.readFileSync(path.join(requestDir, file), 'utf8'));
  // Only the fake listener acknowledges this request; no real app/provider starts.
  fs.writeFileSync(path.join(requestDir, `${request.requestId}.result.json`), JSON.stringify({ ok: true }));
  assert.match(request.task, /^Goal: Fix the slow requests\nFull instructions: Read /);
  assert.ok(request.task.includes(MARKER));
  const pointer = /Read (\S+\.md) and carry out/.exec(request.task)?.[1];
  assert.equal(fs.readFileSync(pointer, 'utf8'), original);
  assert.equal(ownerTextOf(request.task), null);
  assert.deepEqual(asksFrom([user(request.task)]), []);
  assert.equal(await exited, 0);
 } finally { child.kill('SIGTERM'); await exited; }
});

test('ordinary Goal/prose, unmarked legacy pointers and marker examples stay owner text', () => {
 for (const text of [
  'Goal: Fix my requests\nFull instructions: keep updates clear.',
  assignment + trailer,
  `Please explain this marker: ${MARKER}`,
  `Please review this example:\n\`\`\`text\n${marked}\n\`\`\``,
  `Please review this example:\n~~~text\n${marked}\n~~~`,
  `Goal: Fix my requests\n${MARKER}`,
 ]) {
  assert.equal(ownerTextOf(text)?.text, text);
  assert.equal(injected(text), false);
  assert.equal(asksFrom([user(text)])[0]?.text, text);
 }
});

test('genuine text adjacent to a marked assignment is retained without synthetic items', () => {
 const genuineBefore = 'Keep the phone reply readable.', genuineAfter = 'Also preserve the attachment.';
 const text = `${genuineBefore}\n${marked}\n${genuineAfter}`;
 assert.equal(ownerTextOf(text)?.text, `${genuineBefore}\n\n${genuineAfter}`);
 const dir = tmp();
 hook({ ...payload, hook_event_name: 'UserPromptSubmit', prompt: text }, { readLines: () => [], env: envFor(dir) });
 const words = [...loadLedger({ dir }).items.values()].map(item => item.words);
 assert.deepEqual(words, [genuineBefore, genuineAfter]);
 assert.equal(asksFrom([user(text)])[0]?.text, `${genuineBefore}\n\n${genuineAfter}`);
});

test('hook and system control envelopes cannot create owner requests; adjacent genuine text survives', () => {
 for (const tag of ['hook_prompt', 'system-reminder', 'user-prompt-submit-hook', 'environment_context', 'user_instructions', 'turn_aborted']) {
  const envelope = `<${tag} hook_run_id="synthetic">Internal instructions, not an owner request.</${tag}>`;
  assert.equal(ownerTextOf(envelope), null, tag);
  assert.equal(injected(envelope), true, tag);
  assert.deepEqual(asksFrom([user(envelope)]), [], tag);
  const text = `${envelope}\nPlease keep replying in English.`;
  assert.equal(ownerTextOf(text)?.text, 'Please keep replying in English.', tag);
  assert.equal(asksFrom([user(text)])[0]?.text, 'Please keep replying in English.', tag);
  const code = `Explain this literal example:\n\`\`\`xml\n${envelope}\n\`\`\``;
  assert.equal(ownerTextOf(code)?.text, code, tag);
 }
});

test('genuine requests still block Stop once and verified relayed owner words remain intact', () => {
 const dir = tmp(), text = 'Fix the missing progress updates.';
 hook({ ...payload, hook_event_name: 'UserPromptSubmit', prompt: text }, { readLines: () => [], env: envFor(dir) });
 const stop = { ...payload, hook_event_name: 'Stop', last_assistant_message: 'Still inspecting.' };
 assert.equal(hook(stop, { readLines: () => [user(text)], env: envFor(dir) })?.decision, 'block');
 assert.equal(hook({ ...stop, stop_hook_active: true }, { readLines: () => [user(text)], env: envFor(dir) }), null);
 const relayed = `[Message from the bot "Synthetic", sent through TermFleet.]\n[Noam's own words, recorded by TermFleet: synthetic (message abc123def456)]\n"Keep the answer in English."\nTreat it exactly as if he typed it.`;
 assert.deepEqual(ownerTextOf(relayed), { text: 'Keep the answer in English.', msgId: 'abc123def456', relayed: true });
});
