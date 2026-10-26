import {expect,test} from '@playwright/test';
import fs from 'node:fs';import path from 'node:path';
import {publishSessionEvent,publishSessionObservation} from '../scripts/lib/session-event-journal.mjs';
import {sessionCompatibilitySidecar} from '../shared/sessionCompatibility.mjs';
import {recordSessionSoak} from '../scripts/lib/session-soak.mjs';
const setup=()=>({dir:fs.mkdtempSync('/tmp/termfleet-lifecycle-'),paneId:'synthetic-pane',provider:'codex',runId:'synthetic-run'});
async function start(options:any){return publishSessionEvent({...options,at:1000,payload:{session_id:'synthetic-chat',hook_event_name:'UserPromptSubmit'},sidecar:{turn:'working'}});}
function observed(head:any,type:string,seq:number,changes:any={}){return {identity:head.identity,type,observer:'synthetic-backend',seq,at:1000+seq,processToken:'child-42-start-9',...changes};}
// Oct 7 capsule contract: a rejected/stale observation is no longer dropped (null);
// it is retained as an uninterpreted source record, but it must never be projected
// into lifecycle state: same lifecycle, same ended flag, same conversation identity.
function expectRejected(result:any,before:any){
 expect(result).not.toBeNull();
 if(result.captureReceipt?.projected!==undefined) expect(result.captureReceipt.projected).toBe(false);
 else expect(result.event.kind).toBe('source.observed');
 expect(result.state.lifecycle).toBe(before.state.lifecycle);expect(result.state.ended).toBe(before.state.ended);
 expect(result.identity).toEqual(before.identity);
}
test('agent exit is durable while shell lives; wrong process and stale binding cannot end a session',async()=>{
 const options=setup();try{
  let head=await start(options);
  head=await publishSessionObservation({...options,observation:observed(head,'agent.started',1)});
  expect(head.state.lifecycle).toBe('working');
  expectRejected(await publishSessionObservation({...options,observation:observed(head,'agent.exited',2,{processToken:'other',exitCode:0})}),head);
  expectRejected(await publishSessionObservation({...options,observation:observed(head,'agent.exited',2,{identity:{...head.identity,runId:'old-run'},exitCode:0})}),head);
  head=await publishSessionObservation({...options,observation:observed(head,'agent.exited',2,{exitCode:0,shellAlive:true})});
  expect(head.state.lifecycle).toBe('ended');expect(head.state.ended).toBe(true);
  expect(JSON.parse(fs.readFileSync(path.join(options.dir,head.journal),'utf8').trim().split('\n').at(-1)!).kind).toBe('process.gone');
 }finally{fs.rmSync(options.dir,{recursive:true,force:true});}
});
test('Esc and Ctrl+C intent alone do not cancel; only a matched observed interruption changes state',async()=>{
 const options=setup();try{
  let head=await start(options);head=await publishSessionObservation({...options,observation:observed(head,'agent.started',1)});
  head=await publishSessionObservation({...options,observation:observed(head,'interruption.intent',2,{intentId:'input-1',key:'Escape'})});
  expect(head.state.lifecycle).toBe('working');
  expectRejected(await publishSessionObservation({...options,observation:observed(head,'interruption.observed',3,{intentId:'wrong'})}),head);
  head=await publishSessionObservation({...options,observation:observed(head,'interruption.observed',3,{intentId:'input-1'})});
  expect(head.state.lifecycle).toBe('interrupted');expect(head.state.ended).toBe(false);
  head=await publishSessionEvent({...options,at:1010,payload:{session_id:'synthetic-chat',hook_event_name:'UserPromptSubmit'},sidecar:{turn:'working'}});
  expect(head.state.lifecycle).toBe('working');
 }finally{fs.rmSync(options.dir,{recursive:true,force:true});}
});
test('backend signal exits are explicit; nonzero exits crash and success is not turn completion',async()=>{
 for(const [extra,lifecycle] of [[{exitCode:2},'crashed'],[{signal:'SIGINT'},'interrupted'],[{exitCode:0},'ended']] as const){
  const options=setup();try{let head=await start(options);head=await publishSessionObservation({...options,observation:observed(head,'agent.started',1)});
   head=await publishSessionObservation({...options,observation:observed(head,'agent.exited',2,extra)});
   expect(head.state.lifecycle).toBe(lifecycle);expect(head.state.completion).toBeNull();
  }finally{fs.rmSync(options.dir,{recursive:true,force:true});}
 }
});
test('transport events persist, never mark Finished, and reconnect requires fresh report',async()=>{
 const options=setup();try{
  let head=await start(options);
  head=await publishSessionObservation({...options,observation:observed(head,'transport.disconnected',1)});
  expect(head.state.lifecycle).toBe('unknown');expect(head.state.transportGap).toBe(true);
  head=await publishSessionObservation({...options,observation:observed(head,'transport.reconnected',2)});
  expect(head.identity.epoch).toBe(1);expect(head.state.lifecycle).toBe('unknown');
  head=await publishSessionEvent({...options,at:1010,payload:{session_id:'synthetic-chat',hook_event_name:'PostToolUse'},sidecar:{turn:'working'}});
  expect(head.state.lifecycle).toBe('working');expect(head.state.transportGap).toBe(false);
 }finally{fs.rmSync(options.dir,{recursive:true,force:true});}
});
test('source observation ordering survives snapshot loss and rejects duplicate events',async()=>{
 const options=setup();try{
  let head=await start(options);const initial=fs.readFileSync(path.join(options.dir,`events-${(await import('../scripts/lib/agent-status-paths.mjs')).fnv(options.paneId)}.json`));
  const observation=observed(head,'agent.started',1);head=await publishSessionObservation({...options,observation});
  fs.writeFileSync(path.join(options.dir,(await import('../scripts/lib/session-event-journal.mjs')).sessionEventHeadName(options.paneId)),initial);
  // Replay restores seq 2; the duplicate is retained as seq 3 (source record only),
  // so ordering stays monotonic and the next real observation is seq 4.
  const duplicate=await publishSessionObservation({...options,observation});
  expectRejected(duplicate,head);expect(duplicate.seq).toBe(3);
  head=await publishSessionObservation({...options,observation:observed(head,'agent.exited',2,{exitCode:0})});
  expect(head.seq).toBe(4);expect(head.state.lifecycle).toBe('ended');
 }finally{fs.rmSync(options.dir,{recursive:true,force:true});}
});
test('authority compatibility has a sole derived status writer and fails closed without a head',()=>{
 const old={turn:'working',now:'legacy speculation',turnReason:'permission_request',sessionId:'chat',mainTask:'Keep checkout reliable'};
 expect(sessionCompatibilitySidecar(old,null,false)).toEqual(old);
 const absent=sessionCompatibilitySidecar(old,null,true);expect(absent.turn).toBe('unknown');expect(absent.now).toBeUndefined();expect(absent.turnReason).toBeUndefined();expect(absent.mainTask).toBe(old.mainTask);
});
test('soak persists bounded sanitized metadata, survives restart and contains no content or raw identity',()=>{
 const dir=fs.mkdtempSync('/tmp/termfleet-soak-');try{
  const head={provider:'codex',seq:1,identity:{paneId:'/private/pane',sessionId:'secret-chat',runId:'run',epoch:0},event:{source:'hook',kind:'report',at:1000},state:{lifecycle:'working',task:{text:'secret prompt'},reason:'secret reason'}};
  for(let i=0;i<20;i++) recordSessionSoak(head,{dir,maxBytes:1024,slots:2,at:1000+i,legacyStatus:'waiting'});
  const files=fs.readdirSync(dir).filter(name=>name.endsWith('.jsonl'));expect(files.length).toBeLessThanOrEqual(2);
  const body=files.map(name=>fs.readFileSync(path.join(dir,name),'utf8')).join('');expect(body).not.toMatch(/secret|\/private|Keep checkout/);
  expect(body).toContain('waiting');expect(body).toContain('working');
  for(const file of files) expect(fs.statSync(path.join(dir,file)).size).toBeLessThanOrEqual(1024);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('reconnected durable heads hydrate and never erase an explicit completion',async()=>{
 const options=setup();try{
  let head=await start(options);
  head=await publishSessionEvent({...options,at:1001,payload:{session_id:'synthetic-chat',hook_event_name:'Stop'},sidecar:{turn:'idle'}});
  head=await publishSessionObservation({...options,observation:observed(head,'transport.reconnected',2)});
  const {viewFromSessionSnapshot}=await import('../shared/sessionSnapshot.mjs');
  expect(viewFromSessionSnapshot(head,{now:10,wallNow:1010})?.lifecycle).toBe('finished');
  const impostor={...head,event:{...head.event,kind:'report'}};
  expect(viewFromSessionSnapshot(impostor,{now:10,wallNow:1010})).toBeNull();
 }finally{fs.rmSync(options.dir,{recursive:true,force:true});}
});
test('late tools after observed interruption cannot revive work; a new prompt can',async()=>{
 const options=setup();try{
  let head=await start(options);head=await publishSessionObservation({...options,observation:observed(head,'agent.started',1)});
  head=await publishSessionObservation({...options,observation:observed(head,'interruption.intent',2,{intentId:'cancel',key:'Ctrl+C'})});
  head=await publishSessionObservation({...options,observation:observed(head,'interruption.observed',3,{intentId:'cancel'})});
  const late=await publishSessionEvent({...options,at:1010,payload:{session_id:'synthetic-chat',hook_event_name:'PostToolUse'},sidecar:{turn:'working'}});
  expect(late.state.lifecycle).toBe('interrupted');
  const next=await publishSessionEvent({...options,at:1011,payload:{session_id:'synthetic-chat',hook_event_name:'UserPromptSubmit'},sidecar:{turn:'working'}});
  expect(next.state.lifecycle).toBe('working');
 }finally{fs.rmSync(options.dir,{recursive:true,force:true});}
});
test('opt-in desktop authority never promotes a legacy status when no durable head exists',async()=>{
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'window');
 Object.defineProperty(globalThis,'window',{configurable:true,value:{localStorage:{getItem:()=> 'on'}}});
 try{
  const {projectSessionState}=await import('../src/lib/sessionStateAdapter');
  const pane:any={id:'synthetic-pty',paneId:'synthetic-pane',providerSessionId:'synthetic-chat',activeRunId:'synthetic-run',statusSummarySource:'sidecar',statusSummary:{sessionId:'synthetic-chat',updatedAt:1000,status:'working',confidence:'high'}};
  expect(projectSessionState(undefined,pane,1000,1000).lifecycle).toBe('unknown');
 }finally{if(descriptor)Object.defineProperty(globalThis,'window',descriptor);else Reflect.deleteProperty(globalThis,'window');}
});
test('OpenCode compatibility retires guessed turn and activity only when authority is explicitly on',async()=>{
 const saved=process.env.TERMFLEET_STATUS_AUTHORITY,dir=fs.mkdtempSync('/tmp/termfleet-retirement-');
 try{
  process.env.TERMFLEET_STATUS_AUTHORITY='on';
  const {createStatusWriter,publishOpenCodeEvent}=await import('../scripts/termfleet-opencode-status-plugin.js');
  const writer=createStatusWriter({paneId:'synthetic-pane',filePath:path.join(dir,'pane.json')});
  writer.state.sessionId='synthetic-chat';writer.state.turn='working';writer.state.now='Speculation';
  expect(writer.write(1000).turn).toBe('unknown');expect(writer.write(1000).now).toBeUndefined();
  const head=await publishOpenCodeEvent(writer,{type:'chat.message'},1001);expect(head.state.lifecycle).toBe('working');
  expect(JSON.parse(fs.readFileSync(writer.filePath,'utf8')).turn).toBe('working');
  process.env.TERMFLEET_STATUS_AUTHORITY='off';writer.state.turn='idle';expect(writer.write(1002).turn).toBe('idle');
 }finally{if(saved===undefined)delete process.env.TERMFLEET_STATUS_AUTHORITY;else process.env.TERMFLEET_STATUS_AUTHORITY=saved;fs.rmSync(dir,{recursive:true,force:true});}
});
test('journal opt-in emits durable sanitized soak evidence and recorder failure preserves committed head',async()=>{
 const options=setup(),soakDir=path.join(options.dir,'soak');try{
  let head=await publishSessionEvent({...options,soakDir,at:1000,payload:{session_id:'synthetic-chat',hook_event_name:'UserPromptSubmit'},sidecar:{turn:'working',now:'Never copy this private content'}});
  expect(fs.readFileSync(path.join(soakDir,'soak-0.jsonl'),'utf8')).not.toContain('private content');
  fs.mkdirSync(path.join(soakDir,'.recorder-lock'));fs.writeFileSync(path.join(soakDir,'.recorder-lock/owner'),String(process.pid));
  const errors:string[]=[],original=console.error;console.error=(...args)=>errors.push(args.join(' '));
  try {head=await publishSessionEvent({...options,soakDir,at:1001,payload:{session_id:'synthetic-chat',hook_event_name:'Stop'},sidecar:{turn:'idle'}});}finally{console.error=original;}
  expect(head.state.lifecycle).toBe('finished');expect(errors.join()).toContain('evidence not acknowledged');
 }finally{fs.rmSync(options.dir,{recursive:true,force:true});}
});

test('crash replay repairs a reconnect head even when the duplicate old-epoch observation is rejected',async()=>{
 const options=setup();try{
  let head=await start(options);const {sessionEventHeadName}=await import('../scripts/lib/session-event-journal.mjs');const file=path.join(options.dir,sessionEventHeadName(options.paneId));const initial=fs.readFileSync(file);
  const observation=observed(head,'transport.reconnected',1);head=await publishSessionObservation({...options,observation});
  fs.writeFileSync(file,initial);
  expectRejected(await publishSessionObservation({...options,observation}),head);
  const repaired=JSON.parse(fs.readFileSync(file,'utf8'));
  expect(repaired.identity.epoch).toBe(1);
  expect((await import('../shared/sessionSnapshot.mjs')).viewFromSessionSnapshot(repaired,{now:10,wallNow:1010})?.lifecycle).toBe('unknown');
 }finally{fs.rmSync(options.dir,{recursive:true,force:true});}
});

test('bridge authority without durable evidence exposes Unknown rather than a legacy lifecycle',async()=>{
 const dir=fs.mkdtempSync('/tmp/termfleet-bridge-authority-');try{
  const {readSessionStatus}=await import('../termcontrol/bridge/session-status.mjs');
  const pane={id:'synthetic-pane',provider:'claude',sessionId:'synthetic-chat'};
  const active=readSessionStatus(pane,{dir,authority:true});expect(active.turn).toBe('unknown');expect(active.workingSince).toBeNull();expect(active.sessionAuthority).toBe(true);
  expect(readSessionStatus(pane,{dir,authority:false}).turn).toBeUndefined();
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});


test('kernel exit evidence without a wait status is Ended, never fabricated Crashed or Finished',async()=>{
 const options=setup();try{
  let head=await start(options);head=await publishSessionObservation({...options,observation:observed(head,'agent.started',1)});
  expectRejected(await publishSessionObservation({...options,observation:observed(head,'agent.exited',2)}),head);
  head=await publishSessionObservation({...options,observation:observed(head,'agent.exited',2,{exitObserved:true})});
  expect(head.state.lifecycle).toBe('ended');expect(head.state.completion).toBeNull();
 }finally{fs.rmSync(options.dir,{recursive:true,force:true});}
});
