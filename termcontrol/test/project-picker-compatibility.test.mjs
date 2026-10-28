import { serveAppModule } from './helpers/app-module-route.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright';
const html=fs.readFileSync(new URL('../app/index.html',import.meta.url),'utf8');

test('old bridge retains working group creation and clearly disables unsupported global creation',async()=>{
 const browser=await chromium.launch();try{
  for(const olderResponse of ['404','html','malformed']){
   const page=await browser.newPage({viewport:{width:320,height:568},locale:'he-IL'}),calls=[];
   const p={id:'desk-pane',sessionId:'desk-session',project:'freelance-desk',mapGroupId:'desk-id',cwd:'/desk',provider:'claude',turn:'idle',updatedAt:Date.now()};
   await page.route('**/*',async route=>{
  if(await serveAppModule(route))return;const u=new URL(route.request().url());
    if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:html});
    if(u.pathname==='/api/panes')return route.fulfill({json:{panes:[p],groups:[{id:'map:desk-id',mapGroupId:'desk-id',project:'freelance-desk',panes:[p]}]}});
    if(u.pathname==='/api/projects')return route.fulfill(olderResponse==='404'?{status:404,json:{error:'not found'}}:olderResponse==='html'?{contentType:'text/html',body:html}:{json:{}});
    if(u.pathname==='/api/spawn'){calls.push(route.request().postDataJSON());return route.fulfill({json:{ok:true,childPaneId:'synthetic-new-pane'}});}
    return route.fulfill({json:{}});
   });
   await page.goto('https://tc.test/');await page.locator('.global-new-agent').click();
   await page.locator('.newagent .err').filter({hasText:/עדכו|updated|update/i}).waitFor({timeout:4000});
   assert.equal(await page.locator('.newagent .go').isDisabled(),true);
   assert.doesNotMatch(await page.locator('.newagent').innerText(),/טוען|Loading|Unexpected token|undefined/);
   await page.keyboard.press('Escape');await page.locator('.addagent[data-project="freelance-desk"]').click();
   await page.locator('.newagent input[value=codex]').check();await page.locator('.newagent textarea').fill('Approved synthetic old-group work');
   assert.equal(await page.locator('.newagent .go').isDisabled(),false);await page.locator('.newagent .go').click();await page.locator('.newagent').waitFor({state:'detached'});
   assert.deepEqual(calls,[{project:'freelance-desk',provider:'codex',task:'Approved synthetic old-group work'}]);
   await page.close();
  }
 }finally{await browser.close();}
});

test('dialog follows a shrinking keyboard visual viewport and keeps its footer reachable',async()=>{
 const browser=await chromium.launch();try{
  const page=await browser.newPage({viewport:{width:390,height:844},locale:'he-IL'});
  await page.addInitScript(()=>{const vv=Object.assign(new EventTarget(),{width:390,height:844,offsetTop:0,offsetLeft:0});Object.defineProperty(window,'visualViewport',{value:vv});});
  await page.route('**/*',async route=>{
  if(await serveAppModule(route))return;const u=new URL(route.request().url());if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:html});if(u.pathname==='/api/projects')return route.fulfill({json:{ready:true,projects:[{id:'paper-id',name:'PaperBot',cwd:'/paper'}],providers:[{id:'claude',name:'Claude'},{id:'codex',name:'Codex'},{id:'opencode',name:'OpenCode'}]}});return route.fulfill({json:{panes:[],groups:[]}});});
  await page.goto('https://tc.test/');await page.locator('.global-new-agent').click();await page.locator('.newagent select option[value=paper-id]').waitFor({state:'attached'});await page.locator('.newagent textarea').fill('Keyboard draft');
  await page.evaluate(()=>{visualViewport.height=360;visualViewport.offsetTop=48;visualViewport.dispatchEvent(new Event('resize'));});await page.locator('.newagent .go').scrollIntoViewIfNeeded();
  const rect=await page.locator('.newagent').evaluate(form=>({top:form.getBoundingClientRect().top,bottom:form.getBoundingClientRect().bottom,actions:form.querySelector('.actions').getBoundingClientRect().bottom}));
  assert.ok(rect.top>=48 && rect.bottom<=408 && rect.actions<=408,JSON.stringify(rect));assert.equal(await page.locator('.newagent textarea').inputValue(),'Keyboard draft');
  if(process.env.TC_TEST_ARTIFACT_DIR)await page.screenshot({path:process.env.TC_TEST_ARTIFACT_DIR+'/project-dialog-keyboard-rtl.png'});
 }finally{await browser.close();}
});

test('ready picker fits small phone and reduced viewport without clipped fields or actions',async()=>{
 const browser=await chromium.launch();try{
  for(const [width,height,locale,theme] of [[320,568,'he-IL','dark'],[390,360,'he-IL','light'],[320,360,'en-US','dark']]){
   const page=await browser.newPage({viewport:{width,height},locale});
   await page.addInitScript(theme=>localStorage.setItem('termcontrol-theme',theme),theme);
   await page.route('**/*',async route=>{
  if(await serveAppModule(route))return;const u=new URL(route.request().url());if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:html});if(u.pathname==='/api/panes')return route.fulfill({json:{panes:[],groups:[]}});if(u.pathname==='/api/projects')return route.fulfill({json:{ready:true,projects:[{id:'paper-id',name:'PaperBot / פרויקט לתמלול ויצירה עם כותרת ארוכה במיוחד',cwd:'/safe/long-folder/'.repeat(7)}],providers:[{id:'claude',name:'Claude'},{id:'codex',name:'Codex'},{id:'opencode',name:'OpenCode'}]}});return route.fulfill({json:{}});});
   await page.goto('https://tc.test/');await page.locator('.global-new-agent').click();await page.locator('.newagent select option[value=paper-id]').waitFor({state:'attached'});await page.locator('.newagent select').selectOption('paper-id');await page.locator('.newagent textarea').fill('Synthetic draft');await page.locator('.newagent .go').scrollIntoViewIfNeeded();
   const geometry=await page.locator('.newagent').evaluate(form=>({left:form.getBoundingClientRect().left,right:form.getBoundingClientRect().right,top:form.getBoundingClientRect().top,bottom:form.getBoundingClientRect().bottom,client:form.clientWidth,scroll:form.scrollWidth,controls:[...form.querySelectorAll('select,textarea,fieldset,.actions')].map(el=>({left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right}))}));
   assert.ok(geometry.left>=0 && geometry.right<=width && geometry.top>=0 && geometry.bottom<=height,JSON.stringify(geometry));assert.ok(geometry.scroll<=geometry.client,JSON.stringify(geometry));assert.ok(geometry.controls.every(el=>el.left>=0 && el.right<=width),JSON.stringify(geometry));
   if(process.env.TC_TEST_ARTIFACT_DIR)await page.screenshot({path:`${process.env.TC_TEST_ARTIFACT_DIR}/project-dialog-${width}-${height}-${locale}-${theme}.png`});
   await page.keyboard.press('Escape');await page.close();
  }
 }finally{await browser.close();}
});
