import { serveAppModule } from './helpers/app-module-route.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright';
const html=fs.readFileSync(new URL('../app/index.html',import.meta.url),'utf8');
const now=Date.now();
const panes=Array.from({length:24},(_,i)=>({id:`demo-${i}`,project:i<12?'freelance-desk':'studio-notes',mapGroupId:i<12?'desk':'notes',color:i<12?'#899887':'#8a98a0',provider:['claude','codex','opencode'][i%3],task:'בודק את טיוטת ההצעה · North Studio',lastActiveAt:now-i*60000,lastUsedAt:now-i*90000,updatedAt:now-i*60000,turn:i===0?'waiting':i%4===0?'idle':'working',producing:i%4===1,attention:i===0?{title:'Which draft?'}:null}));
const groups=[{project:'freelance-desk',panes:panes.slice(0,12)},{project:'studio-notes',panes:panes.slice(12)}];
test('dense local themes, stable avatar nodes, map grouping and wide chat survive refresh',async()=>{
 const browser=await chromium.launch();
 try{for(const width of [320,390,430,1440])for(const theme of ['dark','light']){
  const context=await browser.newContext({viewport:{width,height:844},locale:'he-IL',isMobile:width<600,hasTouch:width<600});const page=await context.newPage();await page.clock.install();let reads=0,sends=0;
  await page.addInitScript(theme=>{localStorage.setItem('termcontrol-theme',theme);},theme);
  await page.route('**/*',async route=>{
  if(await serveAppModule(route))return;
   const url=new URL(route.request().url());assert.equal(url.origin,'http://redesign.synthetic','all requests stay on the current origin');
   if(url.pathname==='/')return route.fulfill({body:html,contentType:'text/html'});
   let data={};
   if(url.pathname==='/api/panes'){reads++;data={panes,groups,view:'projects',daemon:true};}
   if(url.pathname==='/api/feed')data={pane:panes.find(p=>p.id===url.searchParams.get('pane')),events:[{kind:'user',text:'הצג את התוכנית להיום'},{kind:'assistant',text:'The draft is ready.\n\nלא בוצעו שינויים בלו״ז.'}],reachedStart:true};
   if(url.pathname==='/api/screen')data={screen:'Synthetic screen'};
   if(url.pathname==='/api/send'){sends++;data={error:'No synthetic action was dispatched.'};}
   return route.fulfill({json:data});
  });
  await page.goto('http://redesign.synthetic/');await page.waitForSelector('.pane');
  const measure=()=>page.evaluate(()=>({over:document.documentElement.scrollWidth-innerWidth,main:document.querySelector('main').scrollWidth-document.querySelector('main').clientWidth,small:[...document.querySelectorAll('button,summary,select')].filter(el=>el.checkVisibility()).filter(el=>{const r=el.getBoundingClientRect();return r.width<43.9 || r.height<43.9;}).map(el=>el.textContent.trim())}));
  let m=await measure();assert.ok(m.over<=1 && m.main<=1);assert.deepEqual(m.small,[]);
  assert.equal(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor),theme==='dark'?'rgb(20, 19, 18)':'rgb(245, 242, 237)');
  assert.deepEqual(await page.locator('.pane').evaluateAll(els=>els.map(el=>el.getBoundingClientRect().height)),Array(24).fill(72));
  await page.evaluate(()=>{window.__avatar=document.querySelector('[data-avatar-state="producing"]');window.__animation=window.__avatar.querySelector('.cr-body').getAnimations()[0];});
  const refreshed=page.waitForResponse(r=>r.url().endsWith('/api/panes'));await page.clock.fastForward(15001);await refreshed;await page.clock.runFor(50);assert.ok(reads>=2);
  assert.equal(await page.evaluate(()=>window.__avatar===document.querySelector('[data-avatar-state="producing"]')),true,'refresh preserves the actual avatar node');
  assert.equal(await page.evaluate(()=>window.__animation===window.__avatar.querySelector('.cr-body').getAnimations()[0]),true,'unchanged state animation is not restarted');
  await page.locator('.fleetbar [data-pref=sort]').selectOption('recent');await page.waitForFunction(()=>localStorage.getItem('termcontrol-sort')==='recent');
  await page.locator('.fleetbar [data-pref=window]').selectOption('3d');assert.equal(await page.evaluate(()=>localStorage.getItem('termcontrol-window')),'3d');
  await page.locator('.projgroup').first().locator('summary').click();assert.equal(await page.locator('.projgroup').first().getAttribute('open'),null);await page.locator('.projgroup').first().locator('summary').click();
  await page.locator('.pane').first().click();await page.waitForSelector('.composer textarea');
  assert.equal(await page.locator('.back svg').count(),1);assert.equal(await page.locator('.send svg').count(),1);assert.ok(await page.locator('.send').getAttribute('aria-label'));
  assert.match(await page.locator('.composer textarea').getAttribute('placeholder'),/^הודעה/);
  if(width===1440){assert.equal(await page.locator('#fleet-side').isVisible(),true);assert.ok(await page.locator('#fleet-side').evaluate(el=>el.getBoundingClientRect().width>=300));}
  else assert.equal(await page.locator('#fleet-side').isVisible(),false);
  await page.evaluate(()=>{const m=document.querySelector('.composer-menu');if(m)m.open=true;});await page.locator('[data-mode=screen]').click();assert.equal(await page.locator('.send svg').count(),1);await page.evaluate(()=>{const m=document.querySelector('.composer-menu');if(m)m.open=true;});await page.locator('[data-mode=chat]').click();assert.equal(await page.locator('.send svg').count(),1);
  m=await measure();assert.ok(m.over<=1 && m.main<=1);assert.deepEqual(m.small,[]);assert.equal(sends,0);
  await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('[data-avatar-state="producing"] .cr-body').first().evaluate(el=>getComputedStyle(el).animationName),'none');
  await context.close();
 }}finally{await browser.close();}
});
