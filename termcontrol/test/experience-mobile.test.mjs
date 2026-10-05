import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

// Full synthetic work scene; no production transcripts, tasks or calendar calls.
const html=fs.readFileSync(new URL('../app/index.html',import.meta.url),'utf8');
const out=path.resolve('.captures/termcontrol-mobile/dark');fs.mkdirSync(out,{recursive:true});
const fixedNow=Date.parse('2026-10-04T09:14:00Z');
const pane={id:'demo-day',project:'freelance-desk',provider:'claude',cwd:'/synthetic/freelance-desk',task:'היום וההצעה ל־North Studio',turn:'waiting',updatedAt:fixedNow};
const other={id:'demo-payments',project:'freelance-desk',provider:'codex',task:'בדיקת בקשות ותשלומים',lastLine:'פרטי החשבונית מוכנים לבדיקה',turn:'idle',updatedAt:fixedNow-600000};
const notes={id:'demo-notes',project:'studio-notes',provider:'opencode',task:'ארגון מסמכי הפרויקט',lastLine:'סיכום הפגישה נשמר בטיוטה',turn:'working',updatedAt:fixedNow-180000};
const panes=[pane,other,notes];
const question={id:'demo-question-1',sourceId:'demo-question',kind:'question',header:'הצעד הבא',title:'מה תרצה לקדם עכשיו?',questionIndex:0,questionCount:1,customAnswerSupported:true,options:[{key:'1',label:'טיוטה ל־North Studio',detail:'להכין נוסח לבדיקה, ללא שליחה'},{key:'2',label:'בדיקת התשלום',detail:'לבדוק את הפרטים הקיימים'}]};
const events=[{kind:'user',text:'מה קורה היום עם ההצעה והתשלום?',at:'2026-10-04T09:09:00Z'},{kind:'notice',text:'Planning check blocked: 2 open items still need review.',details:'Synthetic planning gate details',at:'2026-10-04T09:10:00Z'},{kind:'assistant',text:'יש ארבעה מקטעים מתוזמנים להיום.\n\nהטיוטה ל־North Studio עדיין פתוחה. התשלום של Atlas ממתין לבדיקה. לא שיניתי את הלו״ז.',at:'2026-10-04T09:12:00Z'}];
const desk={available:true,source:'Live Timeline',generated:'2026-10-04T09:10:00',day:'2026-10-04',stale:false,fixed_blocks:[{date:'2026-10-04',time:'09:30–10:30',what:'טיוטת הצעה ל־North Studio',note:'מיקוד בתכולה ובשלבי העבודה',source:'N-demo-proposal'},{date:'2026-10-04',time:'14:00–14:30',what:'בדיקת התשלום של Atlas',note:'הסכום והסטטוס עדיין דורשים בדיקה',source:'N-demo-payment'}],calendar_events:[{date:'2026-10-04',time:'11:00',title:'שיחת עדכון עם הלקוח'},{date:'2026-10-04',time:'15:30',title:'בדיקת תוצרים'}],calendar:{available:true,stale:false,checkedAt:'2026-10-04T09:10:00Z'},today:[{id:'N-demo-proposal',title:'טיוטת ההצעה',status:'open',due:'2026-10-04',note:'לבדיקה לפני שליחה'},{id:'N-demo-payment',title:'בדיקת התשלום',status:'waiting',due:'2026-10-04',note:'ממתין לאישור הפרטים'}],overdue:[{id:'N-demo-brief',title:'השלמת פרטי הבריף',status:'deferred',due:'2026-10-03',note:'חסר מידע מהלקוח'}],week:[],later:[],undated:[],gaps:['FlowState is not included in this export.']};

function noOverflow(page){return page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1 && document.querySelector('main').scrollWidth<=document.querySelector('main').clientWidth+1);}
async function targets(page){const small=await page.evaluate(()=>[...document.querySelectorAll('button,summary')].filter(el=>el.checkVisibility() && !el.closest('[hidden]')).filter(el=>{const r=el.getBoundingClientRect();return r.width<43.9 || r.height<43.9;}).map(el=>({text:el.textContent.trim(),w:el.getBoundingClientRect().width,h:el.getBoundingClientRect().height})));assert.deepEqual(small,[],'visible controls have 44 px touch targets');}

test('coherent agent navigation, inline requests and recorded day in Hebrew and English',async()=>{
 const browser=await chromium.launch();try{
  for(const width of [320,390,430,1280]){
   const context=await browser.newContext({viewport:{width,height:900},locale:width===1280?'en-GB':'he-IL',isMobile:width<600,hasTouch:width<600});const page=await context.newPage();let supported=true,sends=0,feedReads=0,feedEvents=events;
   await page.addInitScript(now=>{Date.now=()=>now;window.__copied='';Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__copied=text;}}});},fixedNow);
   await page.route('http://termcontrol.design/**',async route=>{
    const url=new URL(route.request().url());let data;
    if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:html.replace('<body>',`<body><div style="flex:none;padding:4px;text-align:center;font:12px/1.4 system-ui;background:#232320;color:#9a9993">${width===1280?'Demonstration · synthetic data':'הדגמה · נתונים סינתטיים'}</div>`)});
    if(url.pathname==='/api/panes')data={panes,groups:[{project:'freelance-desk',panes:[pane,other]},{project:'studio-notes',panes:[notes]}],daemon:true,view:'projects'};
    else if(url.pathname==='/api/feed'){feedReads++;data={pane,desk:true,ask:{...question,customAnswerSupported:supported},events:feedEvents,reachedStart:true};}
    else if(url.pathname==='/api/desk')data=desk;
    else if(url.pathname==='/api/send'){sends++;data={error:'That request changed. Refresh and review it again.',notSent:true};}
    else data={};return route.fulfill({json:data});
   });
   await page.goto('http://termcontrol.design/');await page.waitForSelector('.pane');
   assert.equal(await page.locator('.pane').count(),3);assert.ok(await noOverflow(page));await targets(page);
   await page.screenshot({path:path.join(out,`agents-${width}.png`),fullPage:true});
   assert.equal(await page.locator('.agent-search,.brand-mark,.view-tabs,.session-meta').count(),0,'no extra navigation chrome');assert.equal(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor),'rgb(20, 19, 18)');
   await page.locator('.pane[data-id=demo-day]').click();await page.waitForSelector('main > .askbox');
   assert.equal(await page.locator('body > .askbox').count(),0);assert.equal(await page.locator('.terminal-tools').isVisible(),false);assert.ok(await noOverflow(page));await targets(page);
   await page.locator('main').evaluate(el=>el.scrollTop=el.scrollHeight);
   await page.screenshot({path:path.join(out,`conversation-${width}.png`),fullPage:true});
   await page.locator('.msg.assistant .copy-message').click();assert.equal(await page.evaluate(()=>window.__copied),events[2].text);assert.equal(sends,0);
   await page.locator('[data-mode=today]').click();await page.waitForSelector('.desk-agenda');assert.equal(await page.locator('.agenda-row').count(),4);assert.equal(await page.locator('.askbox').count(),0);assert.ok(await noOverflow(page));await targets(page);
   await page.screenshot({path:path.join(out,`day-${width}.png`),fullPage:true});
   await page.locator('.modeswitch [data-mode=chat]').click();await page.waitForSelector('.asktoggle');await page.locator('.asktoggle').click();assert.equal(await page.locator('.askbody').isVisible(),false);await page.locator('.modeswitch [data-mode=today]').click();await page.waitForSelector('.desk-agenda');await page.locator('.pending-answer').click();await page.waitForSelector('main > .askbox');assert.equal(await page.locator('[data-choice="1"]').evaluate(el=>el===document.activeElement),true,'Pending answer opens choices and focuses a genuine choice without submitting');
   if(width<600){
    await page.locator('.typeinstead').click();const field=page.locator('.custom-answer textarea');const draft='אבחר בטיוטה, אבל בדוק את הדרישות קודם.\nCheck scope at 10:30.';await field.fill(draft);await field.press('Control+a');assert.equal(await field.evaluate(el=>el.selectionEnd-el.selectionStart),draft.length);
    const before=feedReads;feedEvents=[...events.slice(0,2),{...events[2],text:events[2].text+'\nעדכון נוסף התקבל.'}];await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.waitForFunction(()=>Boolean(document.querySelector('.custom-answer textarea')));await page.waitForResponse(r=>r.url().includes('/api/feed'));assert.ok(feedReads>before);assert.equal(await field.inputValue(),draft,'polling keeps the request draft');
    await page.setViewportSize({width,height:520});
    try{await page.waitForFunction(()=>{const r=document.querySelector('.custom-actions [type=submit]')?.getBoundingClientRect();return r && r.top>=0 && r.bottom<=innerHeight;},{},{timeout:3000});}catch(error){await page.screenshot({path:path.join(out,`keyboard-failed-${width}.png`)});fs.writeFileSync(path.join(out,'keyboard-debug.json'),JSON.stringify(await page.evaluate(()=>({height:innerHeight,visual:visualViewport.height,body:document.body.getBoundingClientRect().toJSON(),main:document.querySelector('main').getBoundingClientRect().toJSON(),focused:document.activeElement.outerHTML,send:document.querySelector('.custom-actions [type=submit]').getBoundingClientRect().toJSON(),scroll:document.querySelector('main').scrollTop})),null,2));throw error;}
    assert.ok(await noOverflow(page));await targets(page);
    await page.screenshot({path:path.join(out,`keyboard-${width}.png`),fullPage:true});
    await field.press('Escape');await page.waitForFunction(()=>document.querySelector('.custom-answer')?.hidden);assert.equal(sends,0);
    await page.setViewportSize({width,height:900});
   }
   supported=false;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.waitForSelector('.unsupported-answer');assert.equal(await page.locator('.typeinstead').isDisabled(),true);assert.equal(sends,0,'unverified custom dispatch is not offered');
   await page.locator('main').evaluate(el=>el.scrollTop=el.scrollHeight);await page.screenshot({path:path.join(out,`live-gate-${width}.png`),fullPage:true});
   await page.locator('[data-choice="1"]').click();await page.waitForFunction(()=>document.querySelector('.askresult')?.textContent.match(/question changed|השאלה השתנתה/));assert.equal(await page.locator('.approvalmsg').count(),0);if(width===390)await page.screenshot({path:path.join(out,'failed-choice-390.png'),fullPage:true});
   await page.locator('.back').click();await page.waitForSelector('.pane');assert.equal(await page.locator('.pane').count(),3);assert.equal(sends,1);
   await context.close();
  }
 }finally{await browser.close();}
});
