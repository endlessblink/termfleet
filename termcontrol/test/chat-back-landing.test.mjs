// Noam 2026-10-22: "אם אני חוזר אחורה מסוכן בפלאפון זה צריך לחזור לאזור שבו היה הסוכן במסך".
// Terminal chats: Back puts the list where the tapped card was, or on the agent a swipe ended on.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';

const html=fs.readFileSync(new URL('../app/index.html',import.meta.url),'utf8');
const ids=Array.from({length:22},(_,i)=>'t'+String(i).padStart(2,'0'));
const pane=id=>({id,sessionId:id,title:`Chat ${id}`,project:'Same project',provider:'codex',turn:'idle',alive:true});

async function fixture(browser){
 const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>localStorage.setItem('termcontrol-fleet-tab','terminals'));
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:html});
  if(url.pathname==='/api/panes')return route.fulfill({json:{daemon:true,panes:ids.map(pane),view:'manual'}});
  if(url.pathname==='/api/feed'){const id=url.searchParams.get('pane');return route.fulfill({json:{pane:pane(id),events:[{kind:'assistant',text:`${id} says hello`,at:Date.now()-5000}],reachedStart:true}});}
  return route.fulfill({json:{}});
 });
 await page.goto('https://termcontrol.test/');
 await page.waitForFunction(n=>document.querySelectorAll('#main .pane[data-id]').length===n,ids.length);
 return {page,errors};
}
const top=(page,id)=>page.evaluate(id=>{const r=document.querySelector(`#main .pane[data-id="${id}"]`);return r?Math.round(r.getBoundingClientRect().top-document.querySelector('#main').getBoundingClientRect().top):null;},id);
async function swipe(page,dx){
 await page.evaluate(async dx=>{
  const el=document.querySelector('#main');const fire=(type,o)=>el.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:5,pointerType:'touch',isPrimary:true,button:0,clientX:200+o,clientY:330}));
  fire('pointerdown',0);for(const f of [.15,.35,.6,.85,1]){fire('pointermove',dx*f);await new Promise(requestAnimationFrame);}fire('pointerup',dx);
 },dx);
}
const inChat=(page,id)=>page.waitForFunction(id=>location.hash==='#'+id&&document.querySelector('.composer')?.dataset.recipient===id&&!document.querySelector('.chat-navigation-preview'),id);
const listBack=async page=>{await page.waitForFunction(()=>document.querySelector('#main .pane[data-id]'));await page.waitForTimeout(300);};

test('Back from a terminal chat returns the list to the card, also after swiping',async()=>{
 const browser=await chromium.launch();try{
  const {page,errors}=await fixture(browser);
  const order=await page.$$eval('#main .pane[data-id]',els=>els.map(e=>e.dataset.id));
  const pick=order[11];
  await page.evaluate(id=>{const m=document.querySelector('#main'),r=m.querySelector(`.pane[data-id="${id}"]`);m.scrollTop+=r.getBoundingClientRect().top-m.getBoundingClientRect().top-300;},pick);
  await page.waitForTimeout(150);const start=await top(page,pick);
  assert.ok(start>200&&start<400,`picked card mid-screen (${start})`);
  await page.locator(`#main .pane[data-id="${pick}"]`).click();await inChat(page,pick);
  await page.locator('.back').click();await listBack(page);
  assert.ok(Math.abs(await top(page,pick)-start)<=4,`plain Back keeps the card in place (${await top(page,pick)} vs ${start})`);

  await page.locator(`#main .pane[data-id="${pick}"]`).click();await inChat(page,pick);
  await swipe(page,-160);await inChat(page,order[12]);
  await swipe(page,-160);await inChat(page,order[13]);
  await page.locator('.back').click();await listBack(page);
  assert.ok(Math.abs(await top(page,order[13])-start)<=4,`Back after swiping shows the agent he ended on (${await top(page,order[13])} vs ${start})`);

  await page.locator(`#main .pane[data-id="${order[13]}"]`).click();await inChat(page,order[13]);
  await swipe(page,160);await inChat(page,order[12]);
  await page.goBack();await listBack(page);
  assert.ok(Math.abs(await top(page,order[12])-start)<=4,`phone back after swiping also lands there (${await top(page,order[12])} vs ${start})`);
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
