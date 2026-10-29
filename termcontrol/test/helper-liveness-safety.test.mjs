import test from 'node:test';
import assert from 'node:assert/strict';
import {stalledFor,pendingToolsFromRecords,readSessionStatus} from '../bridge/session-status.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PATHS,claudeSlug} from '../bridge/paths.mjs';
import {stuckNote} from '../bridge/orchestrate.mjs';
import {cleanupPlan,autoCloseFinished,cleanupScreenState,cardlessSessions} from '../bridge/idle-cleanup.mjs';
import {recoverBotHelpers} from '../bridge/helper-recovery.mjs';
const now=10*3600000;
const pane={id:'synthetic-helper',provider:'codex',sessionId:'synthetic-session',alive:true,turn:'idle',recordAt:1,lastActiveAt:1,lastWorkedAt:1};
const plan=(extra={},screenState=()=> 'clear')=>cleanupPlan({panes:[{...pane,...extra}],now,startedBy:()=> 'fixture',startedByBot:()=>true,screenState});
test('fresh PTY output and pending tool evidence suppress stale-record stall',()=>{
 assert.equal(stalledFor({...pane,turn:'working'},{producing:true},now,now,1),0);
 assert.equal(stalledFor({...pane,turn:'working',pendingTools:true},{producing:false},1,now,1),0);
 assert(stalledFor({...pane,turn:'working'},{producing:false},1,now,1)>0,'quiet alone remains diagnostic, not crash proof');
});
test('silence note does not infer a crash or prescribe closing/replacement',()=>{
 const note=stuckNote({...pane,stalledForMs:15*60000});
 assert.doesNotMatch(note,/most likely crashed|Close it|start a fresh/i);assert.match(note,/check|inspect/i);
});
test('unknown screen and fresh approval prevent cleanup; known clear idle remains eligible',()=>{
 assert.equal(plan({},()=>null).offer.length,0);
 assert.equal(plan({},()=> 'waiting').keep[0].reason,'Waiting for you');
 assert.equal(plan().offer.length,1);
 assert.equal(plan({pendingTools:true}).offer.length,0);
 assert.equal(plan({producing:true,turn:'working'}).offer.length,0);
 assert.equal(plan({producing:false,turn:'working'}).offer.length,0,'silence is not a finished-turn receipt');
 assert.equal(plan({turn:'unknown'}).offer.length,0,'unobserved state is not finished');
});
test('automatic close rechecks each offered target immediately and defaults to refusal',async()=>{
 const offered=plan();let closes=0;
 await autoCloseFinished({plan:offered,requestClose:async()=>{closes++;return {ok:true};}});assert.equal(closes,0);
 await autoCloseFinished({plan:offered,canClose:async()=>false,requestClose:async()=>{closes++;return {ok:true};}});assert.equal(closes,0);
 await autoCloseFinished({plan:offered,canClose:async()=>true,requestClose:async()=>{closes++;return {ok:true};}});assert.equal(closes,1);
});
test('recovery never types into a working agent solely because its record is stale',async()=>{
 let nudges=0;const p={...pane,turn:'working',stalledForMs:20*60000};
 await recoverBotHelpers({panes:[p],now,lastAt:()=>1,items:[{id:'R-fixture',status:'assigned',source:'bot:fixture',assigned:[{pane:p.id,at:1}]}],
 bots:{list:()=>[{id:'fixture',helpers:[{paneId:p.id,at:1}]}],messages:()=>[],append:()=>{},wake:()=>{}},
 readAsk:async()=>null,readScreen:async()=> 'Agent input',nudge:async()=>{nudges++;return {delivered:true};},log:()=>{}});
 assert.equal(nudges,0);
});
test('recovery refuses an unknown turn even with ordinary nonblank output',async()=>{
 let nudges=0;const p={...pane,turn:'unknown'};
 await recoverBotHelpers({panes:[p],now,lastAt:()=>1,items:[{id:'R-fixture',status:'assigned',source:'bot:fixture',assigned:[{pane:p.id,at:1}]}],
 bots:{list:()=>[{id:'fixture',helpers:[{paneId:p.id,at:1}]}],messages:()=>[],append:()=>{},wake:()=>{}},
 readAsk:async()=>null,readScreen:async()=> 'Agent input',nudge:async()=>{nudges++;return {delivered:true};},log:()=>{}});
 assert.equal(nudges,0);
});
test('correlated Codex and Claude tools remain pending until their own result, without a time threshold',()=>{
 for(const provider of ['codex','claude']){
  const call=provider==='codex'?{payload:{type:'function_call',call_id:'tool-a'}}:{message:{content:[{type:'tool_use',id:'tool-a',name:'Bash'}]}};
  const result=id=>provider==='codex'?{payload:{type:'function_call_output',call_id:id}}:{message:{content:[{type:'tool_result',tool_use_id:id}]}};
  assert.equal(pendingToolsFromRecords([call,result('different')]),true);
  assert.equal(pendingToolsFromRecords([call,result('tool-a')]),false);
 }
});
test('screen classification keeps unreadable and approval prompts while preserving idle input',()=>{
 assert.equal(cleanupScreenState(pane,null),'unknown');assert.equal(cleanupScreenState(pane,''),'unknown');
 assert.equal(cleanupScreenState(pane,'Do you want to proceed?\n❯ 1. Yes\n2. No\nEsc to cancel'),'waiting');
 assert.equal(cleanupScreenState(pane,'Agent input prompt'),'clear');
});
test('exact synthetic conversation tool activity is refreshed after its own result, with missing state unknown',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tf-f15-tools-')),original=PATHS.claudeProjects;
 try{
  PATHS.claudeProjects=dir;
  const p={...pane,provider:'claude',cwd:'/synthetic-f15'};
  const folder=path.join(dir,claudeSlug(p.cwd));fs.mkdirSync(folder);
  const file=path.join(folder,p.sessionId+'.jsonl');
  const call={message:{content:[{type:'tool_use',id:'call-a',name:'Bash'}]}};
  fs.writeFileSync(file,JSON.stringify(call)+'\n');
  assert.equal(readSessionStatus(p,{dir,authority:false}).pendingTools,true);
  assert.equal(readSessionStatus({...p,sessionId:'other-synthetic'},{dir,authority:false}).pendingTools,null);
  fs.appendFileSync(file,JSON.stringify({message:{content:[{type:'tool_result',tool_use_id:'call-a'}]}})+'\n');
  assert.equal(readSessionStatus(p,{dir,authority:false}).pendingTools,false);
 }finally{PATHS.claudeProjects=original;fs.rmSync(dir,{recursive:true,force:true});}
});
test('approval appearing after the offer prevents the automatic close',async()=>{
 const offered=plan();let closes=0;
 await autoCloseFinished({plan:offered,canClose:async()=>plan({},()=> 'waiting').offer.length>0,
  requestClose:async()=>{closes++;return {ok:true};}});
 assert.equal(closes,0);
});
test('an agent without a card or vendor state is unknown, not implicitly idle',()=>{
 const panes=cardlessSessions({liveById:new Map([[pane.id,{pid:99,quietForMs:now,initialCwd:'/synthetic'}]]),ownedIds:new Set(),
  agents:new Map([[pane.id,{provider:'codex',sessionId:'synthetic'}]]),now,lastUsed:()=>1});
 assert.equal(panes[0].turn,'unknown');
 assert.equal(cleanupPlan({panes,now,startedBy:()=> 'fixture',screenState:()=> 'clear'}).offer.length,0);
});
