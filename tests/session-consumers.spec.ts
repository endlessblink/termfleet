import {expect,test} from '@playwright/test';
import fs from 'node:fs';import path from 'node:path';import vm from 'node:vm';
import {publishSessionEvent} from '../scripts/lib/session-event-journal.mjs';
import {readSessionEventView,readSessionStatus} from '../termcontrol/bridge/session-status.mjs';
import {createStatusWriter,publishOpenCodeEvent,applyEvent} from '../scripts/termfleet-opencode-status-plugin.js';
import {projectSessionState} from '../src/lib/sessionStateAdapter';
import {ptySessionEnvelope} from '../src/lib/sessionProcessEvents';
import {sessionDisagreements} from '../src/lib/sessionShadowDiagnostics';
import {selectSessionView} from '../shared/sessionState.mjs';
const setup=()=>({dir:fs.mkdtempSync('/tmp/termfleet-consumers-'),paneId:'synthetic-source',provider:'claude',runId:'synthetic-run'});
const payload=(name:string)=>({session_id:'synthetic-chat',hook_event_name:name});

test('durable head reaches bridge and desktop with identical text and lifecycle; polls expire leases',async()=>{
 const options=setup();
 try {
  const head=await publishSessionEvent({...options,at:1000,payload:payload('UserPromptSubmit'),sidecar:{turn:'working',mainTask:'Reliable <checkout>',mainTaskSource:'opening-request',todos:[{id:'one',content:'Verify payment',status:'in_progress'}]}});
  const pane:any={id:options.paneId,paneId:'ui-pane',providerSessionId:'synthetic-chat',agentProvider:'claude',statusEventPaneId:options.paneId,sessionSnapshotV2:head};
  const desktop=projectSessionState(undefined,pane,1100,20),bridge=readSessionEventView({id:options.paneId,provider:'claude',sessionId:'synthetic-chat'},{dir:options.dir,now:20,wallNow:1100});
  expect({...selectSessionView(desktop,20),identity:bridge.identity}).toEqual(bridge);
  expect(readSessionEventView({id:'foreign-pane',provider:'claude'},{dir:options.dir,now:20,wallNow:1100})).toBeNull();
  expect(readSessionEventView({id:options.paneId,provider:'claude',sessionId:'foreign-chat'},{dir:options.dir,now:20,wallNow:1100})).toBeNull();
  expect(readSessionEventView({id:options.paneId,provider:'claude'},{dir:options.dir,now:20,wallNow:121000}).lifecycle).toBe('unknown');
  const status=readSessionStatus({id:options.paneId,provider:'claude'},{dir:options.dir,authority:false,now:20,wallNow:1100});
  expect(status.sessionAuthority).toBe(false);expect(status.turn).toBeUndefined();
 } finally {fs.rmSync(options.dir,{recursive:true,force:true});}
});
test('backend exits are exact-PTY bound and distinct from completion; shadow logs are bounded metadata',async()=>{
 const options=setup();
 try {
  const head=await publishSessionEvent({...options,at:1000,payload:payload('UserPromptSubmit'),sidecar:{turn:'working'}});
  const pane:any={id:options.paneId,paneId:'ui-pane',agentProvider:'claude',statusEventPaneId:options.paneId,sessionSnapshotV2:head,statusSummary:{status:'idle',now:'secret text'}};
  const state=projectSessionState(undefined,pane,1100,20);pane.sessionStateV2=state;
  expect(ptySessionEnvelope(pane,{id:'old-pty',code:130},1101)).toBeNull();
  for(const [exit,lifecycle] of [[{id:pane.id,code:130},'interrupted'],[{id:pane.id,success:true},'ended'],[{id:pane.id,code:1},'crashed']] as const) {
   const updated=projectSessionState(pane,{...pane,sessionEventsV2:[ptySessionEnvelope(pane,exit,1101)]},1101,21);
   expect(updated.lifecycle).toBe(lifecycle);expect(updated.completion).toBeNull();
  }
  const records=sessionDisagreements();expect(records.length).toBeLessThanOrEqual(64);expect(JSON.stringify(records)).not.toContain('secret text');expect(records.at(-1).fields).toContain('status');
 } finally {fs.rmSync(options.dir,{recursive:true,force:true});}
});
test('reattach needs a fresh head and retains the exact conversation and task',async()=>{
 const options=setup();
 try {
  const head=await publishSessionEvent({...options,at:1000,payload:payload('UserPromptSubmit'),sidecar:{turn:'working'}});
  const pane:any={id:options.paneId,paneId:'ui-pane',agentProvider:'claude',statusEventPaneId:options.paneId,sessionSnapshotV2:head};
  const state=projectSessionState(undefined,pane,1100,20),previous={...pane,sessionStateV2:state};
  const attached={...pane,id:'new-pty'};
  const reconnect=projectSessionState(previous,attached,1101,21);
  expect(reconnect.lifecycle).toBe('unknown');expect(reconnect.identity.epoch).toBe(1);
  const next=await publishSessionEvent({...options,at:1102,payload:payload('PostToolUse'),sidecar:{turn:'working',now:'Checking receipts'}});
  const restored=projectSessionState({...attached,sessionStateV2:reconnect},{...attached,sessionSnapshotV2:next},1103,22);
  expect(restored.lifecycle).toBe('working');expect(restored.identity.epoch).toBe(1);expect(restored.now.text).toBe('Checking receipts');
 } finally {fs.rmSync(options.dir,{recursive:true,force:true});}
});
test('OpenCode requires real non-summary completion and matches approval/input IDs',async()=>{
 const options=setup(),writer=createStatusWriter({paneId:options.paneId,filePath:path.join(options.dir,'pane.json')});
 writer.state.sessionId='synthetic-chat';writer.state.turn='working';writer.state.userTask='Reliable checkout';
 try {
  await publishOpenCodeEvent(writer,{type:'chat.message'},1000);
  const permission=await publishOpenCodeEvent(writer,{type:'permission.asked',properties:{sessionID:'synthetic-chat',id:'approval'}},1001);
  expect(permission.state.question.reason).toBe('approval');
  const wrong=await publishOpenCodeEvent(writer,{type:'permission.replied',properties:{sessionID:'synthetic-chat',requestID:'other'}},1002);
  expect(wrong.state.lifecycle).toBe('waiting');
  const answer=await publishOpenCodeEvent(writer,{type:'permission.replied',properties:{sessionID:'synthetic-chat',requestID:'approval'}},1003);
  expect(answer.state.lifecycle).toBe('unknown');
  const input=await publishOpenCodeEvent(writer,{type:'question.asked',properties:{sessionID:'synthetic-chat',id:'input'}},1004);
  expect(input.state.question.reason).toBe('input');
  await publishOpenCodeEvent(writer,{type:'question.replied',properties:{sessionID:'synthetic-chat',requestID:'input'}},1005);
  writer.state.turn='idle';const idle=await publishOpenCodeEvent(writer,{type:'session.idle'},1006);expect(idle.state.completion).toBeNull();
  const info={role:'assistant',sessionID:'synthetic-chat',finish:'stop',time:{completed:1007}};
  expect(await publishOpenCodeEvent(writer,{type:'message.updated',properties:{info:{...info,summary:true}}},1007)).toBeNull();
  expect(await publishOpenCodeEvent(writer,{type:'message.updated',properties:{info:{...info,error:{}}}},1007)).toBeNull();
  expect(await publishOpenCodeEvent(writer,{type:'message.updated',properties:{info:{...info,sessionID:'foreign-chat'}}},1007)).toBeNull();
  const done=await publishOpenCodeEvent(writer,{type:'message.updated',properties:{info}},1007);
  expect(done.state.lifecycle).toBe('finished');expect(done.state.completion.source).toBe('vendor-turn-complete');
  expect(applyEvent(writer,{type:'todo.updated',properties:{sessionID:'foreign-chat',todos:[]}})).toBe(false);
  expect(writer.state.sessionId).toBe('synthetic-chat');
 } finally {fs.rmSync(options.dir,{recursive:true,force:true});}
});
test('actual mobile card renders shared labels, escapes text, and keeps the legacy flag off',()=>{
 const html=fs.readFileSync(path.join(process.cwd(),'termcontrol/app/index.html'),'utf8');
 const source=html.slice(html.indexOf('function card(p) {'),html.indexOf('\nasync function chat(id)',html.indexOf('function card(p) {')));
 const context:any={esc:(s:any)=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'),localStorage:{getItem:()=>null},ago:()=>'',ui:(en:string)=>en,statusHtml:()=>'',technicalTask:()=>false,quietFor:()=>'',trace:()=>''};
 vm.createContext(context);vm.runInContext(source+';globalThis.renderCard=card;',context);
 const pane={id:'synthetic',provider:'claude',project:'checkout',turn:'completed',task:'Legacy task',producing:true,sessionAuthority:true,
  sessionViewV2:{lifecycle:'finished',task:{label:'Verify <payment>'},goal:{label:'Reliable checkout'},now:{label:'Checking receipts',stale:true}}};
 const rendered=context.renderCard(pane);expect(rendered).toContain('Task: Verify &lt;payment>');expect(rendered).toContain('Goal: Reliable checkout');expect(rendered).toContain('Last: Checking receipts');expect(rendered).toContain('completed');expect(rendered).not.toContain('Live now');
 const legacy=context.renderCard({...pane,sessionAuthority:false});expect(legacy).not.toContain('data-session-field');expect(legacy).toContain('Legacy task');
});

test('pinned operator Goal reaches the phone only through exact owned-pane metadata',async()=>{
 const {attachOperatorGoal}=await import('../termcontrol/bridge/inventory.mjs');
 const options=setup();
 try {
  const head=await publishSessionEvent({...options,at:1000,payload:payload('UserPromptSubmit'),sidecar:{turn:'working',mainTask:'Agent Goal',mainTaskSource:'opening-request'}});
  const goal={text:'Operator Goal',source:'manual',updatedAt:1050};
  const source={id:options.paneId,provider:'claude',sessionId:'synthetic-chat'};
  const workspace={tabs:[{terminals:[{id:options.paneId,mainUserAsk:goal}]}]};
  const owned=attachOperatorGoal(source,workspace),view=readSessionEventView(owned,{dir:options.dir,wallNow:1100,now:20});
  const desktop=projectSessionState(undefined,{id:options.paneId,paneId:'ui-pane',agentProvider:'claude',sessionSnapshotV2:head,mainUserAsk:goal} as any,1100,20);
  expect(view.goal).toEqual(selectSessionView(desktop,20).goal);expect(view.goal.source).toBe('manual');
  expect(attachOperatorGoal({...source,id:'other-pane'},workspace).operatorGoal).toBeUndefined();
 } finally {fs.rmSync(options.dir,{recursive:true,force:true});}
});
