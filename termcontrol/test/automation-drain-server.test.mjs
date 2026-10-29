import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import net from 'node:net';
import {spawn} from 'node:child_process';import {once} from 'node:events';import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
test('isolated paused bridge drains without terminal effects and serves an exact older-question jump',{timeout:45000},async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tc-paused-server-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const config=path.join(dir,'config'),id='111111111111',folder=path.join(config,'bots',id);fs.mkdirSync(folder,{recursive:true});
 const bot={id,name:'Isolated retained question',provider:'codex',active:'codex',cwd:dir,createdAt:1,sessions:{codex:null},queued:['same words','same words','later correction']};
 fs.writeFileSync(path.join(folder,'bot.json'),JSON.stringify(bot));
 const q=(id,text)=>({id,role:'bot',text:'',at:1,question:{text,options:['Continue','Wait']}});
 const rows=[q('original-old','Which independent fixture scope should continue?'),q('already-answered','May the answered fixture continue?'),{id:'answer',role:'operator',answerTo:'already-answered',text:'Continue',at:2},
  ...Array.from({length:310},(_,i)=>({id:'progress-'+i,role:'bot',text:'Later fixture progress '+i,at:3+i}))];
 fs.writeFileSync(path.join(folder,'chat.jsonl'),rows.map(JSON.stringify).join('\n')+'\n');
 const botBefore=fs.readFileSync(path.join(folder,'bot.json'),'utf8'),chatBefore=fs.readFileSync(path.join(folder,'chat.jsonl'),'utf8');
 const requests=[],socket=path.join(dir,'daemon.sock');
 const daemon=net.createServer(conn=>{let raw='';conn.on('data',b=>{raw+=b;});conn.on('end',()=>{
  const r=JSON.parse(raw);requests.push(r.type);
  conn.end(JSON.stringify(r.type==='listSessions'?{type:'listSessions',sessions:[]}:{type:r.type,reachable:true,sessions:[]}));
 });});await new Promise(r=>daemon.listen(socket,r));t.after(()=>daemon.close());
 const reservation=net.createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));
 const child=spawn(process.execPath,['termcontrol/bridge/server.mjs'],{cwd:new URL('../..',import.meta.url),stdio:['ignore','ignore','ignore'],env:{...process.env,
  TC_PORT:String(port),TC_HOST:'127.0.0.1',TC_CONFIG_DIR:config,TC_BOT_CHECK_HOME:dir,TC_CODEX_HOME:dir,XDG_DATA_HOME:path.join(dir,'data'),
  TERMFLEET_DAEMON_SOCKET:socket,TC_PAUSE_AUTOMATIC_ACTIONS:'1',TC_NO_AGENT_HEALTH:'1',TC_NO_CANARY:'1',TC_NO_TERMINAL_HEALTH:'1',TC_NO_WATCHDOG:'1',TC_NO_AUTO_CLEANUP:'1',TC_NO_AUTO_SLEEP:'1',TC_NO_DOCK_ICON:'1'}});
 t.after(async()=>{if(child.exitCode===null){const exited=once(child,'exit');child.kill('SIGTERM');await exited;}});
 const origin='http://127.0.0.1:'+port;let ready=false;
 for(let n=0;n<100;n++){try{if((await fetch(origin+'/login')).ok){ready=true;break;}}catch{}if(child.exitCode!==null)break;await delay(50);}
 assert.ok(ready,'isolated bridge must start without a provider');
 const auth=await fetch(origin+'/setup',{method:'POST',redirect:'manual',headers:{'content-type':'application/x-www-form-urlencoded',origin},body:new URLSearchParams({email:'fixture@example.test',password:'disposable-fixture-only',confirm:'disposable-fixture-only'})});assert.equal(auth.status,302);
 const cookie=auth.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);
 const get=async url=>{const r=await fetch(origin+url,{headers:{cookie}});assert.equal(r.status,200);return r.json();};
 const initial=(await get('/api/action-evidence?bot_id='+id)).runtime;
 assert.equal(initial.automatic_actions.protocol,'registered-automatic-drain-v1');assert.equal(initial.automatic_actions.paused,true);
 assert.equal(initial.automatic_actions.active.length,0);
 // Only this disposable server supports the handler; never signal the legacy live PID.
 child.kill('SIGUSR2');let drained;
 for(let n=0;n<50;n++){drained=(await get('/api/action-evidence?bot_id='+id)).runtime.automatic_actions;if(drained.maintenance)break;await delay(20);}
 assert.equal(drained.maintenance.registered_callbacks_finished,true);assert.equal(drained.maintenance.registered_work_settled,false);assert.equal(drained.timers,0);
 assert.equal(drained.maintenance.bot_replies,0);assert.equal(drained.maintenance.bot_sides,0);assert.equal(drained.maintenance.restart_boundary_proven,false);
 assert.equal(fs.existsSync(path.join(config,'automatic-actions.paused')),true);
 const view=await get('/api/bot?id='+id);assert.equal(view.messages.filter(m=>m.id==='original-old').length,1);
 assert.equal(view.messages.some(m=>m.id==='already-answered'),false);assert.ok(view.messages.length>=300);
 const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
 for(const width of [390,1400]){
  const context=await browser.newContext({viewport:{width,height:860},serviceWorkers:'block'});const split=cookie.indexOf('=');await context.addCookies([{name:cookie.slice(0,split),value:cookie.slice(split+1),url:origin}]);
  const answers=[];await context.route('**/api/**',async route=>{const r=route.request(),u=new URL(r.url());
   if(r.method()!=='GET'){answers.push(u.pathname);return route.fulfill({status:403,json:{error:'Read-only fixture'}});}
   if(u.pathname==='/api/bot'){u.searchParams.delete('read');return route.continue({url:u.href});}return route.continue();});
  const page=await context.newPage();await page.goto(origin+'/#bot:'+id);
  await page.waitForSelector('.bot-unanswered:not([hidden])');await page.locator('.bot-unanswered summary').click();
  const jump=page.locator('.bot-unanswered [data-question-jump="original-old"]');await jump.waitFor();assert.equal(await jump.count(),1);await jump.click();
  assert.equal(await page.evaluate(()=>document.activeElement?.dataset.qid),'original-old');
  assert.equal(await page.locator('[data-qid="original-old"]').count(),1);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  assert.equal(answers.some(p=>/answer|provider|send/.test(p)),false);await context.close();
 }
 assert.equal(fs.readFileSync(path.join(folder,'bot.json'),'utf8'),botBefore,'pause and navigation retain original queued duplicates');
 assert.equal(fs.readFileSync(path.join(folder,'chat.jsonl'),'utf8'),chatBefore,'no question was answered, copied or retracted');
 assert.ok(requests.every(type=>['listSessions','status','getSnapshot','readSession'].includes(type)),'only synthetic daemon reads may occur: '+requests.join(','));
 assert.equal(fs.existsSync(path.join(config,'automatic-operations'))?fs.readdirSync(path.join(config,'automatic-operations')).length:0,0);
 assert.match(initial.source_sha256,/^[a-f0-9]{64}$/);assert.equal(createHash('sha256').update(chatBefore).digest('hex'),createHash('sha256').update(fs.readFileSync(path.join(folder,'chat.jsonl'))).digest('hex'));
});
