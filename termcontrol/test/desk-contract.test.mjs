import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readDesk, deskRoot } from '../bridge/desk.mjs';
import { ChoiceReceipts } from '../bridge/choice-receipts.mjs';
import { sendCustomAnswer, promptKey } from '../bridge/send.mjs';
import { questionFromRecords, questionResultsFromRecords } from '../bridge/asks.mjs';
import { isNoise, clean } from '../bridge/noise.mjs';
import { visibleScreenOf } from '../bridge/screen.mjs';

const temp=t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'tc-desk-contract-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;};
test('day adapter projects the complete export and honestly reports coverage',t=>{
 const root=temp(t),now=Date.now();fs.mkdirSync(path.join(root,'.state'));
 const data={generated:'2026-10-04T09:10:00',fixed_blocks:[{date:'2026-10-04',time:'10:30',what:'סקירת הצעה',source:'N-test',secret:'never exported'},{date:'2026-10-03',time:'14:00',what:'Unfinished block'}],today:[{id:'N1',title:'Today',status:'open',due:'2026-10-04'}],overdue:[{id:'N2',title:'Overdue',status:'deferred',due:'2026-10-03'}],week:[],later:[],undated:[{id:'N3',title:'No time',status:'open'}]};
 const file=path.join(root,'.state/live-timeline.json');fs.writeFileSync(file,JSON.stringify(data));
 const read=readDesk({}, {root,now});assert.equal(read.available,true);assert.equal(read.today.length,1);assert.equal(read.undated.length,1);assert.equal(read.fixed_blocks.length,2);assert.equal(read.fixed_blocks[0].secret,undefined);assert.equal(read.calendar.available,false);assert.ok(read.gaps.some(g=>g.includes('Calendar')));
 fs.writeFileSync(path.join(root,'.state/timeline-calendar.json'),JSON.stringify({day:'2026-10-04',at:now/1000,lines:['2026-10-04 11:45 | Client call']}));
 assert.deepEqual(readDesk({}, {root,now}).calendar_events,[{date:'2026-10-04',time:'11:45',title:'Client call'}]);
 fs.utimesSync(file,new Date(now-7*3600e3),new Date(now-7*3600e3));assert.equal(readDesk({}, {root,now}).stale,true);
 fs.writeFileSync(file,'bad json');assert.equal(readDesk({}, {root,now}).available,false);assert.equal(deskRoot({cwd:root}),null);
});

test('durable request receipts prevent duplicate keys across concurrency and restart',async t=>{
 const file=path.join(temp(t),'receipts.json'),receipts=new ChoiceReceipts(file);let count=0,release;
 const promise=receipts.send('pane','question1','1',async()=>{count++;await new Promise(resolve=>release=resolve);return {ok:true};});
 const concurrent=await receipts.send('pane','question1','1',()=>{count++;return {ok:true};});assert.equal(concurrent.uncertain,true);release();await promise;
 const reconnected=new ChoiceReceipts(file);assert.equal((await reconnected.send('pane','question1','1',()=>{count++;})).duplicate,true);assert.equal(count,1);
 assert.match((await reconnected.send('pane','question1','2',()=>{})).error,/already sent/);
 await reconnected.send('pane','question2','private custom text',async()=>{count++;throw Error('response lost');});
 assert.equal((await new ChoiceReceipts(file).send('pane','question2','private custom text',()=>{count++;})).uncertain,true);assert.equal(count,2);assert.ok(!fs.readFileSync(file,'utf8').includes('private custom text'));
 await reconnected.send('pane','question3','3',async()=>({error:'not live',notSent:true}));assert.equal((await reconnected.send('pane','question3','3',async()=>({ok:true}))).ok,true);
});

test('custom answers reach the matching two-question destination exactly, without cancel keys',async()=>{
 const pane={provider:'claude',sessionId:'fixture-session',id:'fixture-pane'};
 const questions=[{question:'Which proposal first?',options:[{label:'Draft'},{label:'Review'}]},{question:'Which day works?',options:[{label:'Tomorrow'},{label:'Next week'}]}];
 const record={message:{role:'assistant',content:[{type:'tool_use',name:'AskUserQuestion',id:'fixture-call',input:{questions}}]}};
 const answers=['אבחר לכתוב טיוטה\nThen review the scope','מחר אחרי השיחה · Tomorrow'];const destination={};let keys=[];
 for(let i=0;i<2;i++){
  const question=questionFromRecords(pane,[JSON.stringify(record)],questions[i].question);assert.equal(question.questionIndex,i);assert.equal(question.questionCount,2);
  let screen=questions[i].question+'\n1. First\n2. Second\n3. Type something\n4. Chat about this',text='';
  const result=await sendCustomAnswer(pane,question,answers[i],{record:()=>{},pause:async()=>{},screen:async()=>screen,write:async key=>{keys.push(key);if(key==='3')screen=questions[i].question+'\nType something.';else if(key.startsWith('\x1b[200~')){text=key.slice(6,-6);screen=questions[i].question+'\nType something.\n'+text;}else if(key==='\r')destination[questions[i].question]=text;else throw Error('Unexpected terminal input');}});
  assert.equal(result.ok,true);assert.equal(destination[questions[i].question],answers[i]);
 }
 assert.equal(keys.filter(k=>k==='\x1b').length,0,'local cancel must never decline the request');
 const receipt=questionResultsFromRecords([{message:{role:'user',content:[{type:'tool_result',tool_use_id:'fixture-call',content:JSON.stringify({answers:destination})}]}}]);
 assert.equal(receipt[0].sourceId,'fixture-call');assert.equal(receipt[0].declined,false);assert.ok(JSON.parse(receipt[0].text).answers['Which proposal first?']===answers[0]);
 const declined=questionResultsFromRecords([{message:{role:'user',content:[{type:'tool_result',tool_use_id:'fixture-call',content:'User declined to answer questions'}]}}]);assert.equal(declined[0].declined,true);
});

test('custom answer fails closed on stale, unsupported or unverified terminal fields',async()=>{
 const pane={provider:'claude',id:'fixture'},q={title:'Current question?',kind:'question'};let writes=[];
 const io={screen:async()=>'A different question?\n3. Type something',write:async k=>writes.push(k),pause:async()=>{}};
 assert.equal((await sendCustomAnswer(pane,q,'תשובה',io)).notSent,true);assert.deepEqual(writes,[]);
 assert.equal((await sendCustomAnswer(pane,q,'  ',io)).notSent,true);assert.equal((await sendCustomAnswer(pane,q,'x'.repeat(8001),io)).notSent,true);
 assert.equal((await sendCustomAnswer({...pane,provider:'codex'},q,'answer',io)).notSent,true);
 io.screen=async()=>q.title+'\n3. Type something\n4. Chat about this';assert.equal((await sendCustomAnswer(pane,q,'answer',io)).notSent,true);assert.deepEqual(writes,['3'],'never enters text before a verified field');
});

test('hook and skill envelopes are excluded without losing genuine pasted content',()=>{
 assert.equal(isNoise('[[ "$PLAN_RUNNER" = 1 ]] || python3 "script.py"]: PLAN GATE: internal'),false);
 assert.match(clean('[[ "$PLAN_RUNNER" = 1 ]] || python3 "script.py"]: PLAN GATE: 30 open thread(s) need review'),/^Planning check blocked: 30 open items/);
 assert.equal(clean('הודעה אמיתית\n\nBase directory for this skill: /home/example/.claude/skills/spawn-on-termfleet\n# Instructions'),'הודעה אמיתית');
 assert.equal(clean('<pasted_content id="x">Useful table</pasted_content>\nIs this current?'),'Useful table\nIs this current?');
 assert.equal(clean('Please explain PLAN GATE and this command'),'Please explain PLAN GATE and this command');
});

test('custom field identity comes from the fresh rendered VT screen, never ANSI scrollback',t=>{
 const file=path.join(temp(t),'snapshot.json'),now=Date.now();
 fs.writeFileSync(file,JSON.stringify({sourceApp:'termfleet',terminals:[{terminalId:'pane',terminalVisibleText:'Question?\nType something.',terminalVisibleTextUpdatedAt:now}]}));
 assert.equal(visibleScreenOf('pane',{file,now}),'Question?\nType something.');
 assert.equal(visibleScreenOf('other',{file,now}),null);assert.equal(visibleScreenOf('pane',{file,now:now+10000}),null);assert.equal(visibleScreenOf('pane',{file,now,after:now+1}),null);
});

test('an unchanged question uses its current exact-pane observation, while post-input checks require new content',t=>{
 const file=path.join(temp(t),'stable-screen.json'),now=Date.now(),old=now-8*3600e3;
 const snapshot={sourceApp:'termfleet',updatedAt:now,terminals:[{terminalId:'waiting-pane',updatedAt:now,terminalVisibleText:'Current question?\n1. First\n2. Second',terminalVisibleTextUpdatedAt:old}]};
 const save=()=>fs.writeFileSync(file,JSON.stringify(snapshot));save();
 assert.equal(visibleScreenOf('waiting-pane',{file,now}),snapshot.terminals[0].terminalVisibleText,'unchanged VT content does not expire while this pane is freshly observed');
 assert.equal(visibleScreenOf('waiting-pane',{file,now,after:now-1}),null,'a new keystroke still requires a new VT content observation');
 snapshot.terminals[0].updatedAt=now-30000;save();assert.equal(visibleScreenOf('waiting-pane',{file,now}),null,'fresh global heartbeat cannot revive a stale exact pane');
 snapshot.terminals[0].updatedAt=now+5000;save();assert.equal(visibleScreenOf('waiting-pane',{file,now}),null,'future timestamps fail closed');
 assert.equal(visibleScreenOf('another-pane',{file,now}),null);
});

test('Claude question digits select directly without submitting the next question; permission keys are unchanged',()=>{
 assert.equal(promptKey({provider:'claude'},'1',{},'question'),'1');
 assert.equal(promptKey({provider:'codex'},'2',{},'question'),'2');
 assert.equal(promptKey({provider:'claude'},'1',{},'permission'),'1\r');
 assert.equal(promptKey({provider:'opencode'},'yes',{yes:'y'},'permission'),'y');
});

test('Claude multi-question review is a distinct explicit submission, not a resurrected first question',()=>{
 const pane={provider:'claude',sessionId:'review-fixture',id:'review-pane'};
 const questions=[{question:'First question?',options:[{label:'Draft'},{label:'Review'}]},{question:'Second question?',options:[{label:'Tomorrow'},{label:'Later'}]}];
 const record={message:{role:'assistant',content:[{type:'tool_use',name:'AskUserQuestion',id:'review-call',input:{questions}}]}};
 const lines=[JSON.stringify(record)],screen='Review your answers\nFirst question?\n→ Draft\nSecond question?\n→ Later\nReady to submit your answers?\nSubmit answers\nCancel';
 const ask=questionFromRecords(pane,lines,screen);
 assert.equal(ask.stage,'review');assert.equal(ask.questionIndex,2);assert.equal(ask.options[0].key,'submit');
 assert.deepEqual(ask.reviewAnswers,[{question:'First question?',answer:'Draft'},{question:'Second question?',answer:'Later'}]);
 assert.notEqual(ask.id,questionFromRecords(pane,lines,questions[0].question).id);
 assert.equal(promptKey(pane,'submit',{},'question-submit'),'\r');
 assert.equal(questionFromRecords(pane,lines,screen+'\nYou have not answered all questions').options.length,0);
});
