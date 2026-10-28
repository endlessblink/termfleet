import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createAutomaticActionBarrier} from '../bridge/automation-pause.mjs';
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};
const temp=t=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tc-drain-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;};
test('drain cancels registered timers before waiting and rejects new effects',async()=>{
 const barrier=createAutomaticActionBarrier({env:{}});let cancelled=0,input=0;
 barrier.registerTimer(()=>cancelled++);
 const slow=deferred();const pending=barrier.run(()=>slow.promise,{label:'synthetic job'});
 assert.equal(barrier.status().active.length,1);
 const draining=barrier.drain({timeoutMs:100,pause:async()=>{assert.equal(cancelled,1);assert.equal(barrier.guard(()=>++input)().notSent,true);slow.resolve({ok:true});}});
 const result=await draining;await pending;
 assert.equal(input,0);assert.equal(result.settled,true);assert.equal(result.quiescence_verified,false,'only registered work is covered');
});
test('detached registered effect prevents an already returned root from proving drain complete',async t=>{
 const operationsDir=temp(t),barrier=createAutomaticActionBarrier({env:{},operationsDir});const ack=deferred();let effect;
 barrier.run(()=>{effect=barrier.guard(()=>ack.promise,{label:'synthetic write',reference:'existing-send:fixture'})();},{label:'synthetic root'});
 const first=await barrier.drain({timeoutMs:0});assert.equal(first.settled,false);assert.equal(first.active.length,1);
 assert.equal(fs.readdirSync(operationsDir).length,1,'pending effect is retained');
 ack.resolve({ok:true});await effect;
 assert.equal((await barrier.drain({timeoutMs:0})).settled,true);assert.equal(fs.readdirSync(operationsDir).length,0);
});
test('unknown write result remains blocked with original reference and is never replayed',async t=>{
 const operationsDir=temp(t),barrier=createAutomaticActionBarrier({env:{},operationsDir});let writes=0;
 const result=await barrier.guard(async()=>{writes++;return{uncertain:true,error:'ack missing'};},{label:'synthetic write',reference:'existing-send:original'})();
 assert.equal(result.uncertain,true);const drain=await barrier.drain({timeoutMs:0});assert.equal(drain.settled,false);assert.equal(drain.retained[0].reference,'existing-send:original');
 const bytes=fs.readdirSync(operationsDir).map(n=>fs.readFileSync(path.join(operationsDir,n),'utf8'));
 const restored=createAutomaticActionBarrier({env:{},operationsDir});assert.equal(restored.paused,true);assert.equal(restored.guard(()=>++writes)().notSent,true);
 assert.equal(writes,1);assert.deepEqual(fs.readdirSync(operationsDir).map(n=>fs.readFileSync(path.join(operationsDir,n),'utf8')),bytes);
});
test('proven zero-write refusal settles without consuming or changing an existing queue',async t=>{
 const dir=temp(t),operationsDir=path.join(dir,'ops'),queue=path.join(dir,'queue');fs.writeFileSync(queue,'original words and target');
 const barrier=createAutomaticActionBarrier({env:{},operationsDir});await barrier.guard(async()=>({notSent:true,error:'fixture prewrite refusal'}))();
 assert.equal((await barrier.drain({timeoutMs:0})).settled,true);assert.equal(fs.readFileSync(queue,'utf8'),'original words and target');
});
test('rejection and drain timeout retain intent rather than force success or alter queue data',async t=>{
 const dir=temp(t),operationsDir=path.join(dir,'ops'),queue=path.join(dir,'queue');fs.writeFileSync(queue,'original');
 const barrier=createAutomaticActionBarrier({env:{},operationsDir});await assert.rejects(barrier.guard(async()=>{throw Error('unknown postwrite failure');},{reference:'existing-send:failed'})());
 const result=await barrier.drain({timeoutMs:0});assert.equal(result.settled,false);assert.equal(result.retained.length,1);assert.equal(fs.readFileSync(queue,'utf8'),'original');
});
test('process exit retains issued operation metadata without recording the message',t=>{
 const operationsDir=temp(t);const moduleURL=new URL('../bridge/automation-pause.mjs',import.meta.url).href;
 const script=`import {createAutomaticActionBarrier} from ${JSON.stringify(moduleURL)};const b=createAutomaticActionBarrier({env:{},operationsDir:process.argv[1]});b.guard(()=>new Promise(()=>{}),{label:'synthetic effect',reference:'existing-held:original'})();process.exit(0);`;
 const child=spawnSync(process.execPath,['--input-type=module','-e',script,operationsDir],{encoding:'utf8'});assert.equal(child.status,0,child.stderr);
 const restored=createAutomaticActionBarrier({env:{},operationsDir});assert.equal(restored.paused,true);assert.equal(restored.status().retained[0].reference,'existing-held:original');
 const raw=fs.readFileSync(path.join(operationsDir,fs.readdirSync(operationsDir)[0]),'utf8');assert.ok(!raw.includes('original words'));assert.equal(restored.status().active.length,0);
});
test('persistent maintenance pause survives process reconstruction without changing unknown marker content',t=>{
 const dir=temp(t),file=path.join(dir,'pause'),b=createAutomaticActionBarrier({file,env:{}});
 assert.equal(b.persistPause().ok,true);const bytes=fs.readFileSync(file,'utf8');
 const after=createAutomaticActionBarrier({file,env:{}});assert.equal(after.paused,true);assert.equal(after.persistPause().ok,true);assert.equal(fs.readFileSync(file,'utf8'),bytes);
});
test('scheduled root is registered until its promise completes and its timer is cancelled by drain',async()=>{
 const b=createAutomaticActionBarrier({env:{}}),slow=deferred();let tick,cancelled=0;
 const timer={unref(){}};
 b.schedule(()=>slow.promise,{label:'synthetic timer',ms:1,set:fn=>{tick=fn;return timer;},clear:handle=>{assert.equal(handle,timer);cancelled++;}});
 const started=tick();assert.equal(b.status().active.length,1);
 const incomplete=await b.drain({timeoutMs:0});assert.equal(incomplete.settled,false);assert.equal(cancelled,1);
 slow.resolve({ok:true});await started;assert.equal((await b.drain({timeoutMs:0})).settled,true);
});
import vm from 'node:vm';
import {Bots} from '../bridge/bots.mjs';
test('actual maintenance handshake retains queued messages, reports active side work, and never exits',async t=>{
 const source=fs.readFileSync(new URL('../bridge/server.mjs',import.meta.url),'utf8');
 const start=source.indexOf('async function pauseAutomaticWork('),end=source.indexOf("process.on('SIGUSR2'",start);
 assert.ok(start>=0&&end>start,'maintenance handshake must be implemented before service stop');
 const dir=temp(t),queueFile=path.join(dir,'bot.json');let exited=0;
 const automatic=createAutomaticActionBarrier({file:path.join(dir,'pause'),env:{}});
 const original=['same original words','same original words','later correction'];
 let bot={queued:original.slice(0,1)};fs.writeFileSync(queueFile,JSON.stringify(bot));
 const bots=Object.create(Bots.prototype);
 Object.assign(bots,{running:new Map(),queues:new Map([['fixture',original.slice(1)]]),
  sides:new Map([['fixture',{busy:true,pending:['original side message']}]]),now:Date.now,
  read:()=>bot,write:value=>{bot=value;fs.writeFileSync(queueFile,JSON.stringify(value));}});
 const context={automatic,bots,maintenanceDrain:null,console,process:{exit(){exited++;}}};
 const result=await vm.runInNewContext(source.slice(start,end)+'\npauseAutomaticWork({timeoutMs:0})',context);
 assert.equal(bots.closing,true);assert.deepEqual(JSON.parse(fs.readFileSync(queueFile,'utf8')).queued,original);assert.deepEqual(bots.sides.get('fixture').pending,['original side message']);assert.equal(result.registered_callbacks_finished,true);assert.equal(result.registered_work_settled,false);assert.equal(result.bot_sides,1);assert.equal(result.restart_boundary_proven,false);assert.equal(exited,0);assert.deepEqual(bot.queued,original);
});
test('a preexisting broken-link marker still pauses and is never replaced',t=>{
 const dir=temp(t),file=path.join(dir,'pause');fs.symlinkSync(path.join(dir,'missing'),file);
 const b=createAutomaticActionBarrier({file,env:{}});assert.equal(b.paused,true);assert.equal(b.persistPause().ok,true);assert.equal(fs.lstatSync(file).isSymbolicLink(),true);
});
test('unreadable or malformed operation metadata blocks admission without deletion',t=>{
 const dir=temp(t),file=path.join(dir,'unknown.pending.json');fs.writeFileSync(file,'{incomplete');const before=fs.readFileSync(file,'utf8');
 const b=createAutomaticActionBarrier({operationsDir:dir,env:{}});assert.equal(b.paused,true);assert.equal(b.guard(()=>assert.fail('must not start'))().notSent,true);assert.equal(fs.readFileSync(file,'utf8'),before);
});
for (const failure of ['missing','read','write']) test(`actual pause preserves queued duplicates on ${failure} failure and retries once`,async t=>{
 const source=fs.readFileSync(new URL('../bridge/server.mjs',import.meta.url),'utf8');
 const start=source.indexOf('async function pauseAutomaticWork('),end=source.indexOf("process.on('SIGUSR2'",start);
 const original=['same original words','same original words','later correction'];let fail=true;
 const persisted={queued:['earlier original']};const bots=Object.create(Bots.prototype);
 Object.assign(bots,{running:new Map(),queues:new Map([['fixture',original.slice()]]),sides:new Map(),now:Date.now,
  read:()=>{if(fail&&failure==='read')throw Error('fixture read failure');return fail&&failure==='missing'?null:persisted;},
  write:value=>{if(fail&&failure==='write')throw Error('fixture write failure');Object.assign(persisted,value);}});
 const automatic=createAutomaticActionBarrier({file:path.join(temp(t),'pause'),env:{}}),context={automatic,bots,maintenanceDrain:null};
 const run=()=>vm.runInNewContext(source.slice(start,end)+'\npauseAutomaticWork({timeoutMs:0})',context);
 await assert.rejects(run());assert.deepEqual(bots.queues.get('fixture'),original);assert.deepEqual(persisted.queued,['earlier original']);
 fail=false;await run();await run();assert.deepEqual(persisted.queued,['earlier original',...original]);assert.deepEqual(bots.queues.get('fixture'),[]);
});
