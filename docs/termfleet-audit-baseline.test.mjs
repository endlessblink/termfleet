// Historical diagnosis fixtures retained for unmarked legacy launchers and
// untyped text with no following work event. Repair acceptance lives in
// termcontrol/test/{bot-progress,helper-request-origin}.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Bots, runBrain } from '../termcontrol/bridge/bots.mjs';
import { hook, injected } from '../scripts/termfleet-asks.mjs';
import { loadLedger, ownerTextOf } from '../termcontrol/bridge/requirements.mjs';
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(),'tf-delivery-baseline-'));
const waitFor = async (fn) => { for (let i=0;i<500;i++) { if(fn()) return; await new Promise(r=>setTimeout(r,10)); } throw new Error('bounded fixture timeout'); };

test('baseline: fake Codex commentary is parsed but absent from running bot chat and said history', async t => {
 const dir=tmp(), home=path.join(dir,'fake-home');
 // Empty synthetic login fixtures match existing bots.test; no real credentials read.
 for(const provider of ['.claude','.codex']) fs.mkdirSync(path.join(home,provider),{recursive:true});
 fs.writeFileSync(path.join(home,'.claude','.credentials.json'),'{}');
 fs.writeFileSync(path.join(home,'.codex','auth.json'),'{}');
 const socket=path.join(dir,'fake.sock');fs.writeFileSync(socket,'');
 const release=path.join(dir,'release'), marker=path.join(dir,'emitted'), fake=path.join(dir,'fake-codex.mjs');
 fs.writeFileSync(fake,`#!/usr/bin/env node
import fs from 'node:fs';
const out=x=>process.stdout.write(JSON.stringify(x)+'\\n');
out({type:'thread.started',thread_id:'S-synthetic-progress'});
out({type:'item.completed',item:{type:'agent_message',text:'Checking the slow task now.'}});
fs.writeFileSync(${JSON.stringify(marker)},'ready');
const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(release)})){clearInterval(timer);out({type:'item.completed',item:{type:'agent_message',text:'The synthetic audit finished.'}});out({type:'turn.completed'});}},10);
`,{mode:0o755});
 const parsed=[];
 const bots=new Bots({checks:{home,socket},dir:path.join(dir,'bots'),bins:{codex:fake},fill:()=>null,
  run:(bot,text,options)=>runBrain(bot,text,{...options,onEvent:ev=>{parsed.push(ev);options.onEvent?.(ev);},env:{...process.env,TERMFLEET_GENTLE_BRAINS:'0'}})});
 const {bot}=bots.create({name:'Synthetic progress baseline',provider:'codex',cwd:dir});
 assert.ok(bot);assert.equal(bots.send(bot.id,'Inspect the synthetic task.').ok,true);
 await waitFor(()=>fs.existsSync(marker)&&parsed.some(ev=>ev.text==='Checking the slow task now.'));
 const during=bots.view(bot.id).messages;
 assert.equal(during.some(m=>m.text==='Checking the slow task now.'),false);
 assert.deepEqual(bots.running.get(bot.id).said,[]);
 t.diagnostic(`parsed commentary=1; visible commentary during run=0; running said entries=0; state=${bots.summary(bot.id).state}`);
 fs.writeFileSync(release,'go');await waitFor(()=>!bots.running.has(bot.id));
 assert.equal(bots.view(bot.id).messages.at(-1).text,'The synthetic audit finished.');
 t.diagnostic(`final bot replies=${bots.view(bot.id).messages.filter(m=>m.role==='bot').length}; final delivered=true`);
});

test('baseline: generated launch instructions become owner items and block Stop',t=>{
 const dir=tmp(), env={TERMFLEET_REQ_DIR:dir,TERMFLEET_PROJECT:'synthetic'};
 const prompt='Goal: Audit delays\nFull instructions: Read /tmp/synthetic-task.md and carry out the instructions in it.\nBot registry reference: termcontrol.\nValidated checkout: /tmp/synthetic.\nThis path check grants no deployment or messaging permission.';
 const payload={transcript_path:'/tmp/synthetic-conversation.jsonl',cwd:'/tmp',session_id:'synthetic-launch'};
 assert.notEqual(ownerTextOf(prompt),null);assert.equal(injected(prompt),false);
 const shown=hook({...payload,hook_event_name:'UserPromptSubmit',prompt},{readLines:()=>[],env});
 assert.ok(shown);const count=loadLedger({dir}).items.size;assert.ok(count>=5);
 const stop=hook({...payload,hook_event_name:'Stop',last_assistant_message:'Audit remains in progress.'},{readLines:()=>[],env});
 assert.equal(stop.decision,'block');assert.match(stop.reason,/nobody has taken yet/);
 const repeated=hook({...payload,hook_event_name:'Stop',stop_hook_active:true},{readLines:()=>[],env});
 assert.equal(repeated,null);
 t.diagnostic(`synthetic owner items=${count}; first Stop blocked=true; stop_hook_active retry allowed=true`);
});

test('repair: hook_prompt control envelope is excluded from owner intake',t=>{
 const prompt='<hook_prompt hook_run_id="stop:synthetic">Noam has 1 item nobody has taken yet. Items: R-1 "synthetic"</hook_prompt>';
 assert.equal(ownerTextOf(prompt),null);assert.equal(injected(prompt),true);
 t.diagnostic('hook_prompt excluded; production loaded bridge remains separately verified');
});
