import { serveAppModule } from './helpers/app-module-route.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';

const html=fs.readFileSync(new URL('../app/index.html',import.meta.url),'utf8');
const pane=(id,sessionId=id)=>({id,sessionId,title:`Chat ${id}`,project:`Project ${id}`,provider:'codex',turn:'idle',alive:true,updatedAt:Date.now()});
const events=Array.from({length:45},(_,i)=>({kind:'assistant',text:`Message ${i}\n\n${'Readable conversation text. '.repeat(12)}${i===10?'\n\n```js\nconst selected = true;\n```':''}`,at:Date.now()-100000+i*1000}));
async function fixture(browser,{rtl=false,width=390}={}) {
 const page=await browser.newPage({viewport:{width,height:844},locale:rtl?'he-IL':'en-US',hasTouch:true});
 const state={panes:[pane('a'),pane('b'),pane('c')],sends:[],visits:[],reads:0,hold:null,errors:[],offline:false,feedHold:new Map(),sendHold:null};
 page.on('pageerror',error=>state.errors.push(error.message));
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:html});
  if(await serveAppModule(route))return;
  if(url.pathname==='/api/panes'){state.reads++;if(state.hold)await state.hold;if(state.offline)return route.fulfill({status:503,json:{error:'offline'}});return route.fulfill({json:{daemon:true,panes:state.panes,view:'manual'}});}
  if(url.pathname==='/api/feed'){const id=url.searchParams.get('pane'),held=state.feedHold.get(id);if(held){held.started();await held.promise;return route.fulfill({status:503,json:{error:'old request'}});}return route.fulfill({json:{pane:state.panes.find(p=>p.id===id)||pane(id),events,reachedStart:true,producing:false}});}
  if(url.pathname==='/api/visit'){state.visits.push(request.postDataJSON().pane);return route.fulfill({json:{ok:true}});}
  if(url.pathname==='/api/send'){state.sends.push(request.postDataJSON());if(state.sendHold)await state.sendHold;return route.fulfill({json:{ok:true,delivered:true}});}
  return route.fulfill({json:{}});
 });
 await page.goto('https://termcontrol.test/');await page.locator('.pane[data-id="a"]').click();await page.locator('.composer textarea').waitFor();
 await page.waitForTimeout(60);
 return {page,state};
}
async function swipe(page,{dx=-135,dy=2,selector='.msg .bubble',x=190,y=280,cancel=false}={}) {
 await page.evaluate(({dx,dy,selector,x,y,cancel})=>{
  const target=document.querySelector(selector)||document.querySelector('#main');
  const fire=(type,px,py)=>target.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:8,pointerType:'touch',isPrimary:true,button:0,clientX:px,clientY:py}));
  fire('pointerdown',x,y);fire('pointermove',x+dx,y+dy);fire(cancel?'pointercancel':'pointerup',x+dx,y+dy);
 },{dx,dy,selector,x,y,cancel});
}
async function inChat(page,id){await page.waitForFunction(id=>location.hash==='#'+id && document.querySelector('.composer')?.dataset.recipient===id,id);await page.waitForTimeout(60);}

test('phone chat navigation keeps a frozen order, drafts, reading position and exact recipients',async()=>{
 const browser=await chromium.launch();try{
  const {page,state}=await fixture(browser);
  assert.equal(await page.locator('[data-chat-step="1"]').count(),1);
  assert.match(await page.locator('[data-chat-step="1"]').getAttribute('aria-label'),/Chat b/);
  await page.locator('.composer textarea').fill('draft for a');
  const scroll=await page.evaluate(()=>{const m=document.querySelector('#main');m.scrollTop=350;m.dispatchEvent(new Event('scroll'));return m.scrollTop;});assert.ok(scroll>100);
  // A background inventory reorder must not retarget the next gesture.
  state.panes=[pane('c'),pane('a'),pane('b')];
  await swipe(page);await inChat(page,'b');
  assert.equal(await page.locator('.composer textarea').inputValue(),'');
  await page.locator('.composer textarea').fill('draft for b');
  await page.locator('[data-chat-step="-1"]').click();await inChat(page,'a');
  assert.equal(await page.locator('.composer textarea').inputValue(),'draft for a');
  assert.ok(Math.abs(await page.locator('#main').evaluate(m=>m.scrollTop)-scroll)<5);
  await page.locator('[data-chat-step="1"]').click();await inChat(page,'b');
  assert.equal(await page.locator('.composer textarea').inputValue(),'draft for b');
  await page.locator('.send').click();await page.waitForFunction(()=>!document.querySelector('.composer textarea').value);
  assert.deepEqual(state.sends.map(s=>({pane:s.pane,text:s.text})),[{pane:'b',text:'draft for b'}]);
  await page.locator('[data-chat-step="1"]').click();await inChat(page,'c');
  assert.equal(await page.locator('[data-chat-step="1"]').isDisabled(),true);
  await swipe(page);assert.equal(new URL(page.url()).hash,'#c');
  assert.equal(state.errors.length,0);await page.close();
 }finally{await browser.close();}
});

test('image drafts, view mode, back navigation and pending deliveries remain attached to their chat',async()=>{
 const browser=await chromium.launch();try{
  const {page,state}=await fixture(browser);
  await page.locator('.composer textarea').fill('with image for a');
  await page.locator('.composer input[type=file]').setInputFiles({name:'fixture.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6lLQAAAAASUVORK5CYII=','base64')});
  await page.locator('.attached .name').filter({hasText:'fixture.png'}).waitFor();
  await page.evaluate(()=>{const m=document.querySelector('.composer-menu');if(m)m.open=true;}).then(()=>page.locator('[data-mode="screen"]').click());
  await page.locator('[data-chat-step="1"]').click();await inChat(page,'b');
  assert.equal(await page.locator('[data-mode="chat"]').getAttribute('aria-pressed'),'false'); // existing default mode carries to an unvisited chat
  await page.evaluate(()=>{const m=document.querySelector('.composer-menu');if(m)m.open=true;}).then(()=>page.locator('[data-mode="chat"]').click());
  assert.equal(await page.locator('.attached').isHidden(),true);
  await page.locator('.composer textarea').fill('pending for b');let releaseSend;state.sendHold=new Promise(resolve=>releaseSend=resolve);
  await page.locator('.send').click();await page.waitForFunction(()=>document.querySelector('.composer').dataset.sending==='true');
  await swipe(page);assert.equal(new URL(page.url()).hash,'#b');assert.equal(await page.locator('[data-chat-step="1"]').isDisabled(),true);
  releaseSend();state.sendHold=null;await page.waitForFunction(()=>!document.querySelector('.composer').dataset.sending);
  await page.locator('[data-chat-step="-1"]').click();await inChat(page,'a');
  assert.equal(await page.locator('[data-mode="screen"]').getAttribute('aria-pressed'),'true');
  assert.match(await page.locator('.attached .name').innerText(),/fixture.png/);
  assert.equal(await page.locator('.composer textarea').inputValue(),'with image for a');
  await page.evaluate(()=>{const m=document.querySelector('.composer-menu');if(m)m.open=true;}).then(()=>page.locator('[data-mode="chat"]').click());
  let releaseFeed,started;const startedPromise=new Promise(resolve=>started=resolve);state.feedHold.set('a',{promise:new Promise(resolve=>releaseFeed=resolve),started});
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await startedPromise;
  await page.locator('[data-chat-step="1"]').click();await inChat(page,'b');releaseFeed();state.feedHold.delete('a');await page.waitForTimeout(60);
  assert.ok(await page.locator('.msg').count()>0,'an older failed request cannot erase the destination chat');
  assert.doesNotMatch(await page.locator('#chat-status').innerText(),/Connection lost/,'an old chat error cannot change the destination status');
  assert.equal(await page.locator('.composer textarea').inputValue(),'');
  await page.locator('.composer textarea').fill('b saved on Back');await page.locator('.back').click();await page.locator('#main .pane[data-id="b"]').waitFor();await page.locator('#main .pane[data-id="b"]').click();await inChat(page,'b');
  assert.equal(await page.locator('.composer textarea').inputValue(),'b saved on Back');
  assert.deepEqual(state.sends.map(p=>p.pane),['b']);assert.equal(state.errors.length,0);await page.close();
 }finally{await browser.close();}
});

test('RTL and LTR thresholds exclude scroll, editor/code/selection, browser edges and cancelled pointers',async()=>{
 const browser=await chromium.launch();try{
  for(const rtl of [false,true]) {
   const {page,state}=await fixture(browser,{rtl,width:320});
   for(const options of [{dx:rtl?80:-80},{dx:rtl?140:-140,dy:95},{selector:'.composer textarea',dx:rtl?140:-140},{selector:'pre code',dx:rtl?140:-140},{x:10,dx:140},{x:310,dx:-140},{cancel:true,dx:rtl?140:-140}]){await swipe(page,options);assert.equal(new URL(page.url()).hash,'#a');}
   await page.evaluate(()=>{const node=document.querySelector('.bubble p')?.firstChild||document.querySelector('.msg')?.firstChild;const range=document.createRange();range.selectNodeContents(node);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);});
   await swipe(page,{dx:rtl?140:-140});assert.equal(new URL(page.url()).hash,'#a');await page.evaluate(()=>getSelection().removeAllRanges());
   await page.evaluate(rtl=>{const target=document.querySelector('#main');target.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:8,pointerType:'touch',isPrimary:true,clientX:160,clientY:300}));target.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:8,pointerType:'touch',isPrimary:true,clientX:160+(rtl?105:-105),clientY:302}));},rtl);
   assert.match(await page.locator('.chat-navigation-preview').innerText(),/Chat b/);
   await page.evaluate(rtl=>document.querySelector('#main').dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:8,pointerType:'touch',isPrimary:true,clientX:160+(rtl?105:-105),clientY:302})),rtl);await inChat(page,'b');
   await page.locator('.composer textarea').focus();await page.keyboard.press(rtl?'Alt+ArrowRight':'Alt+ArrowLeft');assert.equal(new URL(page.url()).hash,'#b');
   await page.locator('.composer textarea').evaluate(el=>el.blur());await page.keyboard.press(rtl?'Alt+ArrowLeft':'Alt+ArrowRight');await inChat(page,'c');
   assert.equal(await page.locator('body').evaluate(el=>el.scrollWidth<=innerWidth),true);
   assert.equal(state.errors.length,0);await page.close();
  }
 }finally{await browser.close();}
});

test('stale/recycled/unavailable targets stay put and repeated navigation opens only one chat',async()=>{
 const browser=await chromium.launch();try{
  const {page,state}=await fixture(browser);
  state.panes=[pane('a'),pane('c')];await page.locator('[data-chat-step="1"]').click();await page.locator('.chat-navigation-notice').waitFor();assert.equal(new URL(page.url()).hash,'#a');
  state.panes=[pane('a'),pane('b','replacement'),pane('c')];await page.locator('[data-chat-step="1"]').click();await page.waitForTimeout(30);assert.equal(new URL(page.url()).hash,'#a');
  assert.match(await page.locator('.chat-navigation-notice').innerText(),/changed|refresh|available/i);
  state.offline=true;await page.locator('[data-chat-step="1"]').click();await page.waitForTimeout(30);assert.equal(new URL(page.url()).hash,'#a');state.offline=false;
  state.panes=[pane('a'),pane('b'),pane('c')];let release;state.hold=new Promise(resolve=>release=resolve);
  const before=state.reads;await swipe(page);await swipe(page);await swipe(page);await page.waitForTimeout(30);assert.equal(state.reads,before+1);
  release();state.hold=null;await page.waitForTimeout(260);assert.equal(new URL(page.url()).hash,'#a');
  // Starting another gesture cancels the pending drag; a fresh gesture can navigate once.
  await swipe(page);await inChat(page,'b');assert.equal(state.visits.filter(id=>id==='b').length,1);
  assert.equal(state.errors.length,0);await page.close();
 }finally{await browser.close();}
});
