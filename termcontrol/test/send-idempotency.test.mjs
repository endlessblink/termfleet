import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {createSendOnce} from '../bridge/send-once.mjs';

const moduleURL=new URL('../bridge/send-once.mjs',import.meta.url).href;
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'send-idempotency-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}

test('acknowledged text followed by failed Enter stays uncertain and never types twice',async t=>{
 const root=fixture(t),socketPath=path.join(root,'daemon.sock'),id='terminal-f18-disposable';
 const previous={TC_CONFIG_DIR:process.env.TC_CONFIG_DIR,TERMFLEET_DAEMON_SOCKET:process.env.TERMFLEET_DAEMON_SOCKET,XDG_DATA_HOME:process.env.XDG_DATA_HOME};
 Object.assign(process.env,{TC_CONFIG_DIR:root,TERMFLEET_DAEMON_SOCKET:socketPath,XDG_DATA_HOME:path.join(root,'data')});
 t.after(()=>{for(const [key,value]of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
 const writes=[];let mode='enter',releaseList,firstList;
 const server=net.createServer({allowHalfOpen:true},socket=>{
  let wire='';socket.on('data',data=>wire+=data);socket.on('end',()=>{
   const req=JSON.parse(wire);let result;
   if(req.type==='listSessions'){
    result={sessions:[{id,scrollbackBytes:0}]};
    if(mode==='hold-list'){firstList();releaseList=()=>socket.end(JSON.stringify(result));return;}
   }
   else if(req.type==='writeSession'){
    writes.push(req.data);
    if(mode==='lost-ack'){socket.end();return;}
    result=req.data==='\r'||mode==='picture-failure'?{error:'fixture Enter failure'}:{ok:true};
   }
   else result={data:''};
   socket.end(JSON.stringify(result));
  });
 });
 server.listen(socketPath);await once(server,'listening');t.after(()=>server.close());
 const {sendToPane}=await import('../bridge/send.mjs');
 const sendOnce=createSendOnce({dir:path.join(root,'receipts')});
 const run=()=>sendToPane({id,provider:'codex',turn:'idle'},'one owner message');
 const first=await sendOnce('draft','one owner message',run,{scope:id});
 const again=await sendOnce('draft','one owner message',run,{scope:id});
 assert.equal(first.uncertain,true,JSON.stringify(first));assert.equal(first.ok,undefined);
 assert.equal(again.repeated,true);assert.equal(writes.filter(x=>x==='one owner message').length,1);
 assert.equal(writes.filter(x=>x==='\r').length,1);
 assert.equal(JSON.parse(fs.readFileSync(path.join(root,'sent.log'),'utf8').trim().split('\n').at(-1)).uncertain,true);

 mode='lost-ack';writes.length=0;
 const lost=await sendToPane({id,provider:'codex'},'lost acknowledgement');
 assert.equal(lost.uncertain,true);assert.deepEqual(writes,['lost acknowledgement'],'unknown write acknowledgement must not cause a replay or Enter');

 mode='hold-list';writes.length=0;
 const listed=new Promise(resolve=>firstList=resolve);
 const pending=sendToPane({id,provider:'codex'},'held send');await listed;
 const blocked=await sendToPane({id,provider:'codex'},'different draft');
 assert.equal(blocked.busy,true);assert.equal(blocked.notSent,true);assert.deepEqual(writes,[]);
 mode='enter';releaseList();await pending;

 mode='picture-failure';writes.length=0;
 const picture=path.join(root,'fixture.png');fs.writeFileSync(picture,'fixture');
 const partial=await sendToPane({id,provider:'codex'},picture+'\nremaining text');
 assert.equal(partial.uncertain,true);assert.equal(writes.length,1);assert.ok(writes[0].includes(picture));
});

test('uncertain and successful receipts survive new bridge instances and cache expiry',async t=>{
 const dir=fixture(t);let calls=0,clock=100;
 const send=createSendOnce({dir,now:()=>clock,ttlMs:10});
 const run=async()=>{calls++;return{error:'Enter failed',uncertain:true};};
 await send('draft','private payload',run,{scope:'pane-a'});clock=1000;
 const retry=await createSendOnce({dir,now:()=>clock})('draft','private payload',run,{scope:'pane-a'});
 assert.equal(retry.repeated,true);assert.equal(retry.uncertain,true);assert.equal(calls,1);
 await send('success','other payload',async()=>{calls++;return{ok:true,sentAt:500};},{scope:'pane-b'});
 const success=await createSendOnce({dir})('success','other payload',async()=>{calls++;return{ok:true};},{scope:'pane-b'});
 assert.equal(success.repeated,true);assert.equal(calls,2);
 assert.ok(fs.readdirSync(dir).every(name=>!fs.readFileSync(path.join(dir,name),'utf8').includes('private payload')),'receipt stores a hash rather than owner text');
});

test('known prewrite refusal remains retryable and a draft cannot change terminal',async t=>{
 const dir=fixture(t);let calls=0;const send=createSendOnce({dir});
 assert.equal((await send('draft','text',async()=>({error:'busy',notSent:true} ),{scope:'pane'})).notSent,true);
 assert.equal((await createSendOnce({dir})('draft','text',async()=>{calls++;return{ok:true};},{scope:'pane'})).ok,true);
 assert.equal((await send('draft','text',async()=>{calls++;return{ok:true};},{scope:'other-pane'})).notSent,true);
 assert.equal(calls,1);
 assert.equal((await send('other-draft','text',async()=>{calls++;return{ok:true};},{scope:'other-pane'})).ok,true);
 assert.equal(calls,2);
 assert.match((await send('draft','changed',async()=>({ok:true}),{scope:'pane'})).error,/changed/);
});

const worker=String.raw`
 const {createSendOnce}=await import(process.argv[1]);
 const fs=await import('node:fs');
 const [dir,count,crash]=process.argv.slice(2);
 const result=await createSendOnce({dir})('draft','same payload',async()=>{
  fs.appendFileSync(count,'typed\n');
  if(crash==='crash')process.exit(17);
  await new Promise(r=>setTimeout(r,100));return{error:'Enter failed',uncertain:true};
 },{scope:'pane'});
 process.stdout.write(JSON.stringify(result));
`;
function child(dir,count,crash=''){
 const p=spawn(process.execPath,['--input-type=module','-e',worker,moduleURL,dir,count,crash],{stdio:['ignore','pipe','pipe']});
 let out='',error='';p.stdout.on('data',x=>out+=x);p.stderr.on('data',x=>error+=x);
 return once(p,'exit').then(([code])=>({code,out,error}));
}
test('same scoped draft reserves once across concurrent processes',async t=>{
 const root=fixture(t),dir=path.join(root,'receipts'),count=path.join(root,'writes');
 const outcomes=await Promise.all([child(dir,count),child(dir,count)]);
 assert.ok(outcomes.every(x=>x.code===0),JSON.stringify(outcomes));
 assert.equal(fs.readFileSync(count,'utf8'),'typed\n');
 assert.ok(outcomes.some(x=>JSON.parse(x.out).repeated));
});

test('process exit after text cannot release its durable reservation',async t=>{
 const root=fixture(t),dir=path.join(root,'receipts'),count=path.join(root,'writes');
 assert.equal((await child(dir,count,'crash')).code,17);
 const retry=await child(dir,count);
 assert.equal(retry.code,0,retry.error);assert.equal(JSON.parse(retry.out).uncertain,true);
 assert.equal(fs.readFileSync(count,'utf8'),'typed\n');
});

test('unwritable receipt storage refuses before invoking the sender',async t=>{
 const dir=fixture(t),file=path.join(dir,'not-a-directory');fs.writeFileSync(file,'fixture');let called=false;
 const result=await createSendOnce({dir:file})('draft','text',async()=>{called=true;return{ok:true};},{scope:'pane'});
 assert.equal(called,false);assert.equal(result.notSent,true);
});

test('unknown throws, incomplete receipts, body conflicts and missing IDs never dispatch again',async t=>{
 const dir=fixture(t);let calls=0;
 const run=async()=>{calls++;throw Error('unknown transport outcome');};
 const first=await createSendOnce({dir})('draft','text',run,{scope:'pane'});
 assert.equal(first.uncertain,true);
 assert.equal((await createSendOnce({dir})('draft','text',run,{scope:'pane'})).repeated,true);
 assert.equal((await createSendOnce({dir})('draft','changed',run,{scope:'pane'})).notSent,true);
 assert.equal((await createSendOnce({dir})(null,'text',run)).notSent,true);
 assert.equal(calls,1);
 const receipt=path.join(dir,fs.readdirSync(dir).find(x=>x.endsWith('.json')));fs.writeFileSync(receipt,'{"v":');
 assert.equal((await createSendOnce({dir})('draft','text',run,{scope:'pane'})).uncertain,true);
 assert.equal(calls,1);
});

test('completion persistence failure keeps the pending reservation across reload',async t=>{
 const dir=fixture(t);let calls=0;const rename=fs.renameSync;
 fs.renameSync=(from,to)=>{if(to.startsWith(dir+path.sep))throw Error('fixture completion rename failed');return rename(from,to);};
 try{
  const result=await createSendOnce({dir})('draft','text',async()=>{calls++;return{ok:true};},{scope:'pane'});
  assert.equal(result.uncertain,true);assert.equal(result.ok,undefined);
 }finally{fs.renameSync=rename;}
 const result=await createSendOnce({dir})('draft','text',async()=>{calls++;return{ok:true};},{scope:'pane'});
 assert.equal(result.uncertain,true);assert.equal(result.repeated,true);assert.equal(calls,1);
 const blocked=await createSendOnce({dir})('other','different text',async()=>{calls++;return{ok:true};},{scope:'pane'});
 assert.equal(blocked.notSent,true);assert.equal(blocked.blocked,true);assert.equal(calls,1);
});
