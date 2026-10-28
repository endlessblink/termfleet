import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
import {captureMessage,record,markItem} from '../bridge/requirements.mjs';
import {startLinkServer} from './helpers/link-server.mjs';

test('existing bot chat shows complete live lists, keeps its composer and handles unavailable data', {timeout:60000}, async()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'tc-work-dashboard-'));
  const cfg=path.join(tmp,'cfg'),home=path.join(tmp,'bots');fs.mkdirSync(cfg);fs.mkdirSync(home);
  const port=8000+Math.floor(Math.random()*500),base=`http://127.0.0.1:${port}`;
  const server=spawn(process.execPath,['termcontrol/bridge/server.mjs'],{env:{...process.env,TC_PORT:String(port),TC_HOST:'127.0.0.1',TC_CONFIG_DIR:cfg,TC_BOTS_HOME:home,TC_NO_AGENT_HEALTH:'1',TC_NO_WATCHDOG:'1'},stdio:'ignore'});
  let browser,artifactServer;
  try{
    for(let i=0;i<80;i++){try{await fetch(base+'/login');break;}catch{await new Promise(r=>setTimeout(r,100));}}
    assert.equal((await fetch(base+'/api/work-terminals')).status,401);
    assert.equal((await fetch(base+'/api/requirements?dashboard=1')).status,401);
    browser=await chromium.launch();const page=await browser.newPage();
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base);await page.locator('#email').fill('owner@example.test');await page.locator('#password').fill('a-good-password');await page.locator('form').evaluate(f=>f.requestSubmit());await page.waitForSelector('.fleet-content');
    const id=await page.evaluate(async()=>(await(await fetch('/api/bots',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'בדיקת תמונת מצב'})})).json()).bot.id);
    const dir=path.join(cfg,'requirements');
    const items=Array.from({length:305},(_,i)=>captureMessage({text:`לשפר את קריאת ההודעות מספר ${i+1}`,project:'termfleet',source:`bot:${id}`,msgId:`work-${i}`},{dir})[0]);
    record(items.map(item=>({e:'topic',id:item.id,topics:['bot-chat-dashboard']})),{dir});
    const [context]=captureMessage({text:'אם אתה לא בטוח, אל תעשה את זה',project:'termfleet',source:`bot:${id}`,msgId:'feedback'},{dir});
    record([{e:'status',id:context.id,status:'context',note:'הסבר של הבעלים ולא הוראת התנסות'}],{dir});
    captureMessage({text:'בקשה ששייכת לבוט אחר',project:'termfleet',source:'bot:other',msgId:'another-bot'},{dir});
    record([{e:'status',id:items[0].id,status:'done'},{e:'status',id:items[1].id,status:'waiting'},{e:'status',id:items[2].id,status:'ready'}],{dir});
    artifactServer=await startLinkServer();
    const artifact=artifactServer.url('/ok');
    const [experience]=captureMessage({text:'תיקון הגלילה בצ׳אט למסירה',project:'termfleet',source:`bot:${id}`,msgId:'actual-experience'},{dir});
    const ready=markItem({status:'ready',id:experience.id,tryText:'גלול למעלה וקרא הודעה קודמת',expected:'ההודעה נשארת באותו מקום',artifact,evidence:`Actual delivered scroll result is visible at ${artifact}`},{dir});
    assert.equal(ready.error,undefined);record(ready.events,{dir});
    const [machine]=captureMessage({text:'בדיקת הגנת הרקע',project:'termfleet',source:`bot:${id}`,msgId:'machine-proof'},{dir});
    const guard=markItem({status:'ready',id:machine.id,tryText:'בדוק את מנגנון ההגנה',expected:'אין כתיבה כפולה לאותה רשומה',artifact,testKind:'machine',evidence:`Machine guard result for delivered artifact at ${artifact}`},{dir});
    assert.equal(guard.error,undefined);record(guard.events,{dir});
    await page.route('**/api/work-terminals',r=>r.fulfill({json:{daemon:true,panes:[{id:'fixture-terminal',profile:{name:'בדיקת יומן האוכל'},statedTask:'בודק שמירת ארוחות',alive:true,dashboardState:'working'},{id:'idle-terminal',alive:true,dashboardState:'idle'}]}}));
    for(const width of [1600,1024,390,320]){
      await page.setViewportSize({width,height:width===320?667:width===390?844:1000});await page.goto(base+'/#bot:'+id);await page.waitForSelector('.bot-composer');
      if(width<1440)await page.locator('.work-toggle').click();
      await page.waitForFunction(()=>document.querySelectorAll('[data-work=tasks] li').length===308);
      assert.equal(await page.locator('[data-work=tasks] details small').count(),308);
      assert.match(await page.locator('[data-work=tasks]').innerText(),/תמונת מצב העבודה בתוך הצ׳אט/);
      assert.equal(await page.locator('[data-work-kind=owner]').count(),1);
      assert.equal(await page.locator('[data-work-kind=machine]').count(),1);
      assert.equal(await page.locator('[data-work-kind=history]').count(),1);
      assert.equal(await page.locator('[data-work-kind=context]').count(),1);
      assert.equal(await page.locator('[data-work-kind=context]').isVisible(),false,'background explanation starts collapsed');
      assert.equal(await page.locator('[data-work-kind=history]').isVisible(),false,'historical results start collapsed');
      assert.equal(await page.locator('[data-work-kind]').first().getAttribute('data-work-kind'),'owner','owner experience comes before open work and background');
      for(const kind of ['context','history']){
        const section=page.locator(`[data-work-section=${kind}]`);
        assert.match(await section.locator(':scope > summary').innerText(),/1/);
        await section.locator(':scope > summary').click();
        assert.equal(await page.locator(`[data-work-kind=${kind}]`).isVisible(),true,'explicit expansion retains source rows');
        await section.locator(':scope > summary').click();
      }
      assert.equal(await page.locator('[data-work-kind=owner] a').getAttribute('href'),artifact);
      assert.match(await page.locator('[data-work-kind=owner]').innerText(),/גלול למעלה וקרא הודעה קודמת[\s\S]*ההודעה נשארת באותו מקום/);
      assert.equal(await page.locator('[data-work=terminals] li').count(),1);
      assert.equal(await page.locator('[data-work=tasks]').innerText().then(t=>t.includes('בקשה ששייכת לבוט אחר')),false);
      assert.ok(await page.locator('#work-terminals-title').evaluate(el=>el.getBoundingClientRect().bottom<innerHeight),'both panels visible in first viewport');
      assert.match(await page.locator('[data-work=terminals]').innerText(),/בודק שמירת ארוחות/);
      assert.equal(await page.locator('#work-dashboard .ask-verdict').count(),0);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`no overflow at ${width}`);
      if(width>=1000 && width<1440)assert.equal(await page.locator('#work-dashboard').evaluate(el=>el.getBoundingClientRect().left),await page.locator('#fleet-side').evaluate(el=>el.getBoundingClientRect().right),'overlay starts after existing sidebar');
      assert.equal(await page.locator('#work-dashboard').evaluate(el=>getComputedStyle(el).backgroundColor),await page.locator('body').evaluate(el=>getComputedStyle(el).backgroundColor));
      if(process.env.TC_SHOT_DIR)await page.screenshot({path:path.join(process.env.TC_SHOT_DIR,`work-dashboard-${width}.png`)});
      if(width<1440){await page.locator('[aria-label="סגירת תמונת המצב"]').click();await page.locator('.bot-composer textarea').fill('טיוטה נשמרת');assert.equal(await page.locator('.bot-composer textarea').inputValue(),'טיוטה נשמרת');}
    }
    await page.unroute('**/api/work-terminals');
    await page.route('**/api/work-terminals',r=>r.fulfill({json:{daemon:false,panes:[]}}));
    await page.route('**/api/requirements?dashboard=1&closed=1&source=*',r=>r.fulfill({status:503,json:{error:'unavailable'}}));
    await page.reload();await page.locator('.work-toggle').click();
    await page.waitForFunction(()=>document.querySelector('[data-work=tasks]').textContent.includes('לא ניתן לטעון'));
    assert.match(await page.locator('[data-work=terminals]').innerText(),/המצב אינו ידוע/);
    assert.match(await page.locator('.work-fresh').innerText(),/אינו זמין/);
    await page.unroute('**/api/requirements?dashboard=1&closed=1&source=*');
    await page.unroute('**/api/work-terminals');
    await page.route('**/api/requirements?dashboard=1&closed=1&source=*',r=>r.fulfill({json:{items:{}}}));
    await page.route('**/api/work-terminals',r=>r.fulfill({json:null}));
    await page.reload();await page.locator('.work-toggle').click();
    await page.waitForFunction(()=>document.querySelector('[data-work=terminals]').textContent.includes('לא ניתן לטעון'));
    await page.unroute('**/api/requirements?dashboard=1&closed=1&source=*');
    await page.unroute('**/api/work-terminals');
    await page.route('**/api/work-terminals',r=>r.fulfill({json:{daemon:true,panes:[]}}));
    await page.waitForFunction(()=>document.querySelectorAll('[data-work=tasks] li').length===308,{},{timeout:20000});
    assert.match(await page.locator('[data-work=terminals]').innerText(),/אין טרמינלים/);
    await page.locator('[aria-label="סגירת תמונת המצב"]').click();await page.locator('.back').click();
    await page.waitForFunction(()=>document.querySelector('#work-dashboard').hidden);
    assert.deepEqual(errors,[]);
    console.log('308 source-preserving deliveries/context/history; one genuine checked owner experience; machine proof separate; 1600/1024/390/320 layouts; failure states; draft and navigation preserved.');
  }finally{await browser?.close();artifactServer?.stop();server.kill('SIGKILL');fs.rmSync(tmp,{recursive:true,force:true});}
});
