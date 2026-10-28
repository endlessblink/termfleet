import test from 'node:test';
import assert from 'node:assert/strict';
import { createBotBatch } from '../bridge/bot-batch.mjs';
const A='aaaaaaaaaaaa', B='bbbbbbbbbbbb', C='cccccccccccc';
const row=(id,extra={})=>({id,name:id,plan:{items:[]},identity:{session:'one',activity:'idle'},blocked:null,...extra});
function fixture(options={}) {
  const rows=new Map([[A,row(A)],[B,row(B)]]), closed=[],archived=[];
  const batch=createBotBatch({snapshot:async id=>rows.get(id),close:async s=>{closed.push(s);return {ok:true};},archive:async s=>{archived.push(s);return {ok:true};},...options});
  return {batch,rows,closed,archived};
}
test('freezes selection and action; new bots and response mutations cannot expand it',async()=>{
  const {batch,rows,closed,archived}=fixture(); rows.get(A).plan.items.push({id:'terminal:first'});
  const ids=[A,A],p=await batch.preview(ids,'remove'); ids.push(B);rows.set(C,row(C));p.bots[0].items.push({id:'terminal:injected'});
  const r=await batch.execute(p.token);assert.equal(r.ok,true);assert.deepEqual(closed.map(s=>s.id),[A]);assert.deepEqual(archived.map(s=>s.id),[A]);
  assert.deepEqual(closed[0].plan.items.map(i=>i.id),['terminal:first']);assert.ok(Object.isFrozen(closed[0].plan.items));
});
for(const field of ['session','activity'])test('refuses changed '+field,async()=>{
  const {batch,rows,closed,archived}=fixture(),p=await batch.preview([A],'remove');rows.get(A).identity[field]='new';
  const r=await batch.execute(p.token);assert.equal(r.ok,false);assert.match(r.results[0].error,/changed/i);assert.equal(closed.length+archived.length,0);
});
test('refuses new helper even if caller identity omits plan details',async()=>{
  const {batch,rows,closed}=fixture(),p=await batch.preview([A],'close');rows.get(A).plan.items.push({id:'terminal:new'});
  assert.equal((await batch.execute(p.token)).ok,false);assert.equal(closed.length,0);
});
test('busy and unsaved bots are blocked, including work arising after preview',async()=>{
  const {batch,rows,closed}=fixture();rows.get(A).plan.items.push({id:'turn',busy:true});rows.get(B).blocked='Unsaved work';
  const p=await batch.preview([A,B],'close');assert.match(p.bots[0].blocked,/working/i);assert.equal(p.bots[1].blocked,'Unsaved work');
  assert.equal((await batch.execute(p.token)).failed,2);rows.set(A,row(A));const q=await batch.preview([A],'close');rows.get(A).blocked='Unsaved work';
  assert.equal((await batch.execute(q.token)).ok,false);assert.equal(closed.length,0);
});
test('partial failure catches per-bot errors and archives only successful closures',async()=>{
  const archived=[],batch=createBotBatch({snapshot:async id=>row(id,{plan:{items:[{id:'watch:x'}]}}),close:async s=>{if(s.id===A)throw Error('No acknowledgment');return {ok:true};},archive:async s=>{archived.push(s.id);return {ok:true};}});
  const r=await batch.execute((await batch.preview([A,B],'remove')).token);assert.equal(r.ok,false);assert.equal(r.succeeded,1);assert.equal(r.failed,1);assert.deepEqual(archived,[B]);assert.match(r.results[0].error,/acknowledgment/);
});
test('idle no-item close succeeds without callbacks',async()=>{
  const {batch,closed,archived}=fixture();assert.equal((await batch.execute((await batch.preview([A],'close')).token)).ok,true);assert.equal(closed.length+archived.length,0);
});
test('expiry, single use and cancel never permit later execution',async()=>{
  let now=100;const {batch,rows,closed}=fixture({now:()=>now,ttlMs:50});rows.get(A).plan.items.push({id:'watch:x'});
  const p=await batch.preview([A],'close');now=150;assert.equal((await batch.execute(p.token)).ok,false);
  const q=await batch.preview([A],'close');assert.equal(batch.cancel(q.token).ok,true);assert.equal((await batch.execute(q.token)).ok,false);
  const r=await batch.preview([A],'close');assert.equal((await batch.execute(r.token)).ok,true);assert.equal((await batch.execute(r.token)).ok,false);assert.equal(closed.length,1);
});
test('concurrent replay consumes token before any await',async()=>{
  let release;const pending=new Promise(r=>{release=r;});const {batch}=fixture({snapshot:async id=>row(id,{plan:{items:[{id:'watch:x'}]}}),close:async()=>{await pending;return {ok:true};}});
  const p=await batch.preview([A],'close'),first=batch.execute(p.token);assert.equal((await batch.execute(p.token)).ok,false);release();assert.equal((await first).ok,true);
});
test('bounded valid selection, supported action, missing bot and identity fail closed',async()=>{
  const {batch,rows,closed}=fixture();for(const ids of [[],['bad'],Array.from({length:101},(_,i)=>i.toString(16).padStart(12,'0'))])assert.equal((await batch.preview(ids,'close')).ok,false);
  assert.equal((await batch.preview([A],'delete')).ok,false);rows.delete(A);rows.get(B).identity=undefined;
  assert.equal((await batch.execute((await batch.preview([A,B],'remove')).token)).failed,2);assert.equal(closed.length,0);
});
test('failed close response preserves item outcomes and prevents archive',async()=>{
  let archives=0;const batch=createBotBatch({snapshot:async id=>row(id,{plan:{items:[{id:'terminal:x'}]}}),close:async()=>({ok:false,results:[{id:'terminal:x',ok:false,error:'Still running'}]}),archive:async()=>{archives++;return {ok:true};}});
  const r=await batch.execute((await batch.preview([A],'remove')).token);assert.equal(r.ok,false);assert.equal(archives,0);assert.equal(r.results[0].results[0].error,'Still running');
});
test('canonical identity tolerates object key order but archive failure remains failure',async()=>{
  let reads=0;const batch=createBotBatch({snapshot:async id=>row(id,{identity:reads++?{activity:'idle',session:'one'}:{session:'one',activity:'idle'}}),close:async()=>({ok:true}),archive:async()=>({ok:false,error:'Storage unavailable'})});
  const r=await batch.execute((await batch.preview([A],'remove')).token);assert.equal(r.ok,false);assert.equal(r.failed,1);assert.equal(r.results[0].error,'Storage unavailable');
});
test('preview exposes the existing manager warning',async()=>{
  const {batch}=fixture({snapshot:async id=>row(id,{plan:{items:[],warning:'This bot manages your other agents.'}})});
  assert.equal((await batch.preview([A],'remove')).bots[0].warning,'This bot manages your other agents.');
});
test('activity arriving during close is refused by final archive guard; partial close remains visible',async()=>{
  let arrived=false,archived=false;
  const batch=createBotBatch({snapshot:async id=>row(id,{plan:{items:[{id:'terminal:first'}]}}),
    close:async()=>{await Promise.resolve();arrived=true;return {ok:true,results:[{id:'terminal:first',ok:true}]};},
    archive:async()=>{if(arrived)return {ok:false,error:'New activity arrived; review again.'};archived=true;return {ok:true};}});
  const r=await batch.execute((await batch.preview([A],'remove')).token);
  assert.equal(r.ok,false);assert.equal(archived,false);assert.match(r.results[0].error,/New activity/);assert.deepEqual(r.results[0].results,[{id:'terminal:first',ok:true}]);
});
test('manager actions require explicit server-side acknowledgment',async()=>{
  const {batch,closed,archived}=fixture({snapshot:async id=>row(id,{plan:{items:[{id:'watch:x'}],warning:'This bot manages your agents.'}})});
  for(const action of ['close','remove']){
    const missing=await batch.execute((await batch.preview([A],action)).token);
    assert.equal(missing.ok,false);assert.match(missing.results[0].error,/confirm/i);
    assert.equal((await batch.execute((await batch.preview([A],action)).token,{confirmManager:'true'})).ok,false);
    assert.equal((await batch.execute((await batch.preview([A],action)).token,{confirmManager:true})).ok,true);
  }
  assert.equal(closed.length,2);assert.equal(archived.length,1);
});
