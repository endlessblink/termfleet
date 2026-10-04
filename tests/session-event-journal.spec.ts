import {expect,test} from '@playwright/test';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {publishSessionEvent,sessionEventHeadName} from '../scripts/lib/session-event-journal.mjs';
import {hydrateSessionSnapshot,viewFromSessionSnapshot} from '../shared/sessionSnapshot.mjs';
const setup=()=>({dir:fs.mkdtempSync(path.join('/tmp','termfleet-journal-')),paneId:'synthetic-pane',provider:'codex',runId:'synthetic-run'});
const payload=(event:string,changes:any={})=>({session_id:'synthetic-conversation',hook_event_name:event,...changes});

test('concurrent hooks append ordered events and preserve captured Goal and Task',async()=>{
 const options=setup();
 try {
  await publishSessionEvent({...options,payload:payload('UserPromptSubmit'),at:1000,sidecar:{turn:'working',mainTask:'Fix checkout',mainTaskSource:'opening-request',todos:[{content:'Verify payments',status:'in_progress'}]}});
  const writes=await Promise.all(Array.from({length:8},(_,i)=>publishSessionEvent({...options,payload:payload('PostToolUse',{tool_use_id:`call-${i}`}),at:1001+i,sidecar:{turn:'working',now:`Checking payment ${i}`}})));
  const head=JSON.parse(fs.readFileSync(path.join(options.dir,sessionEventHeadName(options.paneId)),'utf8'));
  const events=fs.readFileSync(path.join(options.dir,head.journal),'utf8').trim().split('\n').map(line=>JSON.parse(line));
  expect(events.map(item=>item.seq)).toEqual([1,2,3,4,5,6,7,8,9]);expect(writes).toHaveLength(8);
  expect(head.state.goal.text).toBe('Fix checkout');expect(head.state.task.text).toBe('Verify payments');
 } finally {fs.rmSync(options.dir,{recursive:true,force:true});}
});
test('approval resolves only the corresponding call; completion and late tools remain ordered',async()=>{
 const options=setup();
 try {
  await publishSessionEvent({...options,payload:payload('UserPromptSubmit'),at:1000,sidecar:{turn:'working'}});
  const waiting=await publishSessionEvent({...options,payload:payload('PermissionRequest',{tool_use_id:'approval'}),at:1001,sidecar:{turn:'waiting',turnReason:'permission_request'}});
  expect(waiting.state.question.reason).toBe('approval');
  const unrelated=await publishSessionEvent({...options,payload:payload('PostToolUse',{tool_use_id:'other'}),at:1002,sidecar:{turn:'working'}});
  expect(unrelated.state.lifecycle).toBe('waiting');
  const resumed=await publishSessionEvent({...options,payload:payload('PostToolUse',{tool_use_id:'approval'}),at:1003,sidecar:{turn:'working'}});
  expect(resumed.state.lifecycle).toBe('working');
  const finished=await publishSessionEvent({...options,payload:payload('Stop'),at:1004,sidecar:{turn:'idle'}});
  expect(finished.state.lifecycle).toBe('finished');
  const late=await publishSessionEvent({...options,payload:payload('PostToolUse'),at:1005,sidecar:{turn:'working'}});
  expect(late.state.lifecycle).toBe('finished');expect(late.state.completion.source).toBe('hook-stop');
 } finally {fs.rmSync(options.dir,{recursive:true,force:true});}
});
test('crash before snapshot rename replays the durable append before assigning a new sequence',async()=>{
 const options=setup();
 try {
  const first=await publishSessionEvent({...options,payload:payload('UserPromptSubmit'),at:1000,sidecar:{turn:'working'}});
  const event={...first.event,id:'committed-stop',seq:2,at:1001,lifecycle:'finished',startsNewTurn:false,completionSource:'hook-stop',completedAt:1001};
  fs.appendFileSync(path.join(options.dir,first.journal),JSON.stringify(event)+'\n');
  const recovered=await publishSessionEvent({...options,payload:payload('PostToolUse'),at:1002,sidecar:{turn:'working'}});
  expect(recovered.seq).toBe(3);expect(recovered.state.lifecycle).toBe('finished');
  expect(fs.readFileSync(path.join(options.dir,first.journal),'utf8').trim().split('\n')).toHaveLength(3);
 } finally {fs.rmSync(options.dir,{recursive:true,force:true});}
});
test('reader rebases leases and rejects mixed pane state; stale polls cannot renew working',async()=>{
 const options=setup();
 try {
  const head=await publishSessionEvent({...options,payload:payload('UserPromptSubmit'),at:1000,sidecar:{turn:'working'}});
  expect(viewFromSessionSnapshot(head,{now:20,wallNow:1100}).lifecycle).toBe('working');
  expect(viewFromSessionSnapshot(head,{now:20,wallNow:121000}).lifecycle).toBe('unknown');
  expect(hydrateSessionSnapshot({...head,identity:{...head.identity,paneId:'other'}},{now:20,wallNow:1100})).toBeNull();
 } finally {fs.rmSync(options.dir,{recursive:true,force:true});}
});

test('panes in one folder and successive conversations have independent journals',async()=>{
 const options=setup();
 try {
  const first=await publishSessionEvent({...options,payload:payload('UserPromptSubmit'),at:1000,sidecar:{turn:'working',cwd:'/same-folder'}});
  const sibling=await publishSessionEvent({...options,paneId:'other-pane',payload:payload('UserPromptSubmit'),at:1001,sidecar:{turn:'idle',cwd:'/same-folder'}});
  expect(first.journal).not.toBe(sibling.journal);
  const changed=await publishSessionEvent({...options,payload:payload('UserPromptSubmit',{session_id:'next-conversation'}),at:1002,sidecar:{turn:'working'}});
  expect(changed.seq).toBe(1);expect(changed.journal).not.toBe(first.journal);
  expect(await publishSessionEvent({...options,payload:payload('Stop'),at:1003,sidecar:{turn:'idle'}})).toBeNull();
  const stored=JSON.parse(fs.readFileSync(path.join(options.dir,sessionEventHeadName(options.paneId)),'utf8'));
  expect(stored.identity.sessionId).toBe('next-conversation');
 } finally {fs.rmSync(options.dir,{recursive:true,force:true});}
});
test('partial crash tail is delimited; a stale sidecar cannot roll back completed plan items',async()=>{
 const options=setup();
 try {
  const todos=[{id:'one',content:'Check payments',status:'in_progress'},{id:'two',content:'Check receipt',status:'pending'}];
  const first=await publishSessionEvent({...options,payload:payload('UserPromptSubmit'),at:1000,sidecar:{turn:'working',todos}});
  fs.appendFileSync(path.join(options.dir,first.journal),'{"version":2');
  const updated=await publishSessionEvent({...options,payload:payload('PostToolUse',{tool_name:'TaskUpdate',tool_input:{taskId:'one'}}),at:1001,sidecar:{turn:'working',todos:[{...todos[0],status:'completed'},todos[1]]}});
  expect(updated.seq).toBe(2);expect(updated.state.tasks[0].status).toBe('completed');
  const late=await publishSessionEvent({...options,payload:payload('PostToolUse',{tool_name:'Read'}),at:1002,sidecar:{turn:'working',todos}});
  expect(late.state.tasks.find(item=>item.id==='one').status).toBe('completed');
 } finally {fs.rmSync(options.dir,{recursive:true,force:true});}
});
test('explicit Goal provenance outranks an agent guess; vendor errors become Unknown',async()=>{
 const options=setup();
 try {
  await publishSessionEvent({...options,payload:payload('UserPromptSubmit'),at:1000,sidecar:{turn:'working',mainTask:'Reliable checkout',mainTaskSource:'about-what'}});
  const guessed=await publishSessionEvent({...options,payload:payload('PostToolUse'),at:1001,sidecar:{turn:'working',mainTask:'Running tests',mainTaskSource:'agent-goal'}});
  expect(guessed.state.goal.text).toBe('Reliable checkout');
  const unknown=await publishSessionEvent({...options,payload:payload('VendorError'),at:1002,sidecar:{turn:'unknown'}});
  expect(unknown.state.lifecycle).toBe('unknown');
 } finally {fs.rmSync(options.dir,{recursive:true,force:true});}
});
