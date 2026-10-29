import { serveAppModule } from './helpers/app-module-route.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
const html=fs.readFileSync(new URL('../app/index.html',import.meta.url),'utf8');
test('recording starts preparation without awaiting it and preserves auto language; diagnostics are bounded',async()=>{
 const browser=await chromium.launch();
 try {
  const page=await browser.newPage({viewport:{width:390,height:844}});
  await page.addInitScript(()=>{
   Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>({getTracks:()=>[{stop(){}}]})}});
   window.MediaRecorder=class{static isTypeSupported(){return true;}constructor(){this.state='inactive';this.mimeType='audio/webm';}start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable({data:new Blob([new Uint8Array(16)])});this.onstop();}};
  });
  const requests=[];
  const pane={id:'fixture',project:'demo',provider:'claude',task:'Demo',turn:'idle',updatedAt:Date.now()};
  await page.route('**/*',async(route)=>{
  if(await serveAppModule(route))return;
   const u=new URL(route.request().url());
   if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:html});
   if(u.pathname==='/api/panes')return route.fulfill({json:{panes:[pane],groups:[{id:'demo',project:'demo',panes:[pane]}],daemon:true}});
   if(u.pathname==='/api/feed')return route.fulfill({json:{pane,events:[],reachedStart:true}});
   if(u.pathname==='/api/transcribe/prepare'){
    assert.equal(u.search,requests.length===0?'':'?lang=he','only previously detected speech supplies a loading hint');
    requests.push('prepare');assert.equal(route.request().method(),'POST');assert.equal(route.request().postData(),null,'no clip sent to preparation');
    if(requests.length===1)await new Promise(r=>setTimeout(r,250));
    return route.fulfill({status:503,json:{prepared:false}}); // best effort failure does not block speech
   }
   if(u.pathname==='/api/transcribe'){
    requests.push('transcribe');assert.equal(u.search,'','language remains automatic');
    return route.fulfill({json:{text:'synthetic words',language:'he',timings:{uploadMs:1,queueMs:2,workerStartupMs:0,warmupMs:0,decodeMs:1,detectMs:3,inferenceMs:4,requestMs:11,text:'DO-NOT-KEEP'}}});
   }
   return route.fulfill({json:{}});
  });
  await page.goto('https://termcontrol.test/');await page.locator('.pane').first().click();await page.waitForSelector('.composer .mic',{state:'attached'});await page.evaluate(()=>{const m=document.querySelector('.composer-menu');if(m)m.open=true;});
  assert.equal(requests.length,0,'opening a chat must not warm large models');
  for(let i=0;i<21;i++){
   await page.locator('.mic').click();await page.waitForSelector('.mic.rec');
   await page.locator('.mic').click({force:true});
   await page.waitForFunction(n=>(window.termcontrolDictationTimings?.length||0)>=Math.min(n,20),i+1);
   await page.waitForSelector('.mic:not(.busy)');
  }
  assert.deepEqual(requests.slice(0,2),['prepare','transcribe']);
  const timings=await page.evaluate(()=>window.termcontrolDictationTimings);
  assert.equal(timings.length,20);assert.equal(timings[0].inferenceMs,4);assert.ok(timings[0].clientMs>=0);
  assert.ok(timings[0].captureFinalizeMs>=0);assert.ok(timings[0].stopToTextMs>=timings[0].clientMs);
  const before=await page.locator('.composer textarea').inputValue();
  await page.evaluate(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='termcontrol-dictation-language')throw new DOMException('Quota','QuotaExceededError');return original.call(this,k,v);};});
  await page.locator('.mic').click();await page.waitForSelector('.mic.rec');await page.locator('.mic').click({force:true});
  await page.waitForFunction(before=>document.querySelector('.composer textarea').value.length>before.length,before);
  assert.ok(!JSON.stringify(timings).includes('synthetic words'));assert.ok(!JSON.stringify(timings).includes('DO-NOT-KEEP'));
 } finally {await browser.close();}
});
