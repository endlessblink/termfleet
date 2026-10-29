import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {holdMessage,deliverHeld,sweepStranded,recordHeldQuarantineStatus} from '../bridge/held-messages.mjs';
import {createEventLog} from '../bridge/events-db.mjs';
const pane={id:'terminal-quarantine-fixture',provider:'codex',sessionId:'original-conversation',alive:true,turn:'idle'};
const text='[Message from the bot "fixture" (bot:0123456789ab), sent through TermFleet.]\nExact original שלום 🧭\n[delivery D-1234abcd]';
const fixture=()=>fs.mkdtempSync(path.join(os.tmpdir(),'tf-held-quarantine-'));
const aged=2*60*60*1000;
function manifest(dir){
 const reservation=JSON.parse(fs.readFileSync(path.join(dir,pane.id+'.jsonl.quarantine'),'utf8'));
 const root=path.join(dir,'quarantine',reservation.id);
 return {root,data:JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'))};
}
test('aged dead batch is quarantined byte-for-byte and cannot replay after return or restart',async()=>{
 const dir=fixture();try{
  holdMessage(pane.id,text,{dir,target:pane,now:1000});
  const original=fs.readFileSync(path.join(dir,pane.id+'.jsonl'));
  let notices=0;const statuses=[];
  sweepStranded({panes:[],dir,now:aged,notify:()=>notices++,status:s=>statuses.push(s)});
  let sends=0;await deliverHeld({panes:[pane],dir,now:aged,resolveTarget:async()=>pane,send:async()=>{sends++;return {ok:true};}});
  assert.equal(sends,0,'closed target return cannot authorize old work');
  const saved=manifest(dir);assert.deepEqual(fs.readFileSync(path.join(saved.root,'queued.jsonl')),original);
  assert.equal(saved.data.pane,pane.id);assert.equal(saved.data.targets[0].sessionId,pane.sessionId);
  assert.equal(saved.data.receiptState,'not-attempted');assert.equal(notices,0);assert.equal(statuses.length,1);
  const child=spawnSync(process.execPath,['--input-type=module','-e',`
   import {deliverHeld,sweepStranded} from './termcontrol/bridge/held-messages.mjs';
   const pane=${JSON.stringify(pane)},dir=${JSON.stringify(dir)};let sends=0,statuses=0;
   sweepStranded({panes:[],dir,now:${aged},status:()=>statuses++});
   await deliverHeld({panes:[pane],dir,resolveTarget:async()=>pane,send:async()=>sends++});
   if(sends||statuses)throw Error('restart replay or duplicate status');
  `],{cwd:new URL('../..',import.meta.url),encoding:'utf8',timeout:10000});
  assert.equal(child.status,0,child.stderr);
  assert.throws(()=>holdMessage(pane.id,'new arrival',{dir,target:pane}),/quarantin/i);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('uncertain batch retains bytes and unconfirmed recovery state without replay',async()=>{
 const dir=fixture();try{
  holdMessage(pane.id,text,{dir,target:pane,now:1000});let sends=0;
  await deliverHeld({panes:[pane],dir,resolveTarget:async()=>pane,send:async()=>{sends++;return {uncertain:true};}});
  const original=fs.readFileSync(path.join(dir,pane.id+'.jsonl.inflight'));
  sweepStranded({panes:[],dir,now:aged,status:()=>{}});
  const saved=manifest(dir);assert.equal(saved.data.receiptState,'unconfirmed');
  assert.deepEqual(fs.readFileSync(path.join(saved.root,'inflight.jsonl')),original);
  await deliverHeld({panes:[pane],dir,resolveTarget:async()=>pane,send:async()=>sends++});assert.equal(sends,1);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('quarantine status retries failure with stable id and no notification',()=>{
 const dir=fixture();try{
  holdMessage(pane.id,text,{dir,target:pane,now:1000});const ids=[];let fail=true;
  const options={panes:[],dir,now:aged,notify:()=>assert.fail('must not wake sender'),status:s=>{ids.push(s.id);if(fail)throw Error('offline internal status');}};
  sweepStranded(options);fail=false;sweepStranded(options);sweepStranded(options);
  assert.equal(ids.length,2);assert.equal(ids[0],ids[1]);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('young dead, sleeping and unreadable batches are never aged out',()=>{
 for(const kind of ['young','sleeping','corrupt']){
  const dir=fixture();try{
   holdMessage(pane.id,text,{dir,target:pane,now:1000});
   if(kind==='corrupt')fs.appendFileSync(path.join(dir,pane.id+'.jsonl'),'broken-json\n');
   sweepStranded({panes:kind==='sleeping'?[{...pane,alive:false,sleeping:true}]:[],dir,now:kind==='young'?2000:aged,notify:()=>{},status:()=>assert.fail('not a quarantine candidate')});
   assert.equal(fs.existsSync(path.join(dir,pane.id+'.jsonl.quarantine')),false);assert(fs.existsSync(path.join(dir,pane.id+'.jsonl')));
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
 }
});

test('young queued row protects an old inflight batch from premature quarantine',async()=>{
 const dir=fixture();try{
  holdMessage(pane.id,text,{dir,target:pane,now:1000});
  await deliverHeld({panes:[pane],dir,resolveTarget:async()=>pane,send:async()=>({notSent:true})});
  holdMessage(pane.id,'young words',{dir,target:pane,now:aged-100});
  sweepStranded({panes:[],dir,now:aged,status:()=>assert.fail('mixed-age batch is not eligible')});
  assert(!fs.existsSync(path.join(dir,pane.id+'.jsonl.quarantine')));
  assert(fs.existsSync(path.join(dir,pane.id+'.jsonl.inflight.retryable')));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('interrupted archive move leaves durable reservation and exact original bytes, never replay',async()=>{
 const dir=fixture();const rename=fs.renameSync;try{
  holdMessage(pane.id,text,{dir,target:pane,now:1000});
  const file=path.join(dir,pane.id+'.jsonl'),original=fs.readFileSync(file);
  fs.renameSync=(from,to)=>{if(to.endsWith('/queued.jsonl'))throw Error('synthetic archive storage failure');return rename(from,to);};
  sweepStranded({panes:[],dir,now:aged,status:()=>{}});fs.renameSync=rename;
  assert.deepEqual(fs.readFileSync(file),original);assert(manifest(dir).data);
  let sends=0;await deliverHeld({panes:[pane],dir,resolveTarget:async()=>pane,send:async()=>sends++});assert.equal(sends,0);
 }finally{fs.renameSync=rename;fs.rmSync(dir,{recursive:true,force:true});}
});

test('internal SQL status is idempotent across record-before-ack failure and database reopen',()=>{
 const dir=fixture();let store;try{
  holdMessage(pane.id,text,{dir,target:pane,now:1000});store=createEventLog({file:path.join(dir,'status.db')});
  let fail=true;const status=event=>{recordHeldQuarantineStatus(event,store.recordActionEvidence);if(fail)throw Error('record committed; acknowledgement unavailable');};
  sweepStranded({panes:[],dir,now:aged,status});store.close();store=createEventLog({file:path.join(dir,'status.db')});fail=false;
  sweepStranded({panes:[],dir,now:aged,status});sweepStranded({panes:[],dir,now:aged,status});
  const events=store.queryActionEvidence({bot_id:'0123456789ab'});assert.equal(events.length,1);
  assert.equal(events[0].state,'interrupted');assert.equal(events[0].result_code,'held_quarantined_not_attempted');
  assert.equal(events[0].session_id,pane.sessionId);assert(!JSON.stringify(events).includes('Exact original'));
 }finally{store?.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('process death after reservation before archive move preserves recoverable rows and refuses replay',async()=>{
 const dir=fixture();try{
  holdMessage(pane.id,text,{dir,target:pane,now:1000});
  const original=fs.readFileSync(path.join(dir,pane.id+'.jsonl'));
  const child=spawnSync(process.execPath,['--input-type=module','-e',`
   import fs from 'node:fs';import {sweepStranded} from './termcontrol/bridge/held-messages.mjs';
   const rename=fs.renameSync;fs.renameSync=(a,b)=>{if(b.endsWith('/queued.jsonl'))process.exit(29);return rename(a,b);};
   sweepStranded({panes:[],dir:${JSON.stringify(dir)},now:${aged}});
  `],{cwd:new URL('../..',import.meta.url),encoding:'utf8',timeout:10000});
  assert.equal(child.status,29,child.stderr);assert(manifest(dir).data);
  assert.deepEqual(fs.readFileSync(path.join(dir,pane.id+'.jsonl')),original);
  let sends=0;await deliverHeld({panes:[pane],dir,resolveTarget:async()=>pane,send:async()=>sends++});assert.equal(sends,0);
  assert(fs.existsSync(path.join(dir,pane.id+'.jsonl.dispatch')),'no automatic stale-lock reclamation');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
