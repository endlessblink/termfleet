import { serveAppModule } from './app-module-route.mjs';
import {chromium} from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
const input=process.argv[2]||'05c-baseline/termcontrol/app/index.html',out=process.argv[3]||'05c-before';
fs.mkdirSync(out,{recursive:true});const html=fs.readFileSync(input,'utf8');
const panes=['a','b','c'].map(id=>({id,sessionId:id,title:`Chat ${id}`,project:`Project ${id}`,provider:'codex',turn:'idle',alive:true}));
const events=id=>Array.from({length:24},(_,i)=>({kind:i%2?'user':'assistant',text:`${id.toUpperCase()} · ${i+1}\n\n${(i%2?'The draft is ready for review. ':'Here is the next step for this conversation. ').repeat(8)}`,at:Date.now()-60000+i*1000}));
const browser=await chromium.launch();const summaries=[];
try{for(const [name,dx,duration,latency] of [['commit',-152,240,180],['short',-64,240,180],['flick',-74,65,180],['recycled',-152,240,180]]){
 const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,recordVideo:{dir:out,size:{width:390,height:844}}});const page=await context.newPage();let reads=0,feeds=0;
 await page.route('**/*',async route=>{
  if(await serveAppModule(route))return;
  const u=new URL(route.request().url());if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:html});
  if(u.pathname==='/api/panes'){if(reads++>0)await new Promise(r=>setTimeout(r,latency));return route.fulfill({json:{panes,daemon:true,view:'manual'}});}
  if(u.pathname==='/api/feed'){const id=u.searchParams.get('pane'),limit=Number(u.searchParams.get('limit')||60);feeds++;await new Promise(r=>setTimeout(r,id==='b'?(limit<10?75:330):15));const target=panes.find(p=>p.id===id);return route.fulfill({json:{pane:name==='recycled'&&id==='b'?{...target,sessionId:'recycled'}:target,events:events(id).slice(-limit),reachedStart:true}});}
  return route.fulfill({json:{ok:true}});
 });
 await page.goto('http://motion.synthetic/');await page.locator('.pane[data-id="a"]').click();await page.locator('.composer textarea').waitFor();await page.waitForTimeout(200);
 await page.evaluate(name=>{
  window.motionFrames=[];window.motionMarks=[];window.motionStart=performance.now();window.motionPointer=null;
  const dot=document.createElement('div');dot.style.cssText='position:fixed;z-index:999;pointer-events:none;width:26px;height:26px;border:2px solid #d97757;border-radius:50%;background:#d9775730;display:none';document.body.append(dot);
  const tag=document.createElement('div');tag.style.cssText='position:fixed;z-index:999;pointer-events:none;bottom:4px;right:8px;background:#141413cc;color:#f0eee6;font:11px monospace;padding:3px 5px';document.body.append(tag);
  for(const type of ['pointerdown','pointermove','pointerup','pointercancel'])document.addEventListener(type,e=>{if(e.pointerType!=='touch')return;window.motionMarks.push({type,t:performance.now()-window.motionStart,x:e.clientX});window.motionPointer={x:e.clientX,y:e.clientY,down:!['pointerup','pointercancel'].includes(type)};dot.style.display=window.motionPointer.down?'block':'none';dot.style.left=(e.clientX-13)+'px';dot.style.top=(e.clientY-13)+'px';},{passive:true});
  function frame(){const main=document.querySelector('#main'),preview=document.querySelector('.chat-navigation-preview'),t=performance.now()-window.motionStart;const x=new DOMMatrixReadOnly(getComputedStyle(main).transform).m41;
   window.motionFrames.push({t,x,pointer:window.motionPointer?.x,hash:location.hash,recipient:document.querySelector('.composer')?.dataset.recipient||null,spinner:Boolean(main.querySelector('.spin')),preview:Boolean(preview),previewX:preview?new DOMMatrixReadOnly(getComputedStyle(preview).transform).m41:null,mainTop:main.scrollTop});tag.textContent=name+' '+Math.round(t)+'ms '+location.hash;window.motionFrame=requestAnimationFrame(frame);
  }window.motionFrame=requestAnimationFrame(frame);
 },name);
 const cdp=await context.newCDPSession(page),send=(type,x)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x,y:310,id:1}]});
 await send('touchStart',260);const steps=Math.max(3,Math.round(duration/16));
 // Pace input from one clock; waiting for every CDP acknowledgement artificially slows a flick.
 await Promise.all(Array.from({length:steps},async(_,index)=>{const i=index+1;await new Promise(r=>setTimeout(r,duration*i/steps));await send('touchMove',260+dx*i/steps);}));
 await send('touchEnd');await page.waitForTimeout(1100);
 const data=await page.evaluate(()=>{cancelAnimationFrame(window.motionFrame);return{frames:window.motionFrames,marks:window.motionMarks}});
 const released=data.marks.findLast(m=>m.type==='pointerup'),drag=data.frames.filter(f=>released&&f.t<released.t&&f.pointer!=null),lastDrag=drag.at(-1),post=data.frames.filter(f=>released&&f.t>=released.t),moving=post.find(f=>Math.abs(f.x-(lastDrag?.x||0))>2),firstB=post.find(f=>f.hash==='#b'),spinner=post.filter(f=>f.spinner);
 const summary={name,input:dx,duration,inventoryLatency:latency,releaseTime:released?.t,releaseX:lastDrag?.x,releaseMotionDelay:moving&&released?moving.t-released.t:null,commitDelay:firstB&&released?firstB.t-released.t:null,spinnerFrames:spinner.length,spinnerDuration:spinner.length?spinner.at(-1).t-spinner[0].t:0,finalHash:post.at(-1)?.hash,reads,feeds};
 summaries.push(summary);fs.writeFileSync(path.join(out,name+'-timeline.json'),JSON.stringify({summary,...data},null,2));await page.screenshot({path:path.join(out,name+'-final.png')});const video=page.video();await context.close();await video.saveAs(path.join(out,name+'.webm'));
}fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(summaries,null,2));console.log(JSON.stringify(summaries,null,2));}finally{await browser.close();}
