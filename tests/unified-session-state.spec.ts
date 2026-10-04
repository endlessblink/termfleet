import {expect,test} from '@playwright/test';
import {createSessionState,reduceSessionStatus,selectSessionView} from '../shared/sessionState.mjs';
const identity={paneId:'pane-a',sessionId:'conversation-a',runId:'run-a',epoch:0};
const context={now:1000,wallNow:1000,leaseMs:100};
const report=(overrides:any={})=>({identity,id:'event-1',producer:'hook-stream',seq:1,at:1000,source:'hook',kind:'report',lifecycle:'working',...overrides});
const apply=(state:any,event:any,ctx=context)=>reduceSessionStatus(state,event,ctx);

test('one state contains independent captured Task Goal Now and manual precedence',()=>{
 let state=createSessionState(identity);
 state=apply(state,report({task:{text:'Checking the checkout flow',source:'task-tool'},goal:{text:'Make checkout reliable',source:'opening-request'},now:{text:'Testing card payments',source:'hook'}}));
 state=apply(state,{...report({id:'manual',producer:'operator',seq:1,at:1001}),source:'operator',kind:'goal.set',goal:{text:'Keep checkout accessible',source:'manual'}});
 state=apply(state,report({id:'event-2',seq:2,at:1002,goal:{text:'A new agent goal',source:'agent-goal'},now:{text:'Checking keyboard access',source:'hook'}}),{...context,wallNow:1002});
 const view=selectSessionView(state,1000);
 expect(view.task?.text).toBe('Checking the checkout flow');
 expect(view.goal?.text).toBe('Keep checkout accessible');
 expect(view.now?.text).toBe('Checking keyboard access');
});
test('duplicates and reordered events cannot turn Finished back into Working',()=>{
 let state=apply(createSessionState(identity),report());
 state=apply(state,report({id:'stop',seq:3,at:1003,lifecycle:'finished',completedAt:1003,completionSource:'hook-stop'}));
 const stopped=state;
 state=apply(state,report({id:'late-tool',seq:2,at:1004}));
 expect(state).toBe(stopped);
 expect(apply(state,report({id:'stop',seq:3,at:1003,lifecycle:'finished',completedAt:1003,completionSource:'hook-stop'}))).toBe(state);
 expect(selectSessionView(state,999999).lifecycle).toBe('finished');
});
test('another pane, conversation, run, or attachment epoch cannot write this state',()=>{
 const state=createSessionState(identity);
 for (const key of ['paneId','sessionId','runId','epoch'])
  expect(apply(state,report({identity:{...identity,[key]:key==='epoch'?1:'different'}}))).toBe(state);
});
test('a reattach requires a new epoch; late old completion is rejected',()=>{
 let state=apply(createSessionState(identity),report());
 state=apply(state,{...report({id:'reattach',producer:'transport',seq:1,at:1001}),source:'transport',kind:'transport.reconnected'});
 expect(state.identity.epoch).toBe(1);
 expect(selectSessionView(state,1000).lifecycle).toBe('unknown');
 expect(apply(state,report({id:'old-stop',seq:99,lifecycle:'finished',completedAt:1002,completionSource:'hook-stop'}))).toBe(state);
 state=apply(state,report({identity:state.identity,id:'fresh',seq:1,at:1002}),{...context,wallNow:1002});
 expect(selectSessionView(state,1000).lifecycle).toBe('working');
});
test('approval stays distinct from a question; mismatched answers and loose Working do not clear it',()=>{
 let state=apply(createSessionState(identity),report({lifecycle:'waiting',question:{id:'approval-a',reason:'approval'}}));
 expect(selectSessionView(state,1000).question?.reason).toBe('approval');
 const waiting=state;
 expect(apply(state,{...report({id:'wrong',seq:2,at:1001}),kind:'question.resolved',questionId:'other'})).toBe(waiting);
 state=apply(state,report({id:'loose',seq:3,at:1002}));
 expect(selectSessionView(state,1000).lifecycle).toBe('waiting');
 state=apply(state,{...report({id:'answer',seq:4,at:1003}),kind:'question.resolved',questionId:'approval-a'});
 expect(selectSessionView(state,1000).lifecycle).toBe('unknown');
 state=apply(state,report({id:'resumed',seq:5,at:1004}));
 expect(selectSessionView(state,1000).lifecycle).toBe('working');
});
test('Idle, silence, and process disappearance never manufacture Finished',()=>{
 let state=apply(createSessionState(identity),report({lifecycle:'idle'}));
 expect(selectSessionView(state,1000).completion).toBeNull();
 expect(apply(state,report({id:'invented',seq:2,lifecycle:'finished',completedAt:1000,completionSource:'screen-text'}))).toBe(state);
 state=apply(state,{...report({id:'gone',producer:'process',seq:1,at:1001}),kind:'process.gone',source:'process'});
 expect(selectSessionView(state,1000).lifecycle).toBe('ended');
 expect(selectSessionView(state,1000).completion).toBeNull();
 expect(apply(state,report({id:'stale-working',seq:99,at:1010}))).toBe(state);
});
test('expired leases are Unknown and preserve context; duplicate polling cannot renew them',()=>{
 const state=apply(createSessionState(identity),report({goal:{text:'Fix checkout',source:'opening-request'}}));
 expect(selectSessionView(state,1099).lifecycle).toBe('working');
 expect(selectSessionView(state,1100).lifecycle).toBe('unknown');
 expect(selectSessionView(state,1100).goal?.text).toBe('Fix checkout');
 expect(apply(state,report(),{...context,now:9000})).toBe(state);
});
test('producer sequence handles backward wall clocks; another old stream cannot overwrite it',()=>{
 let state=apply(createSessionState(identity),report());
 state=apply(state,report({id:'clock-back',seq:2,at:900,lifecycle:'idle'}),{...context,wallNow:900});
 expect(state.lifecycle).toBe('idle');
 expect(apply(state,report({id:'other-clock',producer:'other',seq:1,at:800}))).toBe(state);
});
test('future timestamps cannot create confident work and unknown Goal provenance is ignored',()=>{
 const future=apply(createSessionState(identity),report({at:100000}));
 expect(selectSessionView(future,1000).lifecycle).toBe('unknown');
 const state=apply(createSessionState(identity),report({goal:{text:'Guessed from project folder',source:'inferred'}}));
 expect(state.goal).toBeNull();
});
test('consumer mutations cannot corrupt another consumer or the captured state',()=>{
 const state=apply(createSessionState(identity),report({lifecycle:'waiting',question:{id:'q',reason:'input'},task:{text:'Verify checkout',source:'task-tool'},goal:{text:'Make checkout reliable',source:'opening-request'}}));
 const before=JSON.stringify(state);
 const view=selectSessionView(state,1001);
 view.identity.paneId='other'; view.question!.id='other'; view.task!.text='other'; view.goal!.text='other';
 expect(JSON.stringify(state)).toBe(before);
 expect(selectSessionView(state,1001).question?.id).toBe('q');
});
test('late tools cannot revive a completed turn even with a higher sequence',()=>{
 let state=apply(createSessionState(identity),report({lifecycle:'finished',completionSource:'hook-stop',completedAt:1000}));
 const finished=state;
 expect(apply(state,report({id:'tool-after-stop',seq:2,at:1001}))).toBe(finished);
 state=apply(state,report({id:'next-turn',seq:3,at:1002,startsNewTurn:true}));
 expect(state.lifecycle).toBe('working');expect(state.completion).toBeNull();
});
test('completion provenance matches the emitting source and cannot clear an unresolved question',()=>{
 const waiting=apply(createSessionState(identity),report({lifecycle:'waiting',question:{id:'approval',reason:'approval'}}));
 expect(apply(waiting,report({id:'wrong-source',seq:2,lifecycle:'finished',completionSource:'vendor-turn-complete',completedAt:1000}))).toBe(waiting);
 expect(apply(waiting,report({id:'unanswered-stop',seq:3,lifecycle:'finished',completionSource:'hook-stop',completedAt:1000}))).toBe(waiting);
 expect(apply(waiting,report({id:'resolved-stop',seq:4,lifecycle:'finished',completionSource:'hook-stop',completedAt:1000,resolvesQuestionId:'approval'})).lifecycle).toBe('finished');
});
test('a source clock error does not poison ordering for the next valid event',()=>{
 let state=apply(createSessionState(identity),report());
 state=apply(state,report({id:'bad-clock',seq:200,at:100000}));
 expect(state.lifecycle).toBe('unknown');
 state=apply(state,report({id:'valid-clock',seq:2,at:1001}));
 expect(state.lifecycle).toBe('working');
});
test('manual goals have an independent clock and do not lose to newer lifecycle timestamps',()=>{
 const state=apply(createSessionState(identity),report({at:1010}));
 const changed=apply(state,{identity,id:'goal',producer:'operator',seq:1,at:1005,source:'operator',kind:'goal.set',goal:{text:'Keep the operator goal',source:'manual'}});
 expect(changed.goal?.text).toBe('Keep the operator goal');expect(changed.lastEventAt).toBe(1010);
});
test('a hook cannot fabricate an operator Goal and an invalid clock cannot erase Finished',()=>{
 const guessed=apply(createSessionState(identity),report({goal:{text:'Pretend the operator pinned this',source:'manual'}}));
 expect(guessed.goal).toBeNull();
 const finished=apply(createSessionState(identity),report({lifecycle:'finished',completedAt:1000,completionSource:'hook-stop'}));
 expect(apply(finished,report({id:'bad-next-clock',seq:2,at:100000,startsNewTurn:true}))).toBe(finished);
});
