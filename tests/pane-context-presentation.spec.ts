import {expect,test} from '@playwright/test';
import {presentPaneGoal,presentPaneNow} from '../src/lib/paneContextPresentation';
import {mapUtilityCollapsed,saveMapUtilityCollapsed} from '../src/lib/mapUtilityVisibility';
import type {WorkstreamStatusSummary} from '../src/lib/types';
const now=10_000_000;
const summary = (extra:Partial<WorkstreamStatusSummary>):WorkstreamStatusSummary => ({task:'',path:'',now:'',status:'working',sessionId:'chat-a',updatedAt:now,...extra});
test('the screenshot request provides a grounded purpose clause with inference provenance',()=>{
  const goal=presentPaneGoal({summary:summary({userTask:'lets add to the complaints this to see that dropoffs will have all relevant context'}),sessionId:'chat-a',now});
  expect(goal).toEqual({text:'Dropoffs will have all relevant context',kind:'inferred',source:'latest-request',updatedAt:now,stale:false,canAuthorize:false});
});
test('a manual user goal takes precedence over captured and inferred context',()=>{
  const goal=presentPaneGoal({manualAsk:{text:'Make the handoff preserve the newest user request',source:'manual',updatedAt:now},capturedGoal:'Improve the handoff checker',summary:summary({mainTaskSource:'agent-goal',userTask:'Improve the handoff checker'}),now});
  expect(goal.kind).toBe('explicit');expect(goal.source).toBe('operator');expect(goal.canAuthorize).toBe(false);
});
test('context must belong to this conversation and be provenance bearing',()=>{
  expect(presentPaneGoal({capturedGoal:'Improve the handoff checker',summary:summary({mainTaskSource:'agent-goal',userTask:'Make handoffs reliable'}),sessionId:'chat-b',now}).kind).toBe('unknown');
  expect(presentPaneGoal({capturedGoal:'Improve the handoff checker',now}).kind).toBe('unknown');
});
test('missing or vague context stays unknown and never invents a project goal',()=>{
  for(const userTask of ['', 'go', 'fix it', 'so lets make it run automatically', 'Read /tmp/HANDOFF.md and continue exactly where it left off', 'Using mcp__lean_ctx__ctx_shell', 'Marking the plan task done.'])
    expect(presentPaneGoal({summary:summary({userTask}),now}).kind,userTask).toBe('unknown');
});
test('old inference retains its source time and explicitly becomes earlier context',()=>{
  expect(presentPaneGoal({summary:summary({userTask:'Improve handoffs so all relevant context is preserved',updatedAt:now-130_000}),now})).toMatchObject({kind:'inferred',updatedAt:now-130_000,stale:true,canAuthorize:false});
});
test('an earlier run request cannot replace the current goal',()=>{
  expect(presentPaneGoal({manualAsk:{text:'Improve handoffs so all context is preserved',source:'terminal-prompt',updatedAt:now,runId:'old'},runId:'new',now}).kind).toBe('unknown');
});
test('Hebrew requests and long purpose text remain intact',()=>{
  const text='לשפר את העברת השיחה כדי לוודא שכל ההקשר וההנחיות של המשתמש נשמרים';
  expect(presentPaneGoal({summary:summary({userTask:text}),now}).text).toBe('כל ההקשר וההנחיות של המשתמש נשמרים');
});
test('Now does not repeat the stale completed-step narration',()=>{
  expect(presentPaneNow({attention:'idle',reportedNow:'Marking the plan task done.',reportedStatus:'idle',reportedAt:now,now})).toBe('Finished — waiting for your next message');
  expect(presentPaneNow({attention:'running',reportedNow:'Marking the plan task done.',reportedStatus:'idle',reportedAt:now,now})).toBe('Working');
});
test('Now preserves unknown and waiting, without treating attached PTY as work',()=>{
  expect(presentPaneNow({attention:'unavailable',reportedNow:'Building the handoff checker',now})).toBe('Current activity not yet known');
  expect(presentPaneNow({attention:'waiting',now})).toBe('Waiting for you');
});
test('current narration wins only while fresh and genuinely running',()=>{
  const screen="● I'm adding search filters to the service directory.\n✻ Reticulating… (5m 28s · ↓ 12.2k tokens)";
  expect(presentPaneNow({attention:'running',screen,screenAt:now,now})).toContain('service directory');
  expect(presentPaneNow({attention:'running',screen,screenAt:now-130_000,now})).toBe('Working');
});
test('Services and Scope start collapsed and retain deliberate choices',()=>{
  const values=new Map<string,string>();const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);}};
  expect(mapUtilityCollapsed('services',storage)).toBe(true);expect(mapUtilityCollapsed('scope',storage)).toBe(true);
  saveMapUtilityCollapsed('services',false,storage);expect(mapUtilityCollapsed('services',storage)).toBe(false);expect(mapUtilityCollapsed('scope',storage)).toBe(true);
  saveMapUtilityCollapsed('services',true,storage);expect(mapUtilityCollapsed('services',storage)).toBe(true);
});
test('unavailable utility preference storage falls back safely to collapsed',()=>{
  const storage={getItem:()=>{throw Error('denied');},setItem:()=>{throw Error('denied');}};
  expect(mapUtilityCollapsed('services',storage)).toBe(true);expect(()=>saveMapUtilityCollapsed('services',false,storage)).not.toThrow();
});

test('a named automation surface remains usable while pronominal continuation stays unknown',()=>{
  expect(presentPaneGoal({summary:summary({userTask:'Make terminal recovery run automatically'}),now})).toMatchObject({kind:'inferred',text:'Make terminal recovery run automatically'});
  expect(presentPaneGoal({taskLine:{text:'Fix audio sync',source:'declared',capturedAt:now-200000,expiresAt:now-1000},now}).kind).toBe('unknown');
});

test('a provenance-bearing outcome Goal survives a generic shell-role header',()=>{
  const text='Keep terminal-summary evidence separated from transient command output';
  expect(presentPaneGoal({capturedGoal:'Nothing asked in this pane yet',summary:summary({mainTask:text,mainTaskSource:'opening-request'}),now})).toMatchObject({text,kind:'captured',source:'opening-request',canAuthorize:false});
});

test('agent-authored Goals are explicitly inferred while original user Goals stay captured',()=>{
  const text='Keep all user context and instructions between conversations';
  for(const mainTaskSource of ['agent-goal','about-what','plan-explanation','goal-task'] as const)
    expect(presentPaneGoal({summary:summary({mainTask:text,mainTaskSource}),now})).toMatchObject({text,kind:'inferred',source:mainTaskSource,canAuthorize:false});
  for(const mainTaskSource of ['opening-request','user-prompt'] as const)
    expect(presentPaneGoal({summary:summary({mainTask:text,mainTaskSource}),now})).toMatchObject({text,kind:'captured',source:mainTaskSource,canAuthorize:false});
});
test('TF-094: a price or $skill in a real request keeps the Goal; pasted menu choices and "but ..." follow-ups do not',()=>{
  const pasted='- All at once: I find out which project is running the Instagram and extra tweet scrapers, and raise our X limit to $3 a day.';
  const latest='search for the skill and slash command $about-what and port it to claude code';
  expect(presentPaneGoal({summary:summary({mainTask:pasted,mainTaskSource:'opening-request',userTask:latest}),sessionId:'chat-a',now}))
    .toMatchObject({text:latest,kind:'inferred',source:'latest-request'});
  expect(presentPaneGoal({summary:summary({userTask:'Raise the scraper budget to $3 a day for the tweet collector'}),sessionId:'chat-a',now}))
    .toMatchObject({text:'Raise the scraper budget to $3 a day for the tweet collector',kind:'inferred'});
  expect(presentPaneGoal({summary:summary({userTask:'but it has a loit of uneeded content'}),sessionId:'chat-a',now}).kind).toBe('unknown');
  expect(presentPaneGoal({summary:summary({mainTask:pasted.slice(2),mainTaskSource:'opening-request',userTask:latest}),sessionId:'chat-a',now}))
    .toMatchObject({text:latest,source:'latest-request'});
  expect(presentPaneGoal({summary:summary({userTask:'Bug: I click save and the login screen freezes'}),sessionId:'chat-a',now}).kind).toBe('inferred');
  // Live shape: userTask repeats the refused opening request, the newest ask rides separately.
  expect(presentPaneGoal({summary:summary({mainTask:pasted.slice(2),mainTaskSource:'opening-request',userTask:pasted.slice(2),
    task:'restart the phone link so the fix goes live',latestRequest:'restart the phone link so the fix for answering off-screen terminals goes live'}),sessionId:'chat-a',now}))
    .toMatchObject({text:'restart the phone link so the fix for answering off-screen terminals goes live',source:'latest-request'});
  expect(presentPaneGoal({summary:summary({userTask:'copy the files into $HOME and then rerun the build'}),sessionId:'chat-a',now}).kind).toBe('unknown');
});
