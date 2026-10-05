import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const app = fs.readFileSync(process.env.TC_APP_SOURCE || new URL('../app/index.html', import.meta.url), 'utf8');
const out = path.resolve(process.env.TC_VISUAL_DIR || '.captures/termcontrol-mobile');
fs.mkdirSync(out, { recursive: true });
const pane = { id: 'fixture-desk', project: 'freelance-desk', provider: 'claude', cwd: '/fixture/freelance-desk', turn: 'waiting', updatedAt: Date.now() };
const table = '| Time | Work | Outcome |\n|---|---|---|\n| 09:30–10:15 | סקירת הצעה · Review | טיוטה לבדיקה |\n| 11:00 | שיחה עם הלקוח | החלטה על הצעד הבא |';
const userText = 'הנה עדכון על ההצעה\nReview tomorrow\n\n' + table;
const ask = { id: 'claude:fixture:q1', kind: 'question', title: 'איזו הצעה להכין קודם?', header: 'הצעה', options: [{key:'1',label:'להכין טיוטה',detail:'נבחן את הטיוטה לפני שליחה'},{key:'2',label:'לבדוק את הדרישות',detail:'נשלים את המידע החסר'}] };
const desk = { available:true, generated:'2026-10-04T09:12:00', day:'2026-10-04', stale:false, source:'Live Timeline', gaps:['FlowState is not included in this export.'], calendar:{available:true,stale:false,checkedAt:'2026-10-04T09:10:00Z'}, fixed_blocks:[{date:'2026-10-04',time:'09:30–10:15',what:'סקירת הצעה · Review',note:'טיוטה לבדיקה',source:'N-fixture'}], calendar_events:[{date:'2026-10-04',time:'11:00',title:'שיחה עם הלקוח'}], today:[{id:'N-today',title:'הכנת הצעה',status:'open',due:'2026-10-04',note:'ממתין להחלטה'}], overdue:[{id:'N-overdue',title:'בדיקת פרטים',status:'deferred',due:'2026-10-03',note:'חסר מידע'}], week:[],later:[],undated:[] };

test('mobile fixture: native day, readable conversation, copy and safe choices', async () => {
 const browser = await chromium.launch();
 try {
  for (const width of [320,390,430,1280]) {
   const context = await browser.newContext({viewport:{width,height:900},hasTouch:width<600,isMobile:width<600});
   const page = await context.newPage(); let sends=0; let question=ask; let failure=false; let deskResponse=desk;
   await page.addInitScript(() => { window.__copied=''; Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__copied=text;}}}); });
   await page.route('http://termcontrol.test/**', async route => {
    const u = new URL(route.request().url()); let data;
    if (u.pathname==='/') return route.fulfill({contentType:'text/html',body:app});
    if(u.pathname==='/api/feed') data={pane,desk:true,ask:question,events:[{kind:'user',text:userText,at:'2026-10-04T09:00:00Z'},{kind:'assistant',text:'הצעה להמשך\n\n'+table,at:'2026-10-04T09:01:00Z'}],reachedStart:true};
    else if(u.pathname==='/api/desk') data=deskResponse;
    else if(u.pathname==='/api/panes') data={panes:[pane],groups:[],daemon:true,view:{order:[pane.id]}};
    else if(u.pathname==='/api/prefs') data={};
    else if(u.pathname==='/api/send') {sends++; data=failure?{error:'The terminal refused the answer.'}:{ok:true,sentAt:Date.now()}; if(!failure) question=null;}
    else data={screen:''};
    return route.fulfill({json:data});
   });
   await page.goto('http://termcontrol.test/#fixture-desk');
   await page.waitForSelector('.msg');
   await page.locator('main').evaluate(el=>el.scrollTop=0);
   await page.screenshot({path:path.join(out,`${process.env.TC_BASELINE?'before':'after'}-chat-${width}.png`),fullPage:true});
   if (process.env.TC_BASELINE) {await context.close();continue;}
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1 && document.querySelector('main').scrollWidth<=document.querySelector('main').clientWidth+1),`chat fits ${width}px`);
   assert.equal(await page.locator('.msg.user table').count(),1,'user tables render as native rows');
   assert.equal(await page.locator('.msg.user .text-line').nth(0).getAttribute('dir'),'rtl');
   assert.equal(await page.locator('.msg.user .text-line').nth(1).getAttribute('dir'),'ltr');
   assert.equal(await page.locator('[data-choice="1"]').evaluate(el=>getComputedStyle(el).direction),'rtl');
   if(width===390){await page.locator('.asktoggle').click();await page.screenshot({path:path.join(out,'after-chat-reading-390.png'),fullPage:true});await page.locator('.asktoggle').click();}
   const copy=page.locator('.msg.user .copy-message');
   await copy.click();
   assert.equal(await page.evaluate(()=>window.__copied),userText,'copy contains original Markdown, no UI labels');
   await copy.click(); assert.equal(await page.evaluate(()=>window.__copied),userText);
   assert.equal(sends,0,'copy cannot answer a question');
   assert.match(await page.locator('.copy-status').first().innerText(),/Copied/);
   await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new Error('denied')}}}));
   await copy.click();
   const fallback=page.locator('.copy-fallback textarea');
   assert.equal(await fallback.inputValue(),userText);
   assert.ok(await fallback.evaluate(el=>el.selectionEnd-el.selectionStart)>0,'fallback selects actual text');
   if(width===390)await page.screenshot({path:path.join(out,'after-copy-fallback-390.png'),fullPage:true});
   assert.match(await page.locator('.copy-status').first().innerText(),/Select|select/);
   assert.equal(await page.locator('.msg.user .bubble').evaluate(el=>getComputedStyle(el).userSelect),'text');
   assert.equal(await copy.getAttribute('aria-label'),'Copy message');
   const target=await copy.boundingBox();assert.ok(target.height>=44 && target.width>=44);
   await page.locator('.copy-fallback button').click();
   await page.getByRole('button',{name:'Today',exact:true}).click();
   await page.waitForSelector('.desk-agenda');
   assert.match(await page.locator('.desk-agenda').innerText(),/09:30/);
   await page.locator('.desk-bucket').filter({has:page.getByText('Overdue',{exact:false})}).first().locator('summary').click();
   assert.match(await page.locator('.desk-view').innerText(),/N-overdue/);
   assert.equal(await page.locator('.desk-view input[type=checkbox]').count(),0,'viewer cannot mutate tasks');
   await page.screenshot({path:path.join(out,`after-agenda-${width}.png`),fullPage:true});
   const overflow=await page.evaluate(()=>Math.max(document.documentElement.scrollWidth-innerWidth,document.querySelector('main').scrollWidth-document.querySelector('main').clientWidth));
   assert.ok(overflow<=1,`no horizontal overflow at ${width}: ${overflow}`);
   if(width===390){
    deskResponse={available:false,error:'The timeline could not be read.'};await page.locator('[data-desk-refresh]').click();await page.getByText('The timeline could not be read.',{exact:true}).waitFor();
    deskResponse={...desk,fixed_blocks:[],calendar_events:[],today:[],overdue:[]};await page.locator('[data-desk-refresh]').click();await page.getByText('No scheduled blocks are recorded for this date.',{exact:true}).waitFor();assert.ok(await page.getByText('No items in this snapshot.',{exact:true}).count()>0);
   }
   await page.getByRole('button',{name:'Chat',exact:true}).click();
   await page.waitForSelector('main > .askbox');
   assert.equal(await page.locator('main > .askbox').count(),1,'question belongs to the conversation');
   failure=true;
   await page.locator('[data-choice="1"]').click();
   await page.waitForFunction(()=>document.querySelector('.askresult')?.textContent.includes('refused'));
   assert.equal(await page.locator('.approvalmsg').count(),0,'failure does not create a successful answer');
   failure=false;
   await page.locator('[data-choice="1"]').evaluate(el=>{el.click();el.click();});
   await page.waitForSelector('.approvalmsg');
   assert.equal(sends,2,'repeated click sends once after an explicit refusal');
   await context.close();
  }
 } finally { await browser.close(); }
});

test('custom answer editor preserves bilingual drafts, local back and real acknowledgment states',{skip:Boolean(process.env.TC_BASELINE)},async()=>{
 const browser=await chromium.launch();
 try {
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const q={...ask,sourceId:'two-question-call',questionIndex:0,questionCount:2};
  let sends=0,fail=true,receipt=null,results=[],question=q,received=null;
  await page.route('http://termcontrol.test/**',async route=>{
   const u=new URL(route.request().url());let data;
   if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:app});
   if(u.pathname==='/api/feed')data={pane,desk:true,ask:question,answerReceipt:receipt,questionResults:results,events:[{kind:'assistant',text:'נבחן את ההצעה של Studio North ב־09:30.\n\n`src/brief.ts`\nhttps://example.test/brief',at:'2026-10-04T09:00:00Z'}],reachedStart:true};
   else if(u.pathname==='/api/send'){
    sends++;const payload=route.request().postDataJSON();
    if(payload.askId!==question?.id)data={error:'That question is no longer active.',notSent:true};
    else if(fail)data={error:'The text field could not be verified. Nothing was sent.',notSent:true};
    else{received=payload;receipt={state:'sent'};data={ok:true,delivery:'terminal',sentAt:Date.now()};}
   }else data={};
   return route.fulfill({json:data});
  });
  await page.goto('http://termcontrol.test/#fixture-desk');await page.waitForSelector('.askbox');
  await page.getByRole('button',{name:'Write my answer'}).click();
  const editor=page.locator('.custom-answer textarea'),send=page.getByRole('button',{name:'Send answer',exact:true});
  await editor.fill('   ');assert.equal(await send.isDisabled(),true);
  const text='אבחר בטיוטה של Studio North.\nCheck scope at 09:30–10:15.\nשלום, hello — https://example.test/brief\n'+('פירוט עם English · '.repeat(35));
  await editor.fill(text);assert.equal(await editor.evaluate(el=>el.dir),'auto');
  await editor.press('Control+a');assert.equal(await editor.evaluate(el=>el.selectionEnd-el.selectionStart),text.length);await editor.fill(text);
  await page.getByRole('button',{name:'Back to choices'}).click();await page.waitForFunction(()=>document.querySelector('.custom-answer')?.hidden);
  assert.equal(sends,0,'local cancel does not send Escape or decline');
  await page.getByRole('button',{name:'Write my answer'}).click();assert.equal(await editor.inputValue(),text);
  await editor.press('Escape');await page.waitForFunction(()=>document.querySelector('.custom-answer')?.hidden);assert.equal(sends,0);
  await page.getByRole('button',{name:'Write my answer'}).click();await page.goBack();await page.waitForFunction(()=>document.querySelector('.custom-answer')?.hidden);assert.equal(sends,0);
  await page.getByRole('button',{name:'Write my answer'}).click();await page.setViewportSize({width:390,height:520});
  await page.waitForFunction(()=>{const button=document.querySelector('.custom-actions [type=submit]'),rect=button?.getBoundingClientRect();return rect && rect.top>=0 && rect.bottom<=innerHeight;});
  assert.equal(await page.getByRole('button',{name:'Write my answer'}).isVisible(),false);
  assert.equal(await page.locator('.composer textarea').isVisible(),false,'the question editor has one answer field');
  assert.equal(await page.locator('.askheading bdi[dir=ltr]').innerText(),'1 / 2');
  const sendBox=await send.boundingBox();assert.ok(sendBox.y>=0 && sendBox.y+sendBox.height<=520,'send remains reachable above the keyboard');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'keyboard editor fits the viewport');
  await page.screenshot({path:path.join(out,'after-custom-keyboard-390.png'),fullPage:true});
  await send.click();await page.waitForFunction(()=>document.querySelector('.askresult')?.textContent.includes('Nothing was sent'));
  assert.equal(await editor.inputValue(),text);assert.equal(await page.locator('.approvalmsg').count(),0);
  fail=false;await send.evaluate(el=>{el.click();el.click();});await page.waitForSelector('.approvalmsg');
  assert.equal(sends,2,'one refused attempt and one request-bound retry');assert.equal(received.answer,text);assert.equal(received.askId,q.id);
  assert.match(await page.locator('.approvalmsg .delivery-note').innerText(),/awaiting agent confirmation/);
  await page.reload();await page.waitForSelector('.askbox');assert.equal(await page.locator('[data-choice]').count(),0,'reconnect cannot send the same answer again');
  results=[{sourceId:q.sourceId,declined:false,text:JSON.stringify({answers:{[q.title]:text}})}];question=null;
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await page.waitForFunction(()=>document.querySelector('.approvalmsg .delivery-note')?.textContent.includes('Confirmed'));
  assert.equal(sends,2,'read-back never repeats the answer');
  await page.locator('.approvalmsg .copy-message').click();
  const approvalFallback=page.locator('.approvalmsg .copy-fallback textarea');
  if(await approvalFallback.count()){assert.equal(await approvalFallback.inputValue(),text,'copy excludes answer UI labels');await page.locator('.approvalmsg .copy-fallback button').click();}
  const composer=page.locator('.composer textarea');await composer.fill('שלום לעולם\nEnglish editing');assert.equal(await composer.evaluate(el=>getComputedStyle(el).direction),'rtl');
  await composer.fill('English first\nשלום לעולם');assert.equal(await composer.evaluate(el=>getComputedStyle(el).direction),'ltr');
  await composer.evaluate(el=>el.blur());await page.setViewportSize({width:390,height:844});await page.locator('main').evaluate(el=>el.scrollTop=el.scrollHeight);
  await page.screenshot({path:path.join(out,'after-answer-confirmed-390.png'),fullPage:true});
 }finally{await browser.close();}
});
