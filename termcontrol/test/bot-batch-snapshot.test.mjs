import test from 'node:test';
import assert from 'node:assert/strict';
import { createBotBatchSnapshot } from '../bridge/bot-batch-snapshot.mjs';
const ID='aaaaaaaaaaaa';
function fixture(){
  const bot={id:ID,name:'Worker',state:'idle',helpers:[{paneId:'terminal-one',task:'Finished work'}]},raw={name:'Worker',provider:'codex'},pane={id:'terminal-one',cwd:'/repo',pid:123,startedAt:1,sessionId:'session-one',turn:'idle',alive:true,lastActiveAt:2};
  const bots={summary:()=>bot,read:()=>raw,watches:()=>[],messages:()=>[],running:new Map(),queues:new Map(),sides:new Map()};
  const calls=[];let git={status:0,stdout:''},unsaved=[];
  const snapshot=createBotBatchSnapshot({bots,routines:{forPane:()=>[]},currentPanes:async()=>({daemon:true,panes:[pane]}),runGit:(args,cwd)=>{calls.push({args,cwd});return git;},filesTheAgentChanged:()=>[],unsavedWork:(_cwd,_since,run)=>{run(['status','--porcelain','--untracked-files=normal']);return unsaved;}});
  return {snapshot,bot,raw,pane,bots,calls,setGit:value=>{git=value;},setUnsaved:value=>{unsaved=value;}};
}
test('missing helper cwd blocks rather than claiming no unsaved work',async()=>{
  const f=fixture();delete f.pane.cwd;assert.match((await f.snapshot(ID)).blocked,/folder|unsaved|verify/i);assert.equal(f.calls.length,0);
});
test('failed or throwing Git inspection blocks and successful status is reused',async()=>{
  const f=fixture();f.setGit({status:128,stderr:'Unavailable'});assert.match((await f.snapshot(ID)).blocked,/unsaved|verify/i);
  f.setGit({status:0,stdout:''});f.calls.length=0;assert.equal((await f.snapshot(ID)).blocked,null);assert.equal(f.calls.length,1);
  const snapshot=createBotBatchSnapshot({bots:f.bots,routines:{forPane:()=>[]},currentPanes:async()=>({daemon:true,panes:[f.pane]}),runGit:()=>{throw Error('EACCES');},unsavedWork:()=>[],filesTheAgentChanged:()=>[]});assert.match((await snapshot(ID)).blocked,/unsaved|verify/i);
});
test('busy, unknown lifecycle and unknown runtime identity are blocked',async()=>{
  for(const change of [{turn:'working'},{turn:'waiting'},{turn:'unknown'},{pid:null},{startedAt:null},{producing:true},{attention:{kind:'ask'}}]){
    const f=fixture();Object.assign(f.pane,change);assert.ok((await f.snapshot(ID)).blocked,JSON.stringify(change));
  }
});
test('changed helper session changes snapshot identity',async()=>{
  const f=fixture(),before=await f.snapshot(ID);f.pane.sessionId='replacement';const after=await f.snapshot(ID);
  assert.notDeepEqual(before.identity.sessions,after.identity.sessions);
});
test('durable queue and main or side work always block',async()=>{
  for(const change of [f=>{f.raw.queued=['waiting'];},f=>{f.raw.inflight={text:'pending'};},f=>{f.bots.running.set(ID,{});},f=>{f.bots.queues.set(ID,['waiting']);},f=>{f.bots.sides.set(ID,{busy:true});},f=>{f.bots.sides.set(ID,{pending:[{}]});},f=>{f.bots.sides.set(ID,{inflight:[{}]});}]){
    const f=fixture();change(f);assert.ok((await f.snapshot(ID)).blocked);
  }
});
test('unsaved results and verification failure never permit helper closure',async()=>{
  const f=fixture();f.setUnsaved(['work.mjs']);assert.match((await f.snapshot(ID)).blocked,/unsaved/i);
});
