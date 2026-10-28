import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

// Real HTTP bridge processes and on-disk receipts; every terminal operation goes
// only to this disposable socket. No provider process or actual terminal input.
test('authenticated draft retry after actual bridge restart never repeats acknowledged text',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'tc-send-restart-'));
 const id='terminal-send-restart-fixture',cwd=path.join(root,'project'),dataHome=path.join(root,'data');
 const state=path.join(dataHome,'terminal-workspace');
 fs.mkdirSync(cwd,{recursive:true});fs.mkdirSync(state,{recursive:true});
 fs.writeFileSync(path.join(state,'workspace.json'),JSON.stringify({tabs:[{id:'fixture-tab',cwd,terminals:[{id}]}],canvasState:{nodes:[{id:'fixture-node',type:'terminal',terminalTabId:'fixture-tab'}]}}));
 const socketPath=path.join(root,'daemon.sock'),writes=[];
 const daemon=net.createServer({allowHalfOpen:true},socket=>{
  let body='';socket.on('data',chunk=>body+=chunk);socket.on('end',()=>{
   const req=JSON.parse(body);let result={};
   if(req.type==='listSessions')result={sessions:[{id,initialCwd:cwd,pid:999999,scrollbackBytes:0}]};
   if(req.type==='snapshotSession')result={data:'$ '};
   if(req.type==='writeSession'){assert.equal(req.id,id);writes.push(req.data);result=req.data==='\r'?{error:'fixture Enter failure'}:{ok:true};}
   socket.end(JSON.stringify(result));
  });
 });
 await new Promise(resolve=>daemon.listen(socketPath,resolve));
 const reserve=net.createServer();await new Promise(resolve=>reserve.listen(0,'127.0.0.1',resolve));
 const port=reserve.address().port;await new Promise(resolve=>reserve.close(resolve));
 const base=`http://127.0.0.1:${port}`;let child,errors='';
 const stop=async()=>{if(child&&child.exitCode===null){child.kill();await once(child,'exit');}};
 t.after(async()=>{await stop();await new Promise(resolve=>daemon.close(resolve));fs.rmSync(root,{recursive:true,force:true});});
 const start=async()=>{
  child=spawn(process.execPath,[new URL('../bridge/server.mjs',import.meta.url).pathname],{env:{...process.env,HOME:root,XDG_DATA_HOME:dataHome,TC_CONFIG_DIR:path.join(root,'config'),TC_CLAUDE_PROJECTS_DIR:path.join(root,'projects'),TC_PORT:String(port),TC_HOST:'127.0.0.1',TC_NO_AGENT_HEALTH:'1',TC_DESK_STT:'0',TERMFLEET_DAEMON_SOCKET:socketPath},stdio:['ignore','ignore','pipe']});
  child.stderr.on('data',x=>errors+=x);
  for(let n=0;n<100;n++){
   try{await fetch(base+'/login');return;}catch{if(child.exitCode!==null)throw Error(errors);await new Promise(resolve=>setTimeout(resolve,50));}
  }
  throw Error('Fixture bridge did not start: '+errors);
 };
 await start();
 const setup=await fetch(base+'/setup',{method:'POST',redirect:'manual',headers:{'content-type':'application/x-www-form-urlencoded'},body:'email=fixture%40example.test&password=synthetic-fixture-password'});
 assert.equal(setup.status,302,errors);const cookie=setup.headers.get('set-cookie').split(';')[0];
 const payload={pane:id,sendId:'stable-draft',text:'one isolated owner draft'};
 const send=async(body=payload,authenticated=true)=>{
  const response=await fetch(base+'/api/send',{method:'POST',redirect:'manual',headers:{...(authenticated?{cookie}:{}),'content-type':'application/json'},body:JSON.stringify(body)});
  return{status:response.status,body:response.headers.get('content-type')?.includes('json')?await response.json():null};
 };
 assert.equal((await send(payload,false)).status,401);
 const first=await send();assert.equal(first.body.uncertain,true,JSON.stringify(first));
 assert.deepEqual(writes,[payload.text,'\r']);
 // SIGKILL cannot run bridge drain/save handlers; disk reservation must suffice.
 child.kill('SIGKILL');await once(child,'exit');await start();
 const retry=await send();assert.equal(retry.body.repeated,true,JSON.stringify(retry));assert.equal(retry.body.uncertain,true);
 assert.deepEqual(writes,[payload.text,'\r']);
 const changed=await send({...payload,text:'changed body'});assert.equal(changed.body.notSent,true);
 const missing=await send({pane:id,text:'no stable ID'});assert.equal(missing.body.notSent,true);
 assert.deepEqual(writes,[payload.text,'\r']);
 const receipts=fs.readdirSync(path.join(root,'config/send-receipts'));
 assert.equal(receipts.filter(x=>x.endsWith('.json')).length,1);
 assert.equal(fs.readFileSync(path.join(root,'config/send-receipts',receipts[0]),'utf8').includes(payload.text),false);
});
