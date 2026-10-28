import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {createAutomaticActionBarrier} from '../bridge/automation-pause.mjs';
const temp=t=>{const d=fs.mkdtempSync(path.join(os.tmpdir(),'tc-effect-'));t.after(()=>fs.rmSync(d,{recursive:true,force:true}));return d;};
const ref={kind:'routine',source_id:'routine-1:due-10',pane_id:'synthetic',provider:'codex',session_id:'fixture-session'};
test('delivery receipts distinguish settled, before-effect failure and uncertainty',async t=>{
 const dir=temp(t),b=createAutomaticActionBarrier({operationsDir:dir,env:{}});let writes=0;
 await b.delivery(ref,async()=>({received:true,receipt:'fixture-exact-receipt'}));
 await b.delivery({...ref,source_id:'routine-2'},async()=>({notSent:true,error:'prewrite refusal'}));
 await b.delivery({...ref,source_id:'routine-3'},async()=>{writes++;return{ok:true,delivered:true};});
 assert.equal(writes,1);const states=b.status().deliveries.map(x=>x.state);assert.deepEqual(states,['settled','failed-before-effect','uncertain']);
 const drain=await b.drain({timeoutMs:0});assert.equal(drain.settled,false);assert.equal(drain.retained.length,1);
 const restored=createAutomaticActionBarrier({operationsDir:dir,env:{}});assert.equal(restored.paused,true);assert.equal(restored.status().deliveries.find(d=>d.state==='uncertain').reference.source_id,'routine-3');
 assert.equal((await restored.delivery(ref,()=>++writes)).notSent,true);assert.equal(writes,1);
});
test('root completion before child settlement cannot certify drain',async t=>{
 const b=createAutomaticActionBarrier({operationsDir:temp(t),env:{}});let resolve,child;
 b.run(()=>{child=b.delivery(ref,()=>new Promise(r=>{resolve=r;}));return{ok:true};});
 assert.equal(b.status().deliveries[0].state,'pending');assert.equal((await b.drain({timeoutMs:0})).settled,false);
 resolve({uncertain:true});await child;assert.equal(b.status().deliveries[0].state,'uncertain');assert.equal((await b.drain({timeoutMs:0})).settled,false);
});
test('reconstruction preserves an interrupted individual receipt without replay',t=>{
 const dir=temp(t),moduleURL=new URL('../bridge/automation-pause.mjs',import.meta.url).href;
 const script=`import {createAutomaticActionBarrier} from ${JSON.stringify(moduleURL)};const b=createAutomaticActionBarrier({operationsDir:process.argv[1],env:{}});b.delivery(${JSON.stringify(ref)},()=>new Promise(()=>{}));process.exit(0);`;
 const child=spawnSync(process.execPath,['--input-type=module','-e',script,dir],{encoding:'utf8'});assert.equal(child.status,0,child.stderr);
 const b=createAutomaticActionBarrier({operationsDir:dir,env:{}});assert.equal(b.status().deliveries[0].state,'uncertain');assert.equal(b.status().deliveries[0].reference.session_id,ref.session_id);
 assert.equal(b.guard(()=>assert.fail('must not replay'))().notSent,true);
});
import {Routines} from '../bridge/routines.mjs';import {Rooms} from '../bridge/rooms.mjs';import {holdMessage,deliverHeld} from '../bridge/held-messages.mjs';
const pane={id:'synthetic',provider:'codex',sessionId:'fixture-session',alive:true,turn:'idle'};
test('actual routine dispatch exposes its exact occurrence and target without changing manual send',async t=>{
 const dir=temp(t),b=createAutomaticActionBarrier({operationsDir:path.join(dir,'ops'),env:{}});let manual=0;
 const routines=new Routines({file:path.join(dir,'r.json'),now:()=>100000,send:()=>{manual++;return{ok:true};}});
 routines.data.routines=[{id:'routine-one',pane:pane.id,text:'original words',enabled:true,nextRunAt:1000,days:[1],time:'08:00'}];routines.save();
 await b.run(()=>routines.tick([pane],{send:(p,text,reference)=>{assert.equal(text,'original words');return b.delivery(reference,async()=>({uncertain:true}));}}));
 assert.equal(manual,0);assert.equal(b.status().deliveries[0].reference.source_id,'routine-one:1000');assert.equal(b.status().deliveries[0].state,'uncertain');assert.equal((await b.drain({timeoutMs:0})).settled,false);
});
test('actual room dispatch supplies the original message identity to automatic accounting',async t=>{
 const dir=temp(t),b=createAutomaticActionBarrier({operationsDir:path.join(dir,'ops'),env:{}});let manual=0;
 const rooms=new Rooms({file:path.join(dir,'rooms.json'),send:()=>{manual++;return{ok:true};},readFeed:()=>({events:[]})});const {room}=rooms.create('Fixture',[pane]);const message=rooms.addMessage(room,{author:'You',from:'operator',text:'same original words'});
 await b.run(()=>rooms.deliver(room,message,[pane.id],[pane],0,{send:(p,text,reference)=>b.delivery(reference,async()=>({notSent:true,error:'before effect'}))}));
 assert.equal(manual,0);assert.equal(b.status().deliveries[0].reference.source_id,room.id+':'+message.seq);assert.equal(b.status().deliveries[0].state,'failed-before-effect');
});
test('actual held batch records uncertainty even though aggregate returns no received entries',async t=>{
 const dir=temp(t),held=path.join(dir,'held');fs.mkdirSync(held);const b=createAutomaticActionBarrier({operationsDir:path.join(dir,'ops'),env:{}});
 holdMessage(pane.id,'same words',{dir:held,target:pane,now:1});holdMessage(pane.id,'same words',{dir:held,target:pane,now:2});
 const out=await b.run(()=>deliverHeld({panes:[pane],dir:held,resolveTarget:async()=>pane,receipt:()=>false,send:async()=>({ok:true}),account:(reference,action)=>b.delivery(reference,action,{receipt:r=>r?.received?'held:'+reference.source_id:null})}));
 assert.deepEqual(out,[]);const d=b.status().deliveries[0];assert.equal(d.state,'uncertain');assert.equal(d.reference.row_ids.length,2);assert.notEqual(d.reference.row_ids[0],d.reference.row_ids[1]);assert.equal((await b.drain({timeoutMs:0})).settled,false);
 const file=fs.readdirSync(held).find(f=>f.endsWith('.inflight'));assert.equal(fs.readFileSync(path.join(held,file),'utf8').trim().split('\n').map(JSON.parse).filter(r=>r.text==='same words').length,2);
});
for (const phase of ['create','rename']) test(`receipt ${phase} failure retains the original pending intent across reconstruction`,async t=>{
 const dir=temp(t),b=createAutomaticActionBarrier({operationsDir:dir,env:{}});let original;
 await b.delivery(ref,()=>{original=fs.readdirSync(dir).find(n=>n.endsWith('.pending.json'));if(phase==='create')fs.writeFileSync(path.join(dir,original+'.settling'),'fixture conflict');else fs.mkdirSync(path.join(dir,original.replace('.pending.json','.receipt.json')));return{received:true,receipt:'exact-receipt'};});
 assert.equal(fs.existsSync(path.join(dir,original)),true,'failed receipt persistence must not unlink original intent');
 assert.equal((await b.drain({timeoutMs:0})).settled,false);
 const after=createAutomaticActionBarrier({operationsDir:dir,env:{}});assert.equal(after.paused,true);assert.equal(after.status().deliveries[0].reference.source_id,ref.source_id);
});
for(const uncertain of [false,true])test(`isolated child outlives completed callback; uncertain=${uncertain}`,t=>{
 const dir=temp(t),moduleURL=new URL('../bridge/automation-pause.mjs',import.meta.url).href;
 const script=`import assert from 'node:assert/strict';import {createAutomaticActionBarrier} from ${JSON.stringify(moduleURL)};const b=createAutomaticActionBarrier({operationsDir:process.argv[1],env:{}});let finish,child;b.run(()=>{child=b.delivery(${JSON.stringify(ref)},()=>new Promise(r=>finish=r));});assert.equal((await b.drain({timeoutMs:0})).settled,false);assert.equal(b.status().deliveries[0].state,'pending');finish(${uncertain?"{uncertain:true}":"{received:true,receipt:'verified-fixture-receipt'}"});await child;assert.equal((await b.drain({timeoutMs:0})).settled,${!uncertain});console.log(b.status().deliveries[0].state);`;
 const child=spawnSync(process.execPath,['--input-type=module','-e',script,dir],{encoding:'utf8'});assert.equal(child.status,0,child.stderr);assert.equal(child.stdout.trim(),uncertain?'uncertain':'settled');
});
import vm from 'node:vm';
test('actual server adapter settles only an existing exact bot message; typed-only terminal stays uncertain',async t=>{
 const source=fs.readFileSync(new URL('../bridge/server.mjs',import.meta.url),'utf8');const start=source.indexOf('function sendAutomaticDelivery('),end=source.indexOf('const rooms = new Rooms(',start);assert.ok(start>=0&&end>start);
 const b=createAutomaticActionBarrier({operationsDir:temp(t),env:{}});let terminalWrites=0;const rows=[];
 const context={automatic:b,bots:{send:(id,text)=>{const message={id:'synthetic-message',role:'operator',text};rows.push(message);return{ok:true,message};},messages:()=>rows},sendToPane:async()=>{terminalWrites++;return{ok:true,delivered:true};}};
 vm.runInNewContext(source.slice(start,end)+'\nthis.send=sendAutomaticDelivery',context);
 await context.send({...pane,id:'bot:111111111111'},'original',{...ref,pane_id:'bot:111111111111'});assert.equal(b.status().deliveries[0].state,'settled');assert.equal(b.status().deliveries[0].receipt,'bot-message:synthetic-message');
 await context.send({...pane,sessionId:null},'original',{...ref,session_id:null});assert.equal(terminalWrites,0);assert.equal(b.status().deliveries[1].state,'failed-before-effect');
 await context.send(pane,'original',ref);assert.equal(terminalWrites,1);assert.equal(b.status().deliveries[2].state,'uncertain');assert.equal((await b.drain({timeoutMs:0})).settled,false);
});
test('admitted parent may finish its delivery after drain; detached late work is refused',async t=>{
 const b=createAutomaticActionBarrier({operationsDir:temp(t),env:{}});let release,late,writes=0;
 const root=b.run(async()=>{await new Promise(r=>release=r);await b.delivery(ref,()=>{writes++;return{received:true,receipt:'verified'};});late=()=>b.delivery(ref,()=>++writes);});
 assert.equal((await b.drain({timeoutMs:0})).settled,false);release();await root;assert.equal(writes,1);assert.equal((await b.drain({timeoutMs:0})).settled,true);assert.equal(late().notSent,true);assert.equal(writes,1);
});
test('completed status history is bounded without deleting receipts or pending recovery references',async t=>{
 const dir=temp(t),b=createAutomaticActionBarrier({operationsDir:dir,env:{}});
 for(let i=0;i<105;i++)await b.delivery({...ref,source_id:'occurrence-'+i},()=>({notSent:true}));
 assert.equal(b.status().deliveries.length,100);assert.equal(b.status().delivery_history.completed_omitted,5);assert.equal(fs.readdirSync(dir).filter(n=>n.endsWith('.receipt.json')).length,105);
 const restored=createAutomaticActionBarrier({operationsDir:dir,env:{}});assert.equal(restored.status().deliveries.length,100);assert.equal(restored.paused,false);
});
