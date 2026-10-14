import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';

const html=fs.readFileSync(new URL('../app/index.html',import.meta.url),'utf8');
const pane=(id,sessionId=id)=>({id,sessionId,title:`Chat ${id}`,project:`Project ${id}`,provider:'codex',turn:'idle',alive:true});
async function fixture(browser,{rtl=false,width=390,light=false,reduced=false}={}){
 const page=await browser.newPage({viewport:{width,height:844},hasTouch:true,locale:rtl?'he-IL':'en-US',reducedMotion:reduced?'reduce':'no-preference'});
 const state={panes:[pane('a'),pane('b'),pane('c')],reads:0,hold:null,previews:0,visits:[],errors:[]};
 page.on('pageerror',e=>state.errors.push(e.message));
 await page.addInitScript(light=>localStorage.setItem('termcontrol-theme',light?'light':'dark'),light);
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:html});
  if(url.pathname==='/api/panes'){state.reads++;if(state.hold)await state.hold;return route.fulfill({json:{daemon:true,panes:state.panes,view:'manual'}});}
  if(url.pathname==='/api/feed'){
   const id=url.searchParams.get('pane');if(id==='b')state.previews++;
   return route.fulfill({json:{pane:pane(id),events:Array.from({length:28},(_,i)=>({kind:i%2?'user':'assistant',text:`${id} message ${i}\n\n${'Readable conversation. '.repeat(16)}`,at:Date.now()-30000+i*1000})),reachedStart:true}});
  }
  if(url.pathname==='/api/visit'){state.visits.push(route.request().postDataJSON().pane);return route.fulfill({json:{ok:true}});}
  return route.fulfill({json:{}});
 });
 await page.goto('https://termcontrol.test/');await page.locator('.pane[data-id="a"]').click();await page.locator('.composer textarea').waitFor();
 await page.waitForTimeout(60);return {page,state};
}
async function pointer(page,type,{dx=0,dy=0,id=8,primary=true,x=190,y=280,selector='#main'}={}){
 await page.evaluate(async({type,dx,dy,id,primary,x,y,selector})=>{
  document.querySelector(selector).dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:id,pointerType:'touch',isPrimary:primary,button:0,clientX:x+dx,clientY:y+dy}));
  if(type==='pointermove')await new Promise(requestAnimationFrame);
 },{type,dx,dy,id,primary,x,y,selector});
}
const translate=page=>page.locator('#main').evaluate(el=>new DOMMatrixReadOnly(getComputedStyle(el).transform).m41);
const clean=page=>page.waitForFunction(()=>!document.querySelector('.chat-navigation-preview')&&getComputedStyle(document.querySelector('#main')).transform==='none');
const inChat=(page,id)=>page.waitForFunction(id=>location.hash==='#'+id&&document.querySelector('.composer')?.dataset.recipient===id,id);

test('before release, the live chat follows the finger and one adjacent preview is reused',async()=>{
 const browser=await chromium.launch();try{
  for(const rtl of [false,true]){
   const {page,state}=await fixture(browser,{rtl});const sign=rtl?1:-1;
   await page.locator('.composer textarea').fill('still bound to a');
   await pointer(page,'pointerdown');await pointer(page,'pointermove',{dx:sign*62});await page.waitForTimeout(25);
   assert.ok(Math.abs((await translate(page))-sign*62)<2,'chat must move before release');
   assert.equal(new URL(page.url()).hash,'#a');assert.equal(await page.locator('.composer').getAttribute('data-recipient'),'a');
   await page.locator('.chat-navigation-preview').filter({hasText:'b message'}).waitFor();
   await page.evaluate(()=>{window.swipeMainNode=document.querySelector('#main .msg');window.swipePreview=document.querySelector('.chat-navigation-preview');window.swipeChanges=0;window.swipeObserver=new MutationObserver(r=>window.swipeChanges+=r.filter(e=>e.type==='childList').length);window.swipeObserver.observe(window.swipePreview,{subtree:true,childList:true});});
   for(const n of [75,87,102,124])await pointer(page,'pointermove',{dx:sign*n});
   await page.waitForTimeout(25);assert.ok(Math.abs((await translate(page))-sign*124)<2);
   assert.deepEqual(await page.evaluate(()=>({sameMain:window.swipeMainNode===document.querySelector('#main .msg'),samePreview:window.swipePreview===document.querySelector('.chat-navigation-preview'),changes:window.swipeChanges})),{sameMain:true,samePreview:true,changes:0});
   assert.equal(state.previews,1);assert.equal(state.visits.filter(id=>id==='b').length,0);
   await pointer(page,'pointerup',{dx:sign*124});await inChat(page,'b');await clean(page);assert.equal(state.errors.length,0);await page.close();
  }
 }finally{await browser.close();}
});

test('short swipe snaps back, while stale target verification leaves the source and draft intact',async()=>{
 const browser=await chromium.launch();try{
  const {page,state}=await fixture(browser);await page.locator('.composer textarea').fill('draft a');
  const top=await page.locator('#main').evaluate(el=>{el.scrollTop=400;el.dispatchEvent(new Event('scroll'));return el.scrollTop;});
  await pointer(page,'pointerdown');await pointer(page,'pointermove',{dx:-64});await page.waitForTimeout(25);assert.ok(await translate(page)<-50);
  await pointer(page,'pointerup',{dx:-64});await page.waitForTimeout(40);assert.ok((await translate(page))>-64 && (await translate(page))<0,'snapback has visible progress');await clean(page);assert.equal(new URL(page.url()).hash,'#a');assert.equal(await page.locator('#main').evaluate(el=>el.scrollTop),top);
  state.panes=[pane('a'),pane('b','recycled'),pane('c')];await pointer(page,'pointerdown');await pointer(page,'pointermove',{dx:-150});await pointer(page,'pointerup',{dx:-150});
  await page.locator('.chat-navigation-notice').waitFor();await clean(page);assert.equal(new URL(page.url()).hash,'#a');assert.equal(await page.locator('.composer textarea').inputValue(),'draft a');assert.equal(state.errors.length,0);
 }finally{await browser.close();}
});

test('scroll, cancellation, lost pointer, interrupted view and multiple fingers clear transforms',async()=>{
 const browser=await chromium.launch();try{
  const {page,state}=await fixture(browser);
  for(const reason of ['vertical','scroll','cancel','lost','blur','second','selection','mode']){
   await pointer(page,'pointerdown');await pointer(page,'pointermove',{dx:-110});await page.waitForTimeout(25);assert.ok(await translate(page)<-80,reason);
   if(reason==='vertical')await pointer(page,'pointermove',{dx:-110,dy:100});
   if(reason==='scroll')await page.locator('#main').evaluate(el=>{el.scrollTop-=20;el.dispatchEvent(new Event('scroll'));});
   if(reason==='cancel')await pointer(page,'pointercancel',{dx:-110});
   if(reason==='lost')await pointer(page,'lostpointercapture',{dx:-110});
   if(reason==='blur')await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
   if(reason==='second')await pointer(page,'pointerdown',{id:9,primary:false});
   if(reason==='selection')await page.evaluate(()=>{const r=document.createRange();r.selectNodeContents(document.querySelector('.bubble p'));getSelection().addRange(r);document.dispatchEvent(new Event('selectionchange'));});
   if(reason==='mode')await page.evaluate(()=>{const m=document.querySelector('.composer-menu');if(m)m.open=true;}).then(()=>page.locator('[data-mode="screen"]').click());
   await pointer(page,'pointerup',{dx:-110});await clean(page);assert.equal(new URL(page.url()).hash,'#a',reason);
   await page.evaluate(()=>getSelection().removeAllRanges());if(reason==='mode')await page.evaluate(()=>{const m=document.querySelector('.composer-menu');if(m)m.open=true;}).then(()=>page.locator('[data-mode="chat"]').click());
  }
  assert.equal(state.errors.length,0);
 }finally{await browser.close();}
});

test('repeated swipes during validation cannot commit after the gesture is interrupted',async()=>{
 const browser=await chromium.launch();try{
  const {page,state}=await fixture(browser);let release;state.hold=new Promise(r=>release=r);const before=state.reads;
  await pointer(page,'pointerdown');await pointer(page,'pointermove',{dx:-150});await pointer(page,'pointerup',{dx:-150});await page.waitForTimeout(25);
  assert.ok(await translate(page)<-100,'retain the drag while checking the destination');
  await pointer(page,'pointerdown');await pointer(page,'pointermove',{dx:-150});await pointer(page,'pointerup',{dx:-150});release();state.hold=null;
  await clean(page);await page.waitForTimeout(220);assert.equal(new URL(page.url()).hash,'#a');assert.equal(state.reads,before+1);assert.equal(state.visits.filter(id=>id==='b').length,0);assert.equal(state.errors.length,0);
 }finally{await browser.close();}
});

test('direction reversal follows back through zero and the opposite neighbor; list boundaries resist',async()=>{
 const browser=await chromium.launch();try{
  const {page,state}=await fixture(browser);await page.locator('[data-chat-step="1"]').click();await inChat(page,'b');
  await pointer(page,'pointerdown');await pointer(page,'pointermove',{dx:-80});await page.waitForTimeout(25);assert.match(await page.locator('.chat-navigation-preview').innerText(),/Chat c/);
  await pointer(page,'pointermove',{dx:-5});await page.waitForTimeout(25);assert.ok(Math.abs((await translate(page))+5)<2);
  await pointer(page,'pointermove',{dx:120});await page.waitForTimeout(25);assert.ok(await translate(page)>110);assert.match(await page.locator('.chat-navigation-preview').innerText(),/Chat a/);
  await pointer(page,'pointerup',{dx:120});await page.waitForTimeout(40);assert.equal(new URL(page.url()).hash,'#b','commit animates before changing recipients');await inChat(page,'a');await clean(page);
  await pointer(page,'pointerdown');await pointer(page,'pointermove',{dx:140});await page.waitForTimeout(25);assert.ok((await translate(page))>0 && (await translate(page))<32);assert.equal(await page.locator('.chat-navigation-preview').count(),0);
  await pointer(page,'pointerup',{dx:140});await clean(page);assert.equal(new URL(page.url()).hash,'#a');assert.equal(state.errors.length,0);
 }finally{await browser.close();}
});

test('native touch scrolling wins and native horizontal touch has visible progress',async()=>{
 const browser=await chromium.launch();try{
  const {page,state}=await fixture(browser);const cdp=await page.context().newCDPSession(page);
  const touch=(type,x,y)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x,y,id:1}]});
  await touch('touchStart',190,350);await touch('touchMove',115,352);await page.waitForTimeout(30);assert.ok(await translate(page)<-60);await touch('touchEnd');await clean(page);assert.equal(new URL(page.url()).hash,'#a');
  const top=await page.locator('#main').evaluate(el=>el.scrollTop);await touch('touchStart',190,300);await touch('touchMove',188,420);await touch('touchEnd');await page.waitForTimeout(200);assert.notEqual(await page.locator('#main').evaluate(el=>el.scrollTop),top);await clean(page);assert.equal(new URL(page.url()).hash,'#a');assert.equal(state.errors.length,0);
 }finally{await browser.close();}
});

test('reduced motion keeps a stationary preview and preserves navigation in both directions',async()=>{
 const browser=await chromium.launch();try{
  for(const rtl of [false,true]){
   const {page,state}=await fixture(browser,{rtl,width:320,reduced:true});const dx=rtl?125:-125;
   await pointer(page,'pointerdown',{x:160});await pointer(page,'pointermove',{x:160,dx});await page.waitForTimeout(25);
   assert.equal(await translate(page),0);assert.match(await page.locator('.chat-navigation-preview').innerText(),/Chat b/);
   await pointer(page,'pointerup',{x:160,dx});await inChat(page,'b');await clean(page);assert.equal(state.errors.length,0);await page.close();
  }
 }finally{await browser.close();}
});

test('phone-width dark/light RTL/LTR progress, snapback and commit screenshots',async()=>{
 const browser=await chromium.launch();try{
  const dir=new URL('../../../screens/',import.meta.url);fs.mkdirSync(dir,{recursive:true});
  for(const [width,rtl,light] of [[390,false,false],[390,true,true],[320,false,true],[320,true,false]]){
   const {page,state}=await fixture(browser,{width,rtl,light});const x=width/2,dx=rtl?145:-145,name=`${width}-${rtl?'rtl':'ltr'}-${light?'light':'dark'}`;
   await page.screenshot({path:new URL(`${name}-rest.png`,dir).pathname});await pointer(page,'pointerdown',{x});await pointer(page,'pointermove',{x,dx});await page.locator('.chat-navigation-preview').filter({hasText:'b message'}).waitFor();await page.waitForTimeout(25);
   await page.screenshot({path:new URL(`${name}-drag.png`,dir).pathname});assert.equal(await page.locator('body').evaluate(el=>el.scrollWidth<=innerWidth),true);
   await pointer(page,'pointerup',{x,dx:rtl?65:-65});await clean(page);await page.screenshot({path:new URL(`${name}-snapback.png`,dir).pathname});
   await pointer(page,'pointerdown',{x});await pointer(page,'pointermove',{x,dx});await pointer(page,'pointerup',{x,dx});await inChat(page,'b');await clean(page);await page.screenshot({path:new URL(`${name}-committed.png`,dir).pathname});assert.equal(state.errors.length,0);await page.close();
  }
 }finally{await browser.close();}
});
