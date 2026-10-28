import test from 'node:test';
import assert from 'node:assert/strict';
import {projectWork} from '../app/work-dashboard.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {captureMessage,markItem,record,loadLedger} from '../bridge/requirements.mjs';
import {startLinkServer} from './helpers/link-server.mjs';
import {cli} from '../../scripts/termfleet-asks.mjs';

const link='https://example.test/delivered';
const base={id:'R-1',source:'bot:fixture',msgId:'message-1',project:'termcontrol',topics:['scroll-stuck'],words:'תיקון הגלילה',status:'ready',statusAt:100};
const delivered={...base,testing:{link,tryText:'גלול למעלה וקרא הודעה קודמת',expected:'ההודעה נשארת באותו מקום',artifact:link},evidence:[{at:100,what:`Live delivered scroll result at ${link}`} ]};
const checked={targetChecks:new Map([[link,{reachable:true,checkedAt:110}]]),now:110};

test('TF-128 ready is not an owner test without an explicit delivered experience and current target check',()=>{
  for(const item of [base,{...delivered,testing:{...delivered.testing,tryText:'רענן את הדף'}},{...delivered,testing:{...delivered.testing,tryText:'Run npm test to check backend guard'}},{...delivered,testing:{...delivered.testing,expected:''}},{...delivered,evidence:[]},{...delivered,testing:{...delivered.testing,artifact:'https://example.test/other'}}]){
    const [row]=projectWork([item],checked);
    assert.equal(row.bucket,'open');
    assert.ok(row.reasons.length);
  }
  assert.equal(projectWork([delivered])[0].bucket,'open');
  assert.equal(projectWork([delivered],{targetChecks:new Map([[link,{reachable:false,checkedAt:110}]])})[0].bucket,'open');
  assert.equal(projectWork([delivered],{targetChecks:new Map([[link,{reachable:true,checkedAt:90}]])})[0].bucket,'open');
  assert.equal(projectWork([delivered],{...checked,now:1000000})[0].bucket,'open');
  assert.equal(projectWork([delivered],{...checked,now:105})[0].bucket,'open');
  assert.equal(projectWork([{...delivered,evidence:delivered.evidence.map(e=>({...e,scope:'machine'}))}],checked)[0].bucket,'open');
  const [row]=projectWork([delivered],checked);
  assert.equal(row.bucket,'owner');
  assert.equal(row.ownerAction.expected,delivered.testing.expected);
  assert.equal(row.ownerAction.link,link);
});

test('TF-128 unrelated messages, unknown untitled material and unsafe links remain visible without inferred completion',()=>{
  const rows=projectWork([base,{...base,id:'R-2',msgId:'another-message'},
    {id:'unknown',status:'unrecognized',words:'הסבר שלא סווג',source:'bot:fixture'},
    {...delivered,id:'unsafe',msgId:'unsafe',testing:{...delivered.testing,link:'javascript:alert(1)',artifact:'javascript:alert(1)'}}],checked);
  assert.equal(rows.length,4);
  assert.ok(rows.every(row=>row.bucket==='open'));
  assert.equal(rows[2].details[0].text,'הסבר שלא סווג');
  assert.equal(rows[3].ownerAction,undefined);
});

test('TF-128 separates context, machine checks, hypothetical work and locked owner results without changing authority',()=>{
  const items=[{...base,id:'context',status:'context',words:'זה חלק מההסבר שלי'},
    {...delivered,id:'backend',kind:'machine',words:'בדיקת מניעת כתיבה כפולה'},
    {...base,id:'hypothetical',status:'new',words:'אולי בעתיד נוסיף תצוגה'},
    {...delivered,id:'locked',locked:true,confirmedBy:'owner-receipt'},
    {...base,id:'historical',msgId:'historical-message',status:'ready'}];
  const original=structuredClone(items);
  const rows=projectWork(items,checked);
  assert.deepEqual(rows.map(r=>r.bucket),['context','machine','open','history','open']);
  assert.deepEqual(items,original);
  assert.equal(rows[3].details[0].confirmedBy,'owner-receipt');
});

test('TF-128 same concrete deliverable retains fragments and mixed proof without borrowing owner eligibility',()=>{
  const items=[delivered,{...base,id:'R-2',part:2,of:2,words:'וגם כשחוזרים להודעה',status:'assigned'},
    {...base,id:'R-3',kind:'machine',words:'בדיקת הגנת הרקע',evidence:[{what:'unit guard passed',at:100}]}];
  const rows=projectWork(items,checked);
  assert.equal(rows.length,2);
  assert.equal(rows[0].bucket,'open');
  assert.equal(rows[0].details.length,2);
  assert.deepEqual(rows[0].details.map(d=>d.text),items.slice(0,2).map(i=>i.words));
  assert.equal(rows[0].details[1].msgId,'message-1');
  assert.equal(rows[0].details[1].part,2);
  assert.equal(rows[1].bucket,'machine');
});

test('TF-128 ready boundary writes a checked contract, keeps old ready open, and refuses an unavailable artifact',async t=>{
  const server=await startLinkServer(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'tc-projection-contract-'));
  t.after(()=>{server.stop();fs.rmSync(dir,{recursive:true,force:true});});
  const [item]=captureMessage({text:'תיקון הגלילה בצ׳אט',source:'bot:fixture',project:'termcontrol',msgId:'contract'},{dir});
  const artifact=server.url('/ok');
  const input={status:'ready',id:item.id,evidence:`Actual delivered scroll result is visible at ${artifact}`,tryText:'גלול למעלה וקרא הודעה קודמת',expected:'ההודעה נשארת באותו מקום',artifact};
  const unavailable=markItem({...input,artifact:server.url('/missing'),evidence:`Actual delivered scroll result is visible at ${server.url('/missing')}`},{dir});
  assert.match(unavailable.error,/does not work|do not work|answered 404/);
  assert.equal(loadLedger({dir}).items.get(item.id).status,'new');
  const result=markItem(input,{dir});
  assert.equal(result.error,undefined);
  record(result.events,{dir});
  let saved=loadLedger({dir}).items.get(item.id);
  assert.equal(saved.testing.targetCheck.method,'ready-link-check');
  assert.equal(saved.statusAt,saved.testing.targetCheck.checkedAt);
  assert.equal(projectWork([saved])[0].bucket,'owner');
  const legacy=markItem({status:'ready',id:item.id,note:`Try: scroll the chat and read ${artifact}`,evidence:`Actual delivered scroll result is visible at ${artifact}`},{dir});
  assert.equal(legacy.error,undefined);record(legacy.events,{dir});
  saved=loadLedger({dir}).items.get(item.id);
  assert.equal(saved.testing,undefined);
  assert.equal(projectWork([saved])[0].bucket,'open');
  const cliResult=cli(['ready',item.id,'--try',input.tryText,'--expected',input.expected,'--artifact',artifact,'--evidence',input.evidence],{TERMFLEET_REQ_DIR:dir});
  assert.equal(cliResult.ok,true,cliResult.message);
  assert.equal(projectWork([loadLedger({dir}).items.get(item.id)])[0].bucket,'owner');
});

test('TF-128 isolated check seam cannot accept partial contracts or manufacture the expected outcome',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tc-projection-seam-'));
  try{
    const [item]=captureMessage({text:'תיקון הגלילה',source:'bot:fixture',project:'termcontrol'},{dir});
    let checked=0;
    const options={dir,checkLinks:()=>{checked++;return null;}};
    assert.match(markItem({status:'ready',id:item.id,tryText:'גלול למעלה וקרא הודעה',artifact:link,evidence:`Delivered artifact is visible at ${link}`},options).error,/--expected/);
    assert.equal(checked,0);
    const result=markItem({status:'ready',id:item.id,tryText:'בדוק את מנגנון ההגנה',expected:'אין שתי כתיבות לאותה רשומה',artifact:link,testKind:'machine',evidence:`Delivered artifact is visible at ${link}`},options);
    assert.equal(checked,1);record(result.events,{dir});
    assert.equal(projectWork([...loadLedger({dir}).items.values()])[0].bucket,'machine');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
