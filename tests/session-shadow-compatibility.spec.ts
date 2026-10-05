import {expect,test} from '@playwright/test';
import {sessionCompatibilitySidecar} from '../shared/sessionCompatibility.mjs';
const head=(lifecycle:string,question:any=null)=>({identity:{paneId:'synthetic-pane',sessionId:'synthetic-chat',runId:'synthetic-run',epoch:0},seq:2,state:{lifecycle,question}});
test('shadow records the binding without replacing any legacy display fields',()=>{
 const sidecar={turn:'working',turnReason:'legacy reason',todos:[],mainTask:'Captured Goal',now:'Checking checkout'};
 const projected=sessionCompatibilitySidecar(sidecar,head('unknown'));
 expect(projected).toEqual({...sidecar,sessionEventBinding:head('unknown').identity,sessionEventSeq:2});
 expect(sidecar.turn).toBe('working');
});
test('shadow does not turn stale legacy waiting into journal completion',()=>{
 const projected=sessionCompatibilitySidecar({turn:'waiting',turnReason:'permission_prompt'},head('finished'),false);
 expect(projected.turn).toBe('waiting');expect(projected.turnReason).toBe('permission_prompt');
});
test('explicit authority may derive turn and clear stale legacy question reason',()=>{
 const projected=sessionCompatibilitySidecar({turn:'waiting',turnReason:'permission_prompt'},head('finished'),true);
 expect(projected.turn).toBe('idle');expect(projected.turnReason).toBeUndefined();
 const question=sessionCompatibilitySidecar({turn:'working'},head('waiting',{id:'typed-input',reason:'input'}),true);
 expect(question.turn).toBe('waiting');expect(question.turnReason).toBe('operator_question');
});

test('watcher shadow leaves provider/conversation/task fields intact; activation can apply the same head',async()=>{
 const {applySessionHead}=await import('../src/lib/sessionHeadApplication');
 const snapshot:any={version:2,provider:'codex',...head('working'),event:{at:1000},state:{tasks:[{id:'task-one',text:'Checking payment',status:'in_progress'}],lastEventAt:1000}};
 const pane:any={id:'synthetic-pty',paneId:'synthetic-pane',agentProvider:'shell',providerSessionId:'legacy-conversation',taskLineup:[{id:'legacy-task',content:'Legacy Task',status:'pending'}]};
 const shadow=applySessionHead(pane,snapshot,'synthetic-source',false);
 expect(shadow.providerSessionId).toBe(pane.providerSessionId);expect(shadow.agentProvider).toBe('shell');expect(shadow.taskLineup).toBe(pane.taskLineup);
 expect(applySessionHead(shadow,{...snapshot},'synthetic-source',false)).toBe(shadow);
 const active=applySessionHead(shadow,{...snapshot},'synthetic-source',true);
 expect(active.providerSessionId).toBe('synthetic-chat');expect(active.agentProvider).toBe('codex');expect(active.taskLineup[0].content).toBe('Checking payment');
 expect(active.sessionSnapshotV2).toBe(shadow.sessionSnapshotV2);
 expect(applySessionHead(active,{...snapshot,seq:1},'synthetic-source',true)).toBe(active);
});
