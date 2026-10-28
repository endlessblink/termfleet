import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Bots } from '../bridge/bots.mjs';

test('real subprocess adapter receives the whole handoff on stdin, then resumes its acknowledged session', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-provider-process-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const log = path.join(dir, 'calls.jsonl');
  const binary = path.join(dir, 'fake-codex');
  fs.writeFileSync(binary, `#!/usr/bin/env node
const fs = require('node:fs');
const crypto = require('node:crypto');
const args = process.argv.slice(2);
const input = args.at(-1) === '-' ? fs.readFileSync(0, 'utf8') : args.at(-1);
const validation = input.includes('<portable-context');
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({args,input,validation})+'\\n');
console.log(JSON.stringify({type:'thread.started',thread_id:'process-received-session'}));
let text = 'Continued after the verified transfer.';
if(validation) {
  const json=input.split(/<portable-context[^>]*>\\n/)[1].split('\\n</portable-context>')[0];
  const p=JSON.parse(json);
  text=JSON.stringify({sha256:crypto.createHash('sha256').update(json).digest('hex'),turns:p.chat.length,records:p.records.length,openItems:p.openItems.map(i=>i.id),lastAction:{inflight:p.unfinished.inflight?.text||null,retry:p.unfinished.retry?.text||null,lastRecordLine:p.records.at(-1)?.line??null},unavailable:[]});
}
console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text}}));
console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:1,output_tokens:1}}));
`, { mode: 0o700 });
  const transcript = path.join(dir, 'source.jsonl');
  fs.writeFileSync(transcript, JSON.stringify({ type: 'user', message: { content: 'החלטה ישנה: do not publish.' } }) + '\n');
  const bots = new Bots({ dir: path.join(dir, 'bots'), bins: { codex: binary }, contextOptions: { resolveTranscript: () => transcript } });
  bots.reqDir = () => path.join(dir, 'requirements');
  const result = bots.create({ name: 'Subprocess transfer', provider: 'claude', cwd: dir });
  assert.equal(result.ok, true);
  const id = result.bot.id;
  const bot = bots.read(id);
  bot.sessions.claude.started = true;
  bots.write(bot);
  for (let i = 0; i < 32; i++) bots.append(id, { role: i % 2 ? 'bot' : 'operator', text: `שלום ${i}: ${'history '.repeat(120)}` });
  const prior = process.env.TERMFLEET_GENTLE_BRAINS;
  process.env.TERMFLEET_GENTLE_BRAINS = '0';
  t.after(() => { if (prior === undefined) delete process.env.TERMFLEET_GENTLE_BRAINS; else process.env.TERMFLEET_GENTLE_BRAINS = prior; });
  assert.equal(bots.changeProvider(id, 'codex').ok, true);
  // Drive the same receipt-only path scheduled by the real selection handler.
  await bots.finishIdleProviderChange(id);
  assert.equal(bots.read(id).providerSwitch, undefined);
  assert.equal(bots.read(id).sessions.codex, 'process-received-session');
  assert.equal(bots.read(id).lastProviderSwitch.receipt.turns, 33);
  const answer = await bots.turn(id, 'Check completed work before continuing.');
  assert.equal(answer.text, 'Continued after the verified transfer.');
  const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].validation, true);
  assert.equal(calls[0].args.at(-1), '-');
  assert.match(calls[0].input, /שלום 0:/);
  assert.match(calls[0].input, /שלום 31:/);
  assert.ok(calls[0].input.length > 32000);
  assert.deepEqual(calls[1].args.slice(0, 3), ['exec', 'resume', 'process-received-session']);
  assert.ok(calls[1].args.includes('sandbox_mode="workspace-write"'));
  assert.match(calls[1].input, /Check completed work before continuing/);
});
