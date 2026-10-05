import {expect,test} from '@playwright/test';
import {createSessionState,selectSessionView} from '../shared/sessionState.mjs';
import {reduceSessionEnvelope} from '../shared/sessionEnvelope.mjs';
import {projectSessionState,authoritativeSessionView} from '../src/lib/sessionStateAdapter';
import {buildTerminalHeaderState} from '../src/lib/terminalHeaderState';
import {paneBadgeAttention} from '../src/lib/sessionStatus';
import {projectSessionStatusEvents} from '../termcontrol/bridge/session-status.mjs';
const identity={paneId:'pane-a',sessionId:'conversation-a',runId:'run-a',epoch:0};
const event=(changes:any={})=>({version:2,identity,id:'start',producer:'verified-hooks',source:'hook',seq:1,at:1000,kind:'report',lifecycle:'working',startsNewTurn:true,...changes});
const context={now:1000,wallNow:1000,leaseMs:100};
const pane=(changes:any={})=>({id:'pty-a',paneId:'pane-a',providerSessionId:'conversation-a',activeRunId:'run-a',cols:80,rows:24,...changes});

test('strict envelopes reject missing sequence, guessed identity, and competing producers',()=>{
 const empty=createSessionState(identity);
 for(const malformed of [event({version:1}),event({seq:undefined}),event({identity:{...identity,runId:'unbound'}})])
  expect(reduceSessionEnvelope(empty,malformed,context)).toBe(empty);
 const state=reduceSessionEnvelope(empty,event(),context);
 expect(state.authorityProducer?.producer).toBe('verified-hooks');
 expect(reduceSessionEnvelope(state,event({id:'other',producer:'second-writer',seq:2,at:1001,lifecycle:'idle'}),context)).toBe(state);
});
test('strict reconnect clears source binding and rejects the old epoch',()=>{
 let state=reduceSessionEnvelope(createSessionState(identity),event(),context);
 state=reduceSessionEnvelope(state,event({id:'reattach',producer:'transport',source:'transport',kind:'transport.reconnected',seq:1,at:1001}),context);
 expect(state.authorityProducer).toBeNull();expect(state.identity.epoch).toBe(1);
 expect(reduceSessionEnvelope(state,event({id:'old',seq:99,at:1002}),context)).toBe(state);
 state=reduceSessionEnvelope(state,event({identity:state.identity,id:'fresh',producer:'new-hooks',seq:1,at:1002}),context);
 expect(state.authorityProducer?.producer).toBe('new-hooks');
});
test('real desktop header and badge project the same events as the Node bridge',()=>{
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'window');
 Object.defineProperty(globalThis,'window',{configurable:true,value:{localStorage:{getItem:()=> 'on'}}});
 try {
  const now=performance.now(),wall=Date.now();
  const events=[event({at:wall,task:{text:'Verify checkout',source:'task-tool'},goal:{text:'Make checkout reliable',source:'about-what'},now:{text:'Running payment checks',source:'hook'}}),
   event({id:'approval',seq:2,at:wall+1,lifecycle:'waiting',startsNewTurn:false,question:{id:'permission-a',reason:'approval'}}),
   event({id:'answer',seq:3,at:wall+2,kind:'question.resolved',questionId:'permission-a'}),
   event({id:'stop',seq:4,at:wall+3,lifecycle:'finished',completionSource:'hook-stop',completedAt:wall+3})];
  let previous:any=undefined;
  const accepted:any[]=[];
  for(const envelope of events) {
   accepted.push(envelope);
   const current=pane({sessionEventsV2:accepted,statusSummary:{sessionId:'conversation-a',updatedAt:wall+50,status:'working',confidence:'high',task:'Wrong legacy task',now:'Wrong legacy activity'},statusSummarySource:'sidecar'});
   const state=projectSessionState(previous,current,wall+100,now);
   const view=projectSessionStatusEvents(identity,accepted,{now,wallNow:wall+100}).view;
   const header=buildTerminalHeaderState({paneId:'pane-a',terminalId:'pty-a',terminalStatus:'running',sessionStateV2:state,sessionStateNow:now,
    statusSummary:current.statusSummary,mainUserAsk:{text:'Wrong legacy goal',source:'status-sidecar',updatedAt:wall+50}});
   expect(selectSessionView(state,now)).toEqual(view);
   expect(header.taskDescription).toBe(view.task?.label);
   expect(header.userGoal).toBe(view.goal?.text);
   expect(header.status).toBe(view.lifecycle==='finished'?'done':view.lifecycle==='unknown'?'unavailable':view.lifecycle);
   expect(paneBadgeAttention({...current,sessionStateV2:state,terminalVisibleText:'Working (3m)'})).toBe(view.attention);
   previous={...current,sessionStateV2:state};
  }
 } finally {if(descriptor)Object.defineProperty(globalThis,'window',descriptor);else delete (globalThis as any).window;}
});
test('default shadow records events without activating header authority',()=>{
 const state=projectSessionState(undefined,pane({sessionEventsV2:[event()]}),1000,1000);
 expect(state.lifecycle).toBe('working');expect(authoritativeSessionView(state,1000)).toBeUndefined();
});
test('a mismatched conversation report cannot inherit the bound pane identity',()=>{
 const state=projectSessionState(undefined,pane({statusSummarySource:'sidecar',statusSummary:{sessionId:'conversation-b',updatedAt:1000,status:'working',confidence:'high'}}),1000,1000);
 expect(state.lifecycle).toBe('unknown');
});
test('untyped legacy waiting becomes Unknown rather than preserving a false Working state',()=>{
 const previous=pane({sessionStateV2:projectSessionState(undefined,pane({statusSummarySource:'sidecar',statusSummary:{sessionId:'conversation-a',updatedAt:1000,status:'working',confidence:'high'}}),1000,1000)});
 const state=projectSessionState(previous,pane({statusSummarySource:'sidecar',statusSummary:{sessionId:'conversation-a',updatedAt:1001,status:'waiting',confidence:'high'}}),1001,1001);
 expect(state.lifecycle).toBe('unknown');expect(state.question).toBeNull();
});
test('compact Task retains the full authoritative text for copy and inspection',()=>{
 const full='Finish bilingual coverage for all shared components and verify the complete customer checkout journey. Read the documented project instructions before editing.';
 const state=reduceSessionEnvelope(createSessionState(identity),event({task:{text:full,source:'task-tool'}}),context);
 const view=selectSessionView(state,1000);
 expect(view.task?.text).toBe(full);expect(view.task?.label!.length).toBeLessThanOrEqual(96);expect(view.task?.label).toMatch(/…$/);
});
