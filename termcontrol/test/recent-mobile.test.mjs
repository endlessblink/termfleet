import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {chromium} from 'playwright';
const html=fs.readFileSync(new URL('../app/index.html',import.meta.url),'utf8');
test('Last used follows explicit A B A visits, never background output, and survives another phone',async()=>{
 const browser=await chromium.launch();let rows=['A','B','C'].map(id=>({id,project:'project',provider:'claude',turn:'idle',task:'Read /synthetic/HANDOFF_REVIEW.md.',updatedAt:Date.now(),lastActiveAt:Date.now()})),history={},counter=1000,visits=0;
 try{for(let phone=0;phone<2;phone++){
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const page=await context.newPage();await page.addInitScript(()=>localStorage.setItem('termcontrol-sort','recent'));
  await page.route('http://recent.synthetic/**',async route=>{const url=new URL(route.request().url());if(url.pathname==='/')return route.fulfill({body:html,contentType:'text/html'});let data={};
   if(url.pathname==='/api/panes'){const panes=rows.map(p=>({...p,lastUsedAt:history[p.id] || null}));data={panes,groups:[{project:'project',panes}],daemon:true};}
   if(url.pathname==='/api/visit'){visits++;const id=route.request().postDataJSON().pane;history[id]=++counter;data={ok:true,lastUsedAt:counter};}
   if(url.pathname==='/api/feed')data={pane:rows.find(p=>p.id===url.searchParams.get('pane')),events:[{kind:'assistant',text:'הנה תשובה אמיתית עם קוד:\n```xml\n<system-reminder>example</system-reminder>\n```'},{kind:'notice',text:'Technical context',technical:true,details:'Base directory for this skill: /synthetic/.agents/skills/demo'}],reachedStart:true};return route.fulfill({json:data});
  });
  const order=()=>page.locator('.pane').evaluateAll(els=>els.map(el=>el.dataset.id));await page.goto('http://recent.synthetic/');await page.waitForSelector('.pane');
  if(phone===0){assert.deepEqual(await order(),['A','B','C']);for(const id of ['A','B','A']){const response=page.waitForResponse(r=>r.url().endsWith('/api/visit'));await page.locator(`.pane[data-id=${id}]`).click();await response;await page.waitForSelector('.back');await page.waitForSelector('.technical-context');assert.equal(await page.locator('.activity-details').first().getAttribute('open'),null);assert.equal(await page.locator('.msg.assistant code').textContent(),'<system-reminder>example</system-reminder>');await page.locator('.back').click();await page.waitForSelector('.pane');}
   assert.deepEqual(await order(),['A','B','C']);rows[1].updatedAt=Date.now()+999999;rows[1].lastActiveAt=Date.now()+999999;await page.reload();await page.waitForSelector('.pane');assert.deepEqual(await order(),['A','B','C']);assert.equal(visits,3,'reload/output never invent visits');
  }else{assert.deepEqual(await order(),['A','B','C'],'other phone reads persisted explicit use');rows=rows.filter(p=>p.id!=='A');rows.push({id:'D',project:'project',provider:'claude',turn:'idle',updatedAt:Date.now()+999999});await page.reload();await page.waitForSelector('.pane');assert.deepEqual(await order(),['B','C','D'],'closed excluded; unknown new session retains map order');assert.equal(visits,3);}
  await context.close();
 }}finally{await browser.close();}
});
