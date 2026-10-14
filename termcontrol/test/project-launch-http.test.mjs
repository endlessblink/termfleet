import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import net from 'node:net';import {spawn} from 'node:child_process';
test('authenticated project launch resolves dormant exact map ownership and preserves stale/auth/provider boundaries',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'tc-project-http-')),data=path.join(root,'data'),config=path.join(root,'config'),bin=path.join(root,'bin'),cwd=path.join(root,'paper');for(const dir of [config,bin,cwd,path.join(data,'terminal-workspace','child-requests')])fs.mkdirSync(dir,{recursive:true});
 const workspaceFile=path.join(data,'terminal-workspace','workspace.json'),cap=path.join(data,'terminal-workspace','child-requests','.project-launch'),log=path.join(root,'launch.json');
 const workspace={groups:[{id:'paper-id',name:'Paper Bot',projectRoot:cwd}],tabs:[]};fs.writeFileSync(workspaceFile,JSON.stringify(workspace));fs.writeFileSync(cap,JSON.stringify({version:2,updatedAt:Date.now()}));
 const cli=path.join(bin,'termfleet-child');fs.writeFileSync(cli,'#!/usr/bin/env node\n'+`require('node:fs').writeFileSync(${JSON.stringify(log)},JSON.stringify(process.argv.slice(2)));console.log(JSON.stringify({ok:true,childPaneId:'synthetic-paper-pane'}));`);fs.chmodSync(cli,0o700);
 process.env.TC_CONFIG_DIR=config;const account=await import('../bridge/accounts.mjs');account.createAccount('fixture@example.test','a-long-fixture-password');
 const allocator=net.createServer();await new Promise(resolve=>allocator.listen(0,'127.0.0.1',resolve));const port=allocator.address().port;await new Promise(resolve=>allocator.close(resolve));
 let fixtureDaemon;
 const bridge=spawn(process.execPath,['termcontrol/bridge/server.mjs'],{env:{...process.env,HOME:root,TC_CONFIG_DIR:config,TC_CLAUDE_PROJECTS_DIR:root,TERMFLEET_DAEMON_SOCKET:path.join(root,'no-daemon.sock'),XDG_DATA_HOME:data,TC_HOST:'127.0.0.1',TC_PORT:String(port),PATH:bin+':'+process.env.PATH},stdio:'ignore'});
 try{for(let i=0;i<80;i++){try{await fetch(`http://127.0.0.1:${port}/login`);break;}catch{await new Promise(resolve=>setTimeout(resolve,25));}}
  const base=`http://127.0.0.1:${port}`,login=await fetch(base+'/embed',{headers:{'sec-fetch-dest':'iframe'},redirect:'manual'}),cookie=login.headers.get('set-cookie').split(';')[0];
  const post=(body,headers={cookie})=>fetch(base+'/api/spawn',{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});
  const body={projectId:'paper-id',provider:'codex',task:'Synthetic task'};
  assert.equal((await post(body,{})).status,401);assert.equal((await post(body,{cookie,origin:'https://other.test'})).status,403);
  const projects=await (await fetch(base+'/api/projects',{headers:{cookie}})).json();assert.equal(projects.ready,true);assert.equal(projects.projects[0].id,'paper-id');assert.deepEqual(projects.providers.map(p=>p.id),['claude','codex','opencode']);
  assert.equal((await post({...body,project:'Paper Bot',projectId:undefined})).status,503);assert.equal((await post({...body,provider:'unknown'})).status,400);
  const response=await post({...body,cwd:'/wrong-desk'});assert.equal(response.status,200);assert.equal((await response.json()).childPaneId,'synthetic-paper-pane');const args=JSON.parse(fs.readFileSync(log,'utf8'));assert.equal(args[args.indexOf('--cwd')+1],cwd);assert.equal(args[args.indexOf('--project-id')+1],'paper-id');assert.equal(args.includes('--near'),false);
  fs.unlinkSync(log);fs.writeFileSync(workspaceFile,JSON.stringify({groups:[],tabs:[]}));assert.equal((await post(body)).status,409);assert.equal(fs.existsSync(log),false);
  fs.writeFileSync(workspaceFile,JSON.stringify(workspace));fs.writeFileSync(cap,JSON.stringify({version:2,updatedAt:Date.now()-20000}));assert.equal((await post(body)).status,409);assert.equal(fs.existsSync(log),false);
  const unavailable=await fetch(base+'/api/projects',{headers:{cookie}});assert.equal(unavailable.status,404);assert.equal((await unavailable.json()).capabilityVersion,1);
  const paneId='synthetic-current-pane',current={...workspace,tabs:[{id:'current-tab',groupId:'paper-id',initialCwd:cwd,terminals:[{id:paneId,initialCwd:cwd,agentProvider:'codex'}]}]};
  fs.writeFileSync(workspaceFile,JSON.stringify(current));
  fixtureDaemon=net.createServer(socket=>socket.on('data',data=>{assert.equal(JSON.parse(data).type,'listSessions');socket.end(JSON.stringify({sessions:[{id:paneId,pid:12345,initialCwd:cwd,lastExit:null}]}));}));
  await new Promise(resolve=>fixtureDaemon.listen(path.join(root,'no-daemon.sock'),resolve));
  const legacy={project:path.basename(cwd),provider:'codex',task:'Synthetic legacy task'};
  assert.equal((await post(legacy)).status,200);const oldArgs=JSON.parse(fs.readFileSync(log,'utf8'));assert.equal(oldArgs[oldArgs.indexOf('--near')+1],cwd);assert.equal(oldArgs.includes('--project-id'),false);
  fs.unlinkSync(log);assert.equal((await post({...legacy,provider:'opencode'})).status,400);
  fs.writeFileSync(workspaceFile,JSON.stringify({...current,groups:[...current.groups,{id:'duplicate-root',projectRoot:cwd}]}));assert.equal((await post(legacy)).status,409);assert.equal(fs.existsSync(log),false);
 }finally{bridge.kill();await new Promise(resolve=>bridge.once('exit',resolve));if(fixtureDaemon)await new Promise(resolve=>fixtureDaemon.close(resolve));fs.rmSync(root,{recursive:true,force:true});}
});
