import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PATHS } from '../bridge/paths.mjs';
import { listPanes } from '../bridge/inventory.mjs';
import { openTasks, activeTerminals } from '../app/work-dashboard.mjs';
test('open tasks preserve real names and distinguish unchecked work, excluding closed and duplicate records',()=>{
  const item={id:'R-1',words:'תיקון יומן האוכל',project:'health-app',status:'ready'};
  const rows=openTasks([item,item,{...item,id:'R-2',status:'done'},{...item,id:'R-3',locked:true},{...item,id:'R-4',status:'dropped'},{...item,id:'R-5',status:'waiting'}]);
  assert.deepEqual(rows,[{title:'תיקון יומן האוכל',category:'יומן הבריאות',status:'מוכן לבדיקה'},{title:'תיקון יומן האוכל',category:'יומן הבריאות',status:'נדרש מענה'}]);
  assert.equal(openTasks(Array.from({length:351},(_,i)=>({...item,id:`R-${i}`}))).length,351);
});
test('active terminal list uses live state, ignores stale updates and does not invent progress',()=>{
  const p={id:'pane-1',project:'health-app',task:'בודק את היומן',dashboardState:'working'};
  const rows=activeTerminals([p,{...p,id:'idle',dashboardState:'idle'},{...p,id:'dead',alive:false},{...p,id:'sleep',sleeping:true},{...p,id:'waiting',dashboardState:'needs-you',sessionViewV2:{now:{stale:true,label:'old'}}},{...p,id:'unknown',task:null}]);
  assert.deepEqual(rows.map(r=>r.id),['pane-1','waiting','unknown']);
  assert.equal(rows[1].update,'בודק את היומן');
  assert.equal(rows[1].status,'נדרש מענה');
  assert.equal(rows[2].update,'עדיין לא נמסר עדכון עדכני על העבודה');
});
test('related requests become a named task while preserving every original request and the most urgent status',()=>{
  const rows=openTasks([{id:'R-1',words:'זה חסר ערך',project:'agent-manager',topics:['bot-chat-dashboard'],status:'ready'},{id:'R-2',words:'לשלב את הרשימות בממשק הקיים',project:'agent-manager',topics:['bot-chat-dashboard'],status:'waiting'}]);
  assert.equal(rows.length,1);assert.equal(rows[0].title,'תמונת מצב העבודה בתוך הצ׳אט');assert.equal(rows[0].status,'נדרש מענה');assert.equal(rows[0].details.length,2);
});
test('tasks keep project boundaries and exact original words behind Hebrew summaries',()=>{
  const words='Investigate /tmp/build.log for R-120';
  const rows=openTasks([{id:'a',words,project:'one',topics:['fix'],status:'assigned'},{id:'b',words:'בדיקת השמירה',project:'two',topics:['fix'],status:'new'}]);
  assert.equal(rows.length,2);
  assert.match(rows[0].title,/[א-ת]/);
  assert.equal(rows[0].details[0].text,words);
});
test('canonical freshness wins and technical updates remain exact only in details',()=>{
  const base={id:'p',alive:true,dashboardState:'working',statedTask:'obsolete',sessionAuthority:true,sessionViewV2:{goal:{label:'בדיקת היומן'},task:{label:'שיפור השמירה'},now:{stale:true,label:'npm run build'}}};
  const [row]=activeTerminals([base]);
  assert.equal(row.title,'בדיקת היומן');
  assert.equal(row.update,'עדיין לא נמסר עדכון עדכני על העבודה');
  const [technical]=activeTerminals([{...base,sessionViewV2:{...base.sessionViewV2,now:{stale:false,label:'Inspect /tmp/build.log'}}}]);
  assert.match(technical.update,/[א-ת]/);
  assert.equal(technical.details.update,'Inspect /tmp/build.log');
});
test('shared inventory preserves legacy declared work without a second fleet read',()=>{
  const previous=PATHS.agentStatus,dir=fs.mkdtempSync(path.join(os.tmpdir(),'tc-work-declared-'));
  try {
    PATHS.agentStatus=dir;
    fs.writeFileSync(path.join(dir,'pane-fixture.json'),JSON.stringify({paneId:'fixture',sessionId:'fixture',source:'codex',declaredGoal:'בדיקת היומן',statedTask:'בודק שמירת ארוחות'}));
    const [pane]=listPanes({workspace:{tabs:[]}});
    assert.equal(pane.goal,'בדיקת היומן');
    assert.equal(pane.statedTask,'בודק שמירת ארוחות');
    assert.equal(activeTerminals([{...pane,alive:true,dashboardState:'working'}])[0].update,'בודק שמירת ארוחות');
  } finally {PATHS.agentStatus=previous;fs.rmSync(dir,{recursive:true,force:true});}
});
