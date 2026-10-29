import { serveAppModule } from './helpers/app-module-route.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {chromium} from 'playwright';
const html=fs.readFileSync(new URL('../app/index.html',import.meta.url),'utf8');
test('reconnect/missed updates replace inventory and late older responses cannot erase a new session',async()=>{
 const browser=await chromium.launch();try{
 const page=await browser.newPage();let request=0,phase=0,releaseOld;const p=id=>({id,project:id,provider:'shell',updatedAt:Date.now(),turn:'idle'}),payload=id=>({daemon:true,inventoryVersion:id,view:'manual',panes:[p(id)]});
 await page.route('**/*',async route=>{
  if(await serveAppModule(route))return;const u=new URL(route.request().url());if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:html});if(u.pathname==='/api/panes'){request++;if(phase===1){await new Promise(resolve=>releaseOld=resolve);return route.fulfill({json:payload('old')});}return route.fulfill({json:payload(phase===0?'initial':'replacement')});}return route.fulfill({json:{}});});
 await page.goto('https://termcontrol.test/');await page.waitForSelector('.pane[data-id=initial]');
 phase=1;await page.evaluate(()=>window.dispatchEvent(new Event('online')));await page.waitForFunction(()=>true);while(!releaseOld)await new Promise(r=>setTimeout(r,5));
 phase=2;await page.evaluate(()=>window.dispatchEvent(new Event('pageshow')));await page.waitForSelector('.pane[data-id=replacement]');releaseOld();await page.waitForTimeout(50);
 assert.equal(await page.locator('.pane[data-id=replacement]').count(),1);assert.equal(await page.locator('.pane[data-id=old]').count(),0);
 await page.close();
 }finally{await browser.close();}
});
