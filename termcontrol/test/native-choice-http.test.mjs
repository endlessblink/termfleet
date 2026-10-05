import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chromium } from 'playwright';
import { claudeSlug } from '../bridge/paths.mjs';

// Disposable transcript, account, bridge and daemon. The fixture follows the
// installed Claude 2.1.288 Select handler: a digit calls onChange immediately;
// Enter accepts the focused/default option of the following question.
test('ordinary mobile choices advance one of three questions and confirm only a matching provider record',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'tc-native-choice-'));
 const cwd=path.join(root,'freelance-desk'),id='terminal-native-choice-fixture';
 const dataHome=path.join(root,'data'),status=path.join(dataHome,'terminal-workspace/agent-status'),projects=path.join(root,'projects');
 for(const dir of [status,path.join(cwd,'scripts'),path.join(cwd,'.state'),path.join(projects,claudeSlug(cwd))])fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(path.join(cwd,'scripts/live_timeline.py'),'# synthetic marker');
 fs.writeFileSync(path.join(cwd,'.state/live-timeline.json'),JSON.stringify({fixed_blocks:[],today:[],overdue:[],week:[],later:[],undated:[]}));
 fs.writeFileSync(path.join(status,'pane-fixture.json'),JSON.stringify({paneId:id,source:'claude',sessionId:'native-choice-fixture',cwd,turn:'waiting',updatedAt:Date.now()}));
 fs.writeFileSync(path.join(dataHome,'terminal-workspace/workspace.json'),JSON.stringify({tabs:[{id:'synthetic-tab',cwd,terminals:[{id}]}],canvasState:{nodes:[{id:'synthetic-node',type:'terminal',terminalTabId:'synthetic-tab'}]}}));
 const questions=[
  {header:'Proposal',question:'Which draft should we review?',options:[{label:'First draft',description:'Review the existing draft'},{label:'Second draft',description:'Review the alternative'}]},
  {header:'Review time',question:'When should we review it?',options:[{label:'Tomorrow'},{label:'Later'}]},
  {header:'Next step',question:'Which step comes next?',options:[{label:'Review scope'},{label:'Review wording'}]},
 ];
 const transcript=path.join(projects,claudeSlug(cwd),'native-choice-fixture.jsonl');
 const snapshotFile=path.join(status,'termfleet-cockpit-snapshot.json');
 let index=0,sourceId='',writes=[],answers={},rejectWrite=false,holdResult=true;
 const publish=(old=false)=>{
  const now=Date.now(),question=questions[index];
  const visible=question?question.question+'\n'+question.options.map((o,i)=>`${i+1}. ${o.label}`).join('\n')+'\n3. Type something.\n4. Chat about this':'Review your answers\n'+questions.map(q=>q.question+'\n→ '+answers[q.question]).join('\n')+'\nReady to submit your answers?\nSubmit answers\nCancel';
  fs.writeFileSync(snapshotFile,JSON.stringify({sourceApp:'termfleet',updatedAt:now,terminals:[{terminalId:id,updatedAt:now,terminalVisibleText:visible,terminalVisibleTextUpdatedAt:old?now-8*3600e3:now}]}));
 };
 const reset=(suffix,old=false)=>{index=0;answers={};sourceId='synthetic-native-'+suffix;holdResult=true;rejectWrite=false;
  fs.writeFileSync(transcript,JSON.stringify({timestamp:new Date().toISOString(),message:{role:'assistant',content:[{type:'text',text:'Three choices will help decide the next step.'},{type:'tool_use',name:'AskUserQuestion',id:sourceId,input:{questions}}]}})+'\n');publish(old);
 };
 const recordResult=()=>fs.appendFileSync(transcript,JSON.stringify({timestamp:new Date().toISOString(),message:{role:'user',content:[{type:'tool_result',tool_use_id:sourceId,content:JSON.stringify({answers})}]}})+'\n');
 reset('initial',true);
 const socketPath=path.join(root,'daemon.sock');
 const daemon=net.createServer({allowHalfOpen:true},socket=>{let body='';socket.on('data',chunk=>body+=chunk);socket.on('end',()=>{
  const request=JSON.parse(body);let value={},ok=true,error;
  if(request.type==='listSessions')value={sessions:[{id,initialCwd:cwd,pid:999999,scrollbackBytes:1}]};
  else if(request.type==='snapshotSession')value={data:'Old ANSI scrollback is deliberately unusable for focus'};
  else if(request.type==='writeSession'){
   assert.equal(request.id,id);writes.push(request.data);value={ok:true};
   if(rejectWrite){ok=false;error='Synthetic failed write';}
   else for(const key of request.data){
    assert.ok(/^[12\r]$/.test(key),'only fixture option keys are allowed');
    if(index<questions.length){const option=key==='\r'?0:Number(key)-1;answers[questions[index].question]=questions[index].options[option].label;index++;publish();}
    else if(key==='\r' && !holdResult)recordResult();
   }
  }
  socket.end(JSON.stringify(ok?value:{error}));
 });});
 await new Promise(resolve=>daemon.listen(socketPath,resolve));
 const portServer=net.createServer();await new Promise(resolve=>portServer.listen(0,'127.0.0.1',resolve));const port=portServer.address().port;await new Promise(resolve=>portServer.close(resolve));
 const child=spawn(process.execPath,[new URL('../bridge/server.mjs',import.meta.url).pathname],{env:{...process.env,TC_PORT:String(port),TC_HOST:'127.0.0.1',TC_CONFIG_DIR:path.join(root,'config'),TC_CLAUDE_PROJECTS_DIR:projects,TC_VERIFIED_CUSTOM_ANSWERS:'0',XDG_DATA_HOME:dataHome,TERMFLEET_DAEMON_SOCKET:socketPath},stdio:['ignore','pipe','pipe']});
 let childErrors='';child.stderr.on('data',chunk=>childErrors+=chunk);
 const base=`http://127.0.0.1:${port}`;
 t.after(async()=>{if(child.exitCode===null){child.kill();await once(child,'exit');}await new Promise(resolve=>daemon.close(resolve));fs.rmSync(root,{recursive:true,force:true});});
 for(let i=0;i<40;i++){try{await fetch(base+'/setup');break;}catch{await new Promise(resolve=>setTimeout(resolve,50));}}
 const setup=await fetch(base+'/setup',{method:'POST',redirect:'manual',headers:{'content-type':'application/x-www-form-urlencoded'},body:'email=native-fixture%40example.test&password=synthetic-password'});assert.equal(setup.status,302,childErrors);
 const cookie=setup.headers.get('set-cookie').split(';')[0];
 const request=async(url,payload)=>{const response=await fetch(base+url,{headers:{cookie,...(payload?{'content-type':'application/json'}:{})},...(payload?{method:'POST',body:JSON.stringify(payload)}:{})});return {status:response.status,body:await response.json()};};
 const browser=await chromium.launch();t.after(()=>browser.close());
 const out=path.resolve('.captures/termcontrol-mobile/choice-oct05');fs.mkdirSync(out,{recursive:true});
 for(const width of [320,390,430,1280]){
  reset(String(width),true);const startWrites=writes.length;
  const context=await browser.newContext({viewport:{width,height:900},locale:'en-GB',isMobile:width<600,hasTouch:width<600});
  const equals=cookie.indexOf('=');await context.addCookies([{name:cookie.slice(0,equals),value:cookie.slice(equals+1),url:base}]);
  const page=await context.newPage();await page.addInitScript(()=>document.addEventListener('DOMContentLoaded',()=>{const banner=document.createElement('div');banner.textContent='Demonstration · synthetic data';banner.style.cssText='flex:none;text-align:center;font:12px/1.4 system-ui;background:#232320;color:#9a9993;padding:4px';document.body.prepend(banner);}));
  await page.goto(base+'/#'+id);await page.waitForSelector('[data-choice="1"]',{timeout:6000});
  assert.equal(await page.locator('.pending-answer').textContent(),'Show answer choices');
  await page.locator('.pending-answer').click();assert.equal(writes.length,startWrites,'navigation does not answer');
  await page.waitForFunction(()=>document.querySelector('[data-choice="1"]')===document.activeElement,{},{timeout:2000});
  const first=await request('/api/feed?pane='+id);assert.equal(first.body.ask.questionIndex,0);assert.equal(first.body.ask.customAnswerSupported,false);
  await page.locator('[data-choice="1"]').click();
  await page.waitForFunction(()=>document.querySelector('.askbox .askbody>p')?.textContent==='When should we review it?',{},{timeout:5000});
  assert.equal(index,1,'one click advances exactly one question');assert.deepEqual(answers,{[questions[0].question]:'First draft'});assert.equal(writes.at(-1),'1');
  assert.match(await page.locator('main').textContent(),/awaiting agent confirmation/i);assert.doesNotMatch(await page.locator('main').textContent(),/Confirmed in the agent/);
  await page.screenshot({path:path.join(out,`next-question-${width}.png`),fullPage:true});
  const count=writes.length;assert.equal((await request('/api/send',{pane:id,askId:first.body.ask.id,choice:'1'})).body.duplicate,true);assert.equal(writes.length,count);
  await page.locator('[data-choice="2"]').click();await page.waitForFunction(()=>document.querySelector('.askbox .askbody>p')?.textContent==='Which step comes next?',{},{timeout:5000});assert.equal(index,2);
  await page.locator('[data-choice="1"]').click();await page.waitForSelector('[data-choice="submit"]',{timeout:6000});assert.equal(index,3);
  assert.deepEqual(writes.slice(startWrites),['1','2','1'],'no stray Enter, Escape, or second-question default');
  assert.equal((await request('/api/feed?pane='+id)).body.questionResults.length,0,'terminal writes do not manufacture provider acknowledgment');
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.waitForSelector('[data-choice="submit"]',{timeout:6000});assert.equal(await page.locator('.review-answers dd').count(),3);
  const layout=await page.evaluate(()=>({header:document.querySelector('header').getBoundingClientRect().toJSON(),composer:document.querySelector('.composer').getBoundingClientRect().toJSON(),main:document.querySelector('main').getBoundingClientRect().toJSON(),height:innerHeight,scrollY}));fs.writeFileSync(path.join(out,`layout-${width}.json`),JSON.stringify(layout,null,2));
  assert.ok(layout.header.top>=0 && layout.composer.bottom<=layout.height+1,'original header and bottom controls stay in the viewport');
  await page.screenshot({path:path.join(out,`review-${width}.png`),fullPage:true});holdResult=false;
  await page.locator('[data-choice="submit"]').click();await page.waitForFunction(()=>document.querySelector('main')?.textContent.includes('Confirmed in the agent'),{},{timeout:6000});
  const final=await request('/api/feed?pane='+id);assert.equal(final.body.ask,null);assert.equal(final.body.questionResults[0].sourceId,sourceId);assert.deepEqual(final.body.questionResults[0].answers,['First draft','Later','Review scope']);
  assert.deepEqual(writes.slice(startWrites),['1','2','1','\r'],'final submission is an explicit separate click');
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  await context.close();
 }
 reset('failure');rejectWrite=true;const pending=await request('/api/feed?pane='+id);const before=writes.length;
 const failed=await request('/api/send',{pane:id,askId:pending.body.ask.id,choice:'1'});assert.equal(failed.body.uncertain,true);assert.equal(failed.body.ok,undefined);assert.equal(index,0);
 assert.equal((await request('/api/send',{pane:id,askId:pending.body.ask.id,choice:'1'})).body.uncertain,true);assert.equal(writes.length,before+1,'uncertain failure is not retried');
 reset('stale');const snapshot=JSON.parse(fs.readFileSync(snapshotFile));snapshot.terminals[0].updatedAt=Date.now()-30000;fs.writeFileSync(snapshotFile,JSON.stringify(snapshot));
 const stale=await request('/api/feed?pane='+id),n=writes.length;const refused=await request('/api/send',{pane:id,askId:stale.body.ask.id,choice:'1'});assert.equal(refused.status,409);assert.equal(refused.body.notSent,true);assert.equal(writes.length,n,'fresh global heartbeat cannot authorize an old exact-pane screen');
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({widths:[320,390,430,1280],sequentialChoices:true,duplicateBlocked:true,uncertainRetryBlocked:true,stalePaneBlocked:true,terminalWriteIsNotConfirmation:true,privateDataUsed:false},null,2));
});
