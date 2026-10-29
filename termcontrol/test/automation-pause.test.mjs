import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import {autoCloseFinished} from '../bridge/idle-cleanup.mjs';
const source=fs.readFileSync(new URL('../bridge/server.mjs',import.meta.url),'utf8');
const extract=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const paused=createAutomaticActionBarrier({env:{TC_PAUSE_AUTOMATIC_ACTIONS:'1'}});
test('paused actual cleanup entry cannot call close or inspect real terminal screens',async()=>{
 let closed=0,planned=0;const offer={id:'synthetic',startedBy:'fixture',provider:'codex',sessionId:'fixture',pid:1};const plan={offer:[offer],starters:new Map()};
 const context={automatic:paused,autoCloseFinished,idleCleanupPlan:async()=>{planned++;return plan;},requestClose:async()=>{closed++;return{ok:true};},appendAction:()=>{},paneLogFile:()=>'/unused',console:{log(){}}};
 await vm.runInNewContext(extract('async function sweepFinishedHelpers()','if (!process.env.TC_CONFIG_DIR && !process.env.TC_NO_AUTO_CLEANUP)')+'\nsweepFinishedHelpers()',context);
 assert.equal(closed,0);assert.equal(planned,0,'pause must precede screen inspection');
});
test('paused actual bot-events entry cannot nudge, wake or read terminal prompts',async()=>{
 let inputs=0,reads=0;const bots={list:()=>[{}]};
 const context={automatic:paused,bots,automaticBots:bots,currentPanes:async()=>{reads++;return{daemon:true,panes:[]};},reconcileDeliveries(){},helperRecoveryRunning:false,process:{env:{}},recoverBotHelpers:async({nudge})=>nudge({},'fixture',{name:'fixture'}),itemsView:()=>({items:[]}),sendToPane:()=>{inputs++;return{};},checkBotEvents:async()=>{},checkStalledBots(){},console};
 await vm.runInNewContext(extract('async function botEvents()','automaticInterval(() => botEvents()')+'\nbotEvents()',context);
 assert.equal(inputs,0);assert.equal(reads,0);
});

import os from 'node:os';import path from 'node:path';
import {createAutomaticActionBarrier} from '../bridge/automation-pause.mjs';
const temporary=t=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tc-auto-pause-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;};
test('marker pause is reversible, unreadable state fails closed, drain cannot be unpaused',t=>{
 const file=path.join(temporary(t),'paused');const barrier=createAutomaticActionBarrier({file,env:{}});let effects=0;
 const effect=barrier.guard(()=>++effects);assert.equal(effect(),1);
 fs.writeFileSync(file,'maintenance');assert.equal(effect().notSent,true);assert.equal(effects,1);
 fs.unlinkSync(file);assert.equal(effect(),2);
 barrier.beginDrain();assert.equal(effect().paused,true);assert.equal(effects,2);
 assert.equal(createAutomaticActionBarrier({file,env:{},stat:()=>{throw Object.assign(new Error('unreadable'),{code:'EACCES'});}}).paused,true);
 assert.equal(createAutomaticActionBarrier({env:{TC_PAUSE_AUTOMATIC_ACTIONS:'1'}}).paused,true);
});
test('guard rechecks after an await and preserves unpaused positive control',async()=>{
 const env={};const barrier=createAutomaticActionBarrier({env});let input=0;
 const run=async()=>{await Promise.resolve();return barrier.guard(()=>++input)();};
 const pending=run();env.TC_PAUSE_AUTOMATIC_ACTIONS='1';assert.equal((await pending).notSent,true);assert.equal(input,0);
 delete env.TC_PAUSE_AUTOMATIC_ACTIONS;assert.equal(await run(),1);
});
test('actual cleanup sink refuses a pause that arrives during the async plan',async()=>{
 const env={},automatic=createAutomaticActionBarrier({env});let closed=0,planned=0;
 const offer={id:'synthetic',startedBy:'fixture',provider:'codex',sessionId:'fixture',pid:1};const plan={offer:[offer],starters:new Map()};
 const context={automatic,autoCloseFinished,idleCleanupPlan:async()=>{planned++;env.TC_PAUSE_AUTOMATIC_ACTIONS='1';return plan;},requestClose:async()=>{closed++;return{ok:true};},appendAction:()=>{},paneLogFile:()=>'/unused',console:{log(){}}};
 await vm.runInNewContext(extract('async function sweepFinishedHelpers()','if (!process.env.TC_CONFIG_DIR && !process.env.TC_NO_AUTO_CLEANUP)')+'\nsweepFinishedHelpers()',context);
 assert.equal(closed,0);assert.ok(planned>0,'fixture entered the asynchronous plan before pausing');
});
test('actual cleanup still reaches its ordinary guarded close when not paused',async()=>{
 const automatic=createAutomaticActionBarrier({env:{}});let closed=0;
 const offer={id:'synthetic',startedBy:'fixture',provider:'codex',sessionId:'fixture',pid:1};const plan={offer:[offer],starters:new Map()};
 const context={automatic,autoCloseFinished,idleCleanupPlan:async()=>plan,requestClose:async()=>{closed++;return{ok:true};},appendAction:()=>{},paneLogFile:()=>'/unused',console:{log(){}}};
 await vm.runInNewContext(extract('async function sweepFinishedHelpers()','if (!process.env.TC_CONFIG_DIR && !process.env.TC_NO_AUTO_CLEANUP)')+'\nsweepFinishedHelpers()',context);
 assert.equal(closed,1);
});
test('paused actual sleep entry cannot inspect or kill a terminal',async()=>{
 let effects=0;const context={automatic:paused,currentPanes:async()=>{effects++;throw Error('must not read');},processTable:()=>{effects++;},sweepSleep:()=>{effects++;},sleepPane:()=>{effects++;}};
 await vm.runInNewContext(extract('export async function sweepIdleAgents()','if (!process.env.TC_CONFIG_DIR && !process.env.TC_NO_AUTO_SLEEP)').replace('export async','async')+'\nsweepIdleAgents()',context);
 assert.equal(effects,0);
});
