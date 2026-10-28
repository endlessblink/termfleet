import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
const file=new URL('../app/index.html',import.meta.url);
const sha=b=>createHash('sha256').update(b).digest('hex');
for(const width of [390,1400])test(`buried unanswered questions keep exact jump and answer controls at ${width}px`,{timeout:45000},async t=>{
 const html=fs.readFileSync(process.env.TC_UNANSWERED_HTML||file),app=path.dirname(fileURLToPath(file));
 const server=http.createServer((q,r)=>{
  const pathname=new URL(q.url,'http://fixture').pathname;
  if(pathname==='/'){r.writeHead(200,{'content-type':'text/html'});return r.end(html);}
  const local=path.resolve(app,pathname.replace(/^\/(?:app\/)?/,''));
  if(!local.startsWith(app+'/')||!fs.existsSync(local)){r.writeHead(404);return r.end();}
  r.writeHead(200,{'content-type':/\.m?js$/.test(local)?'text/javascript':'application/octet-stream'});r.end(fs.readFileSync(local));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
 const base=process.env.TC_UNANSWERED_LIVE_ORIGIN||`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
 const ctx=await browser.newContext({viewport:{width,height:860},serviceWorkers:'block'});
 if(process.env.TC_UNANSWERED_LIVE_ORIGIN){
  const sign=await fetch(base+'/embed',{redirect:'manual',headers:{'sec-fetch-dest':'iframe'}});
  assert.equal(sign.status,302);const cookie=sign.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);
  const ix=cookie.indexOf('=');await ctx.addCookies([{name:cookie.slice(0,ix),value:cookie.slice(ix+1),url:base}]);
  const served=await fetch(base+'/',{headers:{cookie}});assert.equal(served.status,200);assert.equal(sha(Buffer.from(await served.arrayBuffer())),sha(html));
 }
 const bots=['navigation-one','navigation-two'].map(id=>({id,name:id,provider:'codex',state:'idle',helpers:[],job:''}));
 const at=Date.now()-200000;
 let messages=[{id:'original-a',role:'bot',text:'',question:{text:'Which scope should continue?',options:['Yes','No']},at},
  {id:'unrelated',role:'operator',text:'Yes',at:at+10},
  {id:'original-b',role:'bot',text:'',question:{text:'May the independent check continue?',options:['Continue','Wait']},at:at+20},
  {id:'withdrawn',role:'bot',text:'',withdrawn:true,question:{text:'Withdrawn question',options:['One','Two']},at},
  {id:'terminal-live',role:'terminal-ask',pane:'synthetic-never-input',askId:'permission-original',kind:'permission',text:'Allow isolated fixture?',options:[{key:'1',label:'Permit'},{key:'2',label:'Refuse'}],promptState:'active',at},
  {id:'terminal-unknown',role:'terminal-ask',pane:'synthetic-unknown',askId:'unknown',promptState:'unknown',text:'Unknown old prompt',at},
  {id:'terminal-ended',role:'terminal-ask',settled:true,text:'Resolved old prompt',at},
  ...Array.from({length:45},(_,i)=>({id:'later-'+i,role:'bot',text:'Later unrelated update '+i+' with enough words to move the original question far above the composer.',at:at+100+i}))];
 const sent=[],errors=[];let disconnected=false,failAnswer=false,holdNext=false,staleStarted,releaseStale;
 await ctx.route('**/*',async route=>{
  const u=new URL(route.request().url());if(u.origin!==base)return route.abort();
  if(!u.pathname.startsWith('/api/'))return route.continue();
  if(u.pathname==='/api/bot'&&disconnected)return route.fulfill({status:503,json:{error:'Synthetic unavailable'}});
  if(u.pathname==='/api/bot'&&holdNext){holdNext=false;const snapshot=structuredClone(messages);staleStarted();await new Promise(resolve=>{releaseStale=resolve;});return route.fulfill({json:{bot:bots[0],messages:snapshot,requirements:[],asks:[],tryNow:[],details:{}}});}
  let body={ok:true,bots,panes:[],groups:[],folders:[],routines:[],skills:[],items:[],asks:[],v:'isolated-unanswered'};
  if(u.pathname==='/api/bot')body={bot:bots.find(b=>b.id===u.searchParams.get('id'))||bots[0],messages:u.searchParams.get('id')==='navigation-two'?[]:messages,requirements:[{id:'ready-test',status:'ready',words:'Ready to try task'}],asks:[],tryNow:[],details:{}};
  if(u.pathname==='/api/bot/send'){
   const post=JSON.parse(route.request().postData());if(failAnswer)return route.fulfill({status:503,json:{error:'Synthetic send failed'}});sent.push(post);
   messages.push({id:'answer-a',role:'operator',text:post.text,answerTo:post.answerTo,at:Date.now()});
  }
  return route.fulfill({json:body});
 });
 const page=await ctx.newPage();page.on('pageerror',e=>errors.push(String(e)));
 const loaded=await page.goto(base+'/#bot:navigation-one');assert.equal(sha(await loaded.body()),sha(html));
 const nav=page.locator('.bot-unanswered');
 await page.waitForSelector('[data-qid="original-a"]',{timeout:5000});
 assert.deepEqual(errors,[],'the real chat renderer loaded before checking navigation');
 await nav.waitFor({timeout:5000});
 assert.equal(await nav.locator('[data-question-jump]').count(),3);
 assert.doesNotMatch(await nav.textContent(),/Ready to try|Withdrawn|Unknown old|Resolved old/);
 const before=await nav.boundingBox();assert.ok(before.y>=0&&before.y+before.height<=860,'indicator visible while original question is buried');
 if(process.env.TC_UNANSWERED_SHOT)await page.screenshot({path:`${process.env.TC_UNANSWERED_SHOT}-${width}-closed.png`});
 await page.locator('.bot-composer textarea').fill('Unsent draft remains here');
 await nav.locator('summary').click();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'no horizontal overflow');
 if(process.env.TC_UNANSWERED_SHOT)await page.screenshot({path:`${process.env.TC_UNANSWERED_SHOT}-${width}-list.png`});
 await nav.locator('[data-question-jump="terminal-live"]').click();
 assert.equal(await page.locator('.term-ask-pinned').evaluate(el=>el.open),true);
 assert.equal(await page.locator('[data-term-ask="terminal-live"]').count(),1);
 assert.equal(await page.locator('[data-term-ask="terminal-live"]').getAttribute('data-ask'),'permission-original');
 assert.equal(await page.locator('.bot-composer textarea').inputValue(),'Unsent draft remains here');
 await nav.locator('summary').click();await nav.locator('[data-question-jump="original-a"]').click();
 const question=page.locator('[data-qid="original-a"]');
 await page.waitForFunction(()=>document.activeElement?.dataset.qid==='original-a');
 assert.equal(await question.count(),1,'one original question, no duplicate card');
 const qbox=await question.boundingBox();assert.ok(qbox.y>=0&&qbox.y<800,'jump exposes exact card');
 assert.equal(sent.length,0,'navigation never answers');
 failAnswer=true;
 await nav.locator('summary').click();await nav.locator('[data-question-jump="original-b"]').click();
 await page.locator('[data-qid="original-b"] [data-answer="Wait"]').click();
 await page.waitForFunction(()=>!document.querySelector('[data-qid="original-b"]').classList.contains('answered'));
 assert.equal(await nav.locator('[data-question-jump="original-b"]').count(),1,'failed send retains pending question');failAnswer=false;
 await question.locator('[data-answer="No"]').click();
 await page.waitForFunction(()=>!document.querySelector('.bot-unanswered [data-question-jump="original-a"]'));
 assert.equal(await nav.locator('[data-question-jump="original-b"]').count(),1);
 assert.deepEqual(sent.map(s=>({answerTo:s.answerTo,text:s.text})),[{answerTo:'original-a',text:'No'}]);
 await page.reload();await nav.waitFor();assert.equal(await nav.locator('[data-question-jump="original-a"]').count(),0);
 messages=messages.map(m=>m.id==='answer-a'?{...m,deleted:{cancelled:false}}:m);
 await page.reload();await nav.waitFor();assert.equal(await nav.locator('[data-question-jump="original-a"]').count(),0,'consumed deleted answer must not reopen approval');
 messages=messages.map(m=>m.id==='answer-a'?{...m,deleted:{cancelled:true}}:m);
 await page.reload();await nav.waitFor();assert.equal(await nav.locator('[data-question-jump="original-a"]').count(),1,'cancelled-before-consumption answer remains unanswered');
 messages=messages.map(m=>m.id==='answer-a'?{...m,deleted:{cancelled:false}}:m);
 await page.reload();await nav.waitFor();
 await page.goto(base+'/#bot:navigation-two');await page.waitForFunction(()=>document.querySelector('.bot-unanswered')?.hidden===true);
 await page.goto(base+'/#bot:navigation-one');await nav.waitFor();assert.equal(await nav.locator('[data-question-jump]').count(),2);
 disconnected=true;await page.waitForFunction(()=>document.querySelector('.bot-unanswered')?.hidden===true);
 disconnected=false;await nav.waitFor();assert.equal(await nav.locator('[data-question-jump]').count(),2);
 const staleRequest=new Promise(resolve=>{staleStarted=resolve;});holdNext=true;await staleRequest;
 messages=messages.map(m=>m.id==='original-b'?{...m,withdrawn:true}:m.id==='terminal-live'?{...m,settled:true,promptState:'resolved'}:m);
 await page.waitForFunction(()=>document.querySelector('.bot-unanswered')?.hidden===true);
 releaseStale();await page.waitForTimeout(500);
 assert.equal(await nav.isVisible(),false,'older delayed snapshot cannot restore resolved questions');
 assert.equal(sent.length,1);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({width,htmlSHA:sha(html),result:'PASS',apiScope:'all synthetic',liveHTML:Boolean(process.env.TC_UNANSWERED_LIVE_ORIGIN)}));
});
