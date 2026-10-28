import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {createSendOnce,inspectPaneSend} from '../bridge/send-once.mjs';
const moduleURL=new URL('../bridge/send-once.mjs',import.meta.url).href;
const worker=String.raw`
 const {createSendOnce}=await import(process.argv[1]);
 const fs=(await import('node:fs')).default;
 const [dir,log,id,pane,gate,mode]=process.argv.slice(2);
 const unlink=fs.unlinkSync;
 if(mode==='crash-before-release')fs.unlinkSync=file=>{if(file.endsWith('.lock'))process.exit(18);return unlink(file);};
 if(mode==='cleanup-failure')fs.unlinkSync=file=>{if(file.endsWith('.json'))throw Error('fixture draft cleanup failed');return unlink(file);};
 const result=await createSendOnce({dir})(id,'fixture '+id,async()=>{
  if(mode==='notSent')return{error:'fixture prewrite refusal',notSent:true};
  fs.appendFileSync(log,id+':text\n');
  if(mode==='crash')process.exit(17);
  if(gate)while(!fs.existsSync(gate))await new Promise(r=>setTimeout(r,5));
  if(mode==='uncertain')return{error:'fixture failed Enter',uncertain:true};
  fs.appendFileSync(log,id+':enter\n');return{ok:true};
 },{scope:pane});
 process.stdout.write(JSON.stringify(result));
`;
function child(args){
 const p=spawn(process.execPath,['--input-type=module','-e',worker,moduleURL,...args],{stdio:['ignore','pipe','pipe']});
 let out='',errors='';p.stdout.on('data',x=>out+=x);p.stderr.on('data',x=>errors+=x);
 const done=once(p,'exit').then(([code])=>({code,out:out?JSON.parse(out):null,errors}));
 return{p,done};
}
async function waitFor(check){for(let i=0;i<400;i++){if(check())return;await new Promise(r=>setTimeout(r,5));}throw Error('Fixture worker did not reach barrier');}
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'send-pane-lock-'));
 const children=[];t.after(async()=>{for(const c of children)if(c.p.exitCode===null)c.p.kill('SIGKILL');await Promise.all(children.map(c=>c.done));fs.rmSync(root,{recursive:true,force:true});});
 return{root,dir:path.join(root,'receipts'),log:path.join(root,'writes'),start:(args)=>{const c=child(args);children.push(c);return c;}};
}
test('different drafts in actual processes cannot interleave text and Enter in one pane',async t=>{
 const {root,dir,log,start}=fixture(t),gate=path.join(root,'continue');
 const first=start([dir,log,'first','pane-a',gate,'']);
 await waitFor(()=>fs.existsSync(log));
 const second=await start([dir,log,'second','pane-a','','']).done;
 fs.writeFileSync(gate,'continue');const firstResult=await first.done;
 assert.equal(firstResult.code,0,firstResult.errors);assert.equal(second.code,0,second.errors);
 assert.equal(second.out.notSent,true,JSON.stringify({second,writes:fs.readFileSync(log,'utf8')}));assert.equal(second.out.blocked,true);assert.equal(second.out.busy,undefined);
 assert.equal(fs.readFileSync(log,'utf8'),'first:text\nfirst:enter\n');
 const retry=await start([dir,log,'second','pane-a','','']).done;
 assert.equal(retry.out.ok,true,JSON.stringify(retry));
 assert.equal(fs.readFileSync(log,'utf8'),'first:text\nfirst:enter\nsecond:text\nsecond:enter\n');
});
test('different panes remain independent while one sender is held',async t=>{
 const {root,dir,log,start}=fixture(t),gate=path.join(root,'continue');
 const first=start([dir,log,'first','pane-a',gate,'']);await waitFor(()=>fs.existsSync(log));
 const other=await start([dir,log,'other','pane-b','','']).done;
 fs.writeFileSync(gate,'continue');await first.done;
 assert.equal(other.out.ok,true,JSON.stringify(other));
});
for(const mode of ['uncertain','crash'])test(mode+' pane state blocks different drafts after process restart',async t=>{
 const {dir,log,start}=fixture(t);
 const first=await start([dir,log,'first','pane-a','',mode]).done;
 assert.equal(first.code,mode==='crash'?17:0);
 const other=await start([dir,log,'other','pane-a','','']).done;
 assert.equal(other.out.notSent,true,JSON.stringify(other));
 assert.equal(fs.readFileSync(log,'utf8'),'first:text\n');
});
test('proven prewrite refusal releases pane and draft for a legitimate retry',async t=>{
 const {dir,log,start}=fixture(t);
 const first=await start([dir,log,'first','pane-a','','notSent']).done;
 assert.equal(first.out.notSent,true);assert.equal(fs.existsSync(log),false);
 const retry=await start([dir,log,'first','pane-a','','']).done;
 assert.equal(retry.out.ok,true);assert.equal(fs.readFileSync(log,'utf8'),'first:text\nfirst:enter\n');
});
test('crash after final receipt persistence cannot clear the pane for another draft',async t=>{
 const {dir,log,start}=fixture(t);
 const first=await start([dir,log,'first','pane-a','','crash-before-release']).done;
 assert.equal(first.code,18,first.errors);assert.equal(inspectPaneSend(dir,'pane-a').state,'recorded');
 const other=await start([dir,log,'other','pane-a','','']).done;
 assert.equal(other.out.notSent,true);assert.equal(fs.readFileSync(log,'utf8'),'first:text\nfirst:enter\n');
 const replay=await start([dir,log,'first','pane-a','','']).done;
 assert.equal(replay.out.repeated,true);assert.equal(replay.out.ok,true);
});
test('a contender whose draft cleanup fails never removes the current pane lock',async t=>{
 const {root,dir,log,start}=fixture(t),gate=path.join(root,'continue');
 const first=start([dir,log,'first','pane-a',gate,'']);await waitFor(()=>fs.existsSync(log));
 const before=inspectPaneSend(dir,'pane-a');
 const failed=await start([dir,log,'other','pane-a','','cleanup-failure']).done;
 assert.equal(failed.code,0,failed.errors);assert.equal(failed.out.uncertain,true);assert.equal(inspectPaneSend(dir,'pane-a').token,before.token);
 fs.writeFileSync(gate,'continue');await first.done;
 assert.equal(fs.readFileSync(log,'utf8'),'first:text\nfirst:enter\n');
});
test('malformed or changed pane lock fails closed and missing pane identity never dispatches',async t=>{
 const {dir}=fixture(t);fs.mkdirSync(dir);const file=path.join(dir,'pane-'+createHash('sha256').update('pane-a').digest('hex')+'.lock');
 fs.writeFileSync(file,'malformed');let calls=0;
 const run=async()=>{calls++;return{ok:true};};
 assert.equal((await createSendOnce({dir})('first','text',run,{scope:'pane-a'})).notSent,true);
 assert.equal((await createSendOnce({dir})('missing','text',run)).notSent,true);assert.equal(calls,0);
 assert.deepEqual(inspectPaneSend(dir,'pane-a'),{present:true,state:'unknown'});
 fs.writeFileSync(file,'null');
 assert.deepEqual(inspectPaneSend(dir,'pane-a'),{present:true,state:'unknown'});
 assert.equal((await createSendOnce({dir})('null-lock','text',run,{scope:'pane-a'})).notSent,true);assert.equal(calls,0);
 fs.unlinkSync(file); // Synthetic malformed fixture only, never production recovery.
 const result=await createSendOnce({dir})('changed','text',async()=>{
  const saved=JSON.parse(fs.readFileSync(file));saved.token='00000000-0000-0000-0000-000000000000';fs.writeFileSync(file,JSON.stringify(saved));return{ok:true};
 },{scope:'pane-a'});
 assert.equal(result.uncertain,true);assert.equal(inspectPaneSend(dir,'pane-a').token,'00000000-0000-0000-0000-000000000000');
});
test('uncertainty takes precedence over success and preserves pane exclusion',async t=>{
 const {dir}=fixture(t);const send=createSendOnce({dir});
 const result=await send('first','text',async()=>({ok:true,delivered:true,uncertain:true}),{scope:'pane-a'});
 assert.equal(result.ok,undefined);assert.equal(result.delivered,undefined);
 assert.equal((await send('other','text',async()=>({ok:true}),{scope:'pane-a'})).notSent,true);
 assert.equal(inspectPaneSend(dir,'pane-a').uncertain,true);
});
test('supported inspector reports bounded recovery metadata without writing or exposing message text',async t=>{
 const {root}=fixture(t),dir=path.join(root,'send-receipts');
 await createSendOnce({dir})('draft','private fixture body',async()=>({uncertain:true}),{scope:'pane-a'});
 const snapshot=()=>fs.readdirSync(dir).sort().map(name=>[name,fs.readFileSync(path.join(dir,name),'utf8')]);
 const before=snapshot();
 const output=execFileSync(process.execPath,[new URL('../../scripts/termfleet-send-inspect.mjs',import.meta.url).pathname,'pane-a'],{env:{...process.env,TC_CONFIG_DIR:root},encoding:'utf8'});
 const metadata=JSON.parse(output);
 assert.equal(metadata.present,true);assert.equal(metadata.uncertain,true);assert.equal(metadata.state,'recorded');
 assert.match(metadata.recovery,/Owner-authorized maintenance/);assert.equal(output.includes('private fixture body'),false);
 assert.deepEqual(snapshot(),before);
});
