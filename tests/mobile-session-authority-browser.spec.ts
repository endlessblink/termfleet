import {test,expect} from '@playwright/test';
import fs from 'node:fs';import path from 'node:path';
import {createSessionState,selectSessionView} from '../shared/sessionState.mjs';
import {reduceSessionEnvelope} from '../shared/sessionEnvelope.mjs';
import {sessionEventHeadName} from '../scripts/lib/session-event-journal.mjs';

test('phone-sized real mobile page renders lifecycle and Goal/Now from the native synthetic journal',async({page})=>{
 const evidence=process.env.TERMFLEET_NATIVE_EVIDENCE_DIR;
 test.skip(!evidence,'Run after the isolated native verifier with its synthetic evidence directory.');
 const dir=path.join(evidence!,'data/terminal-workspace/agent-status');
 const head=JSON.parse(fs.readFileSync(path.join(dir,sessionEventHeadName('terminal-native-a-native-a-pane')),'utf8'));
 const records=fs.readFileSync(path.join(dir,head.journal),'utf8').trim().split('\n').map(line=>JSON.parse(line));
 let state=createSessionState(records[0].identity);const views=new Map();
 for(const event of records){state=reduceSessionEnvelope(state,event,{now:event.at,wallNow:event.at});views.set(state.lifecycle,selectSessionView(state,event.at));}
 for(const lifecycle of ['working','waiting','interrupted','finished','ended'])expect(views.has(lifecycle)).toBe(true);
 const html=fs.readFileSync(path.join(process.cwd(),'termcontrol/app/index.html'),'utf8');
 const panes=[...views.values()].filter(v=>v.goal).map((view,i)=>({id:`synthetic-${i}`,project:'Synthetic checkout',provider:'codex',sessionId:head.identity.sessionId,task:view.task?.text,updatedAt:Date.now(),turn:view.lifecycle==='finished'?'completed':view.lifecycle,sessionAuthority:true,sessionViewV2:view}));
 await page.setViewportSize({width:390,height:844});
 await page.route('http://native-phone.fixture/**',route=>{
  if(route.request().url().endsWith('/'))return route.fulfill({contentType:'text/html',body:html});
  if(route.request().url().includes('/api/session-events'))return route.fulfill({contentType:'text/event-stream',body:'data: "rescan"\n\n'});
  return route.fulfill({contentType:'application/json',body:JSON.stringify({version:'synthetic',view:'manual',daemon:true,panes,groups:[]})});
 });
 await page.goto('http://native-phone.fixture/');
 await expect(page.locator('.pane')).toHaveCount(panes.length);
 await expect(page.locator('[data-session-field="goal"]').first()).toContainText('Keep checkout reliable');
 for(const label of ['working','needs your answer','interrupted','completed','ended'])await expect(page.locator('.pane .badge').filter({hasText:label}).first()).toBeVisible();
 await expect(page.locator('[data-session-field="now"]').filter({hasText:'Testing checkout flow'}).first()).toBeVisible();
 await expect(page.locator('.pane')).not.toContainText(['Live now']);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.screenshot({path:path.join(evidence!,'phone-session-authority.png'),fullPage:true});
});
