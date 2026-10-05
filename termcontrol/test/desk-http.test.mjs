import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { claudeSlug } from '../bridge/paths.mjs';

for(const verified of [false,true])test(verified?'real HTTP bridge delivers two custom answers to an isolated request and rejects stale/repeated sends':'real HTTP bridge disables unverified custom dispatch without terminal writes',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'tc-desk-http-')),cwd=path.join(root,'freelance-desk'),id='terminal-fixture-http';
 const dataHome=path.join(root,'data'),status=path.join(dataHome,'terminal-workspace/agent-status'),projects=path.join(root,'projects');
 for(const d of [status,path.join(cwd,'scripts'),path.join(cwd,'.state'),path.join(projects,claudeSlug(cwd))])fs.mkdirSync(d,{recursive:true});
 fs.writeFileSync(path.join(cwd,'scripts/live_timeline.py'),'# synthetic authority marker');
 fs.writeFileSync(path.join(cwd,'.state/live-timeline.json'),JSON.stringify({generated:'2026-10-04T09:00:00',fixed_blocks:[],today:[],overdue:[],week:[],later:[],undated:[]}));
 fs.writeFileSync(path.join(status,'pane-fixture.json'),JSON.stringify({paneId:id,source:'claude',sessionId:'fixture-session',cwd,turn:'waiting',updatedAt:Date.now()}));
 fs.writeFileSync(path.join(dataHome,'terminal-workspace/workspace.json'),JSON.stringify({tabs:[{id:'fixture-tab',cwd,terminals:[{id}]}],canvasState:{nodes:[{id:'node',type:'terminal',terminalTabId:'fixture-tab'}]}}));
 const questions=[{header:'Proposal',question:'איזו הצעה להכין?',options:[{label:'Draft'},{label:'Review'}]},{header:'Timing',question:'מתי לבדוק את הטיוטה?',options:[{label:'Tomorrow'},{label:'Later'}]}];
 const transcript=path.join(projects,claudeSlug(cwd),'fixture-session.jsonl');
 const call={timestamp:'2026-10-04T09:00:00Z',message:{role:'assistant',content:[{type:'tool_use',name:'AskUserQuestion',id:'http-two-question',input:{questions}}]}};
 fs.writeFileSync(transcript,JSON.stringify(call)+'\n');
 let index=0,focused=false,text='',writes=[],answers={};
 const publish=()=>{
  const visible=index<2?questions[index].question+(focused?'\nType something.\n'+text:'\n1. Draft\n2. Review\n3. Type something\n4. Chat about this'):'Answers recorded';
  fs.writeFileSync(path.join(status,'termfleet-cockpit-snapshot.json'),JSON.stringify({sourceApp:'termfleet',updatedAt:Date.now(),terminals:[{terminalId:id,terminalVisibleText:visible,terminalVisibleTextUpdatedAt:Date.now()}]}));
 };
 publish();const socketPath=path.join(root,'daemon.sock');
 const daemon=net.createServer({allowHalfOpen:true},socket=>{let body='';socket.on('data',chunk=>body+=chunk);socket.on('end',()=>{let value;const req=JSON.parse(body);
  if(req.type==='listSessions')value={sessions:[{id,initialCwd:cwd,pid:999999,scrollbackBytes:1}]};
  else if(req.type==='snapshotSession')value={data:'Old ANSI scrollback, deliberately not a usable form'};
  else if(req.type==='writeSession'){
   writes.push(req.data);assert.equal(req.id,id);
   if(req.data==='3'){focused=true;publish();}
   else if(req.data.startsWith('\x1b[200~')){assert.equal(focused,true);text=req.data.slice(6,-6);publish();}
   else if(req.data==='\r'){assert.equal(focused,true);answers[questions[index].question]=text;index++;focused=false;text='';publish();if(index===2)fs.appendFileSync(transcript,JSON.stringify({timestamp:'2026-10-04T09:10:00Z',message:{role:'user',content:[{type:'tool_result',tool_use_id:'http-two-question',content:JSON.stringify({answers})}]}})+'\n');}
   else assert.fail('Unexpected input to fixture terminal');value={ok:true};
  }else value={};socket.end(JSON.stringify(value));});});
 await new Promise(resolve=>daemon.listen(socketPath,resolve));
 const portServer=net.createServer();await new Promise(resolve=>portServer.listen(0,'127.0.0.1',resolve));const port=portServer.address().port;await new Promise(resolve=>portServer.close(resolve));
 const env={...process.env,TC_PORT:String(port),TC_HOST:'127.0.0.1',TC_CONFIG_DIR:path.join(root,'config'),TC_CLAUDE_PROJECTS_DIR:projects,TC_VERIFIED_CUSTOM_ANSWERS:verified?'1':'0',XDG_DATA_HOME:dataHome,TERMFLEET_DAEMON_SOCKET:socketPath};
 const child=spawn(process.execPath,[new URL('../bridge/server.mjs',import.meta.url).pathname],{env,stdio:['ignore','pipe','pipe']});
 t.after(async()=>{child.kill();await once(child,'exit');await new Promise(resolve=>daemon.close(resolve));fs.rmSync(root,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${port}`;
 for(let i=0;i<40;i++){try{await fetch(base+'/setup');break;}catch{await new Promise(resolve=>setTimeout(resolve,50));}}
 const setup=await fetch(base+'/setup',{method:'POST',redirect:'manual',headers:{'content-type':'application/x-www-form-urlencoded'},body:'email=fixture%40example.test&password=synthetic-test-password'});
 assert.equal(setup.status,302);const cookie=setup.headers.get('set-cookie').split(';')[0];
 const request=async(url,payload)=>{const response=await fetch(base+url,{headers:{cookie,...(payload?{'content-type':'application/json'}:{})},...(payload?{method:'POST',body:JSON.stringify(payload)}:{})});return {status:response.status,body:await response.json()};};
 const first=await request(`/api/feed?pane=${id}`);assert.equal(first.status,200,JSON.stringify(first.body));assert.ok(first.body.ask,JSON.stringify(first.body));assert.equal(first.body.ask.questionIndex,0);assert.equal(first.body.desk,true);
 assert.equal(first.body.ask.customAnswerSupported,verified);
 const inventory=await request('/api/panes');assert.equal(inventory.body.panes.find(p=>p.id===id).lastUsedAt,null);
 const visited=await request('/api/visit',{pane:id});assert.equal(visited.status,200);assert.ok(visited.body.lastUsedAt>1e12,'millisecond owner visit');
 await request(`/api/feed?pane=${id}`);const afterPoll=await request('/api/panes');assert.equal(afterPoll.body.panes.find(p=>p.id===id).lastUsedAt,visited.body.lastUsedAt,'polling does not count as owner use');
 assert.equal((await request('/api/visit',{pane:'closed-fixture'})).status,409);assert.equal(writes.length,0,'visit writes metadata, never terminal input');

 if(!verified){const refused=await request('/api/send',{pane:id,askId:first.body.ask.id,answer:'Unverified custom answer'});assert.equal(refused.status,409);assert.equal(refused.body.notSent,true);assert.equal(writes.length,0);return;}
 assert.equal((await request('/api/send',{pane:id,text:'Lost unbound reply'})).status,409);assert.equal(writes.length,0);
 assert.equal((await request('/api/send',{pane:id,askId:'stale-id',answer:'Wrong question'})).status,409);assert.equal(writes.length,0);
 const answer1='אבחר בטיוטה\nThen review requirements',answer2='מחר ב־10:30 · Tomorrow';
 const sent=await request('/api/send',{pane:id,askId:first.body.ask.id,answer:answer1});assert.equal(sent.body.ok,true);assert.equal(sent.body.delivery,'terminal');assert.equal(answers[questions[0].question],answer1);
 const n=writes.length;const duplicate=await request('/api/send',{pane:id,askId:first.body.ask.id,answer:answer1});assert.equal(duplicate.body.duplicate,true);assert.equal(writes.length,n);
 const second=await request(`/api/feed?pane=${id}`);assert.equal(second.body.ask.questionIndex,1);assert.notEqual(second.body.ask.id,first.body.ask.id);
 const sent2=await request('/api/send',{pane:id,askId:second.body.ask.id,answer:answer2});assert.equal(sent2.body.ok,true);assert.deepEqual(answers,{[questions[0].question]:answer1,[questions[1].question]:answer2});
 const complete=await request(`/api/feed?pane=${id}`);assert.equal(complete.body.ask,null);assert.equal(complete.body.questionResults[0].declined,false);assert.deepEqual(JSON.parse(complete.body.questionResults[0].text).answers,answers);
 assert.equal(writes.filter(key=>key==='\x1b').length,0,'no accidental decline');assert.equal(writes.filter(key=>key==='\r').length,2,'one submission per question');
});
