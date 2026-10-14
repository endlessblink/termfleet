import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
test('HTTP preparation is authenticated and slow synthetic upload has separate safe timings',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tc-http-timing-'));
 const worker=path.join(dir,'stub.py');
 fs.writeFileSync(worker,`import json,sys,time
print(json.dumps({'ready':True}),flush=True)
for line in sys.stdin:
 r=json.loads(line)
 out={'id':r['id'],'timings':{'decodeMs':1,'warmupMs':2,'detectMs':3,'inferenceMs':4,'model':'ivrit-ai/faster-whisper-v2-d4','device':'cpu','computeType':'int8_float32','cpuThreads':8,'private':'DO-NOT-LOG','path':'/private/clip'}}
 if r.get('op')=='prepare':out['prepared']=True
 else:
  time.sleep(0.3)
  out.update(text='synthetic words',language='he',seconds=0.01)
 print(json.dumps(out),flush=True)
`);
 process.env.TC_CONFIG_DIR=dir;
 const accounts=await import('../bridge/accounts.mjs');accounts.createAccount('synthetic@example.test','synthetic-fixture-only-password');
 const reservation=net.createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));
 const child=spawn('node',[path.resolve('termcontrol/bridge/server.mjs')],{env:{...process.env,HOME:dir,XDG_DATA_HOME:dir,TC_CLAUDE_PROJECTS_DIR:dir,TERMFLEET_DAEMON_SOCKET:path.join(dir,'no-daemon.sock'),TC_PORT:String(port),TC_HOST:'127.0.0.1',TC_CONFIG_DIR:dir,TC_STT_WORKER:worker,TC_WHISPER_PY:'/usr/bin/python3',TC_STT_MAX_PENDING:'1'},stdio:'ignore'});
 try{
  for(let i=0;i<100;i++){
   if(await new Promise(r=>net.connect(port,'127.0.0.1').on('connect',function(){this.destroy();r(true);}).on('error',()=>r(false))))break;
   await new Promise(r=>setTimeout(r,25));
  }
  const base=`http://127.0.0.1:${port}`;
  assert.equal((await fetch(base+'/api/transcribe/prepare',{method:'POST'})).status,401);
  assert.equal((await fetch(base+'/api/transcribe/timings')).status,401);
  const login=await fetch(base+'/embed',{headers:{'sec-fetch-dest':'iframe'},redirect:'manual'});
  const cookie=login.headers.get('set-cookie').split(';')[0];
  const prepared=await fetch(base+'/api/transcribe/prepare?lang=he',{method:'POST',headers:{cookie}});
  assert.equal(prepared.status,200);assert.equal((await prepared.json()).prepared,true);
  const {headers,body}=await new Promise((resolve,reject)=>{
   const req=http.request(base+'/api/transcribe',{method:'POST',headers:{cookie,'content-type':'audio/webm'}},res=>{
    let data='';res.on('data',chunk=>data+=chunk);res.on('end',()=>resolve({headers:res.headers,body:JSON.parse(data)}));
   });req.on('error',reject);req.write(Buffer.alloc(32));setTimeout(()=>req.end(Buffer.alloc(32)),80);
  });
  assert.equal(body.text,'synthetic words');assert.ok(body.timings.uploadMs>=60);assert.ok(body.timings.requestMs>=body.timings.uploadMs);
  assert.equal(body.timings.inferenceMs,4);assert.equal(body.timings.computeType,'int8_float32');assert.equal(body.timings.cpuThreads,8);
  const recent=await (await fetch(base+'/api/transcribe/timings',{headers:{cookie}})).json();
  assert.equal(recent.timings.length,2);assert.ok(recent.timings[1].uploadMs>=60);
  assert.ok(!JSON.stringify(recent).includes('synthetic words'));assert.ok(!JSON.stringify(recent).includes('DO-NOT-LOG'));assert.ok(!JSON.stringify(recent).includes('/private/clip'));
  assert.match(headers['server-timing'],/upload;dur=/);assert.match(headers['server-timing'],/inference;dur=4.0/);
  assert.ok(!JSON.stringify(body.timings).includes('synthetic words'));assert.ok(!JSON.stringify(body.timings).includes('DO-NOT-LOG'));assert.ok(!JSON.stringify(body.timings).includes('/private/clip'));
  const active=fetch(base+'/api/transcribe',{method:'POST',headers:{cookie},body:Buffer.alloc(64)});
  await new Promise(r=>setTimeout(r,40));
  const busy=await fetch(base+'/api/transcribe',{method:'POST',headers:{cookie},body:Buffer.alloc(64)});
  assert.equal(busy.status,503);assert.equal(busy.headers.get('retry-after'),'2');assert.match((await busy.json()).error,/busy/i);
  assert.equal((await active).status,200);
 }finally{child.kill();await new Promise(r=>child.once('exit',r));fs.rmSync(dir,{recursive:true,force:true});}
});
