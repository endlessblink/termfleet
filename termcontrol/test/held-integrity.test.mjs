import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {holdMessage,deliverHeld,putBack,takeHeld,sweepStranded,strandedText} from '../bridge/held-messages.mjs';
import {delegate} from '../bridge/orchestrate.mjs';
import {scanDeliveryReceipt} from '../bridge/delivery-reconciliation.mjs';

const pane={id:'terminal-synthetic-held',provider:'codex',sessionId:'session-original',alive:true,turn:'idle'};
const fixture=()=>fs.mkdtempSync(path.join(os.tmpdir(),'tf-held-integrity-'));
const stored=dir=>fs.readdirSync(dir).filter(n=>n.startsWith(pane.id+'.jsonl')&&/\.(jsonl|inflight|received)$/.test(n)).flatMap(n=>{
 try{return fs.readFileSync(path.join(dir,n),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);}catch{return [];}
});

test('default adapter receipt route reads only the exact synthetic Codex session',()=>{
 const dir=fixture();try{
  const code=`
   import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
   import {holdMessage,deliverHeld} from './termcontrol/bridge/held-messages.mjs';
   const id='11111111-2222-3333-4444-555555555555';
   const pane={id:'terminal-test',provider:'codex',sessionId:id,alive:true,turn:'idle'};
   const root=process.env.HOME,queue=path.join(root,'queue'),sessions=path.join(root,'.codex/sessions');
   fs.mkdirSync(sessions,{recursive:true});
   const file=path.join(sessions,'rollout-'+id+'.jsonl');
   const text='Quoted prior [delivery D-abcdef12]\\nActual new words\\n[delivery D-1234abcd]';
   holdMessage(pane.id,text,{dir:queue,target:pane,now:Date.now()-1000});
   fs.writeFileSync(file,JSON.stringify({type:'session_meta',payload:{id}})+'\\n');
   let sends=0;
   const options={panes:[pane],dir:queue,resolveTarget:async()=>pane,send:async()=>{sends++;return {ok:true};}};
   assert.deepEqual(await deliverHeld(options),[]);
   fs.appendFileSync(file,JSON.stringify({type:'event_msg',timestamp:new Date().toISOString(),payload:{type:'user_message',message:'[delivery D-abcdef12]'}})+'\\n');
   assert.deepEqual(await deliverHeld(options),[],'nested earlier marker is not this send receipt');
   fs.appendFileSync(file,JSON.stringify({type:'event_msg',timestamp:new Date().toISOString(),payload:{type:'user_message',message:text}})+'\\n');
   assert.equal((await deliverHeld(options))[0].received,true);assert.equal(sends,1);
  `;
  const child=spawnSync(process.execPath,['--input-type=module','-e',code],{cwd:new URL('../..',import.meta.url),encoding:'utf8',timeout:10000,env:{...process.env,HOME:dir,XDG_DATA_HOME:path.join(dir,'data'),TC_CONFIG_DIR:path.join(dir,'config')}});
  assert.equal(child.status,0,child.stderr);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('closed inflight reports uncertainty and retries each failed sender independently',async()=>{
 const dir=fixture();try{
  for(const sender of ['0123456789ab','abcdef012345'])hold(dir,`[Message from the bot "fixture" (bot:${sender}), sent through TermFleet.] work`);
  await deliverHeld({panes:[pane],dir,resolveTarget:async()=>pane,receipt:()=>false,send:async()=>({uncertain:true})});
  const reports=[];let fail=true;
  const options={panes:[],dir,now:100000,notify:r=>{if(r.sender==='abcdef012345'&&fail)throw Error('temporary');reports.push(r);}};
  sweepStranded(options);fail=false;sweepStranded(options);sweepStranded(options);
  assert.equal(reports.length,2);assert(reports.every(r=>r.reason==='unconfirmed'));
  assert(reports.every(r=>strandedText(r).startsWith('Delivery unconfirmed:')));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('waiting sender report retries after transient notification failure',()=>{
 const dir=fixture();try{
  hold(dir,'[Message from the bot "fixture" (bot:0123456789ab), sent through TermFleet.] work');
  let attempts=0;const reports=[];
  const options={panes:[{...pane,turn:'waiting'}],dir,now:1000000,notify:r=>{if(++attempts===1)throw Error('temporary');reports.push(r);}};
  sweepStranded(options);sweepStranded(options);sweepStranded(options);
  assert.equal(attempts,2);assert.equal(reports.length,1);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
const hold=(dir,text='preserve held words')=>holdMessage(pane.id,text,{dir,target:pane,now:1000});

test('delegate retains every held and newly bundled word after a prewrite failure',async()=>{
 const dir=fixture();try{
  hold(dir);
  await delegate(pane,'new owner correction',{heldOpts:{dir},resolveTarget:async()=>pane,send:async()=>({error:'fixture prewrite refusal',notSent:true})});
  const rows=stored(dir);assert(rows.some(r=>r.text==='preserve held words'));
  assert(rows.some(r=>r.text.includes('new owner correction')));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('unknown outcome remains stored and is never automatically typed again',async()=>{
 const dir=fixture();try{
  hold(dir);let sends=0;
  const options={panes:[pane],resolveTarget:async()=>pane,dir,receipt:()=>false,send:async()=>{sends++;return {uncertain:true,error:'ack lost'};}};
  await deliverHeld(options);await deliverHeld(options);
  assert.equal(sends,1);assert.equal(stored(dir).length,1);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('typed-only is not a received result and keeps recoverable words with report',async()=>{
 const dir=fixture();try{
  hold(dir,'[Message from the bot "fixture" (bot:0123456789ab), sent through TermFleet.] preserve held words');const reports=[];
  const out=await deliverHeld({panes:[pane],resolveTarget:async()=>pane,dir,receipt:()=>false,notify:r=>reports.push(r),send:async()=>({ok:true,delivered:true})});
  assert(!out.some(r=>r.received===true));assert.equal(stored(dir).length,1);assert.equal(reports.length,1);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('changed session, provider, shell, unknown and legacy target never receive held text',async()=>{
 for(const target of [{...pane,sessionId:'different'},{...pane,provider:'claude'},{...pane,provider:'shell'},null]){
  const dir=fixture();try{
   hold(dir);let sends=0;
   await deliverHeld({panes:[pane],resolveTarget:async()=>target,dir,send:async()=>{sends++;return {ok:true};}});
   assert.equal(sends,0);assert.equal(stored(dir).length,1);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
 }
 const dir=fixture();try{
  holdMessage(pane.id,'unbound legacy words',{dir});let sends=0;
  await deliverHeld({panes:[pane],resolveTarget:async()=>pane,dir,send:async()=>{sends++;return {ok:true};}});
  assert.equal(sends,0);assert.equal(stored(dir).length,1);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('sleeping targets stay asleep for periodic and new bundled delivery',async()=>{
 const dir=fixture();try{
  hold(dir);let sends=0;const sleeping={...pane,sleeping:true};
  const send=async()=>{sends++;return {ok:true};};
  await deliverHeld({panes:[sleeping],resolveTarget:async()=>sleeping,dir,send});
  await delegate(sleeping,'wait for the sleeper',{heldOpts:{dir},resolveTarget:async()=>sleeping,send});
  assert.equal(sends,0);assert(stored(dir).some(r=>r.text.includes('wait for the sleeper')));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('putBack preserves target binding and row identity',()=>{
 const dir=fixture();try{
  hold(dir);const rows=takeHeld(pane.id,{dir});putBack(pane.id,rows,{dir});
  const back=stored(dir);assert.equal(back[0].sessionId,pane.sessionId);assert.equal(back[0].provider,pane.provider);assert.equal(back[0].id,rows[0].id);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('dead old rows stay recoverable with internal sender status, never silently expire',()=>{
 const dir=fixture();try{
  hold(dir,'[Message from the bot "fixture" (bot:0123456789ab), sent through TermFleet.] old work');
  const reports=[];sweepStranded({panes:[],dir,now:1000+4*60*60*1000,status:r=>reports.push(r),notify:()=>assert.fail('no new bot message')});
  assert.equal(reports.length,1);
  const marker=JSON.parse(fs.readFileSync(path.join(dir,pane.id+'.jsonl.quarantine'),'utf8'));
  const rows=fs.readFileSync(path.join(dir,'quarantine',marker.id,'queued.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(rows.length,1);assert(rows[0].text.endsWith('old work'));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('thrown send retains inflight words and refuses replay across a fresh process',async()=>{
 const dir=fixture();try{
  hold(dir);
  await deliverHeld({panes:[pane],dir,resolveTarget:async()=>pane,send:async()=>{throw Error('fixture transport lost');}});
  const child=spawnSync(process.execPath,['--input-type=module','-e',`
   import {deliverHeld} from './termcontrol/bridge/held-messages.mjs';
   const pane=${JSON.stringify(pane)};let sends=0;
   await deliverHeld({panes:[pane],dir:${JSON.stringify(dir)},resolveTarget:async()=>pane,send:async()=>{sends++;}});
   if(sends!==0)throw Error('replayed after restart');
  `],{cwd:new URL('../..',import.meta.url),encoding:'utf8',timeout:10000});
  assert.equal(child.status,0,child.stderr);assert.equal(stored(dir).length,1);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('process death during fake send keeps claimed words recoverable without retry',async()=>{
 const dir=fixture();try{
  hold(dir);
  const child=spawnSync(process.execPath,['--input-type=module','-e',`
   import {deliverHeld} from './termcontrol/bridge/held-messages.mjs';
   const pane=${JSON.stringify(pane)};
   await deliverHeld({panes:[pane],dir:${JSON.stringify(dir)},resolveTarget:async()=>pane,send:async()=>process.exit(27)});
  `],{cwd:new URL('../..',import.meta.url),encoding:'utf8',timeout:10000});
  assert.equal(child.status,27,child.stderr);let sends=0;
  await deliverHeld({panes:[pane],dir,resolveTarget:async()=>pane,send:async()=>{sends++;}});
  assert.equal(sends,0);assert.equal(stored(dir).length,1);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('proven prewrite refusal retries the same batch without copying and uncertain retry consumes permission',async()=>{
 const dir=fixture();try{
  hold(dir);let sends=0;
  const options={panes:[pane],dir,resolveTarget:async()=>pane,receipt:()=>false,send:async()=>{sends++;return sends===1?{notSent:true,error:'zero writes'}:{uncertain:true,error:'lost ack'};}};
  await deliverHeld(options);assert.equal(stored(dir).length,1);
  await deliverHeld(options);await deliverHeld(options);
  assert.equal(sends,2);assert.equal(stored(dir).length,1);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('separate concurrent dispatch calls reserve a batch once and retain a concurrently enqueued message',async()=>{
 const dir=fixture();try{
  hold(dir);let sends=0,release;
  const gate=new Promise(r=>release=r);let entered;const ready=new Promise(r=>entered=r);
  const options={panes:[pane],dir,resolveTarget:async()=>pane,receipt:()=>false,send:async()=>{sends++;entered();await gate;return {uncertain:true};}};
  const first=deliverHeld(options);await ready;
  holdMessage(pane.id,'new while inflight',{dir,target:pane,now:2000});
  await deliverHeld(options);release();await first;
  assert.equal(sends,1);assert.equal(stored(dir).length,2);
  await deliverHeld(options);assert.equal(sends,1);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('a restart after known refusal and late receipt cannot leave copied rows to dispatch',async()=>{
 const dir=fixture();try{
  hold(dir);
  const child=spawnSync(process.execPath,['--input-type=module','-e',`
   import {deliverHeld} from './termcontrol/bridge/held-messages.mjs';
   const pane=${JSON.stringify(pane)};
   await deliverHeld({panes:[pane],dir:${JSON.stringify(dir)},resolveTarget:async()=>pane,send:async()=>({notSent:true,error:'zero writes'})});
  `],{cwd:new URL('../..',import.meta.url),encoding:'utf8',timeout:10000});
  assert.equal(child.status,0,child.stderr);assert(!fs.existsSync(path.join(dir,pane.id+'.jsonl')),'never copy back');
  let sends=0;const options={panes:[pane],dir,resolveTarget:async()=>pane,receipt:()=>true,send:async()=>{sends++;}};
  assert.equal((await deliverHeld(options))[0].received,true);await deliverHeld(options);
  assert.equal(sends,0);assert.equal(stored(dir).length,1);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('exact structured user receipt settles a batch; assistant echo and wrong session do not',async()=>{
 const dir=fixture();try{
  const record=path.join(dir,'synthetic-transcript.jsonl');
  const target={...pane,record};
  const token='D-1234abcd';holdMessage(pane.id,'receipt fixture [delivery '+token+']',{dir,target,now:Date.now()-1000});
  const header={type:'session_meta',payload:{id:pane.sessionId}};
  const row=(role)=>({type:'response_item',timestamp:new Date().toISOString(),payload:{type:'message',role,content:[{type:'input_text',text:'[delivery '+token+']'}]}});
  fs.writeFileSync(record,[header,row('assistant')].map(JSON.stringify).join('\n')+'\n');let sends=0;
  const options={panes:[target],dir,resolveTarget:async()=>target,
   receipt:(p,r)=>!!scanDeliveryReceipt({file:record,provider:p.provider,sessionId:p.sessionId,delivery:token,since:r.at}),
   send:async()=>{sends++;return {ok:true,delivered:true};}};
  assert.deepEqual(await deliverHeld(options),[]);assert.equal(sends,1);
  fs.writeFileSync(record,[{...header,payload:{id:'wrong-session'}},row('user')].map(JSON.stringify).join('\n')+'\n');
  assert.deepEqual(await deliverHeld(options),[]);assert.equal(sends,1);
  fs.writeFileSync(record,[header,row('user')].map(JSON.stringify).join('\n')+'\n');
  assert.deepEqual(await deliverHeld(options),[{received:true,pane:pane.id,count:1}]);
  assert.equal(sends,1);assert.equal(stored(dir).length,1,'received archive still retains original words');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
