import { serveAppModule } from './helpers/app-module-route.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {chromium} from 'playwright';
const html=fs.readFileSync(new URL('../app/index.html',import.meta.url),'utf8');
test('global new agent chooses a dormant exact project and provider, preserves drafts and refuses old native support',async()=>{
 const browser=await chromium.launch();try{for(const ready of [true,false]){
  const page=await browser.newPage({viewport:{width:320,height:844},locale:'he-IL'});const calls=[];let fail=true;
  const p={id:'desk-pane',sessionId:'desk-session',project:'freelance-desk',mapGroupId:'desk-id',cwd:'/desk',provider:'claude',turn:'idle',updatedAt:Date.now()};
  await page.route('**/*',async route=>{
  if(await serveAppModule(route))return;const u=new URL(route.request().url());if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:html});if(u.pathname==='/api/panes')return route.fulfill({json:{panes:[p],groups:[{id:'map:desk-id',mapGroupId:'desk-id',project:'freelance-desk',panes:[p]}]}});if(u.pathname==='/api/projects')return route.fulfill({json:{ready,projects:[{id:'desk-id',name:'Freelance Desk',cwd:'/desk'},{id:'paper-id',name:'Paper Bot',cwd:'/paper'}],providers:[{id:'claude',name:'Claude'},{id:'codex',name:'Codex'},{id:'opencode',name:'OpenCode'}]}});if(u.pathname==='/api/spawn'){calls.push(route.request().postDataJSON());return route.fulfill({status:fail?409:200,json:fail?{error:'That project changed. Refresh and check.'}:{ok:true,childPaneId:'synthetic-paper-pane'}});}if(u.pathname==='/api/feed')return route.fulfill({json:{pane:p,events:[{kind:'assistant',text:'Synthetic chat'}],reachedStart:true}});return route.fulfill({json:{}});});
  await page.goto('https://tc.test/');assert.equal(await page.locator('.global-new-agent').count(),1);await page.locator('.global-new-agent').click();await page.locator('.newagent select option[value="paper-id"]').waitFor({state:'attached'});
  await page.locator('.newagent select').selectOption('paper-id');await page.locator('.newagent input[value=codex]').check();await page.locator('.newagent textarea').fill('Approved synthetic task');
  if(ready && process.env.TC_TEST_ARTIFACT_DIR)await page.screenshot({path:process.env.TC_TEST_ARTIFACT_DIR+'/project-picker.png'});
  assert.equal(await page.locator('.newagent .go').isDisabled(),!ready);assert.ok(await page.locator('.newagent').evaluate(el=>el.getBoundingClientRect().right<=innerWidth));
  if(ready){await page.locator('.newagent .go').click();await page.locator('.newagent .err').filter({hasText:'project changed'}).waitFor();assert.equal(await page.locator('.newagent textarea').inputValue(),'Approved synthetic task');assert.equal(await page.locator('.newagent select').inputValue(),'paper-id');assert.deepEqual(calls[0],{projectId:'paper-id',provider:'codex',task:'Approved synthetic task'});fail=false;await page.locator('.newagent .go').click();await page.locator('.newagent').waitFor({state:'detached'});assert.equal(calls.length,2);}
  else{assert.equal(calls.length,0);await page.keyboard.press('Escape');await page.locator('.newagent').waitFor({state:'detached'});}
  await page.close();
 }}finally{await browser.close();}
});
